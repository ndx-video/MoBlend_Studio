"""Mo.Blend API Broker (M2).

FastAPI + uvicorn server that runs *inside* the headless Blender process.
Implements the exact contracts from PRD 3 and Mo.Blend API & Function Spec.

- REST control plane on the same port as the data plane.
- Binary WebSocket viewport at /api/v1/viewport/stream (exact 13-byte little-endian wire).
- Producer-consumer via bounded queue.Queue + bpy.app.timers on the main thread.
- Thread-safe result passing via threading.Event + box (no fragile cross-loop futures).
- Pre-validation of parameters against the loaded manifest (422 before enqueue).
- Stale frame dropping for scrubbing (drop-if-stale flag + latest frame tracking).
- 429 on action queue backpressure.
- CORS limited to known local origins (wails.localhost + localhost variants).
- Loopback-only by default (M2 does not implement --bind-public / bearer yet).

The public entry is serve_forever(). bootstrap.py calls it for the long-running mode.
All heavy bpy work (load, set_parameter, save, render_frame) happens exclusively
on Blender's main thread via the timer callback.
"""

from __future__ import annotations

import asyncio
import queue
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any

import bpy  # type: ignore[import-not-found]

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import engine
from . import log as moblend_log
from .store import BrokerDB, moblend_home, open_broker_db

# -------------------------------------------------------------------
# Constants (wire + backpressure)
# -------------------------------------------------------------------

PROTOCOL_VERSION = 1
QUEUE_MAXSIZE = 32  # small; clients must debounce. Exceeding -> 429 from web thread.

# Binary protocol (little-endian, PRD 3 §3.2)
# Client -> Server REQUEST_FRAME (exactly 13 bytes)
REQUEST_STRUCT = struct.Struct("<B I H H B B B B")  # type, frame u32, w u16, h u16, fmt, flags, ver, res
# Server -> Client FRAME
FRAME_HEADER_STRUCT = struct.Struct("<B I H H B I")  # type, frame u32, w, h, fmt, payload_len
# Server -> Client ERROR (0xFF + u16 len + utf8)
ERROR_PREFIX = struct.Struct("<B H")

MSG_REQUEST = 0x01
MSG_FRAME = 0x02
MSG_ERROR = 0xFF

FORMAT_JPEG = 0
FORMAT_WEBP = 1

FLAG_DROP_STALE = 0x01

# -------------------------------------------------------------------
# Task / result bridge (used by both REST and WS paths)
# -------------------------------------------------------------------

@dataclass
class BrokerTask:
    op: str
    args: dict[str, Any]
    result: Any = None
    exc: BaseException | None = None
    event: threading.Event = None  # type: ignore[assignment]
    # Viewport scrub metadata (M2 stale-drop after render completes)
    frame_number: int | None = None
    drop_stale: bool = False

    def __post_init__(self) -> None:
        if self.event is None:
            object.__setattr__(self, "event", threading.Event())


# Module-level shared queue. Created fresh in serve_forever.
_action_queue: queue.Queue[BrokerTask] | None = None
_latest_wanted_frame: int = -1
_latest_lock = threading.Lock()

_broker_db: BrokerDB | None = None
_last_health_log: float = 0.0
_health_log_lock = threading.Lock()

# -------------------------------------------------------------------
# Pydantic models (wire shapes per API spec)
# -------------------------------------------------------------------

class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class LoadRequest(BaseModel):
    template_path: str = Field(..., description="Absolute or repo-relative path to a .mo.blend")


class SaveRequest(BaseModel):
    incremental: bool = True


class ParameterUpdate(BaseModel):
    id: str
    value: Any


class ParametersPatch(BaseModel):
    updates: list[ParameterUpdate]


class HealthResponse(BaseModel):
    status: str = "ok"
    loaded: bool
    template_id: str | None = None
    dirty: bool
    blender_version: str | None = None


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def _error(code: str, message: str, status: int = 400, details: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail=ErrorEnvelope(error=ErrorDetail(code=code, message=message, details=details)).model_dump(),
    )


def _get_manifest_or_503() -> dict[str, Any]:
    m = engine.get_current_manifest()
    if m is None:
        raise _error("engine_unavailable", "No template loaded", 503)
    return m


def _validate_parameter_update(manifest: dict[str, Any], upd: ParameterUpdate) -> None:
    """Light pre-flight validation before enqueue (protects the queue + engine)."""
    param = engine.manifest.find_parameter(manifest, upd.id) if hasattr(engine, "manifest") else None
    # engine re-exports? fall back to direct import for robustness
    if param is None:
        from .manifest import find_parameter

        param = find_parameter(manifest, upd.id)
    if param is None:
        raise _error("validation_failed", f"Unknown parameter id: {upd.id}", 422, {"id": upd.id})

    ptype = param.get("type")
    # Very light type/shape guard (full coercion still happens in nodes.coerce_value)
    if ptype in ("int", "float") and not isinstance(upd.value, (int, float, str)):
        # allow string numbers from loose JSON clients; engine will parse
        pass
    if ptype == "bool" and not isinstance(upd.value, (bool, int, str)):
        pass
    if ptype == "color_rgba" and not (
        isinstance(upd.value, (list, tuple, str)) or (isinstance(upd.value, str) and upd.value.startswith("#"))
    ):
        raise _error(
            "validation_failed",
            f"color_rgba expects #hex or [r,g,b,a] array, got {type(upd.value)}",
            422,
            {"id": upd.id},
        )
    if ptype == "enum" and not (isinstance(upd.value, (str, int))):
        raise _error("validation_failed", "enum expects string label or int index", 422, {"id": upd.id})

    # Asset params (image/video/font) carry a local filesystem path (or file:// URI) from the
    # Go sandbox. The broker will dispatch to ingest_asset rather than set_parameter.
    if ptype in ("image", "video", "font") and not isinstance(upd.value, (str,)):
        raise _error(
            "validation_failed",
            f"{ptype} expects a local path string (sandbox file), got {type(upd.value)}",
            422,
            {"id": upd.id},
        )


# -------------------------------------------------------------------
# Action execution (runs on main Blender thread via timer)
# -------------------------------------------------------------------

def _execute_task(task: BrokerTask) -> None:
    """Perform the actual engine work. Must only be called from the bpy timer."""
    try:
        if task.op == "load_template":
            path = task.args["template_path"]
            manifest = engine.load_template(path)
            task.result = manifest
        elif task.op == "set_parameter":
            pid = task.args["id"]
            val = task.args["value"]
            ok = engine.set_parameter(pid, val)
            if not ok:
                raise RuntimeError(f"set_parameter({pid}) returned False (unknown or unresolved target)")
            task.result = {"ok": True}
        elif task.op == "save_project":
            inc = task.args.get("incremental", True)
            saved = engine.save_project(incremental=inc)
            task.result = {"path": saved, "dirty": False}
        elif task.op == "render_frame":
            fn = int(task.args["frame_number"])
            w = task.args.get("width")
            h = task.args.get("height")
            fmt = task.args.get("format", "JPEG")
            data = engine.render_frame(fn, width=w, height=h, img_format=fmt)
            task.result = data
        elif task.op == "set_slot":
            idx = int(task.args["index"])
            st = float(task.args["start_time"])
            et = float(task.args["end_time"])
            pid = task.args.get("preset_id")
            ok = engine.set_slot(idx, st, et, pid)
            task.result = {"ok": bool(ok)}
        elif task.op == "ingest_asset":
            pid = task.args["id"]
            src = task.args["source_path"]
            ok = engine.ingest_asset(pid, src)
            if not ok:
                raise RuntimeError(f"ingest_asset({pid}) failed (unknown param, bad path, or unsupported type)")
            task.result = {"ok": True}
        else:
            raise RuntimeError(f"Unknown op: {task.op}")
    except Exception as ex:  # capture everything for the waiter
        task.exc = ex
    finally:
        task.event.set()


def _drain_queue() -> None:
    """bpy.app.timers callback. Runs on Blender main thread ~every 0.01s."""
    global _action_queue
    if _action_queue is None:
        return
    q = _action_queue
    drained = 0
    while True:
        try:
            task = q.get_nowait()
        except queue.Empty:
            break
        _execute_task(task)
        drained += 1
        if drained > 8:  # safety valve; don't starve the bpy loop on a huge backlog
            break


# -------------------------------------------------------------------
# Stale frame tracking (for drop-if-stale scrubbing)
# -------------------------------------------------------------------

def _update_latest_frame(frame_number: int) -> None:
    global _latest_wanted_frame
    with _latest_lock:
        if frame_number > _latest_wanted_frame:
            _latest_wanted_frame = frame_number


def _is_stale_and_should_drop(frame_number: int, drop_flag: bool) -> bool:
    if not drop_flag:
        return False
    with _latest_lock:
        return frame_number < _latest_wanted_frame


# -------------------------------------------------------------------
# FastAPI application factory
# -------------------------------------------------------------------

def create_app(action_q: queue.Queue[BrokerTask]) -> FastAPI:
    app = FastAPI(title="Mo.Blend Broker", version="0.2.0")

    # CORS — local UI origins only (PRD 3 §4). Wails WebView2 uses https://wails.localhost.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://wails.localhost",
            "https://wails.localhost",
            "http://localhost",
            "https://localhost",
            "http://127.0.0.1",
            "https://127.0.0.1",
        ],
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|wails\.localhost)(:\d+)?",
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        m = engine.get_current_manifest()
        ver = None
        try:
            ver = bpy.app.version_string
        except Exception:
            pass
        resp = HealthResponse(
            loaded=m is not None,
            template_id=(m or {}).get("template_id") if m else None,
            dirty=engine.is_dirty(),
            blender_version=ver,
        )
        _maybe_log_health(resp.loaded, resp.template_id)
        return resp

    @app.get("/api/v1/manifest")
    def get_manifest() -> dict[str, Any]:
        return _get_manifest_or_503()

    @app.post("/api/v1/project/load")
    def project_load(req: LoadRequest) -> dict[str, Any]:
        task = BrokerTask(op="load_template", args={"template_path": req.template_path})
        try:
            action_q.put(task, timeout=0.05)
        except queue.Full:
            raise _error("queue_full", "Action queue is full (backpressure)", 429)
        task.event.wait(timeout=30.0)
        if task.exc:
            raise _error("engine_error", str(task.exc), 500)
        return task.result  # the manifest

    @app.post("/api/v1/project/save")
    def project_save(req: SaveRequest | None = None) -> dict[str, Any]:
        inc = True if req is None else req.incremental
        task = BrokerTask(op="save_project", args={"incremental": inc})
        try:
            action_q.put(task, timeout=0.05)
        except queue.Full:
            raise _error("queue_full", "Action queue is full (backpressure)", 429)
        task.event.wait(timeout=60.0)
        if task.exc:
            raise _error("engine_error", str(task.exc), 500)
        return task.result

    @app.patch("/api/v1/parameters")
    def patch_parameters(body: ParametersPatch) -> dict[str, Any]:
        manifest = _get_manifest_or_503()
        for upd in body.updates:
            _validate_parameter_update(manifest, upd)

        results: list[dict[str, Any]] = []
        for upd in body.updates:
            p = None
            if hasattr(engine, "manifest"):
                try:
                    p = engine.manifest.find_parameter(manifest, upd.id)
                except Exception:
                    p = None
            if p is None:
                from .manifest import find_parameter
                p = find_parameter(manifest, upd.id)
            is_asset = p is not None and p.get("type") in ("image", "video", "font")

            op = "ingest_asset" if is_asset else "set_parameter"
            args = {"id": upd.id, "source_path": upd.value} if is_asset else {"id": upd.id, "value": upd.value}

            task = BrokerTask(op=op, args=args)
            try:
                action_q.put(task, timeout=0.05)
            except queue.Full:
                raise _error("queue_full", "Action queue is full (backpressure)", 429)
            task.event.wait(timeout=30.0 if is_asset else 10.0)
            if task.exc:
                op_name = "ingest_asset" if is_asset else "set_parameter"
                raise _error("engine_error", f"{op_name}({upd.id}) failed: {task.exc}", 500)
            results.append(task.result)

        return {"status": "ok", "applied": len(results)}

    @app.patch("/api/v1/slots")
    def patch_slots(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Accept {"slots": [ {"index": 0, "start_time": 0.0, "end_time": 2.5, "preset_id": "fade_in"? }, ... ]}"""
        if body is None or not isinstance(body, dict):
            body = {}
        slots = body.get("slots")
        if not isinstance(slots, list):
            raise _error("validation_failed", "slots must be a list", 422)

        results: list[dict[str, Any]] = []
        for s in slots:
            if not isinstance(s, dict) or "index" not in s or "start_time" not in s or "end_time" not in s:
                raise _error("validation_failed", "each slot requires index, start_time, end_time", 422)
            task = BrokerTask(
                op="set_slot",
                args={
                    "index": s["index"],
                    "start_time": s["start_time"],
                    "end_time": s["end_time"],
                    "preset_id": s.get("preset_id"),
                },
            )
            try:
                action_q.put(task, timeout=0.05)
            except queue.Full:
                raise _error("queue_full", "Action queue is full (backpressure)", 429)
            task.event.wait(timeout=10.0)
            if task.exc:
                raise _error("engine_error", f"set_slot failed: {task.exc}", 500)
            results.append(task.result)

        return {"status": "ok", "applied": len(results)}

    @app.post("/api/v1/render/export")
    def render_export(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """M3 MVP: immediately returns 202 + job_id. Poll status for progress/result_path."""
        spec = body or {}
        # We do not enqueue the whole export (it may be long); engine.start_export_job spawns
        # a status thread. Real per-frame work can be added later by enqueuing render tasks.
        try:
            job_id = engine.start_export_job(spec)
        except Exception as ex:
            raise _error("engine_error", f"Failed to start export: {ex}", 500)
        if _broker_db is not None:
            try:
                _broker_db.upsert_export_job(job_id, "queued")
            except Exception:
                pass
        return {"job_id": job_id, "status": "queued"}

    @app.get("/api/v1/render/status/{job_id}")
    def render_status(job_id: str) -> dict[str, Any]:
        st = engine.get_export_status(job_id)
        if st is None:
            raise _error("not_found", f"Unknown job_id {job_id}", 404, {"job_id": job_id})
        if _broker_db is not None:
            try:
                _broker_db.upsert_export_job(
                    job_id,
                    str(st.get("status") or "unknown"),
                    output_path=st.get("result_path"),
                    error=st.get("error"),
                )
            except Exception:
                pass
        return st

    @app.get("/api/v1/templates")
    def list_templates() -> list[dict[str, Any]]:
        # M2 stub. Real cached index.json fetch from lib.moblend.dev / mbl-registry is M4 work.
        # Returning [] keeps the endpoint "responding correctly" and unblocks clients that call it early.
        return []

    # --- Binary viewport WebSocket (exact wire per PRD 3 §3.2) ---
    @app.websocket("/api/v1/viewport/stream")
    async def viewport_stream(ws: WebSocket) -> None:
        await ws.accept()

        # Pending render jobs: reader updates latest-frame while processor waits on bpy.
        @dataclass
        class _ViewportJob:
            frame_num: int
            width: int
            height: int
            fmt: int
            drop_stale: bool
            img_fmt: str

        pending: asyncio.Queue[_ViewportJob | None] = asyncio.Queue()
        session_closed = asyncio.Event()

        async def _reader() -> None:
            """Continuously read REQUEST_FRAME; update scrub latest even during in-flight renders."""
            try:
                while not session_closed.is_set():
                    raw = await ws.receive_bytes()
                    if len(raw) < 13:
                        await _send_ws_error(ws, "bad_request", "REQUEST_FRAME too short")
                        continue

                    try:
                        msg_type, frame_num, w, h, fmt, flags, ver, _res = REQUEST_STRUCT.unpack(raw[:13])
                    except struct.error:
                        await _send_ws_error(ws, "bad_request", "REQUEST_FRAME unpack failed")
                        continue

                    if msg_type != MSG_REQUEST:
                        await _send_ws_error(ws, "bad_request", f"expected 0x01 REQUEST, got {msg_type:#04x}")
                        continue
                    if ver != PROTOCOL_VERSION:
                        await _send_ws_error(ws, "protocol_mismatch", f"protocol_version {ver} != {PROTOCOL_VERSION}")
                        continue

                    drop_stale = bool(flags & FLAG_DROP_STALE)
                    img_fmt = "WEBP" if fmt == FORMAT_WEBP else "JPEG"

                    if drop_stale:
                        _update_latest_frame(frame_num)

                    if _is_stale_and_should_drop(frame_num, drop_stale):
                        continue

                    await pending.put(
                        _ViewportJob(
                            frame_num=int(frame_num),
                            width=int(w),
                            height=int(h),
                            fmt=int(fmt),
                            drop_stale=drop_stale,
                            img_fmt=img_fmt,
                        )
                    )
            except WebSocketDisconnect:
                pass
            except Exception as ex:  # pragma: no cover (defensive)
                try:
                    await _send_ws_error(ws, "internal_error", str(ex))
                except Exception:
                    pass
            finally:
                session_closed.set()
                await pending.put(None)

        async def _processor() -> None:
            """Drain pending jobs one at a time; re-check stale before and after bpy render."""
            while True:
                job = await pending.get()
                if job is None:
                    return

                if _is_stale_and_should_drop(job.frame_num, job.drop_stale):
                    continue

                task = BrokerTask(
                    op="render_frame",
                    args={
                        "frame_number": job.frame_num,
                        "width": job.width,
                        "height": job.height,
                        "format": job.img_fmt,
                    },
                    frame_number=job.frame_num,
                    drop_stale=job.drop_stale,
                )
                try:
                    action_q.put(task, timeout=0.02)
                except queue.Full:
                    await _send_ws_error(ws, "queue_full", "Action queue full")
                    continue

                finished = await asyncio.to_thread(task.event.wait, 60.0)
                if not finished:
                    await _send_ws_error(ws, "timeout", "render timed out")
                    continue
                if task.exc:
                    await _send_ws_error(ws, "render_failed", str(task.exc))
                    continue

                payload: bytes = task.result  # type: ignore[assignment]
                if not isinstance(payload, (bytes, bytearray)):
                    await _send_ws_error(ws, "render_failed", "render returned non-bytes")
                    continue

                if _is_stale_and_should_drop(job.frame_num, job.drop_stale):
                    continue

                header = FRAME_HEADER_STRUCT.pack(
                    MSG_FRAME,
                    job.frame_num,
                    job.width,
                    job.height,
                    job.fmt,
                    len(payload),
                )
                await ws.send_bytes(header + bytes(payload))

        reader_task = asyncio.create_task(_reader())
        processor_task = asyncio.create_task(_processor())
        try:
            await asyncio.gather(reader_task, processor_task)
        finally:
            session_closed.set()
            reader_task.cancel()
            processor_task.cancel()

    # OpenAPI /docs is automatically available — extremely useful for M2/M3.

    return app


def _maybe_log_health(loaded: bool, template_id: str | None) -> None:
    """Append broker.health at debug, throttled to once per minute."""
    global _last_health_log
    now = time.time()
    with _health_log_lock:
        if now-_last_health_log < 60.0:
            return
        _last_health_log = now
    moblend_log.append(
        "broker",
        "debug",
        "broker.health",
        "Health probe",
        loaded=loaded,
        template_id=template_id,
    )


async def _send_ws_error(ws: WebSocket, code: str, message: str) -> None:
    try:
        msg = f"{code}:{message}".encode("utf-8")[:65535]
        pkt = ERROR_PREFIX.pack(MSG_ERROR, len(msg)) + msg
        await ws.send_bytes(pkt)
    except Exception:
        pass


# -------------------------------------------------------------------
# Public lifecycle
# -------------------------------------------------------------------

def serve_forever(host: str = "127.0.0.1", port: int = 8000, initial_load: str | None = None) -> None:
    """Start the broker inside the running Blender process and block forever.

    - Spawns uvicorn in a daemon thread (its own event loop).
    - Registers a bpy.app.timers callback on the main thread to drain the action queue.
    - Optionally loads a template before entering the server loop (bootstrap convenience).
    - Keeps the Python script (and thus the Blender --background process) alive with a sleep loop.
    """
    global _action_queue, _latest_wanted_frame, _broker_db
    if _action_queue is not None:
        print("[moblend:server] serve_forever called more than once — ignoring.")
        return

    home = moblend_home()
    try:
        _broker_db = open_broker_db(home)
        log_db = moblend_log.open_suite_logs(home)
        moblend_log.set_default(log_db)
        moblend_log.append("broker", "info", "broker.start", "Broker serve mode started", host=host, port=port)
    except Exception as ex:
        print(f"[moblend:server] WARNING: persistence init failed: {ex}")

    _action_queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
    _latest_wanted_frame = -1

    # Optional early load (very handy for `... --serve --load foo.mo.blend`)
    if initial_load:
        try:
            print(f"[moblend:server] initial load: {initial_load}")
            m = engine.load_template(initial_load)
            print(f"[moblend:server] loaded template_id={m.get('template_id')}")
        except Exception as ex:
            print(f"[moblend:server] initial load FAILED: {ex}")
            # Continue — the client can still POST /load later.

    app = create_app(_action_queue)

    # Start uvicorn in a background thread
    import uvicorn

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=False,  # we do our own minimal logging for fps-sensitive path
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    def _run_uvicorn() -> None:
        # This thread owns the uvicorn/ASGI event loop.
        server.run()

    t = threading.Thread(target=_run_uvicorn, name="moblend-uvicorn", daemon=True)
    t.start()

    print(f"[moblend:server] uvicorn starting on {host}:{port} (binary WS + REST)")

    # Register the timer (best-effort; may not fire if the main thread is busy).
    try:
        bpy.app.timers.register(_drain_queue, first_interval=0.01, persistent=True)
        print("[moblend:server] bpy.app.timers registered (0.01s)")
    except Exception as ex:
        print(f"[moblend:server] WARNING: could not register bpy timer: {ex}")

    # Keep the script (and Blender background process) alive.
    # In --background --python mode the main thread must poll the queue directly;
    # relying only on bpy.app.timers is unreliable when this loop holds the thread.
    try:
        while True:
            _drain_queue()
            time.sleep(0.01)
    except KeyboardInterrupt:
        print("[moblend:server] KeyboardInterrupt — shutting down (timers will be cleaned by Blender exit).")
    finally:
        try:
            bpy.app.timers.unregister(_drain_queue)
        except Exception:
            pass
