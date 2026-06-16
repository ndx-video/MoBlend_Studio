import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getHealth, getManifest, Manifest } from '../broker/client';
import { AssetAssignModal } from '../components/AssetAssignModal';
import {
  assetParamsFromManifest,
  basename,
  copyToSandbox,
  inferAssetKind,
  ingestAssetParam,
} from '../util/assets';
import { FlowError, runStep } from '../util/flow';
import { useStatus } from '../layout/StatusContext';

type AssetDropContextValue = {
  pendingPaths: string[];
  clearPending: () => void;
  refreshSandboxSignal: number;
  notifySandboxUpdated: (paths?: string[]) => void;
  lastManifest: Manifest | null;
  refreshManifest: () => Promise<Manifest | null>;
  onParamIngested: (paramId: string, value: string) => void;
  paramIngestHandlers: React.MutableRefObject<((paramId: string, value: string) => void) | null>;
};

const AssetDropContext = createContext<AssetDropContextValue | null>(null);

export function AssetDropProvider({ children }: { children: React.ReactNode }) {
  const { setStatus } = useStatus();
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [modalPaths, setModalPaths] = useState<string[] | null>(null);
  const [modalManifest, setModalManifest] = useState<Manifest | null>(null);
  const [refreshSandboxSignal, setRefreshSandboxSignal] = useState(0);
  const [lastManifest, setLastManifest] = useState<Manifest | null>(null);
  const paramIngestHandlers = React.useRef<((paramId: string, value: string) => void) | null>(null);

  const notifySandboxUpdated = useCallback((paths?: string[]) => {
    setRefreshSandboxSignal(n => n + 1);
    if (paths?.length) {
      setPendingPaths(prev => [...prev, ...paths]);
    }
  }, []);

  const clearPending = useCallback(() => setPendingPaths([]), []);

  const refreshManifest = useCallback(async () => {
    setStatus('[asset] Checking broker for loaded template…', 'info');
    try {
      const health = await getHealth({ timeoutMs: 8_000 });
      if (!health.loaded) {
        setLastManifest(null);
        setStatus('[asset] Broker up but no template loaded.', 'info');
        return null;
      }
      const m = await getManifest({ timeoutMs: 15_000 });
      setLastManifest(m);
      const assetCount = assetParamsFromManifest(m).length;
      setStatus(`[asset] Template loaded (${m.template_id}) — ${assetCount} asset param(s).`, 'info');
      return m;
    } catch (e: unknown) {
      setStatus(`[asset] Manifest refresh failed: ${(e as Error)?.message || e}`, 'error');
      return null;
    }
  }, [setStatus]);

  const onParamIngested = useCallback((paramId: string, value: string) => {
    paramIngestHandlers.current?.(paramId, value);
  }, []);

  const handleDroppedSandboxPaths = useCallback(async (paths: string[]) => {
    if (!paths?.length) return;
    notifySandboxUpdated(paths);

    const manifest = (await refreshManifest()) ?? lastManifest;
    const assetParams = assetParamsFromManifest(manifest);
    if (!manifest || assetParams.length === 0) {
      setStatus('[asset] Files in sandbox — open Editor or assign from Assets when a template is loaded.', 'info');
      return;
    }

    const path = paths[0];
    const kind = inferAssetKind(path);
    setStatus(`[asset] Resolving ingest target for ${basename(path)} (kind: ${kind || 'unknown'})…`, 'info');
    const matching = assetParams.filter(p => p.type === kind);
    if (!kind || matching.length === 0) {
      setStatus(`[asset] Dropped file type does not match any manifest asset param (${basename(path)}).`, 'error');
      return;
    }
    if (matching.length === 1) {
      setStatus(`[asset] Auto-assign → param "${matching[0].id}" (${matching[0].type}).`, 'info');
      try {
        const result = await ingestAssetParam(matching[0].id, path, setStatus);
        onParamIngested(matching[0].id, String(result.value));
      } catch (e: unknown) {
        if (!(e instanceof FlowError)) {
          setStatus(`[asset] Ingest failed: ${(e as Error)?.message || e}`, 'error');
        }
      }
      return;
    }

    setStatus(`[asset] ${matching.length} matching params — opening assign dialog.`, 'info');
    setModalManifest(manifest);
    setModalPaths(paths);
  }, [lastManifest, notifySandboxUpdated, onParamIngested, refreshManifest, setStatus]);

  const handleRawFileDrop = useCallback(async (paths: string[], x: number, y: number) => {
    if (!paths?.length) {
      setStatus('[asset] Drop event with empty path list.', 'warning');
      return;
    }
    setStatus(`[asset] Window drop at (${x}, ${y}) — ${paths.length} file(s).`, 'info');
    paths.forEach((p, i) => setStatus(`[asset]   source[${i}]: ${basename(p)}`, 'info'));

    try {
      const sandboxPaths = await runStep(
        '[asset] Copy to sandbox (Go)',
        setStatus,
        () => copyToSandbox(paths),
        { successMsg: `[asset] Sandbox copy OK — ${paths.length} file(s) hashed to ~/.moblend/assets/` },
      );
      if (!sandboxPaths.length) {
        setStatus('[asset] Sandbox copy returned no paths (permission or read error?).', 'error');
        return;
      }
      sandboxPaths.forEach((p, i) => setStatus(`[asset]   sandbox[${i}]: ${basename(p)}`, 'info'));
      await handleDroppedSandboxPaths(sandboxPaths);
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus(`[asset] Drop pipeline failed: ${(e as Error)?.message || e}`, 'error');
      }
    }
  }, [handleDroppedSandboxPaths, setStatus]);

  const handleRawFileDropRef = useRef(handleRawFileDrop);
  handleRawFileDropRef.current = handleRawFileDrop;

  useEffect(() => {
    const rt = (window as Window & {
      runtime?: {
        OnFileDrop?: (cb: (x: number, y: number, paths: string[]) => void, useDropTarget: boolean) => void;
        OnFileDropOff?: () => void;
      };
    }).runtime;
    if (!rt?.OnFileDrop) {
      setStatus('[asset] File-drop API unavailable (use wails dev; EnableFileDrop must be true in main.go).', 'warning');
      return;
    }
    setStatus('[asset] File-drop listener active — drop files anywhere in the window.', 'info');
    rt.OnFileDrop((x, y, paths) => {
      void handleRawFileDropRef.current(paths, x, y);
    }, false);
    return () => { rt.OnFileDropOff?.(); };
  }, [setStatus]);

  return (
    <AssetDropContext.Provider value={{
      pendingPaths,
      clearPending,
      refreshSandboxSignal,
      notifySandboxUpdated,
      lastManifest,
      refreshManifest,
      onParamIngested,
      paramIngestHandlers,
    }}>
      {children}
      {modalPaths && modalManifest && (
        <AssetAssignModal
          paths={modalPaths}
          manifest={modalManifest}
          onClose={() => { setModalPaths(null); setModalManifest(null); }}
          onIngested={onParamIngested}
          setStatus={setStatus}
        />
      )}
    </AssetDropContext.Provider>
  );
}

export function useAssetDrop() {
  const ctx = useContext(AssetDropContext);
  if (!ctx) throw new Error('useAssetDrop must be used within AssetDropProvider');
  return ctx;
}