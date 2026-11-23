"""Engine contract: every music/vocal model is wrapped behind this small interface.

`EngineInfo.native_controls` lists parameters the model itself accepts (real knobs).
Everything else a user types (style, instruments, mood...) is only *text description* that the
model may or may not follow — the UI shows these two groups separately and honestly.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from ..errors import Cancelled

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def clean_log_text(text: Optional[str], limit: int = 300) -> str:
    """Strip ANSI escapes / carriage returns from server log lines before showing them."""
    if not text:
        return ""
    text = ANSI_RE.sub("", str(text)).replace("\r", "\n")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    return (lines[-1] if lines else "")[:limit]


@dataclass
class GenerationRequest:
    lyrics: str = ""  # engine-ready lyrics (already contains [Verse]/[Chorus] tags)
    caption: str = ""  # free-text style description (English words usually work best)
    instrumental: bool = False
    vocal_language: str = "unknown"
    duration: Optional[float] = None
    bpm: Optional[int] = None
    key_scale: str = ""
    time_signature: str = ""
    seed: Optional[int] = None
    steps: Optional[int] = None
    guidance: Optional[float] = None
    use_lm: Optional[bool] = None  # None = engine default
    purpose: str = "full"  # "full" | "chorus_test"
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GenerationResult:
    path: Path  # audio file written by the engine (any format; studio converts to WAV)
    seed: Optional[int] = None
    engine_meta: Dict[str, Any] = field(default_factory=dict)  # what the engine reported back
    sent: Dict[str, Any] = field(default_factory=dict)  # what we actually sent (shown to the user)
    notes: List[str] = field(default_factory=list)  # Khmer notes about adjustments we made


@dataclass
class Health:
    ok: bool
    state: str  # ready | loading | unreachable | not_configured | error
    message: str  # Khmer, shown in the header chip
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"ok": self.ok, "state": self.state, "message": self.message, "detail": self.detail}


@dataclass
class EngineInfo:
    id: str
    name: str
    is_ai: bool
    summary: str
    homepage: str = ""
    weights_url: str = ""
    license_name: str = ""
    license_url: str = ""
    release_terms: str = ""  # Khmer: what the license/model card says about releasing songs
    hardware: str = ""  # Khmer: GPU / VRAM requirements
    khmer_status: str = "unknown"  # documented | not_documented | none | not_ai
    khmer_note: str = ""
    supports_vocals: bool = True
    supports_instrumental: bool = True
    min_duration: float = 10.0
    max_duration: float = 600.0
    native_controls: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    experimental: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


class EngineContext:
    """What an engine may call while running: progress, log lines, cancellation checks."""

    def __init__(
        self,
        workdir: Path,
        progress_cb: Optional[Callable[[Optional[float], str, Optional[str]], None]] = None,
        log_cb: Optional[Callable[[str], None]] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> None:
        self.workdir = workdir
        self._progress = progress_cb
        self._log = log_cb
        self._cancel = cancel_check
        workdir.mkdir(parents=True, exist_ok=True)

    def progress(self, fraction: Optional[float], stage: str, message: Optional[str] = None) -> None:
        if self._progress:
            self._progress(fraction, stage, message)

    def log(self, text: str) -> None:
        if self._log and text:
            self._log(text)

    def cancelled(self) -> bool:
        return bool(self._cancel and self._cancel())

    def check_cancelled(self) -> None:
        if self.cancelled():
            raise Cancelled()


class Engine:
    """Subclass and register in `engines/__init__.py`."""

    id: str = ""

    def info(self) -> EngineInfo:  # pragma: no cover - interface
        raise NotImplementedError

    def health(self) -> Health:  # pragma: no cover - interface
        raise NotImplementedError

    def generate(self, req: GenerationRequest, ctx: EngineContext) -> GenerationResult:  # pragma: no cover
        raise NotImplementedError


# ---------------------------------------------------------------------------------------------
# Shared control descriptions (Khmer labels). Used by several engines.
# ---------------------------------------------------------------------------------------------
KEY_OPTIONS = [""] + [
    f"{note}{acc} {mode}"
    for mode in ("major", "minor")
    for note, acc in [
        ("C", ""), ("C", "#"), ("D", ""), ("Eb", ""), ("E", ""), ("F", ""),
        ("F", "#"), ("G", ""), ("Ab", ""), ("A", ""), ("Bb", ""), ("B", ""),
    ]
]

# Languages the ACE-Step 1.5 code lists in acestep/constants.py:VALID_LANGUAGES (plus "km", which
# is NOT in that list). "unknown" = let the model decide.
ACESTEP_VALID_LANGUAGES = [
    "ar", "az", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi",
    "hr", "ht", "hu", "id", "is", "it", "ja", "ko", "la", "lt", "ms", "ne", "nl", "no", "pa", "pl",
    "pt", "ro", "ru", "sa", "sk", "sr", "sv", "sw", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi",
    "yue", "zh", "unknown",
]
