"""Mo.Blend Engine I/O helpers (shadow backups, purge).

M1 implements the rolling .01–.05 shadow rotation on incremental save
and the mandatory orphans purge before any write (PRD 2 §2.1–2.2).
"""

from __future__ import annotations

from pathlib import Path

import bpy  # type: ignore[import-not-found]


def orphans_purge() -> None:
    """Remove unlinked data blocks before save/export (VRAM hygiene)."""
    bpy.data.orphans_purge()


def shadow_rotate(base: Path, max_backups: int = 5) -> None:
    """Rotate shadow copies for the given base path (e.g. foo.mo.blend).

    Produces foo.mo.blend.01 (most recent backup) up to .05 (oldest kept).
    The current on-disk base is moved to .01; older shadows are shifted up
    (higher numbers = older). The oldest beyond max_backups is deleted.

    This is the save-side half of the incremental backup system required for M1.
    Load-side recovery scanning is out of scope for M1 (see PRD 2 §2.2).
    """
    base = Path(base)
    if not base.exists():
        return

    # Clean any stale shadows beyond the cap (defensive)
    for i in range(max_backups + 1, max_backups + 10):
        stale = Path(str(base) + f".{i:02d}")
        if stale.exists():
            stale.unlink()

    # Shift existing shadows .05 ← .04 ← ... (drop .05 if present)
    for i in range(max_backups, 0, -1):
        src = Path(str(base) + f".{i:02d}")
        if not src.exists():
            continue
        if i == max_backups:
            src.unlink()
        else:
            dst = Path(str(base) + f".{i + 1:02d}")
            src.replace(dst)

    # Current on-disk file becomes the newest shadow (.01)
    backup_01 = Path(str(base) + ".01")
    base.replace(backup_01)
