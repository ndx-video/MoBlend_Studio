import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getBrokerBase } from '../broker/config';
import { logCheckpoint } from '../util/flow';

export type StatusLevel = 'info' | 'success' | 'warning' | 'error';
export type BrokerState = 'unknown' | 'starting' | 'ready' | 'unreachable';

export type StatusEntry = {
  message: string;
  level: StatusLevel;
  at: number;
};

const HISTORY_CAP = 200;
const BROKER_WAIT_MS = 1500;
const BROKER_MAX_ATTEMPTS = 40;

export function isBrokerUp(health: Record<string, unknown> | null | undefined): boolean {
  if (!health) return false;
  if (health.status === 'ok' || health._direct === true) return true;
  const code = health.http_status;
  if (typeof code === 'number' && code >= 200 && code < 500) return true;
  if (health.status === 'unreachable') return false;
  if ('loaded' in health || 'dirty' in health || 'template_id' in health) return true;
  return false;
}

export function formatStatusEntry(entry: StatusEntry): string {
  const t = new Date(entry.at).toLocaleTimeString();
  return `[${t}] ${entry.level}: ${entry.message}`;
}

interface StatusContextValue {
  message: string;
  level: StatusLevel;
  brokerState: BrokerState;
  brokerHealth: Record<string, unknown> | null;
  history: StatusEntry[];
  setStatus: (message: string, level?: StatusLevel) => void;
  clearStatus: () => void;
  ensureBroker: () => Promise<boolean>;
  refreshBroker: () => Promise<BrokerState>;
}

const StatusContext = createContext<StatusContextValue | null>(null);

type GoHealth = () => Promise<Record<string, unknown>>;
type GoStart = (path?: string) => Promise<void>;

export function StatusProvider({
  children,
  engineHealth,
  startEngine,
}: {
  children: React.ReactNode;
  engineHealth: GoHealth;
  startEngine: GoStart;
}) {
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<StatusLevel>('info');
  const [history, setHistory] = useState<StatusEntry[]>([]);
  const [brokerState, setBrokerState] = useState<BrokerState>('unknown');
  const [brokerHealth, setBrokerHealth] = useState<Record<string, unknown> | null>(null);
  const startingRef = useRef(false);
  const brokerStateRef = useRef<BrokerState>('unknown');
  const engineHealthRef = useRef(engineHealth);
  const startEngineRef = useRef(startEngine);
  const ensurePromiseRef = useRef<Promise<boolean> | null>(null);
  engineHealthRef.current = engineHealth;
  startEngineRef.current = startEngine;

  const setBroker = useCallback((next: BrokerState) => {
    brokerStateRef.current = next;
    setBrokerState(next);
  }, []);

  const setStatus = useCallback((msg: string, lvl: StatusLevel = 'info') => {
    setMessage(msg);
    setLevel(lvl);
    setHistory(prev => {
      const next = [...prev, { message: msg, level: lvl, at: Date.now() }];
      return next.length > HISTORY_CAP ? next.slice(-HISTORY_CAP) : next;
    });
  }, []);

  const clearStatus = useCallback(() => {
    setMessage('');
    setLevel('info');
  }, []);

  const probeBroker = useCallback(async (): Promise<Record<string, unknown>> => {
    try {
      const h = await engineHealthRef.current();
      if (isBrokerUp(h)) return { ...h, _source: 'go' };
    } catch (e: unknown) {
      const err = e as { message?: string };
      logCheckpoint('[broker] Go EngineHealth failed', err?.message || String(e));
    }

    try {
      const res = await fetch(`${getBrokerBase()}/api/v1/health`, {
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      const merged: Record<string, unknown> = {
        ...(typeof body === 'object' && body ? body : {}),
        http_status: res.status,
        _direct: res.ok,
        _source: 'fetch',
      };
      if (res.ok) return merged;
      merged.status = 'unreachable';
      merged.error = `HTTP ${res.status}`;
      return merged;
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { status: 'unreachable', error: err?.message || String(e), _source: 'fetch' };
    }
  }, []);

  const applyProbeResult = useCallback((h: Record<string, unknown>, announceRecovery = false): BrokerState => {
    setBrokerHealth(h);
    const up = isBrokerUp(h);
    if (up) {
      if (announceRecovery && brokerStateRef.current !== 'ready') {
        setStatus('Broker connected.', 'success');
      }
      startingRef.current = false;
      setBroker('ready');
      return 'ready';
    }
    if (startingRef.current) {
      setBroker('starting');
      return 'starting';
    }
    setBroker('unreachable');
    return 'unreachable';
  }, [setBroker, setStatus]);

  const refreshBroker = useCallback(async (announceRecovery = false): Promise<BrokerState> => {
    const h = await probeBroker();
    return applyProbeResult(h, announceRecovery);
  }, [applyProbeResult, probeBroker]);

  const waitForBrokerReady = useCallback(async (opts?: {
    maxAttempts?: number;
    onProgress?: (attempt: number) => void;
    cancelled?: () => boolean;
  }): Promise<boolean> => {
    const max = opts?.maxAttempts ?? BROKER_MAX_ATTEMPTS;
    for (let i = 0; i < max; i++) {
      if (opts?.cancelled?.()) return false;
      const h = await probeBroker();
      if (isBrokerUp(h)) {
        applyProbeResult(h);
        return true;
      }
      opts?.onProgress?.(i);
      setBroker('starting');
      await new Promise(r => setTimeout(r, BROKER_WAIT_MS));
    }
    startingRef.current = false;
    setBroker('unreachable');
    return false;
  }, [applyProbeResult, probeBroker, setBroker]);

  const doEnsureBroker = useCallback(async (): Promise<boolean> => {
    logCheckpoint('[broker] ensureBroker', 'start');
    setStatus('[1/3] Checking broker…', 'info');
    const current = await refreshBroker();
    if (current === 'ready') {
      setStatus('[1/3] Broker ready.', 'success');
      return true;
    }

    if (!startingRef.current) {
      startingRef.current = true;
      setBroker('starting');
      setStatus('[2/3] Starting engine…', 'warning');
      try {
        await startEngineRef.current('');
        logCheckpoint('[broker] StartEngine', 'spawn requested');
      } catch (e: unknown) {
        const err = e as { message?: string };
        startingRef.current = false;
        setBroker('unreachable');
        setStatus('[2/3] Start Engine failed: ' + (err?.message || String(e)), 'error');
        return false;
      }
    } else {
      setStatus('[2/3] Engine startup in progress…', 'info');
    }

    setStatus('[3/3] Waiting for broker health…', 'info');
    const ok = await waitForBrokerReady({
      onProgress: (i) => {
        if (i % 2 === 0) {
          setStatus(`[3/3] Waiting for broker… (${i + 1}/${BROKER_MAX_ATTEMPTS})`, 'info');
        }
      },
    });

    if (ok) {
      setStatus('Broker ready.', 'success');
      return true;
    }

    const h = await probeBroker();
    const detail = typeof h.error === 'string' ? h.error : 'no response on port 8000';
    setStatus(`[3/3] Broker unreachable (${detail}). Suite → Start Engine.`, 'error');
    return false;
  }, [probeBroker, refreshBroker, setBroker, setStatus, waitForBrokerReady]);

  const ensureBroker = useCallback(async (): Promise<boolean> => {
    if (brokerStateRef.current === 'ready') return true;
    if (ensurePromiseRef.current) {
      setStatus('[broker] Joining in-flight startup…', 'info');
      return ensurePromiseRef.current;
    }
    const p = doEnsureBroker().finally(() => {
      ensurePromiseRef.current = null;
      startingRef.current = false;
    });
    ensurePromiseRef.current = p;
    return p;
  }, [doEnsureBroker, setStatus]);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    (async () => {
      setStatus('Connecting to broker…', 'info');
      const initial = await probeBroker();
      if (cancelled) return;
      if (isBrokerUp(initial)) {
        applyProbeResult(initial);
        setStatus('Broker connected.', 'success');
        return;
      }

      startingRef.current = true;
      setBroker('starting');
      setStatus('Starting engine (first launch may take up to 60s)…', 'info');
      try {
        await startEngineRef.current('');
      } catch (e: unknown) {
        const err = e as { message?: string };
        setStatus('Start Engine failed: ' + (err?.message || String(e)), 'error');
      }
      if (cancelled) return;

      const ok = await waitForBrokerReady({
        cancelled: isCancelled,
        onProgress: (i) => {
          if (cancelled) return;
          if (i > 0 && i % 3 === 0) setStatus(`Waiting for broker… (${i + 1}/${BROKER_MAX_ATTEMPTS})`, 'info');
        },
      });
      if (cancelled) return;
      if (ok) {
        setStatus('Broker connected.', 'success');
      } else {
        const h = await probeBroker();
        const detail = typeof h.error === 'string' ? h.error : 'no response on port 8000';
        const src = h._source === 'go' ? 'Go probe' : 'browser fetch';
        setStatus(
          `Broker unreachable at ${getBrokerBase()} (${detail} via ${src}). ` +
          'Restart broker (Suite → Stop/Start Engine), then relaunch Studio.',
          'error',
        );
      }
      startingRef.current = false;
    })();

    const id = setInterval(() => {
      if (cancelled) return;
      void refreshBroker(true);
    }, 3000);

    return () => {
      cancelled = true;
      startingRef.current = false;
      clearInterval(id);
    };
  }, [applyProbeResult, probeBroker, refreshBroker, setBroker, setStatus, waitForBrokerReady]);

  return (
    <StatusContext.Provider value={{
      message, level, brokerState, brokerHealth, history,
      setStatus, clearStatus, ensureBroker, refreshBroker,
    }}>
      {children}
    </StatusContext.Provider>
  );
}

export function useStatus() {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error('useStatus must be used within StatusProvider');
  return ctx;
}