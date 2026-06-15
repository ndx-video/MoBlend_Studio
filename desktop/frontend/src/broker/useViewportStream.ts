// Binary WebSocket viewport hook (M3).
// Direct to ws://127.0.0.1:8000/api/v1/viewport/stream — never proxied via Go.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrokerWsBase } from './config';
import { logCheckpoint } from '../util/flow';

const viewportStreamUrl = () => `${getBrokerWsBase()}/api/v1/viewport/stream`;

const MSG_REQUEST = 0x01;
const MSG_FRAME = 0x02;
const MSG_ERROR = 0xff;
const FMT_JPEG = 0;
const FMT_WEBP = 1;
const FLAG_DROP_STALE = 0x01;
const PROTO_VER = 1;
const PREVIEW_INTERVAL_MS = 200;
const WS_OPEN = 1;

export interface ViewportState {
  connected: boolean;
  fps: number;
  lastFrame: number;
  dropped: number;
  painted: number;
  paintErrors: number;
  wsErrors: number;
  lastWsError: string;
  lastPaintError: string;
  bytesReceived: number;
  width: number;
  height: number;
}

function decodeWsError(ab: ArrayBuffer): string {
  try {
    const dv = new DataView(ab);
    const len = dv.getUint16(1, true);
    return new TextDecoder().decode(new Uint8Array(ab, 3, len));
  } catch (e: unknown) {
    return 'unknown WS error';
  }
}

export function useViewportStream(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ViewportState>({
    connected: false, fps: 0, lastFrame: -1, dropped: 0, painted: 0, paintErrors: 0,
    wsErrors: 0, lastWsError: '', lastPaintError: '', bytesReceived: 0,
    width: 640, height: 360,
  });
  const frameCountRef = useRef(0);
  const fpsWindowRef = useRef(performance.now());
  const latestWantedRef = useRef(-1);
  const paintSeqRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewActiveRef = useRef(false);
  const previewFrameRef = useRef(0);
  const previewDimsRef = useRef({ w: 640, h: 360 });

  const reportPaintError = useCallback((reason: string, plen: number) => {
    logCheckpoint('[viewport] paint failed', `${reason} (${plen} bytes)`);
    setState(s => ({
      ...s,
      paintErrors: s.paintErrors + 1,
      lastPaintError: reason,
    }));
  }, []);

  const sendRequest = useCallback((frameNum: number, w: number, h: number, fmt: 0 | 1, dropStale: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WS_OPEN) return false;

    if (dropStale) latestWantedRef.current = frameNum;

    const buf = new ArrayBuffer(13);
    const dv = new DataView(buf);
    dv.setUint8(0, MSG_REQUEST);
    dv.setUint32(1, frameNum >>> 0, true);
    dv.setUint16(5, w || 640, true);
    dv.setUint16(7, h || 360, true);
    dv.setUint8(9, fmt);
    dv.setUint8(10, dropStale ? FLAG_DROP_STALE : 0);
    dv.setUint8(11, PROTO_VER);
    dv.setUint8(12, 0);
    try {
      ws.send(buf);
      return true;
    } catch (e: unknown) {
      const err = e as { message?: string };
      logCheckpoint('[viewport] ws.send failed', err?.message || String(e));
      return false;
    }
  }, []);

  const stopPreview = useCallback(() => {
    previewActiveRef.current = false;
    if (previewTimerRef.current) {
      clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const paintFrame = useCallback((w: number, h: number, payload: ArrayBuffer, fmt: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      reportPaintError('canvas ref null', payload.byteLength);
      return;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      reportPaintError('2d context unavailable', payload.byteLength);
      return;
    }
    if (payload.byteLength < 100) {
      reportPaintError('payload too small (invalid JPEG?)', payload.byteLength);
      return;
    }

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const seq = ++paintSeqRef.current;
    const mime = fmt === FMT_WEBP ? 'image/webp' : 'image/jpeg';
    const blob = new Blob([payload], { type: mime });

    const drawBitmap = (source: CanvasImageSource) => {
      if (seq !== paintSeqRef.current) return;
      try {
        ctx.drawImage(source, 0, 0, w, h);
        setState(s => ({ ...s, painted: s.painted + 1, lastPaintError: '' }));
      } catch (e: unknown) {
        const err = e as { message?: string };
        reportPaintError('drawImage: ' + (err?.message || String(e)), payload.byteLength);
      }
    };

    // Data URL first — most compatible in Wails WebView2 (blob: URLs can fail)
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => drawBitmap(img);
      img.onerror = () => {
        const url = URL.createObjectURL(blob);
        const img2 = new Image();
        img2.onload = () => { drawBitmap(img2); URL.revokeObjectURL(url); };
        img2.onerror = () => {
          URL.revokeObjectURL(url);
          createImageBitmap(blob).then(bmp => {
            drawBitmap(bmp);
            bmp.close?.();
          }).catch((e: unknown) => {
            const err = e as { message?: string };
            reportPaintError('all decode paths failed: ' + (err?.message || String(e)), payload.byteLength);
          });
        };
        img2.src = url;
      };
      img.src = fr.result as string;
    };
    fr.onerror = () => reportPaintError('FileReader failed', payload.byteLength);
    fr.readAsDataURL(blob);
  }, [canvasRef, reportPaintError]);

  const startPreview = useCallback((w = 640, h = 360) => {
    stopPreview();
    previewActiveRef.current = true;
    previewDimsRef.current = { w, h };
    previewFrameRef.current = 0;
    logCheckpoint('[viewport] startPreview', `${w}x${h}`);
    const tick = () => {
      if (!previewActiveRef.current) return;
      const { w: pw, h: ph } = previewDimsRef.current;
      if (!sendRequest(previewFrameRef.current, pw, ph, FMT_JPEG, false)) {
        logCheckpoint('[viewport] preview tick skipped', 'WS not open');
      } else {
        previewFrameRef.current = (previewFrameRef.current + 1) % 30;
      }
    };
    tick();
    previewTimerRef.current = setInterval(tick, PREVIEW_INTERVAL_MS);
  }, [sendRequest, stopPreview]);

  useEffect(() => {
    const url = viewportStreamUrl();
    logCheckpoint('[viewport] WS connect', url);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      logCheckpoint('[viewport] WS open', 'ok');
      setState(s => ({ ...s, connected: true, lastWsError: '' }));
      if (previewActiveRef.current) {
        sendRequest(previewFrameRef.current, previewDimsRef.current.w, previewDimsRef.current.h, FMT_JPEG, false);
      }
    };

    ws.onclose = (ev) => {
      logCheckpoint('[viewport] WS close', `code=${ev.code}`);
      if (wsRef.current === ws) wsRef.current = null;
      setState(s => ({ ...s, connected: false, lastWsError: `closed (${ev.code})` }));
    };

    ws.onerror = () => {
      logCheckpoint('[viewport] WS error', 'see onclose');
      setState(s => ({ ...s, lastWsError: 'WebSocket error' }));
    };

    ws.onmessage = (ev) => {
      const ab = ev.data as ArrayBuffer;
      if (!(ab instanceof ArrayBuffer)) {
        logCheckpoint('[viewport] non-binary message', typeof ev.data);
        return;
      }
      const dv = new DataView(ab);
      const mt = dv.getUint8(0);

      if (mt === MSG_FRAME) {
        const fn = dv.getUint32(1, true);
        const w = dv.getUint16(5, true);
        const h = dv.getUint16(7, true);
        const fmt = dv.getUint8(9);
        const plen = dv.getUint32(10, true);
        if (ab.byteLength < 14 + plen) {
          reportPaintError(`truncated frame (have ${ab.byteLength}, need ${14 + plen})`, plen);
          return;
        }
        const payload = ab.slice(14, 14 + plen);

        if (fn < latestWantedRef.current - 2) {
          setState(s => ({ ...s, dropped: s.dropped + 1 }));
          return;
        }

        setState(s => ({
          ...s,
          lastFrame: fn,
          width: w,
          height: h,
          bytesReceived: s.bytesReceived + plen,
        }));
        paintFrame(w, h, payload, fmt);

        frameCountRef.current += 1;
        const now = performance.now();
        if (now - fpsWindowRef.current > 900) {
          const fps = frameCountRef.current / ((now - fpsWindowRef.current) / 1000);
          frameCountRef.current = 0;
          fpsWindowRef.current = now;
          setState(s => ({ ...s, fps: Math.max(0, Math.min(120, fps)) }));
        }
      } else if (mt === MSG_ERROR) {
        const msg = decodeWsError(ab);
        logCheckpoint('[viewport] WS ERROR frame', msg);
        setState(s => ({
          ...s,
          dropped: s.dropped + 1,
          wsErrors: s.wsErrors + 1,
          lastWsError: msg,
        }));
      } else {
        logCheckpoint('[viewport] unknown msg type', `0x${mt.toString(16)}`);
      }
    };

    return () => {
      stopPreview();
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [canvasRef, paintFrame, reportPaintError, sendRequest, stopPreview]);

  const requestFrame = useCallback((fn: number, w?: number, h?: number, drop = false) => {
    sendRequest(fn, w || 640, h || 360, FMT_JPEG, drop);
  }, [sendRequest]);

  const requestFrameWebP = useCallback((fn: number, w?: number, h?: number, drop = false) => {
    sendRequest(fn, w || 640, h || 360, FMT_WEBP, drop);
  }, [sendRequest]);

  return {
    ...state,
    startPreview,
    stopPreview,
    requestFrame,
    requestFrameWebP,
    sendRequest,
  };
}