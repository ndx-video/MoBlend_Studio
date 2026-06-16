import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import AppShell from './layout/AppShell';
import { StatusProvider, useStatus, isBrokerUp } from './layout/StatusContext';
import { useViewportStream } from './broker/useViewportStream';
import { getHealth, getManifest, loadProject, patchParameters, patchSlots, startExport, getExportStatus, getTemplates, refreshTemplates, Manifest, CatalogEntry } from './broker/client';
import { FlowError, runStep } from './util/flow';
import { basename, inferAssetKind, isAssetParamType, ingestAssetParam, listSandboxAssets } from './util/assets';
import { AssetParamRow } from './components/AssetParamRow';
import { AssetDropProvider, useAssetDrop } from './context/AssetDropContext';
import * as WailsApp from '../wailsjs/go/main/App';

declare const window: Window & { go?: { main?: { App?: Record<string, unknown> } } };

function wailsOr<T extends (...args: never[]) => unknown>(fn: T, fallback: T): T {
  return (typeof fn === 'function' ? fn : fallback) as T;
}

function goApp(): Record<string, unknown> | undefined {
  return window?.go?.main?.App;
}

/** Wails (string, bool) bindings resolve to [value, ok] at runtime. */
function parsePathBoolResult(result: unknown): { path: string; ok: boolean } {
  if (Array.isArray(result) && result.length >= 2) {
    return { path: String(result[0] ?? ''), ok: Boolean(result[1]) };
  }
  if (typeof result === 'string' && result) {
    return { path: result, ok: true };
  }
  return { path: '', ok: false };
}

function useGoBindings() {
  const go = window?.go?.main?.App;
  const hasWails = Boolean(go);
  return {
    hasWails,
    PickMoBlendFile: wailsOr(WailsApp.PickMoBlendFile, async () => ''),
    StartEngine: wailsOr(WailsApp.StartEngine, async (_p?: string) => {}),
    StopEngine: wailsOr(WailsApp.StopEngine, async () => {}),
    GetRecentProjects: wailsOr(WailsApp.GetRecentProjects, async () => []),
    AddRecentProject: wailsOr(WailsApp.AddRecentProject, async (_p: string) => {}),
    CopyToAssetSandbox: wailsOr(WailsApp.CopyToAssetSandbox, async (ps: string[]) => ps),
    ListAssetSandbox: wailsOr(WailsApp.ListAssetSandbox, async () => [] as string[]),
    PickAssetFile: wailsOr(WailsApp.PickAssetFile, async (_k: string) => ''),
    GetBrokerBaseURL: wailsOr(WailsApp.GetBrokerBaseURL, async () => 'http://127.0.0.1:8000'),
    EngineHealth: wailsOr(WailsApp.EngineHealth, async () => ({ status: 'unreachable', error: 'Wails bindings not loaded' })),
    GetDefaultTemplatePath: wailsOr(WailsApp.GetDefaultTemplatePath, async () => ''),
    Reload: wailsOr(WailsApp.Reload, () => { window.location.reload(); }),
    OpenDevTools: wailsOr(WailsApp.OpenDevTools, () => {
      console.log('%c[MoBlend] F12 — for DevTools use wails dev or open http://localhost:5173 in Chrome', 'color:#888');
    }),
    Greet: wailsOr(WailsApp.Greet, async (n: string) => `Hello ${n}`),
    GetConfig: wailsOr(WailsApp.GetConfig, async () => ({} as Record<string, unknown>)),
    InstallTemplate: async (templateID: string, downloadURL: string, catalogVersion: string) => {
      const fn = goApp()?.InstallTemplate;
      if (typeof fn === 'function') {
        return (fn as (a: string, b: string, c: string) => Promise<string>)(templateID, downloadURL, catalogVersion);
      }
      throw new Error('InstallTemplate binding unavailable');
    },
    ListInstalledTemplates: async () => {
      const fn = goApp()?.ListInstalledTemplates;
      if (typeof fn === 'function') {
        return fn() as Promise<Array<{ TemplateID: string; LocalPath: string; CatalogVersion: string }>>;
      }
      return [];
    },
    GetInstalledTemplatePath: async (templateID: string) => {
      const fn = goApp()?.GetInstalledTemplatePath;
      if (typeof fn !== 'function') {
        return '';
      }
      const { path, ok } = parsePathBoolResult(await fn(templateID));
      return ok ? path : '';
    },
  };
}

const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/ndx-video/MoBlend_Lib/main';

const PARAM_DEBOUNCE_MS = 200;

function EditorScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vp = useViewportStream(canvasRef);
  const { startPreview, stopPreview } = vp;
  const { setStatus, level: statusLevel } = useStatus();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, any>>({});
  const [slots, setSlots] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const paramDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const go = useGoBindings();
  const nav = useNavigate();
  const assetDrop = useAssetDrop();

  async function loadCurrent() {
    setLoading(true);
    try {
      const m = await runStep(
        '[editor] Fetch manifest',
        setStatus,
        () => getManifest({ timeoutMs: 20_000 }),
        { successMsg: '[editor] Manifest loaded.' },
      );
      setManifest(m);
      const init: Record<string, any> = {};
      (m.parameters || []).forEach(p => { if (p.default !== undefined) init[p.id] = p.default; });
      setParamValues(init);
      setSlots(m.slots || []);
      assetDrop.paramIngestHandlers.current = (paramId, value) => {
        setParamValues(v => ({ ...v, [paramId]: value }));
      };
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus('[editor] Manifest failed: ' + (e as Error)?.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  function applyParam(id: string, value: any) {
    setParamValues(v => ({ ...v, [id]: value }));
    const pending = paramDebounceRef.current[id];
    if (pending) clearTimeout(pending);
    paramDebounceRef.current[id] = setTimeout(async () => {
      delete paramDebounceRef.current[id];
      try {
        await patchParameters([{ id, value }]);
      } catch (e) { console.warn('patch param', e); }
    }, PARAM_DEBOUNCE_MS);
  }

  useEffect(() => () => {
    Object.values(paramDebounceRef.current).forEach(clearTimeout);
  }, []);

  async function applySlots(newSlots: any[]) {
    setSlots(newSlots);
    try { await patchSlots(newSlots); } catch (e) { console.warn('patch slots', e); }
  }

  async function doExport() {
    try {
      const r = await startExport({ format: 'webm', resolution: [1280, 720] });
      setJobId(r.job_id);
      // poll
      const iv = setInterval(async () => {
        const st: any = await getExportStatus(r.job_id);
        setJobStatus(st);
        if (st?.status === 'done' || st?.status === 'error') clearInterval(iv);
      }, 800);
    } catch (e) { alert('Export failed: ' + e); }
  }

  // Always attempt to load current manifest on mount / when navigating to Editor.
  // This picks up the default template that Go auto-loaded on broker start.
  useEffect(() => {
    loadCurrent();
  }, []);

  useEffect(() => {
    if (manifest) {
      startPreview(640, 360);
    } else {
      stopPreview();
    }
    return () => stopPreview();
  }, [manifest, startPreview, stopPreview]);

  // Status bar checkpoints for viewport pipeline (no silent black canvas)
  useEffect(() => {
    if (statusLevel === 'error') return;
    if (!manifest) {
      setStatus('[editor] Waiting for manifest…', 'warning');
      return;
    }
    if (!vp.connected) {
      setStatus('[editor] Viewport: connecting WebSocket…', 'info');
      return;
    }
    if (vp.lastWsError && vp.wsErrors > 0) {
      setStatus(`[editor] Viewport WS error: ${vp.lastWsError}`, 'error');
      return;
    }
    if (vp.lastFrame >= 0 && vp.painted === 0 && vp.bytesReceived > 0) {
      setStatus(
        `[editor] Frames received (${vp.bytesReceived} B, f${vp.lastFrame}) but canvas not painted` +
        (vp.lastPaintError ? `: ${vp.lastPaintError}` : '…'),
        'warning',
      );
      return;
    }
    if (vp.paintErrors > 0 && vp.painted === 0) {
      setStatus(`[editor] Paint failed (${vp.paintErrors}×): ${vp.lastPaintError || 'unknown'}`, 'error');
      return;
    }
    if (vp.painted > 0) {
      setStatus(`[editor] Preview live — ${vp.fps.toFixed(1)} fps, ${vp.painted} painted`, 'success');
      return;
    }
    if (vp.connected && vp.lastFrame < 0) {
      setStatus('[editor] Viewport WS open — waiting for first frame…', 'info');
    }
  }, [
    manifest, setStatus, statusLevel, vp.bytesReceived, vp.connected, vp.fps, vp.lastFrame,
    vp.lastPaintError, vp.lastWsError, vp.paintErrors, vp.painted, vp.wsErrors,
  ]);

  // Keyboard scrub example (left/right)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') vp.requestFrame((vp.lastFrame + 1) % 30, 480, 270, true);
      if (e.key === 'ArrowLeft') vp.requestFrame(Math.max(0, vp.lastFrame - 1), 480, 270, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vp]);

  return (
    <div style={{ display: 'flex', height: '100%', gap: 1, background: 'var(--surface-container-lowest)' }}>
      {/* Viewport */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => vp.requestFrame(0, 640, 360, false)} data-testid="req-frame-btn">Request frame</button>
          <button onClick={() => vp.requestFrameWebP(vp.lastFrame || 0, 480, 270, true)} data-testid="req-webp-btn">WebP + drop</button>
          <button onClick={() => { for (let i = 0; i < 12; i++) setTimeout(() => vp.requestFrame(i % 6, 320, 180, true), i * 16); }} data-testid="scrub-burst-btn">Scrub burst (drop)</button>
          <button onClick={loadCurrent} disabled={loading} data-testid="refresh-manifest-btn">Refresh manifest</button>
          <button onClick={doExport} data-testid="trigger-export-btn">Trigger Export (202+poll)</button>
          <span style={{ marginLeft: 'auto', fontSize: 12, opacity: .7 }} data-testid="viewport-stats">
            {vp.connected ? 'WS live' : 'WS disconnected'} • fps {vp.fps.toFixed(1)} • frame {vp.lastFrame}
            {vp.bytesReceived > 0 && ` • ${(vp.bytesReceived / 1024).toFixed(1)}KB`}
            {vp.painted > 0 && ` • painted ${vp.painted}`}
            {vp.paintErrors > 0 && ` • paint err ${vp.paintErrors}`}
            {vp.wsErrors > 0 && ` • ws err ${vp.wsErrors}`}
          </span>
        </div>
        <div style={{ background: '#1a1a1a', display: 'inline-block', border: '1px solid #333', lineHeight: 0 }} data-testid="viewport-canvas-container">
          <canvas ref={canvasRef} width={640} height={360} style={{ display: 'block', maxWidth: '100%' }} data-testid="viewport-canvas" />
        </div>
        <div style={{ fontSize: 11, opacity: .6, marginTop: 6 }}>
          Direct binary WS to broker. Scrub with arrows or burst buttons (stale frames are dropped on both ends).
        </div>
        {jobId && <div style={{ marginTop: 8, fontSize: 12 }}>Export job: {jobId} — {(jobStatus as any)?.status} {(jobStatus as any)?.progress != null ? ((jobStatus as any).progress * 100).toFixed(0) + '%' : ''} {(jobStatus as any)?.result_path && <span>→ {(jobStatus as any).result_path}</span>}</div>}
      </div>

      {/* Inspector + Timeline */}
      <div style={{ width: 320, padding: 12, borderLeft: 'var(--panel-border)', overflow: 'auto' }} className="panel" data-testid="param-inspector">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Parameters (live)</div>
        {!manifest && (
          <div style={{ padding: 12, background: 'var(--surface-container-low)', borderRadius: 6, marginBottom: 12 }}>
            <div style={{ opacity: .85, marginBottom: 8 }}>No template loaded.</div>
            <button onClick={async () => {
              const def = await go.GetDefaultTemplatePath?.();
              if (def) {
                try {
                  await loadProject(def);
                  // loadCurrent will be called by the existing auto-effect or we can force it
                  setTimeout(loadCurrent, 200);
                } catch (e: any) {
                  alert('Auto-load failed: ' + e.message);
                }
              } else {
                alert('Default test template not found. Run scripts/dev.ps1 once or use Home → Open local.');
              }
            }} data-testid="load-default-btn">
              Load default test template
            </button>
            <div style={{ fontSize: 11, opacity: .6, marginTop: 6 }}>
              The M1 synthetic (created by m1_roundtrip.py) will be auto-loaded on broker start when possible.
            </div>
          </div>
        )}
        {(manifest?.parameters || []).map(p => (
          isAssetParamType(p.type) ? (
            <div key={p.id} style={{ marginBottom: 10 }}>
              <AssetParamRow
                param={p}
                value={String(paramValues[p.id] ?? p.default ?? '')}
                onIngested={(id, value) => setParamValues(v => ({ ...v, [id]: value }))}
                setStatus={setStatus}
              />
            </div>
          ) : (
          <div key={p.id} style={{ marginBottom: 10 }} data-testid={`param-row-${p.id}`}>
            <div style={{ fontSize: 12, marginBottom: 2 }}>{p.label || p.id} <span style={{ opacity: .5 }}>({p.type})</span></div>
            {p.type === 'float' || p.type === 'int' ? (
              <input type="range" min={p.min ?? 0} max={p.max ?? 10} step={p.type === 'int' ? 1 : 0.01}
                     value={paramValues[p.id] ?? p.default ?? 0}
                     onChange={e => applyParam(p.id, p.type === 'int' ? parseInt(e.target.value) : parseFloat(e.target.value))}
                     data-testid={`param-input-${p.id}`} />
            ) : p.type === 'bool' ? (
              <input type="checkbox" checked={!!paramValues[p.id]} onChange={e => applyParam(p.id, e.target.checked)}
                     data-testid={`param-input-${p.id}`} />
            ) : p.type === 'color_rgba' ? (
              <input type="text" value={paramValues[p.id] || '#ffffff'} onChange={e => applyParam(p.id, e.target.value)} style={{ width: '100%' }}
                     data-testid={`param-input-${p.id}`} />
            ) : p.type === 'enum' ? (
              <select value={paramValues[p.id] ?? ''} onChange={e => applyParam(p.id, e.target.value)}
                      data-testid={`param-input-${p.id}`}>
                {(p.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type="text" value={paramValues[p.id] || ''} onChange={e => applyParam(p.id, e.target.value)} style={{ width: '100%' }}
                     data-testid={`param-input-${p.id}`} />
            )}
          </div>
          )
        ))}

        <div style={{ marginTop: 16, fontWeight: 600 }}>Slots (drag to change — simple MVP)</div>
        {(slots.length ? slots : [{ index: 0, start_time: 0, end_time: 2 }]).map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, margin: '6px 0' }} data-testid={`slot-row-${s.index ?? i}`}>
            <span>#{s.index}</span>
            <input type="number" step="0.1" value={s.start_time} onChange={e => {
              const ns = [...slots]; ns[i] = { ...s, start_time: parseFloat(e.target.value) }; applySlots(ns);
            }} style={{ width: 70 }} />
            <input type="number" step="0.1" value={s.end_time} onChange={e => {
              const ns = [...slots]; ns[i] = { ...s, end_time: parseFloat(e.target.value) }; applySlots(ns);
            }} style={{ width: 70 }} />
            {s.preset_id && <span style={{ fontSize: 11, opacity: .7 }}>{s.preset_id}</span>}
          </div>
        ))}
        <button onClick={() => applySlots([...slots, { index: (slots[slots.length - 1]?.index || 0) + 1, start_time: 2, end_time: 4 }])}>Add slot</button>
      </div>
    </div>
  );
}

function HomeScreen() {
  const go = useGoBindings();
  const nav = useNavigate();
  const { setStatus, ensureBroker } = useStatus();
  const [defaultPath, setDefaultPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [installed, setInstalled] = useState<Record<string, string>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    go.GetDefaultTemplatePath?.().then((p: string) => setDefaultPath(p || ''));
    void loadGallery();
  }, []);

  async function loadGallery() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const templates = await getTemplates({ timeoutMs: 15_000 });
      const entries = Array.isArray(templates) ? templates : [];
      setCatalog(entries);
      const map: Record<string, string> = {};
      await Promise.all(
        entries.map(async entry => {
          const path = await go.GetInstalledTemplatePath(entry.template_id).catch(() => '');
          if (path) map[entry.template_id] = path;
        }),
      );
      setInstalled(map);
    } catch (e: unknown) {
      setCatalog([]);
      setCatalogError((e as Error)?.message || 'Catalog unavailable');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function openInstalled(entry: CatalogEntry, localPath: string) {
    if (loading) return;
    setActionId(entry.template_id);
    setLoading(true);
    try {
      await runStep('[open 1/3] Broker', setStatus, async () => {
        if (!(await ensureBroker())) throw new FlowError('Broker not ready', '[open 1/3]');
      }, { timeoutMs: 120_000 });
      await runStep(`[open 2/3] Load ${entry.name}`, setStatus, () => loadProject(localPath), { timeoutMs: 120_000 });
      await go.AddRecentProject(localPath);
      setStatus('[open 3/3] Opening editor…', 'info');
      nav('/editor');
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus('Open failed: ' + (e as Error)?.message, 'error');
      }
    } finally {
      setLoading(false);
      setActionId(null);
    }
  }

  async function installAndOpen(entry: CatalogEntry) {
    if (loading) return;
    setActionId(entry.template_id);
    setLoading(true);
    try {
      await runStep('[install 1/4] Broker', setStatus, async () => {
        if (!(await ensureBroker())) throw new FlowError('Broker not ready', '[install 1/4]');
      }, { timeoutMs: 120_000 });
      const localPath = await runStep(
        `[install 2/4] Download ${entry.name}`,
        setStatus,
        () => go.InstallTemplate(entry.template_id, entry.download_url, entry.version),
        { timeoutMs: 300_000 },
      );
      if (!localPath) throw new FlowError('Install returned empty path', '[install 2/4]');
      await go.AddRecentProject(localPath);
      setInstalled(prev => ({ ...prev, [entry.template_id]: localPath }));
      await runStep(`[install 3/4] Load ${entry.name}`, setStatus, () => loadProject(localPath), { timeoutMs: 120_000 });
      setStatus('[install 4/4] Opening editor…', 'info');
      nav('/editor');
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus('Install failed: ' + (e as Error)?.message, 'error');
      }
    } finally {
      setLoading(false);
      setActionId(null);
    }
  }

  async function openLocal() {
    if (loading) return;
    setLoading(true);
    try {
      await runStep('[open 1/3] Broker', setStatus, async () => {
        if (!(await ensureBroker())) throw new FlowError('Broker not ready', '[open 1/3]');
      }, { timeoutMs: 120_000 });
      const p = await go.PickMoBlendFile();
      if (!p) {
        setStatus('Open cancelled (no file selected).', 'info');
        return;
      }
      await runStep(`[open 2/3] Load ${p}`, setStatus, () => loadProject(p), { timeoutMs: 120_000 });
      await go.AddRecentProject(p);
      setStatus('[open 3/3] Opening editor…', 'info');
      nav('/editor');
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus('Load failed: ' + (e as Error)?.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadDefault() {
    if (loading) return;
    setLoading(true);
    try {
      await runStep('[open 1/4] Broker', setStatus, async () => {
        if (!(await ensureBroker())) throw new FlowError('Broker not ready', '[open 1/4]');
      }, { timeoutMs: 120_000 });

      const path = defaultPath || (await go.GetDefaultTemplatePath?.()) || '';
      const health = await runStep('[open 2/4] Health check', setStatus, () => getHealth({ timeoutMs: 10_000 }));

      if (path) {
        await runStep(`[open 3/4] Load template`, setStatus, () => loadProject(path), { timeoutMs: 120_000 });
        await go.AddRecentProject(path);
      } else if (!health.loaded) {
        setStatus('[open 3/4] No template path and broker empty. Run scripts/dev.ps1 or Open .mo.blend…', 'warning');
        return;
      } else {
        setStatus('[open 3/4] Using template already on broker', 'info');
      }

      setStatus('[open 4/4] Opening editor…', 'info');
      nav('/editor');
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus('Open failed: ' + (e as Error)?.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 bg-surface text-on-surface">
      <h2 className="text-2xl font-semibold tracking-tight mb-4">Template Gallery</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Default / preloaded card - matching Stitch card style */}
        <div 
          className="bg-surface-container border border-outline-variant rounded-lg p-4 cursor-pointer hover:bg-surface-container-high transition flex flex-col"
          onClick={loadDefault}
        >
          <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant mb-1">RECOMMENDED</div>
          <div className="text-base font-medium mb-1 text-on-surface">M1 Test Template</div>
          <div className="text-xs text-on-surface-variant mb-3 flex-1">Parametric cube demo with full scalar types</div>
          <div className="text-[10px] font-mono text-on-surface-variant mb-2 truncate">{defaultPath || 'Auto-loaded on start'}</div>
          <button 
            className="mt-auto self-start px-3 py-1.5 text-sm font-medium bg-primary-container text-on-primary-container rounded hover:brightness-110 transition disabled:opacity-50"
            onClick={(e) => { e.stopPropagation(); loadDefault(); }}
            disabled={loading}
            data-testid="open-in-editor-btn"
          >
            {loading ? 'Loading…' : 'Open in Editor'}
          </button>
        </div>

        {/* Open local action card */}
        <div 
          className="bg-surface-container border border-outline-variant rounded-lg p-4 cursor-pointer hover:bg-surface-container-high transition flex flex-col"
          onClick={openLocal}
        >
          <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant mb-1">LOCAL FILES</div>
          <div className="text-base font-medium mb-1 text-on-surface">Open .mo.blend…</div>
          <div className="text-xs text-on-surface-variant flex-1">Browse your filesystem for custom templates</div>
        </div>

        {catalog.map(entry => {
          const localPath = installed[entry.template_id];
          const isInstalled = Boolean(localPath);
          const busy = loading && actionId === entry.template_id;
          return (
            <div
              key={entry.template_id}
              className="bg-surface-container border border-outline-variant rounded-lg p-4 flex flex-col"
              data-testid={`gallery-catalog-card-${entry.template_id}`}
            >
              {entry.preview_url && (
                <img
                  src={entry.preview_url}
                  alt={entry.name}
                  className="w-full h-32 object-cover rounded mb-3 bg-surface-container-low"
                  data-testid={`gallery-preview-${entry.template_id}`}
                />
              )}
              <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-on-surface-variant mb-1">
                {entry.category || 'OFFICIAL'}
              </div>
              <div className="text-base font-medium mb-1 text-on-surface">{entry.name}</div>
              <div className="text-xs text-on-surface-variant mb-3 flex-1">
                {entry.description || `Version ${entry.version}`}
              </div>
              {isInstalled && (
                <div className="text-[10px] font-mono text-on-surface-variant mb-2 truncate">{localPath}</div>
              )}
              {isInstalled ? (
                <button
                  className="mt-auto self-start px-3 py-1.5 text-sm font-medium bg-primary-container text-on-primary-container rounded hover:brightness-110 transition disabled:opacity-50"
                  onClick={() => openInstalled(entry, localPath)}
                  disabled={loading}
                  data-testid={`gallery-open-btn-${entry.template_id}`}
                >
                  {busy ? 'Opening…' : 'Open'}
                </button>
              ) : (
                <button
                  className="mt-auto self-start px-3 py-1.5 text-sm font-medium bg-primary-container text-on-primary-container rounded hover:brightness-110 transition disabled:opacity-50"
                  onClick={() => installAndOpen(entry)}
                  disabled={loading}
                  data-testid={`gallery-install-btn-${entry.template_id}`}
                >
                  {busy ? 'Installing…' : 'Install'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {catalogLoading && (
        <div className="mt-4 text-xs text-on-surface-variant" data-testid="gallery-catalog-loading">
          Loading official catalog…
        </div>
      )}
      {!catalogLoading && catalogError && catalog.length === 0 && (
        <div className="mt-4 text-xs text-on-surface-variant max-w-prose" data-testid="gallery-catalog-offline">
          Official catalog unavailable ({catalogError}). Use the local cards above, or refresh from Suite Manager when the broker is online.
        </div>
      )}
      {!catalogLoading && !catalogError && catalog.length > 0 && (
        <div className="mt-6 text-xs text-on-surface-variant max-w-prose">
          Official templates from lib.moblend.dev. Installed copies are cached under <code>~/.moblend/templates/</code>.
        </div>
      )}
    </div>
  );
}

function ProjectsScreen() {
  const go = useGoBindings();
  const { setStatus, ensureBroker } = useStatus();
  const [recents, setRecents] = useState<string[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    try {
      const promise = go.GetRecentProjects?.() || Promise.resolve([]);
      promise.then((r: any) => Array.isArray(r) ? setRecents(r) : setRecents([])).catch(() => setRecents([]));
    } catch { setRecents([]); }
  }, []);

  async function load(p: string) {
    try {
      if (!(await ensureBroker())) return;
      setStatus('Loading ' + p, 'info');
      await loadProject(p);
      await go.AddRecentProject?.(p);
      nav('/editor');
    } catch (e: any) {
      setStatus('Load failed: ' + (e?.message || e), 'error');
    }
  }

  const safeRecents = Array.isArray(recents) ? recents : [];

  return (
    <div className="p-6">
      <div className="section-label mb-2">RECENT PROJECTS</div>
      <div className="panel">
        {safeRecents.length === 0 && (
          <div className="p-4 text-sm text-[var(--on-surface-variant)]">No recent projects. Use Home to open a template.</div>
        )}
        {safeRecents.map((p, idx) => (
          <div 
            key={idx} 
            className="list-item border-b border-[var(--outline-variant)] last:border-b-0"
            onClick={() => load(p)}
            data-testid="recent-project-item"
          >
            <span className="mono text-xs truncate">{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuiteManager() {
  const go = useGoBindings();
  const { setStatus, refreshBroker } = useStatus();
  const [health, setHealth] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [registryUrl, setRegistryUrl] = useState(DEFAULT_REGISTRY_URL);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [catalogFetchedAt, setCatalogFetchedAt] = useState<Date | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);

  async function loadCatalogStatus() {
    try {
      const cfg = await go.GetConfig();
      const base = String((cfg as Record<string, unknown>)?.registryBaseUrl || DEFAULT_REGISTRY_URL);
      setRegistryUrl(base);
      const templates = await getTemplates({ timeoutMs: 12_000 });
      setCatalogCount(templates.length);
      setCatalogFetchedAt(new Date());
      setCatalogError(null);
    } catch (e: unknown) {
      setCatalogError((e as Error)?.message || 'Catalog fetch failed');
      setCatalogCount(null);
    }
  }

  async function refreshCatalog() {
    setCatalogRefreshing(true);
    setStatus('Refreshing official catalog…', 'info');
    try {
      const templates = await refreshTemplates({ timeoutMs: 30_000 });
      setCatalogCount(templates.length);
      setCatalogFetchedAt(new Date());
      setCatalogError(null);
      setStatus(`Catalog refreshed (${templates.length} entries).`, 'success');
    } catch (e: unknown) {
      const msg = (e as Error)?.message || 'Catalog refresh failed';
      setCatalogError(msg);
      setCatalogCount(null);
      setStatus('Catalog refresh failed: ' + msg, 'error');
    } finally {
      setCatalogRefreshing(false);
    }
  }

  async function refresh() {
    try {
      const h = await go.EngineHealth();
      setHealth(h);
      await refreshBroker();
      await loadCatalogStatus();
    } catch (e: any) {
      setStatus('Health check error: ' + (e?.message || e), 'error');
    }
  }

  async function start() {
    setStarting(true);
    setStatus('Starting engine (this can take 30–60s the first time while installing broker deps)…', 'info');
    try {
      await go.StartEngine('');
      setStatus('Spawned Blender broker. Waiting for health…', 'info');
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const h = await go.EngineHealth().catch(() => null);
        if (h && isBrokerUp(h)) {
          setHealth(h);
          await refreshBroker();
          setStatus('Engine started successfully.', 'success');
          break;
        }
      }
    } catch (e: any) {
      setStatus('Start Engine failed: ' + (e?.message || String(e)), 'error');
    } finally {
      setStarting(false);
      setTimeout(refresh, 500);
    }
  }

  async function stop() {
    setStatus('Stopping engine…', 'info');
    try {
      await go.StopEngine();
      await refreshBroker();
      setStatus('Engine stopped.', 'info');
    } catch (e: any) {
      setStatus('Stop failed: ' + (e?.message || e), 'error');
    }
    refresh();
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const isLoaded = health && isBrokerUp(health);

  const catalogOffline = catalogCount === 0 && Boolean(catalogError);

  return (
    <div style={{ padding: 24 }}>
      <h3>Suite Manager</h3>
      <div className="panel" style={{ padding: 12, maxWidth: 560 }}>
        <div style={{ marginBottom: 8 }}>
          <strong>Broker health:</strong>{' '}
          {health ? (
            <span style={{ color: isLoaded ? '#6c5ce7' : '#ffb4ab' }}>
              {JSON.stringify(health)}
            </span>
          ) : '…'}
        </div>

        <div style={{ marginTop: 8 }}>
          <button onClick={start} disabled={starting} data-testid="start-engine-btn">Start Engine</button>{' '}
          <button onClick={stop} data-testid="stop-engine-btn">Stop Engine</button>{' '}
          <button onClick={refresh} data-testid="refresh-health-btn">Refresh</button>
        </div>

        <div style={{ fontSize: 12, marginTop: 12, opacity: .7, lineHeight: 1.4 }}>
          The Go backend spawns and supervises headless Blender running the FastAPI broker on port 8000.<br />
          All UI data (manifest, parameters, viewport frames, slots) goes directly from React → broker.<br />
          The engine must be running before you can load templates or see live previews.
        </div>
      </div>

      <div className="panel" style={{ padding: 12, maxWidth: 560, marginTop: 16 }} data-testid="catalog-status-panel">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Official Template Library</div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          <strong>Registry URL:</strong>{' '}
          <span className="mono" data-testid="registry-base-url">{registryUrl}</span>
        </div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          <strong>Catalog entries:</strong>{' '}
          <span data-testid="catalog-entry-count">{catalogCount ?? '…'}</span>
        </div>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <strong>Last fetch:</strong>{' '}
          <span data-testid="catalog-last-fetch">
            {catalogFetchedAt ? catalogFetchedAt.toLocaleString() : '—'}
          </span>
        </div>
        {catalogOffline && (
          <div style={{ fontSize: 12, color: 'var(--error)', marginBottom: 8 }} data-testid="catalog-offline-message">
            Catalog offline or empty ({catalogError}). Check broker health and registry URL in config.json.
          </div>
        )}
        {catalogError && !catalogOffline && (
          <div style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginBottom: 8 }}>
            Last catalog check: {catalogError}
          </div>
        )}
        <button
          onClick={refreshCatalog}
          disabled={catalogRefreshing}
          data-testid="catalog-refresh-btn"
        >
          {catalogRefreshing ? 'Refreshing…' : 'Refresh catalog'}
        </button>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, opacity: .6 }}>
        Tip: If Start Engine does nothing visible, check the terminal running <code>wails dev</code> for Go errors
        (e.g. Blender not found on PATH or in Program Files).
      </div>
    </div>
  );
}

function AssetsScreen() {
  const { setStatus } = useStatus();
  const { refreshSandboxSignal, refreshManifest, lastManifest, onParamIngested } = useAssetDrop();
  const [files, setFiles] = useState<string[]>([]);
  const [assignParam, setAssignParam] = useState<Record<number, string>>({});
  const assetParams = (lastManifest?.parameters || []).filter(p => isAssetParamType(p.type));

  async function loadFiles() {
    try {
      setFiles(await listSandboxAssets());
    } catch (e: unknown) {
      setStatus('[asset] List sandbox failed: ' + (e as Error)?.message, 'error');
    }
  }

  useEffect(() => {
    void loadFiles();
    void refreshManifest();
  }, [refreshSandboxSignal]);

  async function ingestAt(index: number, path: string) {
    const paramId = assignParam[index];
    if (!paramId) {
      setStatus('[asset] Select a parameter first.', 'warning');
      return;
    }
    const param = assetParams.find(p => p.id === paramId);
    if (!param) return;
    try {
      const kind = inferAssetKind(path);
      if (kind !== param.type) {
        setStatus(`[asset] Wrong file type for ${param.label || param.id}`, 'error');
        return;
      }
      const result = await ingestAssetParam(paramId, path, setStatus);
      onParamIngested(paramId, String(result.value));
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus('[asset] Ingest failed: ' + (e as Error)?.message, 'error');
      }
    }
  }

  return (
    <div className="p-6" data-testid="assets-screen">
      <div className="section-label mb-2">LOCAL ASSETS</div>
      <div className="panel p-4 mb-4">
        <div className="text-sm mb-2">Drop files anywhere in the window.</div>
        <div className="text-xs text-[var(--on-surface-variant)]">
          Images, video, and fonts are hashed and copied to <code>~/.moblend/assets/</code> by Go, then ingested via PATCH /parameters.
        </div>
      </div>

      <div data-testid="assets-list">
        {files.length === 0 && (
          <div className="text-sm text-[var(--on-surface-variant)] p-4 panel">
            No sandbox files yet. Drop a file on the window or use Editor → Choose file.
          </div>
        )}
        {files.map((path, index) => {
          const name = basename(path);
          const kind = inferAssetKind(path) || 'unknown';
          return (
            <div
              key={path}
              className="panel p-3 mb-2 flex flex-col gap-2"
              data-testid={`asset-item-${index}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--on-surface-variant)]">{kind}</span>
                <span className="font-medium text-sm">{name}</span>
              </div>
              <div className="mono text-[10px] text-[var(--on-surface-variant)] truncate">{path}</div>
              {assetParams.length > 0 ? (
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    value={assignParam[index] || ''}
                    onChange={e => setAssignParam(s => ({ ...s, [index]: e.target.value }))}
                    className="text-sm"
                    data-testid="asset-assign-select"
                  >
                    <option value="">Ingest into…</option>
                    {assetParams.map(p => (
                      <option key={p.id} value={p.id}>{p.label || p.id} ({p.type})</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => ingestAt(index, path)}
                    data-testid="asset-ingest-btn"
                  >
                    Ingest
                  </button>
                </div>
              ) : (
                <div className="text-xs text-[var(--on-surface-variant)]">Load a template with asset parameters to ingest.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExportScreen() {
  return (
    <div style={{ padding: 24, minHeight: 200, border: '1px dashed #555' }} data-testid="export-screen">
      <h3>Export</h3>
      <div style={{ padding: 16, maxWidth: 520, background: '#1e1f24', borderRadius: 6, border: '1px solid #2d2e35' }}>
        <p><strong>Export jobs are triggered from the Editor</strong> (see the "Trigger Export (202+poll)" button while a template is loaded).</p>
        <p style={{ opacity: 0.85 }}>
          The broker returns 202 + job_id immediately. The UI polls /render/status/{'{job_id}'} for progress and result_path.
        </p>
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Full multi-frame video encoding, presets, and OBS injection are planned for M5.
          Current is the minimal 202 + poll contract required for M3.
        </div>
      </div>
    </div>
  );
}

function UserSettingsScreen() {
  return (
    <div style={{ padding: 'var(--space-lg)' }} data-testid="settings-screen">
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>USER SETTINGS</div>
      <div className="panel" style={{ padding: 'var(--space-md)', maxWidth: '520px' }}>
        <p style={{ marginBottom: 'var(--space-sm)' }}>
          <strong>Config is read/written via the Go backend</strong> to <code>%USERPROFILE%\.moblend\config.json</code> (or <code>~/.moblend/config.json</code> on other OSes).
        </p>
        <p style={{ fontSize: '13px', color: 'var(--on-surface-variant)', marginBottom: 'var(--space-md)' }}>
          This is the same file used by the engine and broker. Advanced users can also edit it directly with any text editor.
        </p>
        <div style={{ fontSize: '12px', color: 'var(--on-surface-variant)' }}>
          M3: GetConfig / SetConfig bindings exist and are used by Suite + this screen. Full UI form is future work.
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const go = useGoBindings();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        go.Reload?.();
      }
      if (e.key === 'F12') {
        e.preventDefault();
        go.OpenDevTools?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go]);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/projects" element={<ProjectsScreen />} />
        <Route path="/assets" element={<AssetsScreen />} />
        <Route path="/editor" element={<EditorScreen />} />
        <Route path="/export" element={<ExportScreen />} />
        <Route path="/settings/suite" element={<SuiteManager />} />
        <Route path="/settings" element={<UserSettingsScreen />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const go = useGoBindings();

  return (
    <StatusProvider
      engineHealth={async () => {
        const h = await go.EngineHealth();
        return (h && typeof h === 'object' ? h : { status: 'unreachable' }) as Record<string, unknown>;
      }}
      startEngine={(p) => go.StartEngine(p ?? '')}
    >
      <AssetDropProvider>
        <AppRoutes />
      </AssetDropProvider>
    </StatusProvider>
  );
}
