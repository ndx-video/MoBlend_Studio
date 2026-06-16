import { Page } from '@playwright/test';
import { DEFAULT_TEMPLATE_PATH, M1_MANIFEST } from './manifest';

export type BrokerCall = { method: string; url: string; body?: unknown };

/** In-memory broker state shared across route handlers in one page context. */
export type MockBrokerState = {
  manifest: typeof M1_MANIFEST;
  health: { status: string; loaded: boolean; template_id: string; dirty: boolean };
  calls: BrokerCall[];
  paramValues: Record<string, unknown>;
  slots: typeof M1_MANIFEST.slots;
  exportJobs: Map<string, { status: string; progress: number; result_path?: string }>;
};

export function createBrokerState(): MockBrokerState {
  return {
    manifest: structuredClone(M1_MANIFEST),
    health: { status: 'ok', loaded: true, template_id: 'm1-roundtrip-test', dirty: false },
    calls: [],
    paramValues: Object.fromEntries(M1_MANIFEST.parameters.map(p => [p.id, p.default])),
    slots: structuredClone(M1_MANIFEST.slots),
    exportJobs: new Map(),
  };
}

const MOCK_SANDBOX_PNG = 'C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_abc123.png';
const MOCK_SANDBOX_LIST = [
  MOCK_SANDBOX_PNG,
  'C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_def456.ttf',
];

export async function injectWailsMocks(page: Page, opts?: { brokerBase?: string }) {
  const brokerBase = opts?.brokerBase ?? 'http://127.0.0.1:8000';
  await page.addInitScript((base: string) => {
    const eventListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    (window as any).go = {
      main: {
        App: {
          PickMoBlendFile: async () => 'C:\\\\TEMP\\\\m1_minimal_test.mo.blend',
          PickAssetFile: async (kind: string) => {
            if (kind === 'font') return 'C:\\\\TEMP\\\\picked_font.ttf';
            if (kind === 'video') return 'C:\\\\TEMP\\\\picked_clip.mp4';
            return 'C:\\\\TEMP\\\\picked_logo.png';
          },
          StartEngine: async (_loadPath?: string) => {},
          StopEngine: async () => {},
          GetRecentProjects: async () => ['C:\\\\TEMP\\\\m1_minimal_test.mo.blend', 'C:\\\\TEMP\\\\other_project.mo.blend'],
          AddRecentProject: async (_p: string) => {},
          GetBrokerBaseURL: () => base,
          EngineHealth: async () => ({ loaded: true, template_id: 'm1-roundtrip-test', dirty: false, status: 'ok' }),
          GetConfig: async () => ({}),
          SetConfig: async (_cfg: unknown) => {},
          CopyToAssetSandbox: async (paths: string[]) => {
            const p = paths[0] || '';
            if (p.toLowerCase().includes('.ttf') || p.toLowerCase().includes('font')) {
              return ['C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_def456.ttf'];
            }
            if (p.toLowerCase().includes('.mp4') || p.toLowerCase().includes('video')) {
              return ['C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_vid789.mp4'];
            }
            return ['C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_abc123.png'];
          },
          ListAssetSandbox: async () => [
            'C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_abc123.png',
            'C:\\\\Users\\\\Test\\\\.moblend\\\\assets\\\\asset_def456.ttf',
          ],
          GetDefaultTemplatePath: async () => 'C:\\\\TEMP\\\\m1_minimal_test.mo.blend',
          Reload: () => { window.location.reload(); },
          OpenDevTools: () => {},
          Greet: async (name: string) => `Hello ${name}`,
        },
      },
    };

    const runtime = {
      OnFileDrop: (cb: (x: number, y: number, paths: string[]) => void, _useDropTarget?: boolean) => {
        (window as any).__moblendOnFileDrop = cb;
      },
      OnFileDropOff: () => {
        delete (window as any).__moblendOnFileDrop;
      },
      EventsEmit: (eventName: string, ...data: unknown[]) => {
        for (const cb of eventListeners[eventName] ?? []) cb(...data);
      },
      EventsOnMultiple: (eventName: string, callback: (...args: unknown[]) => void, _max?: number) => {
        (eventListeners[eventName] ??= []).push(callback);
        return () => {
          eventListeners[eventName] = (eventListeners[eventName] ?? []).filter(f => f !== callback);
        };
      },
      EventsOn: (eventName: string, callback: (...args: unknown[]) => void) =>
        runtime.EventsOnMultiple(eventName, callback, -1),
      EventsOnce: (eventName: string, callback: (...args: unknown[]) => void) =>
        runtime.EventsOnMultiple(eventName, callback, 1),
      EventsOff: () => {},
      EventsOffAll: () => {},
      LogPrint: console.log,
    };
    (window as any).runtime = runtime;
    (window as any).__moblendEmitEvent = (eventName: string, ...data: unknown[]) => {
      runtime.EventsEmit(eventName, ...data);
    };
  }, brokerBase);
}

export { MOCK_SANDBOX_PNG, MOCK_SANDBOX_LIST };

export async function mockBroker(page: Page, state?: MockBrokerState) {
  const brokerState = state ?? createBrokerState();

  await page.route('http://127.0.0.1:8000/api/v1/**', async route => {
    const url = route.request().url();
    const method = route.request().method();
    let body: unknown;
    try {
      const postData = route.request().postData();
      if (postData) body = JSON.parse(postData);
    } catch { /* ignore */ }

    brokerState.calls.push({ method, url, body });

    if (url.includes('/health')) {
      return route.fulfill({ json: brokerState.health });
    }
    if (url.includes('/manifest')) {
      const parameters = brokerState.manifest.parameters.map(p => ({
        ...p,
        default: brokerState.paramValues[p.id] ?? p.default,
      }));
      return route.fulfill({
        json: { ...brokerState.manifest, parameters, slots: brokerState.slots },
      });
    }
    if (url.includes('/project/load')) {
      brokerState.health.loaded = true;
      return route.fulfill({ json: { ...brokerState.manifest, slots: brokerState.slots } });
    }
    if (url.includes('/parameters')) {
      const updates = (body as { updates?: Array<{ id: string; value: unknown }> })?.updates ?? [];
      for (const u of updates) {
        brokerState.paramValues[u.id] = u.value;
        const idx = brokerState.manifest.parameters.findIndex(p => p.id === u.id);
        if (idx >= 0) {
          brokerState.manifest.parameters[idx] = {
            ...brokerState.manifest.parameters[idx],
            default: u.value,
          };
        }
      }
      brokerState.health.dirty = true;
      return route.fulfill({ json: { status: 'ok', applied: updates.length } });
    }
    if (url.includes('/slots')) {
      const slots = (body as { slots?: typeof brokerState.slots })?.slots;
      if (Array.isArray(slots)) brokerState.slots = slots;
      return route.fulfill({ json: { status: 'ok', applied: slots?.length ?? 0 } });
    }
    if (url.includes('/render/export')) {
      const jobId = 'job_e2e_001';
      brokerState.exportJobs.set(jobId, { status: 'queued', progress: 0 });
      setTimeout(() => brokerState.exportJobs.set(jobId, { status: 'done', progress: 1, result_path: 'C:\\\\TEMP\\\\fake.webm' }), 50);
      return route.fulfill({ json: { job_id: jobId, status: 'queued' } });
    }
    if (url.includes('/render/status/')) {
      const jobId = url.split('/render/status/')[1]?.split('?')[0] ?? 'job_e2e_001';
      const st = brokerState.exportJobs.get(jobId) ?? { status: 'done', progress: 1, result_path: 'C:\\\\TEMP\\\\fake.webm' };
      return route.fulfill({ json: { job_id: jobId, ...st } });
    }
    return route.fulfill({ status: 200, body: '{}' });
  });

  // Mock binary viewport WebSocket with a tiny JPEG frame response
  await page.addInitScript(() => {
    const OrigWS = window.WebSocket;
    const b64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AP//Z';
    const raw = atob(b64);
    const jpeg = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) jpeg[i] = raw.charCodeAt(i);

    function buildFrame(frameNum: number, w: number, h: number): ArrayBuffer {
      const plen = jpeg.length;
      const buf = new ArrayBuffer(14 + plen);
      const dv = new DataView(buf);
      dv.setUint8(0, 0x02); // FRAME
      dv.setUint32(1, frameNum >>> 0, true);
      dv.setUint16(5, w, true);
      dv.setUint16(7, h, true);
      dv.setUint8(9, 0); // JPEG
      dv.setUint32(10, plen, true);
      new Uint8Array(buf, 14).set(jpeg);
      return buf;
    }

    (window as any).WebSocket = function MockWebSocket(this: WebSocket, url: string | URL, protocols?: string | string[]) {
      const u = String(url);
      if (!u.includes('/api/v1/viewport/stream')) {
        return new OrigWS(url, protocols as any);
      }
      const listeners: Record<string, Array<(ev: any) => void>> = {};
      const ws = {
        binaryType: 'arraybuffer',
        readyState: 0,
        close: () => { ws.readyState = 3; fire('close', {}); },
        send: (data: ArrayBuffer) => {
          const dv = new DataView(data);
          if (dv.getUint8(0) === 0x01) {
            const fn = dv.getUint32(1, true);
            const w = dv.getUint16(5, true) || 64;
            const h = dv.getUint16(7, true) || 36;
            fire('message', { data: buildFrame(fn, w, h) });
          }
        },
        addEventListener: (t: string, fn: (ev: any) => void) => { (listeners[t] ??= []).push(fn); },
        removeEventListener: (t: string, fn: (ev: any) => void) => {
          listeners[t] = (listeners[t] ?? []).filter(f => f !== fn);
        },
        set onopen(fn: ((ev: any) => void) | null) { listeners.open = fn ? [fn] : []; },
        set onclose(fn: ((ev: any) => void) | null) { listeners.close = fn ? [fn] : []; },
        set onmessage(fn: ((ev: any) => void) | null) { listeners.message = fn ? [fn] : []; },
        set onerror(fn: ((ev: any) => void) | null) { listeners.error = fn ? [fn] : []; },
      } as unknown as WebSocket;

      function fire(type: string, ev: any) {
        for (const fn of listeners[type] ?? []) fn(ev);
      }
      // Open synchronously so preview loop can send on first tick
      ws.readyState = 1;
      queueMicrotask(() => fire('open', {}));
      return ws;
    } as unknown as typeof WebSocket;
    // Preserve static constants — app code compares against WebSocket.OPEN
    const W = (window as any).WebSocket;
    W.OPEN = 1;
    W.CONNECTING = 0;
    W.CLOSING = 2;
    W.CLOSED = 3;
  });
}

export async function setupMockedApp(page: Page, state?: MockBrokerState) {
  const brokerState = state ?? createBrokerState();
  await injectWailsMocks(page);
  await mockBroker(page, brokerState);
  return brokerState;
}

export { DEFAULT_TEMPLATE_PATH };