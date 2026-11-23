"""Runtime settings, read from environment variables (and an optional .env file)."""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_DIR.parent
FONTS_DIR = PACKAGE_DIR / "fonts"
WEB_DIR = PACKAGE_DIR / "web"


def load_dotenv(path: Path) -> Dict[str, str]:
    """Tiny .env reader (KEY=VALUE, # comments, optional quotes). Does not touch os.environ."""
    values: Dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
            val = val[1:-1]
        values[key] = val
    return values


def _truthy(value: Optional[str], default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data")
    host: str = "127.0.0.1"
    port: int = 8000
    token: Optional[str] = None  # access token (recommended when binding to the LAN)

    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"

    # Which engine is pre-selected in the UI. Available engines are listed by /api/engines.
    default_engine: str = "acestep"
    enable_selftest: bool = True  # placeholder "system test" engine (NOT AI) for pipeline checks

    # --- ACE-Step 1.5 (official REST API: `acestep-api`) ---
    acestep_url: str = "http://127.0.0.1:8001"
    acestep_api_key: Optional[str] = None
    acestep_model: Optional[str] = None  # None -> server default (acestep-v15-turbo)
    acestep_poll_seconds: float = 2.0
    acestep_timeout_seconds: int = 3600  # CPU-only servers can be very slow; GPUs need seconds.

    # --- HeartMuLa (optional second engine; runs heartlib's example script as a subprocess) ---
    heartmula_dir: Optional[Path] = None
    heartmula_python: str = "python"
    heartmula_ckpt: Optional[Path] = None
    heartmula_version: str = "3B"
    heartmula_lazy_load: bool = True
    heartmula_timeout_seconds: int = 3600

    # --- Optional local text model for lyric help (any OpenAI-compatible server, e.g. Ollama) ---
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_model: Optional[str] = None  # None -> lyric AI helper reports "not configured"
    llm_api_key: Optional[str] = None
    llm_timeout_seconds: int = 180

    max_upload_mb: int = 200

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None, dotenv: Optional[Path] = None) -> "Settings":
        merged: Dict[str, str] = {}
        merged.update(load_dotenv(dotenv or (PROJECT_ROOT / ".env")))
        merged.update(env if env is not None else os.environ)  # real environment wins over .env

        def get(name: str, default: Optional[str] = None) -> Optional[str]:
            value = merged.get(name)
            return value if value not in (None, "") else default

        s = cls()
        s.data_dir = Path(get("STUDIO_DATA_DIR", str(s.data_dir))).expanduser().resolve()
        s.host = get("STUDIO_HOST", s.host) or s.host
        s.port = int(get("STUDIO_PORT", str(s.port)) or s.port)
        s.token = get("STUDIO_TOKEN", None)

        s.ffmpeg = get("FFMPEG", None) or shutil.which("ffmpeg") or "ffmpeg"
        s.ffprobe = get("FFPROBE", None) or shutil.which("ffprobe") or "ffprobe"

        s.default_engine = get("STUDIO_ENGINE", s.default_engine) or s.default_engine
        s.enable_selftest = _truthy(get("STUDIO_ENABLE_SELFTEST"), True)

        s.acestep_url = (get("ACESTEP_URL", s.acestep_url) or s.acestep_url).rstrip("/")
        s.acestep_api_key = get("ACESTEP_API_KEY", None)
        s.acestep_model = get("ACESTEP_MODEL", None)
        s.acestep_poll_seconds = float(get("ACESTEP_POLL_SECONDS", str(s.acestep_poll_seconds)) or 2.0)
        s.acestep_timeout_seconds = int(get("ACESTEP_TIMEOUT_SECONDS", str(s.acestep_timeout_seconds)) or 3600)

        hm_dir = get("HEARTMULA_DIR", None)
        s.heartmula_dir = Path(hm_dir).expanduser().resolve() if hm_dir else None
        s.heartmula_python = get("HEARTMULA_PYTHON", s.heartmula_python) or s.heartmula_python
        hm_ckpt = get("HEARTMULA_CKPT", None)
        s.heartmula_ckpt = Path(hm_ckpt).expanduser().resolve() if hm_ckpt else None
        s.heartmula_version = get("HEARTMULA_VERSION", s.heartmula_version) or s.heartmula_version
        s.heartmula_lazy_load = _truthy(get("HEARTMULA_LAZY_LOAD"), True)
        s.heartmula_timeout_seconds = int(get("HEARTMULA_TIMEOUT_SECONDS", "3600") or 3600)

        s.llm_base_url = (get("LLM_BASE_URL", s.llm_base_url) or s.llm_base_url).rstrip("/")
        s.llm_model = get("LLM_MODEL", None)
        s.llm_api_key = get("LLM_API_KEY", None)
        s.llm_timeout_seconds = int(get("LLM_TIMEOUT_SECONDS", str(s.llm_timeout_seconds)) or 180)

        s.max_upload_mb = int(get("STUDIO_MAX_UPLOAD_MB", str(s.max_upload_mb)) or 200)
        return s
