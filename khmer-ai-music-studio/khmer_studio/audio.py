"""FFmpeg / ffprobe helpers (conversion, probing, silence analysis, voice + instrumental mixing)."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .errors import Cancelled, StudioError

_FFMPEG_HINT = "ដំឡើង FFmpeg (Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Linux: sudo apt install ffmpeg)"


def tool_available(binary: str) -> bool:
    return bool(shutil.which(binary)) or Path(binary).is_file()


def run(
    cmd: List[str],
    *,
    timeout: Optional[float] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    on_stderr_line: Optional[Callable[[str], None]] = None,
    on_stdout_line: Optional[Callable[[str], None]] = None,
    cwd: Optional[Path] = None,
) -> subprocess.CompletedProcess:
    """Run a subprocess, streaming both pipes, killing it if cancelled or timed out."""
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace", cwd=str(cwd) if cwd else None,
        )
    except FileNotFoundError as exc:
        raise StudioError("ffmpeg_missing", f"រក FFmpeg មិនឃើញ ({cmd[0]})", detail=str(exc), hint=_FFMPEG_HINT, status=500) from exc

    stderr_lines: List[str] = []
    stdout_lines: List[str] = []

    def pump(stream, bucket: List[str], callback, cap: int) -> None:
        for line in stream:
            bucket.append(line)
            if len(bucket) > cap:  # keep the newest lines only (progress spam); cap is generous for real output
                del bucket[: cap // 4]
            if callback:
                callback(line)

    assert proc.stderr is not None and proc.stdout is not None
    threads = [
        threading.Thread(target=pump, args=(proc.stderr, stderr_lines, on_stderr_line, 400), daemon=True),
        # stdout carries real results (e.g. `ffmpeg -filters` is ~500 lines): do not drop the head of it
        threading.Thread(target=pump, args=(proc.stdout, stdout_lines, on_stdout_line, 200000), daemon=True),
    ]
    for t in threads:
        t.start()
    import time as _time

    started = _time.monotonic()
    try:
        while proc.poll() is None:
            if cancel_check and cancel_check():
                proc.kill()
                proc.wait()
                raise Cancelled()
            if timeout and _time.monotonic() - started > timeout:
                proc.kill()
                proc.wait()
                raise StudioError("ffmpeg_failed", "FFmpeg ប្រើពេលយូរពេក ត្រូវបានបញ្ឈប់", status=504)
            _time.sleep(0.1)
    finally:
        for t in threads:
            t.join(timeout=2)
    return subprocess.CompletedProcess(cmd, proc.returncode, "".join(stdout_lines), "".join(stderr_lines))


def _fail(what: str, res: subprocess.CompletedProcess) -> StudioError:
    tail = "\n".join((res.stderr or "").strip().splitlines()[-8:])
    return StudioError("ffmpeg_failed", f"FFmpeg បរាជ័យពេល {what}", detail=tail[-900:], status=500)


def probe(ffprobe: str, path: Path) -> Dict[str, Any]:
    res = run([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], timeout=60)
    if res.returncode != 0:
        raise StudioError("invalid_audio", "ឯកសារសំឡេងមិនអាចអានបាន ឬខូច", detail=(res.stderr or "")[-400:], status=422)
    data = json.loads(res.stdout or "{}")
    streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise StudioError("invalid_audio", "ឯកសារនេះមិនមានសំឡេងទេ", status=422)
    st = streams[0]
    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or st.get("duration") or 0)
    return {
        "duration": round(duration, 3),
        "sample_rate": int(st.get("sample_rate") or 0),
        "channels": int(st.get("channels") or 0),
        "codec": st.get("codec_name"),
        "size": int(fmt.get("size") or 0),
    }


def to_wav(ffmpeg: str, src: Path, dst: Path, *, sample_rate: Optional[int] = None, channels: Optional[int] = None) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vn", "-c:a", "pcm_s16le"]
    if sample_rate:
        cmd += ["-ar", str(sample_rate)]
    if channels:
        cmd += ["-ac", str(channels)]
    cmd.append(str(dst))
    res = run(cmd, timeout=600)
    if res.returncode != 0:
        raise _fail("បំលែងទៅ WAV", res)


def to_mp3(ffmpeg: str, src: Path, dst: Path, *, title: str = "", artist: str = "", bitrate: str = "192k") -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vn", "-c:a", "libmp3lame", "-b:a", bitrate]
    if title:
        cmd += ["-metadata", f"title={title}"]
    if artist:
        cmd += ["-metadata", f"artist={artist}"]
    cmd += ["-id3v2_version", "3", str(dst)]
    res = run(cmd, timeout=600)
    if res.returncode != 0:
        raise _fail("បំលែងទៅ MP3", res)


_SIL_START = re.compile(r"silence_start: (-?[0-9.]+)")
_SIL_END = re.compile(r"silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)")


def analyze(ffmpeg: str, path: Path, duration: Optional[float] = None) -> Dict[str, Any]:
    """Loudness + leading/trailing silence. Lets us tell the user when a result is mostly silent."""
    res = run([ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect,silencedetect=noise=-50dB:d=0.4", "-f", "null", "-"], timeout=300)
    text = res.stderr or ""
    mean = re.search(r"mean_volume: (-?[0-9.]+) dB", text)
    peak = re.search(r"max_volume: (-?[0-9.]+) dB", text)
    starts = [float(x) for x in _SIL_START.findall(text)]
    ends = [(float(a), float(b)) for a, b in _SIL_END.findall(text)]
    leading = 0.0
    if starts and starts[0] <= 0.05 and ends:
        leading = ends[0][0]
    trailing = 0.0
    if duration and starts and len(starts) > len(ends):
        trailing = max(0.0, duration - starts[-1])
    silent_total = sum(d for _, d in ends) + (trailing if len(starts) > len(ends) else 0)
    return {
        "mean_db": float(mean.group(1)) if mean else None,
        "peak_db": float(peak.group(1)) if peak else None,
        "leading_silence": round(leading, 2),
        "trailing_silence": round(trailing, 2),
        "silent_seconds": round(silent_total, 2),
    }


def db_to_gain(db: float) -> float:
    return 10 ** (db / 20.0)


def mix_voice_and_music(
    ffmpeg: str,
    instrumental: Path,
    voice: Path,
    dst: Path,
    *,
    music_db: float = 0.0,
    voice_db: float = 0.0,
    voice_offset: float = 0.0,
    preview_seconds: Optional[float] = None,
    clean_voice: bool = True,
) -> None:
    """Render music + the user's own voice into one WAV.

    `voice_offset` (seconds, may be negative) shifts the voice relative to the music to correct
    recording latency. The voice gets an optional gentle clean-up (80 Hz high-pass).
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    v_filters: List[str] = []
    if clean_voice:
        v_filters.append("highpass=f=80")
    if voice_offset > 0:
        ms = int(round(voice_offset * 1000))
        v_filters.append(f"adelay={ms}|{ms}")
    elif voice_offset < 0:
        v_filters.append(f"atrim=start={-voice_offset:.3f},asetpts=PTS-STARTPTS")
    v_filters.append(f"volume={db_to_gain(voice_db):.4f}")
    v_chain = ",".join(v_filters)
    graph = (
        f"[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={db_to_gain(music_db):.4f}[m];"
        f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,{v_chain}[v];"
        "[m][v]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97[out]"
    )
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(instrumental), "-i", str(voice), "-filter_complex", graph, "-map", "[out]"]
    if preview_seconds:
        cmd += ["-t", f"{preview_seconds:.2f}"]
    cmd += ["-c:a", "pcm_s16le", str(dst)]
    res = run(cmd, timeout=900)
    if res.returncode != 0:
        raise _fail("លាយសំឡេងច្រៀង និងភ្លេង", res)
