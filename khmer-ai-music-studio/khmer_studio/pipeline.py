"""Job bodies: music generation, voice mixing and karaoke MV rendering."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import audio as audio_tools
from . import karaoke
from .config import Settings
from .engines.base import Engine, EngineContext, GenerationRequest
from .errors import Cancelled, StudioError
from .jobs import JobCtx
from .storage import ProjectStore
from .util import new_id, now_iso

KIND_LABELS = {"full": "បទពេញ", "chorus_test": "Chorus សាកល្បង", "instrumental": "ភ្លេងសុទ្ធ", "mix": "ភ្លេង + សំឡេងខ្ញុំ", "upload": "ឯកសារនាំចូល"}


def _next_label(project: Dict[str, Any], kind: str, instrumental: bool = False) -> str:
    key = "instrumental" if (instrumental and kind == "full") else kind
    n = sum(1 for v in project["versions"] if v.get("kind") == kind) + 1
    return f"{KIND_LABELS.get(key, 'កំណែ')} #{n}"


def add_version(store: ProjectStore, pid: str, version: Dict[str, Any], select: bool = False) -> None:
    def mut(p: Dict[str, Any]) -> None:
        if not version.get("label"):
            version["label"] = _next_label(p, version["kind"], version.get("instrumental", False))
        p["versions"].append(version)
        if select or not p.get("selected_version_id"):
            if not version.get("instrumental"):
                p["selected_version_id"] = version["id"]

    store.update(pid, mut)


def finalize_wav(settings: Settings, store: ProjectStore, pid: str, src: Path, vid: str, ctx: JobCtx) -> Dict[str, Any]:
    """Convert to WAV inside the project, probe it and analyse silence. Returns file info."""
    ctx.progress(None, "encoding", "កំពុងបំលែងឯកសារទៅ WAV")
    dst = store.sub(pid, "audio") / f"{vid}.wav"
    audio_tools.to_wav(settings.ffmpeg, src, dst)
    meta = audio_tools.probe(settings.ffprobe, dst)
    ctx.progress(None, "analyzing", "កំពុងពិនិត្យសំឡេង (កម្រិត និងផ្នែកស្ងាត់)")
    stats = audio_tools.analyze(settings.ffmpeg, dst, meta["duration"])
    return {"file": f"audio/{vid}.wav", **meta, "analysis": stats}


def quality_warnings(info: Dict[str, Any]) -> List[str]:
    stats = info.get("analysis") or {}
    warnings: List[str] = []
    dur = info.get("duration") or 0
    if stats.get("mean_db") is not None and stats["mean_db"] < -50:
        warnings.append("សំឡេងស្ទើរតែស្ងាត់ទាំងស្រុង — ម៉ូដែលអាចមានបញ្ហា សូមសាកល្បងម្ដងទៀត")
    elif dur and stats.get("silent_seconds", 0) > max(6.0, dur * 0.4):
        warnings.append(f"មានផ្នែកស្ងាត់ច្រើន ({stats['silent_seconds']:.0f} វិនាទី) — ពិចារណាបង្កើតម្ដងទៀត")
    if dur and stats.get("trailing_silence", 0) > 3.0:
        warnings.append(f"ម៉ូដែលបញ្ចប់សំឡេងនៅវិនាទីទី {dur - stats['trailing_silence']:.0f} — ចុងបទស្ងាត់ {stats['trailing_silence']:.0f} វិនាទី (MV នឹងកាត់ចុងស្ងាត់ស្វ័យប្រវត្តិ ប្រសិនបើមិនបិទជម្រើស)")
    return warnings


# ---------------------------------------------------------------------------------------------
def run_generation(
    ctx: JobCtx,
    *,
    settings: Settings,
    store: ProjectStore,
    engine: Engine,
    req: GenerationRequest,
    kind: str,
    sections_snapshot: List[Dict[str, Any]],
    label: Optional[str] = None,
) -> Dict[str, Any]:
    pid = ctx.project_id
    info = engine.info()
    ectx = EngineContext(ctx.workdir, progress_cb=ctx.progress, log_cb=ctx.log, cancel_check=ctx.cancelled)
    ctx.log(f"ម៉ូដែល: {info.name} · {kind} · {req.duration}s · instrumental={req.instrumental}")
    result = engine.generate(req, ectx)
    if ctx.cancelled():  # the user cancelled while the model was finishing: drop the result
        raise Cancelled()
    vid = new_id("v")
    finfo = finalize_wav(settings, store, pid, result.path, vid, ctx)
    ctx.progress(None, "saving", "កំពុងរក្សាទុកកំណែថ្មី")
    version = {
        "id": vid,
        "label": label or "",
        "kind": kind,
        "created_at": now_iso(),
        "engine": {"id": info.id, "name": info.name, "is_ai": info.is_ai, "license": info.license_name},
        "instrumental": bool(req.instrumental),
        "duration": finfo["duration"], "sample_rate": finfo["sample_rate"], "channels": finfo["channels"],
        "file": finfo["file"], "analysis": finfo["analysis"],
        "seed": result.seed,
        "caption": req.caption,
        "vocal_language": req.vocal_language,
        "lyrics_snapshot": copy.deepcopy(sections_snapshot),
        "request": result.sent,
        "engine_meta": result.engine_meta,
        "notes": list(result.notes) + list((req.extra or {}).get("auto_notes", [])),
        "vocal_language_sent": req.vocal_language,
        "warnings": quality_warnings(finfo),
        "job_id": ctx.job_id,
        "source": None,
    }
    add_version(store, pid, version)
    return {"version_id": vid, "duration": finfo["duration"], "warnings": version["warnings"], "notes": version["notes"]}


# ---------------------------------------------------------------------------------------------
def run_mix(ctx: JobCtx, *, settings: Settings, store: ProjectStore, params: Dict[str, Any]) -> Dict[str, Any]:
    pid = ctx.project_id
    project = store.get(pid)
    inst = store.find_version(project, params["instrumental_version_id"])
    voice = next((r for r in project["voice_recordings"] if r["id"] == params["voice_id"]), None)
    if not voice:
        raise StudioError("not_found", "រកមិនឃើញសំឡេងដែលបានថត", status=404)
    inst_path = store.project_dir(pid) / inst["file"]
    voice_path = store.project_dir(pid) / voice["file"]
    vid = new_id("v")
    dst = store.sub(pid, "audio") / f"{vid}.wav"
    ctx.progress(None, "mixing", "កំពុងលាយសំឡេងច្រៀងរបស់អ្នកជាមួយភ្លេង")
    audio_tools.mix_voice_and_music(
        settings.ffmpeg, inst_path, voice_path, dst,
        music_db=float(params.get("music_db", 0)), voice_db=float(params.get("voice_db", 0)),
        voice_offset=float(params.get("voice_offset", 0)),
    )
    meta = audio_tools.probe(settings.ffprobe, dst)
    stats = audio_tools.analyze(settings.ffmpeg, dst, meta["duration"])
    version = {
        "id": vid, "label": params.get("label") or "", "kind": "mix", "created_at": now_iso(),
        "engine": {"id": "mix", "name": "ភ្លេងដែលបានបង្កើត + សំឡេងច្រៀងខ្លួនឯង", "is_ai": bool(inst.get("engine", {}).get("is_ai")), "license": inst.get("engine", {}).get("license", "")},
        "instrumental": False, "duration": meta["duration"], "sample_rate": meta["sample_rate"], "channels": meta["channels"],
        "file": f"audio/{vid}.wav", "analysis": stats, "seed": None, "caption": inst.get("caption", ""),
        "lyrics_snapshot": copy.deepcopy(inst.get("lyrics_snapshot") or project["lyrics"]["sections"]),
        "request": {k: params.get(k) for k in ("music_db", "voice_db", "voice_offset")},
        "engine_meta": {}, "notes": [], "warnings": quality_warnings({"analysis": stats, "duration": meta["duration"]}),
        "job_id": ctx.job_id,
        "source": {"instrumental_version_id": inst["id"], "voice_id": voice["id"], "music_db": params.get("music_db", 0), "voice_db": params.get("voice_db", 0), "voice_offset": params.get("voice_offset", 0)},
    }
    add_version(store, pid, version, select=True)
    return {"version_id": vid, "duration": meta["duration"]}


# ---------------------------------------------------------------------------------------------
def run_mv(ctx: JobCtx, *, settings: Settings, store: ProjectStore, params: Dict[str, Any]) -> Dict[str, Any]:
    pid = ctx.project_id
    project = store.get(pid)
    version = store.find_version(project, params["version_id"])
    audio_path = store.project_dir(pid) / version["file"]
    if not audio_path.is_file():
        raise StudioError("not_found", "រកមិនឃើញឯកសារសំឡេងរបស់កំណែនេះ", status=404)
    mid = new_id("m")
    out = store.sub(pid, "mv") / f"{mid}.mp4"
    bg = None
    if params.get("background_file"):
        bg = store.project_dir(pid) / "covers" / params["background_file"]
    ctx.progress(0.01, "rendering", "កំពុងរៀបចំវីដេអូខារ៉ាអូខេ")
    duration = float(version["duration"])
    trailing = float((version.get("analysis") or {}).get("trailing_silence") or 0)
    if (params.get("style") or {}).get("trim_silence", True) and trailing > 2.5:
        last_start = max((float(x["start"]) for x in params["lines"] if x.get("start") is not None), default=0.0)
        duration = min(duration, max(duration - trailing + 1.5, last_start + 3.0))  # keep a 1.5 s tail; never cut off the last line
        ctx.log(f"កាត់ចុងស្ងាត់ {trailing:.1f}s → MV ប្រវែង {duration:.1f}s")
    karaoke.render_mv(
        settings.ffmpeg, audio_path, out, params["lines"], resolution=params["resolution"], duration=duration,
        workdir=ctx.workdir / "mv", style=params.get("style"), title=project.get("title", ""), artist=project.get("artist", ""),
        background=bg, progress=ctx.progress, log=ctx.log, cancel_check=ctx.cancelled,
    )
    size = out.stat().st_size
    probed = audio_tools.probe(settings.ffprobe, out)  # proves the MP4 is readable and has audio
    if probed["duration"] < 0.5:
        raise StudioError("ffmpeg_failed", "MP4 ដែលបានបង្កើតខូច ឬខ្លីពេក", status=500)
    entry = {
        "id": mid, "file": f"mv/{mid}.mp4", "resolution": params["resolution"], "size": size, "duration": probed["duration"],
        "version_id": version["id"], "version_label": version.get("label", ""), "created_at": now_iso(), "job_id": ctx.job_id,
        "background": params.get("background_file"),
    }

    def mut(p: Dict[str, Any]) -> None:
        p["karaoke"]["outputs"].append(entry)

    store.update(pid, mut)
    return {"mv_id": mid, "size": size, "resolution": params["resolution"]}
