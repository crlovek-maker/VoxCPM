"""Optional automatic cross-check: does an ASR model "hear" the original lyrics in the generated song?

This is an INDICATOR only. Speech recognition for Khmer is weak, and singing over music is much
harder than speech, so a high error rate does not prove the singer is wrong and a low one is not a
guarantee — a Khmer speaker listening is the real test. Needs `pip install faster-whisper`.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


def levenshtein(a: Sequence[str], b: Sequence[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def normalize(text: str) -> str:
    """Keep letters/digits (incl. Khmer), drop spaces, punctuation and zero-width marks; NFC-normalise."""
    text = unicodedata.normalize("NFC", text or "")
    return "".join(ch for ch in text if (ch.isalnum() or "ក" <= ch <= "៿") and ch not in "​‌‍")


def cer(heard: str, target: str) -> float:
    """Character error rate between two strings (0.0 = identical, can exceed 1.0)."""
    a, b = normalize(heard), normalize(target)
    return levenshtein(a, b) / max(1, len(b))


def load_audio_16k(wav: Path, ffmpeg: str = "ffmpeg"):
    """Decode with FFmpeg to 16 kHz mono float32 (avoids faster-whisper's PyAV decoder, which varies by version)."""
    import subprocess

    import numpy as np

    raw = subprocess.run([ffmpeg, "-v", "error", "-i", str(wav), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def transcribe(wav: Path, model_size: str = "small", language: Optional[str] = "km", ffmpeg: str = "ffmpeg") -> Dict[str, Any]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise RuntimeError("faster-whisper is not installed:  pip install faster-whisper") from exc
    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, info = model.transcribe(load_audio_16k(wav, ffmpeg), language=language, beam_size=5)
    segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
    return {"text": " ".join(s["text"] for s in segs).strip(), "segments": segs, "language": info.language, "language_probability": round(info.language_probability, 3)}


def compare(wav: Path, lyric_lines: List[str], model_size: str = "small", language: Optional[str] = "km", ffmpeg: str = "ffmpeg") -> Dict[str, Any]:
    r = transcribe(wav, model_size, language, ffmpeg)
    target = " ".join(lyric_lines)
    r["target"] = target
    r["cer"] = round(cer(r["text"], target), 3)
    r["model"] = model_size
    return r
