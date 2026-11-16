"""Shared atomic file-writing helpers that preserve host-readable permissions."""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any


def _resolve_host_owner(start_dir: str) -> tuple[int, int] | None:
    """Find the first non-root UID/GID walking up from `start_dir` (up to 3 levels)."""
    cur = os.path.abspath(start_dir)
    for _ in range(4):
        try:
            st = os.stat(cur)
            if st.st_uid != 0 or st.st_gid != 0:
                return (st.st_uid, st.st_gid)
        except OSError:
            pass
        parent = os.path.dirname(cur)
        if not parent or parent == cur:
            break
        cur = parent
    return None


def apply_host_file_permissions(
    file_path: str,
    dir_path: str | None = None,
    mode: int = 0o644,
) -> None:
    """
    Override tempfile.mkstemp()'s 0600 restriction and, when running as root inside a
    container bind-mount, align ownership to the host directory owner so non-root
    host processes (e.g. ubuntu during CI/CD deploys) retain read/write access.
    """
    try:
        os.chmod(file_path, mode)
    except OSError:
        pass

    geteuid = getattr(os, "geteuid", None)
    chown = getattr(os, "chown", None)
    if geteuid is not None and chown is not None and geteuid() == 0:
        parent = dir_path or os.path.dirname(os.path.abspath(file_path))
        owner = _resolve_host_owner(parent)
        if owner is not None:
            try:
                chown(file_path, owner[0], owner[1])
            except OSError:
                pass


def atomic_write_json(
    path: str,
    payload: Any,
    *,
    indent: int | None = 2,
    separators: tuple[str, str] | None = None,
    prefix: str = ".tmp_",
    suffix: str = ".json",
    mode: int = 0o644,
    fsync: bool = False,
) -> None:
    """Atomically write JSON to `path` with explicit permissions and host UID/GID."""
    abs_path = os.path.abspath(path)
    dir_name = os.path.dirname(abs_path)
    os.makedirs(dir_name, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix=prefix, suffix=suffix)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            if separators is not None:
                json.dump(payload, f, ensure_ascii=False, separators=separators)
            else:
                json.dump(payload, f, ensure_ascii=False, indent=indent)
            if fsync:
                f.flush()
                os.fsync(f.fileno())
        apply_host_file_permissions(tmp_path, dir_name, mode=mode)
        os.replace(tmp_path, abs_path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise


def atomic_write_lines(
    path: str,
    lines: list[str],
    *,
    prefix: str = ".tmp_",
    suffix: str = ".txt",
    mode: int = 0o644,
) -> None:
    """Atomically write text lines to `path` with explicit permissions and host UID/GID."""
    abs_path = os.path.abspath(path)
    dir_name = os.path.dirname(abs_path)
    os.makedirs(dir_name, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix=prefix, suffix=suffix)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.writelines(lines)
        apply_host_file_permissions(tmp_path, dir_name, mode=mode)
        os.replace(tmp_path, abs_path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise
