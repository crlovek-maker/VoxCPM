"""Small helpers: ids, time, atomic JSON files, and a dependency-free HTTP client."""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple


def new_id(prefix: str) -> str:
    """Short, URL-safe, sortable-ish id such as `v_20261123_a1b2c3d4`."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{prefix}_{stamp}_{secrets.token_hex(4)}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON atomically (tmp file + rename) so a crash never leaves half a project file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path: Path, default: Any = None) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name: str, fallback: str = "file") -> str:
    """ASCII-only file name for disk storage (Khmer titles are kept in JSON, not in file names)."""
    cleaned = _SAFE_NAME.sub("_", name).strip("._")
    return cleaned[:80] or fallback


def download_name(title: str, suffix: str, fallback: str = "song") -> str:
    """Human-friendly download name that keeps Khmer letters but drops path-hostile characters."""
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", title or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)[:80] or fallback
    return cleaned + suffix


# ---------------------------------------------------------------------------------------------
# HTTP (stdlib only: no extra dependency, works the same on Windows/macOS/Linux)
# ---------------------------------------------------------------------------------------------
class HttpError(Exception):
    """Raised for non-2xx responses. `body` is the decoded response text (may be empty)."""

    def __init__(self, status: int, body: str, url: str) -> None:
        super().__init__(f"HTTP {status} from {url}: {body[:300]}")
        self.status = status
        self.body = body
        self.url = url


class NetworkError(Exception):
    """Connection refused / DNS failure / timeout."""

    def __init__(self, reason: str, url: str) -> None:
        super().__init__(f"{reason} ({url})")
        self.reason = reason
        self.url = url


def http_json(
    method: str,
    url: str,
    *,
    body: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
) -> Tuple[int, Any]:
    data = None
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (user-configured URL)
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise HttpError(exc.code, text, url) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise NetworkError(str(reason), url) from exc
    try:
        return status, json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return status, raw


def http_download(
    url: str,
    dest: Path,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 120.0,
    on_bytes: Optional[Callable[[int, Optional[int]], None]] = None,
    chunk: int = 1 << 20,
) -> int:
    """Stream `url` to `dest`. Returns bytes written."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    written = 0
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out:  # noqa: S310
            total_header = resp.headers.get("Content-Length")
            total = int(total_header) if total_header and total_header.isdigit() else None
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                out.write(buf)
                written += len(buf)
                if on_bytes:
                    on_bytes(written, total)
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise HttpError(exc.code, text, url) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise NetworkError(str(reason), url) from exc
    return written


def monotonic() -> float:
    return time.monotonic()
