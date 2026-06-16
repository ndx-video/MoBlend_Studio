"""Mo.Blend catalog fetch/cache (M4b).

Fetches index.json from registryBaseUrl (or catalogFixturePath), caches the body
under <moblend_home>/catalog/index.json, and records metadata in broker.db.
"""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import log as moblend_log
from .store import BrokerDB

DEFAULT_REGISTRY_BASE_URL = "https://raw.githubusercontent.com/ndx-video/MoBlend_Lib/main"
DEFAULT_CATALOG_REFRESH_HOURS = 24

_CATALOG_ENTRY_REQUIRED = frozenset(
    {"template_id", "name", "category", "description", "version", "preview_url", "download_url"}
)


def load_config(home: Path) -> dict[str, Any]:
    """Load config.json from moblend_home; return {} if missing."""
    path = home / "config.json"
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def resolve_registry_url(config: dict[str, Any]) -> str:
    """Resolve the index.json URL from registryBaseUrl."""
    base = str(config.get("registryBaseUrl") or DEFAULT_REGISTRY_BASE_URL).strip()
    base = base.rstrip("/")
    if base.endswith("index.json"):
        return base
    return f"{base}/index.json"


def catalog_cache_path(home: Path) -> Path:
    return home / "catalog" / "index.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _body_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _parse_catalog_body(raw: bytes) -> list[dict[str, Any]]:
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("catalog envelope must be an object")
    templates = data.get("templates")
    if not isinstance(templates, list):
        raise ValueError("catalog envelope missing templates array")
    return templates


def validate_catalog_entries(templates: list[dict[str, Any]]) -> None:
    """Light structural check against catalog.schema.json entry shape."""
    for idx, entry in enumerate(templates):
        if not isinstance(entry, dict):
            raise ValueError(f"templates[{idx}] must be an object")
        missing = _CATALOG_ENTRY_REQUIRED - entry.keys()
        if missing:
            raise ValueError(f"templates[{idx}] missing required fields: {sorted(missing)}")


def load_cached_catalog(home: Path) -> list[dict[str, Any]]:
    """Return templates from disk cache, or [] if absent or unreadable."""
    path = catalog_cache_path(home)
    if not path.is_file():
        return []
    try:
        return _parse_catalog_body(path.read_bytes())
    except Exception:
        return []


def _is_stale(fetched_at: str | None, refresh_hours: float) -> bool:
    if not fetched_at:
        return True
    try:
        dt = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - dt
        return age.total_seconds() > refresh_hours * 3600
    except Exception:
        return True


def _write_disk_cache(home: Path, raw: bytes) -> None:
    path = catalog_cache_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)


def _read_fixture(fixture_path: str) -> bytes:
    path = Path(fixture_path)
    if not path.is_file():
        raise FileNotFoundError(f"catalogFixturePath not found: {fixture_path}")
    return path.read_bytes()


def _fetch_http(url: str, etag: str | None) -> tuple[bytes | None, str | None, int]:
    """Fetch index.json. Returns (body, etag, status). body is None on 304."""
    headers = {"Accept": "application/json", "User-Agent": "MoBlend-Broker/1.0"}
    if etag:
        headers["If-None-Match"] = etag
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            new_etag = resp.headers.get("ETag")
            return resp.read(), new_etag, resp.status
    except urllib.error.HTTPError as ex:
        if ex.code == 304:
            return None, etag, 304
        raise


def _persist_fetch(
    home: Path,
    broker_db: BrokerDB,
    *,
    raw: bytes,
    source_url: str,
    etag: str | None,
) -> list[dict[str, Any]]:
    templates = _parse_catalog_body(raw)
    validate_catalog_entries(templates)
    _write_disk_cache(home, raw)
    broker_db.upsert_catalog_cache(source_url=source_url, body_hash=_body_hash(raw), etag=etag)
    moblend_log.append(
        "broker",
        "info",
        "catalog.fetch_ok",
        "Catalog fetched",
        source=source_url,
        count=len(templates),
    )
    return templates


def fetch_catalog(home: Path, broker_db: BrokerDB, *, force: bool = False) -> list[dict[str, Any]]:
    """Fetch or serve cached catalog; stale-serve on network failure."""
    config = load_config(home)
    refresh_hours = float(config.get("catalogRefreshHours") or DEFAULT_CATALOG_REFRESH_HOURS)
    fixture_path = config.get("catalogFixturePath")
    cache_meta = broker_db.get_catalog_cache()

    if not force and cache_meta is not None and not _is_stale(cache_meta.get("fetched_at"), refresh_hours):
        templates = load_cached_catalog(home)
        if templates:
            moblend_log.append(
                "broker",
                "debug",
                "catalog.cache_hit",
                "Serving TTL-fresh cached catalog",
                count=len(templates),
            )
            return templates

    source_url = f"fixture:{fixture_path}" if fixture_path else resolve_registry_url(config)
    etag = (cache_meta or {}).get("etag")

    try:
        if fixture_path:
            raw = _read_fixture(str(fixture_path))
            return _persist_fetch(home, broker_db, raw=raw, source_url=source_url, etag=None)

        url = resolve_registry_url(config)
        raw, new_etag, status = _fetch_http(url, etag)
        if status == 304:
            templates = load_cached_catalog(home)
            moblend_log.append(
                "broker",
                "debug",
                "catalog.cache_hit",
                "Origin returned 304 Not Modified",
                count=len(templates),
            )
            return templates
        if raw is None:
            raise ValueError("empty catalog response")
        return _persist_fetch(home, broker_db, raw=raw, source_url=url, etag=new_etag)
    except Exception as ex:
        templates = load_cached_catalog(home)
        if templates:
            moblend_log.append(
                "broker",
                "warn",
                "catalog.fetch_failed",
                "Fetch failed; serving stale cache",
                error=str(ex),
                count=len(templates),
            )
            return templates
        moblend_log.append(
            "broker",
            "error",
            "catalog.fetch_failed",
            "Fetch failed with no cache",
            error=str(ex),
        )
        return []