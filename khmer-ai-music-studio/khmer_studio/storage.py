"""Project storage: ONE song = ONE project folder, so you can close the app and continue later.

    data/projects/<project_id>/
        project.json     lyrics, settings, versions, cover, karaoke timings, publish texts
        audio/           <version_id>.wav (+ cached .mp3 on demand)
        voice/           your own recordings (WAV)
        covers/          cover / thumbnail PNGs and the editor's source image
        mv/              rendered karaoke MP4 files
        jobs/            one JSON per job (status survives restarts)
"""
from __future__ import annotations

import copy
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List

from .errors import StudioError
from .util import atomic_write_json, new_id, now_iso, read_json

ID_RE = re.compile(r"^[a-z]{1,4}_[0-9]{8}_[0-9a-f]{8}$")
SCHEMA = 1


def default_project(pid: str, title: str = "", artist: str = "") -> Dict[str, Any]:
    now = now_iso()
    return {
        "schema": SCHEMA,
        "id": pid,
        "created_at": now,
        "updated_at": now,
        "title": title,
        "artist": artist,
        "lyrics": {"sections": [], "updated_at": now},
        "lyrics_history": [],  # snapshots kept before AI suggestions / replacements (undo)
        "music": {
            "engine": None,
            "mode": "vocals",  # vocals | instrumental
            "styles": ["ballad"],
            "instruments": [],
            "moods": [],
            "vocal": [],
            "extra": "",
            "duration": None,
            "bpm": None,
            "key_scale": "",
            "time_signature": "",
            "vocal_language": "unknown",
            "seed": None,
            "steps": None,
            "use_lm": False,
        },
        "versions": [],
        "voice_recordings": [],
        "selected_version_id": None,
        "cover": {"files": {}, "editor": {}, "mv_background": None},
        "karaoke": {
            "version_id": None,
            "lines": [],  # [{"text": "...", "start": 1.25 | None, "section": "chorus"}]
            "style": {"font": "Noto Sans Khmer", "size": 64, "color": "#FFD54A", "dim": "#FFFFFF", "show_title": True},
            "outputs": [],
        },
        "publish": {
            "info": {
                "genre": "", "mood": "", "language": "ខ្មែរ", "year": "", "lyrics_by": "", "music_by": "",
                "vocals_by": "", "links": "", "ai_disclosure": True, "extra_tags": "",
            },
            "texts": {},
        },
    }


def _fill_defaults(target: Dict[str, Any], defaults: Dict[str, Any]) -> None:
    """Add keys that older project files lack (forward compatibility) without touching existing data."""
    for key, value in defaults.items():
        if key not in target:
            target[key] = copy.deepcopy(value)
        elif isinstance(value, dict) and isinstance(target[key], dict):
            _fill_defaults(target[key], value)


class ProjectStore:
    SUBDIRS = ("audio", "voice", "covers", "mv", "jobs")

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: Dict[str, threading.RLock] = {}
        self._guard = threading.Lock()

    # ------------------------------------------------------------------ paths
    @staticmethod
    def valid_id(pid: str) -> bool:
        return bool(ID_RE.match(pid or ""))

    def lock(self, pid: str) -> threading.RLock:
        with self._guard:
            return self._locks.setdefault(pid, threading.RLock())

    def project_dir(self, pid: str) -> Path:
        if not self.valid_id(pid):
            raise StudioError("not_found", "រកមិនឃើញគម្រោង", status=404)
        return self.root / pid

    def file(self, pid: str) -> Path:
        return self.project_dir(pid) / "project.json"

    def exists(self, pid: str) -> bool:
        return self.valid_id(pid) and self.file(pid).is_file()

    def sub(self, pid: str, name: str) -> Path:
        d = self.project_dir(pid) / name
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ------------------------------------------------------------------ CRUD
    def create(self, title: str = "", artist: str = "", sections: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
        pid = new_id("p")
        project = default_project(pid, title.strip(), artist.strip())
        if sections:
            project["lyrics"]["sections"] = sections
        d = self.project_dir(pid)
        for name in self.SUBDIRS:
            (d / name).mkdir(parents=True, exist_ok=True)
        atomic_write_json(self.file(pid), project)
        return project

    def get(self, pid: str) -> Dict[str, Any]:
        if not self.exists(pid):
            raise StudioError("not_found", "រកមិនឃើញគម្រោង", status=404)
        with self.lock(pid):
            project = read_json(self.file(pid))
        if not isinstance(project, dict):
            raise StudioError("corrupt_project", "ឯកសារគម្រោងខូច", status=500)
        _fill_defaults(project, default_project(pid))
        return project

    def update(self, pid: str, mutator: Callable[[Dict[str, Any]], Any]) -> Dict[str, Any]:
        """Locked read-modify-write. `mutator` edits the dict in place (may return a value; ignored)."""
        if not self.exists(pid):
            raise StudioError("not_found", "រកមិនឃើញគម្រោង", status=404)
        with self.lock(pid):
            project = self.get(pid)
            mutator(project)
            project["updated_at"] = now_iso()
            atomic_write_json(self.file(pid), project)
            return project

    def delete(self, pid: str) -> None:
        d = self.project_dir(pid)
        if not d.is_dir():
            raise StudioError("not_found", "រកមិនឃើញគម្រោង", status=404)
        with self.lock(pid):
            shutil.rmtree(d)

    def list(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for d in sorted(self.root.iterdir()) if self.root.is_dir() else []:
            if not (d.is_dir() and self.valid_id(d.name) and (d / "project.json").is_file()):
                continue
            try:
                p = self.get(d.name)
            except StudioError:
                continue
            out.append(self.summary(p))
        out.sort(key=lambda x: x["updated_at"], reverse=True)
        return out

    @staticmethod
    def summary(p: Dict[str, Any]) -> Dict[str, Any]:
        lines = sum(1 for s in p["lyrics"]["sections"] for ln in s.get("lines", []) if str(ln).strip())
        return {
            "id": p["id"],
            "title": p.get("title", ""),
            "artist": p.get("artist", ""),
            "created_at": p["created_at"],
            "updated_at": p["updated_at"],
            "line_count": lines,
            "version_count": len(p.get("versions", [])),
            "has_cover": bool(p.get("cover", {}).get("files")),
            "mv_count": len(p.get("karaoke", {}).get("outputs", [])),
            "selected_version_id": p.get("selected_version_id"),
        }

    # ------------------------------------------------------------------ helpers used by the API
    @staticmethod
    def find_version(project: Dict[str, Any], vid: str) -> Dict[str, Any]:
        for v in project.get("versions", []):
            if v.get("id") == vid:
                return v
        raise StudioError("not_found", "រកមិនឃើញកំណែសំឡេងនេះ", status=404)

    def safe_media_path(self, pid: str, kind: str, name: str) -> Path:
        if kind not in {"audio", "voice", "covers", "mv"}:
            raise StudioError("not_found", "រកមិនឃើញឯកសារ", status=404)
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$", name or ""):
            raise StudioError("not_found", "រកមិនឃើញឯកសារ", status=404)
        base = self.project_dir(pid) / kind
        path = (base / name).resolve()
        try:
            path.relative_to(base.resolve())
        except ValueError as exc:
            raise StudioError("not_found", "រកមិនឃើញឯកសារ", status=404) from exc
        if not path.is_file():
            raise StudioError("not_found", "រកមិនឃើញឯកសារ", status=404)
        return path
