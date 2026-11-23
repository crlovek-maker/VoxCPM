"""FastAPI application: JSON API under /api, project media under /media, the web UI at /."""
from __future__ import annotations

import hmac
import io
import json
import logging
import os
import re
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel

from . import APP_NAME, __version__
from . import audio as audio_tools
from . import karaoke, lyrics as lyr, pipeline, presets, publish
from .config import FONTS_DIR, WEB_DIR, Settings
from .engines import build_engines
from .engines.base import GenerationRequest
from .errors import StudioError
from .jobs import JobManager
from .lyrics_ai import llm_status, suggest
from .storage import ProjectStore
from .util import download_name, new_id, now_iso

log = logging.getLogger("khmer_studio")
COOKIE = "kms_token"
ASPECTS = {"1:1": (1080, 1080), "16:9": (1920, 1080), "9:16": (1080, 1920)}
MUSIC_KEYS = {
    "engine", "mode", "styles", "instruments", "moods", "vocal", "extra", "duration", "bpm", "key_scale",
    "time_signature", "vocal_language", "seed", "steps", "use_lm", "chorus_duration",
}


# ---------------------------------------------------------------------------------------------
# request bodies (module level so FastAPI can resolve the annotations)
# ---------------------------------------------------------------------------------------------
class ProjectCreate(BaseModel):
    title: str = ""
    artist: str = ""
    lyrics_text: Optional[str] = None


class ProjectPatch(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    music: Optional[Dict[str, Any]] = None
    publish_info: Optional[Dict[str, Any]] = None
    karaoke_style: Optional[Dict[str, Any]] = None


class LyricsPut(BaseModel):
    sections: List[Dict[str, Any]]
    history_label: Optional[str] = None


class ParseBody(BaseModel):
    text: str


class AssistBody(BaseModel):
    mode: str = "rhyme"
    section_id: str
    line_indexes: Optional[List[int]] = None
    instruction: str = ""
    count: int = 3
    new_lines: int = 2


class GenerateBody(BaseModel):
    mode: str = "full"  # full | chorus_test
    engine: Optional[str] = None
    instrumental: bool = False
    music: Optional[Dict[str, Any]] = None
    section_ids: Optional[List[str]] = None


class SelectBody(BaseModel):
    version_id: str


class VersionPatch(BaseModel):
    label: Optional[str] = None


class MixBody(BaseModel):
    instrumental_version_id: str
    voice_id: str
    music_db: float = 0.0
    voice_db: float = 0.0
    voice_offset: float = 0.0
    label: Optional[str] = None
    seconds: Optional[float] = None


class KaraokePut(BaseModel):
    version_id: Optional[str] = None
    lines: List[Dict[str, Any]]
    style: Optional[Dict[str, Any]] = None


class KaraokeInit(BaseModel):
    version_id: str
    use_current_lyrics: bool = False


class KaraokeRender(BaseModel):
    resolution: str = "1920x1080"
    background: str = "auto"  # auto | none | <file in covers/>
    style: Optional[Dict[str, Any]] = None
    lines: Optional[List[Dict[str, Any]]] = None
    version_id: Optional[str] = None
    at: Optional[float] = None


class PublishGenerate(BaseModel):
    info: Optional[Dict[str, Any]] = None
    include_lyrics: bool = True


class PublishPut(BaseModel):
    info: Optional[Dict[str, Any]] = None
    texts: Optional[Dict[str, Dict[str, Any]]] = None


class LoginBody(BaseModel):
    token: str


class CaptionBody(BaseModel):
    music: Dict[str, Any] = {}
    instrumental: bool = False


# ---------------------------------------------------------------------------------------------
def token_ok(scope, token: Optional[str]) -> bool:
    """True if the request carries the access token as a cookie or `Authorization: Bearer`."""
    if not token:
        return True
    headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and hmac.compare_digest(auth[7:].strip(), token):
        return True
    for part in headers.get("cookie", "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE and hmac.compare_digest(value, token):
            return True
    return False


class AuthMiddleware:
    """If STUDIO_TOKEN is set, /api and /media need the token (cookie or `Authorization: Bearer`)."""

    OPEN = {"/api/login", "/api/auth"}

    def __init__(self, app, token: Optional[str]) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and self.token:
            path = scope.get("path", "")
            if (path.startswith("/api/") or path.startswith("/media/")) and path not in self.OPEN:
                if not token_ok(scope, self.token):
                    resp = JSONResponse({"error": {"code": "unauthorized", "message": "ត្រូវការលេខកូដចូល (token)"}}, status_code=401)
                    return await resp(scope, receive, send)
        return await self.app(scope, receive, send)


# ---------------------------------------------------------------------------------------------
def save_upload(upload: UploadFile, dest: Path, max_mb: int) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    limit = max_mb * 1024 * 1024
    written = 0
    with open(dest, "wb") as out:
        while True:
            chunk = upload.file.read(1 << 20)
            if not chunk:
                break
            written += len(chunk)
            if written > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise StudioError("too_large", f"ឯកសារធំពេក (លើស {max_mb} MB)", status=413)
            out.write(chunk)
    if written == 0:
        dest.unlink(missing_ok=True)
        raise StudioError("invalid_request", "ឯកសារទទេ", status=422)
    return written


MEDIA_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    s = settings or Settings.from_env()
    store = ProjectStore(s.projects_dir)
    jobs = JobManager(store)
    engines = build_engines(s)
    mp3_lock = threading.Lock()
    health_cache: Dict[str, Any] = {"t": 0.0, "data": None}
    ffmpeg_state: Dict[str, Any] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        ffmpeg_state["ok"] = audio_tools.tool_available(s.ffmpeg) and audio_tools.tool_available(s.ffprobe)
        ffmpeg_state["has_ass"] = bool(ffmpeg_state["ok"] and karaoke.ffmpeg_has_ass(s.ffmpeg))
        jobs.start()
        yield
        jobs.stop()

    app = FastAPI(title=APP_NAME, version=__version__, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.settings, app.state.store, app.state.jobs, app.state.engines = s, store, jobs, engines
    app.add_middleware(AuthMiddleware, token=s.token)

    # ------------------------------------------------------------------ errors
    @app.exception_handler(StudioError)
    async def _studio_error(_req: Request, exc: StudioError):
        return JSONResponse({"error": exc.to_dict()}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_req: Request, exc: RequestValidationError):
        return JSONResponse(
            {"error": {"code": "invalid_request", "message": "ទិន្នន័យដែលផ្ញើមិនត្រឹមត្រូវ", "detail": json.dumps(exc.errors(), default=str, ensure_ascii=False)[:600], "hint": None}},
            status_code=422,
        )

    # ------------------------------------------------------------------ helpers
    def project_or_404(pid: str) -> Dict[str, Any]:
        return store.get(pid)

    def engine_or_error(engine_id: str):
        if engine_id not in engines:
            raise StudioError("invalid_request", f"មិនមាន engine «{engine_id}»", detail=", ".join(engines), status=422)
        return engines[engine_id]

    def sections_by_ids(project: Dict[str, Any], ids: Optional[List[str]]) -> List[Dict[str, Any]]:
        all_sections = project["lyrics"]["sections"]
        if ids:
            return [sec for sec in all_sections if sec["id"] in ids]
        return all_sections

    def ensure_version_file(pid: str, version: Dict[str, Any]) -> Path:
        path = store.project_dir(pid) / version["file"]
        if not path.is_file():
            raise StudioError("not_found", "រកមិនឃើញឯកសារសំឡេងរបស់កំណែនេះ", status=404)
        return path

    def engine_summary_for(project: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        vid = project.get("selected_version_id")
        for v in project.get("versions", []):
            if v["id"] == vid:
                return {"name": v["engine"].get("name"), "is_ai": v["engine"].get("is_ai"), "license": v["engine"].get("license")}
        return None

    # ------------------------------------------------------------------ general
    @app.get("/api/auth")
    def auth_state(request: Request):
        required = bool(s.token)
        return {"required": required, "ok": token_ok(request.scope, s.token)}

    @app.post("/api/login")
    def login(body: LoginBody):
        if not s.token or hmac.compare_digest(body.token.strip(), s.token):
            resp = JSONResponse({"ok": True})
            if s.token:
                resp.set_cookie(COOKIE, s.token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30, path="/")
            return resp
        raise StudioError("unauthorized", "លេខកូដចូលមិនត្រឹមត្រូវ", status=401)

    @app.get("/api/health")
    def health(refresh: int = 0):
        now = time.monotonic()
        if not refresh and health_cache["data"] and now - health_cache["t"] < 4:
            return {**health_cache["data"], "jobs_active": jobs.active_count()}
        eng_list = []
        for e in engines.values():
            info = e.info().to_dict()
            info["health"] = e.health().to_dict()
            eng_list.append(info)
        data = {
            "app": APP_NAME, "version": __version__,
            "ffmpeg": {"ok": ffmpeg_state.get("ok", False), "has_ass": ffmpeg_state.get("has_ass", False), "path": s.ffmpeg},
            "fonts": sorted(p.name for p in FONTS_DIR.glob("*.ttf")),
            "engines": eng_list, "default_engine": s.default_engine if s.default_engine in engines else next(iter(engines)),
            "llm": llm_status(s), "auth_required": bool(s.token), "data_dir": str(s.data_dir),
            "resolutions": list(karaoke.RESOLUTIONS), "aspects": list(ASPECTS),
        }
        health_cache.update(t=now, data=data)
        return {**data, "jobs_active": jobs.active_count()}

    @app.post("/api/caption")
    def preview_caption(body: CaptionBody):
        caption = presets.compose_caption(body.music, instrumental=body.instrumental)
        return {"caption": caption, "length": len(caption), "limit": 512}

    @app.get("/api/presets")
    def get_presets():
        return {**presets.catalog(), "section_types": lyr.SECTION_TYPES, "fonts": karaoke.FONT_FAMILIES, "karaoke_defaults": karaoke.DEFAULT_STYLE}

    # ------------------------------------------------------------------ projects
    @app.get("/api/projects")
    def list_projects():
        return {"projects": store.list()}

    @app.post("/api/projects")
    def create_project(body: ProjectCreate):
        sections = lyr.parse_lyrics_text(body.lyrics_text) if body.lyrics_text else []
        project = store.create(body.title, body.artist, sections)
        return project

    @app.get("/api/projects/{pid}")
    def get_project(pid: str):
        return project_or_404(pid)

    @app.patch("/api/projects/{pid}")
    def patch_project(pid: str, body: ProjectPatch):
        def mut(p: Dict[str, Any]) -> None:
            if body.title is not None:
                p["title"] = body.title.strip()[:200]
            if body.artist is not None:
                p["artist"] = body.artist.strip()[:200]
            if body.music:
                p["music"].update({k: v for k, v in body.music.items() if k in MUSIC_KEYS})
            if body.publish_info:
                p["publish"]["info"].update(body.publish_info)
            if body.karaoke_style:
                p["karaoke"]["style"].update(body.karaoke_style)

        return store.update(pid, mut)

    @app.delete("/api/projects/{pid}")
    def delete_project(pid: str):
        project_or_404(pid)
        if any(j["status"] in ("queued", "running") for j in jobs.list_for_project(pid)):
            raise StudioError("busy", "មានការងារកំពុងដំណើរការក្នុងគម្រោងនេះ — សូមរង់ចាំ ឬបោះបង់ជាមុន", status=409)
        store.delete(pid)
        return {"ok": True}

    # ------------------------------------------------------------------ lyrics
    @app.post("/api/lyrics/parse")
    def parse_lyrics(body: ParseBody):
        return {"sections": lyr.parse_lyrics_text(body.text)}

    @app.put("/api/projects/{pid}/lyrics")
    def put_lyrics(pid: str, body: LyricsPut):
        sections = lyr.normalize_sections(body.sections)

        def mut(p: Dict[str, Any]) -> None:
            if body.history_label:  # keep what was there before AI help / replace, so it can be undone
                p["lyrics_history"].append({"label": body.history_label, "at": now_iso(), "sections": p["lyrics"]["sections"]})
                del p["lyrics_history"][:-30]
            p["lyrics"] = {"sections": sections, "updated_at": now_iso()}

        return store.update(pid, mut)

    @app.post("/api/projects/{pid}/lyrics/undo")
    def undo_lyrics(pid: str):
        def mut(p: Dict[str, Any]) -> None:
            if not p["lyrics_history"]:
                raise StudioError("nothing_to_undo", "គ្មានអ្វីត្រូវ Undo ទេ", status=409)
            snap = p["lyrics_history"].pop()
            p["lyrics"] = {"sections": snap["sections"], "updated_at": now_iso()}

        return store.update(pid, mut)

    @app.get("/api/llm/status")
    def get_llm_status():
        return llm_status(s)

    @app.post("/api/projects/{pid}/lyrics/assist")
    def lyrics_assist(pid: str, body: AssistBody):
        project = project_or_404(pid)
        sections = project["lyrics"]["sections"]
        idx = next((i for i, sec in enumerate(sections) if sec["id"] == body.section_id), None)
        if idx is None:
            raise StudioError("not_found", "រកមិនឃើញផ្នែកទំនុកនេះ", status=404)
        sec = sections[idx]
        all_lines = sec.get("lines", [])
        sel = body.line_indexes if body.line_indexes else [i for i, ln in enumerate(all_lines) if str(ln).strip()]
        sel = [i for i in sel if 0 <= i < len(all_lines)]
        chosen = [all_lines[i] for i in sel]
        before = [ln for ln in all_lines[: (min(sel) if sel else 0)] if str(ln).strip()][-4:]
        after = [ln for ln in all_lines[(max(sel) + 1 if sel else 0):] if str(ln).strip()][:4]
        suggestions = suggest(
            s, mode=body.mode, lines=chosen, context_before=before, context_after=after, instruction=body.instruction,
            count=body.count, section_type=sec.get("type", "verse"), new_lines=body.new_lines,
        )
        return {"suggestions": suggestions, "section_id": body.section_id, "line_indexes": sel, "mode": body.mode}

    # ------------------------------------------------------------------ music generation
    @app.post("/api/projects/{pid}/generate")
    def generate(pid: str, body: GenerateBody):
        project = project_or_404(pid)
        if body.mode not in ("full", "chorus_test"):
            raise StudioError("invalid_request", "របៀបមិនត្រឹមត្រូវ", status=422)

        def save_music(p: Dict[str, Any]) -> None:
            if body.music:
                p["music"].update({k: v for k, v in body.music.items() if k in MUSIC_KEYS})
            p["music"]["mode"] = "instrumental" if body.instrumental else "vocals"
            if body.engine:
                p["music"]["engine"] = body.engine

        project = store.update(pid, save_music)
        music = project["music"]
        engine = engine_or_error(body.engine or music.get("engine") or s.default_engine)
        info = engine.info()
        if body.instrumental and not info.supports_instrumental:
            raise StudioError("invalid_request", f"{info.name} មិនគាំទ្រភ្លេងសុទ្ធទេ", status=422)

        if body.mode == "chorus_test":
            sections = [sec for sec in project["lyrics"]["sections"] if sec["id"] in (body.section_ids or [])] or lyr.pick_chorus(project["lyrics"]["sections"])
        else:
            sections = sections_by_ids(project, body.section_ids)
        n_lines = lyr.count_lines(sections)
        if not body.instrumental and n_lines == 0:
            raise StudioError("invalid_request", "សូមបញ្ចូលទំនុកក្នុងផ្ទាំង «ទំនុក» ជាមុន (ឬជ្រើស «ភ្លេងសុទ្ធ»)", status=422)

        if body.mode == "chorus_test":
            duration = float(music.get("chorus_duration") or lyr.suggest_duration(n_lines, "chorus_test"))
        else:
            duration = float(music.get("duration") or lyr.suggest_duration(n_lines, "full"))
        duration = max(info.min_duration, min(info.max_duration, duration))

        req = GenerationRequest(
            lyrics=lyr.build_engine_lyrics(sections),
            caption=presets.compose_caption(music, instrumental=body.instrumental),
            instrumental=body.instrumental,
            vocal_language=music.get("vocal_language") or "unknown",
            duration=duration,
            bpm=int(music["bpm"]) if music.get("bpm") else None,
            key_scale=music.get("key_scale") or "",
            time_signature=str(music.get("time_signature") or ""),
            seed=int(music["seed"]) if music.get("seed") not in (None, "") else None,
            steps=int(music["steps"]) if music.get("steps") else None,
            use_lm=bool(music.get("use_lm")),
            purpose=body.mode,
        )
        kind = "chorus_test" if body.mode == "chorus_test" else "full"
        snapshot = [{"id": sec["id"], "type": sec["type"], "lines": list(sec["lines"])} for sec in sections]

        def runner(ctx):
            return pipeline.run_generation(ctx, settings=s, store=store, engine=engine, req=req, kind=kind, sections_snapshot=snapshot)

        label = {"chorus_test": "សាកល្បង Chorus", "full": "បង្កើតបទ"}[kind] + (" (ភ្លេងសុទ្ធ)" if body.instrumental else "")
        return jobs.submit(
            pid, kind, runner, queue_name="engine", label=label,
            params={"engine": info.id, "engine_name": info.name, "is_ai": info.is_ai, "mode": body.mode, "duration": duration, "instrumental": body.instrumental, "lines": n_lines},
        )

    # ------------------------------------------------------------------ jobs
    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        return jobs.get(job_id)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        return jobs.cancel(job_id)

    @app.get("/api/projects/{pid}/jobs")
    def project_jobs(pid: str):
        project_or_404(pid)
        return {"jobs": jobs.list_for_project(pid)}

    # ------------------------------------------------------------------ versions & downloads
    @app.post("/api/projects/{pid}/select-version")
    def select_version(pid: str, body: SelectBody):
        def mut(p: Dict[str, Any]) -> None:
            v = store.find_version(p, body.version_id)
            p["selected_version_id"] = v["id"]

        return store.update(pid, mut)

    @app.patch("/api/projects/{pid}/versions/{vid}")
    def patch_version(pid: str, vid: str, body: VersionPatch):
        def mut(p: Dict[str, Any]) -> None:
            v = store.find_version(p, vid)
            if body.label is not None:
                v["label"] = body.label.strip()[:80]

        return store.update(pid, mut)

    @app.delete("/api/projects/{pid}/versions/{vid}")
    def delete_version(pid: str, vid: str):
        def mut(p: Dict[str, Any]) -> None:
            store.find_version(p, vid)  # 404 if unknown
            for ext in (".wav", ".mp3"):
                (store.project_dir(pid) / "audio" / f"{vid}{ext}").unlink(missing_ok=True)
            p["versions"] = [x for x in p["versions"] if x["id"] != vid]
            if p.get("selected_version_id") == vid:
                p["selected_version_id"] = next((x["id"] for x in reversed(p["versions"]) if not x.get("instrumental")), None)
            if p["karaoke"].get("version_id") == vid:
                p["karaoke"]["version_id"] = None

        return store.update(pid, mut)

    @app.get("/api/projects/{pid}/versions/{vid}/download")
    def download_version(pid: str, vid: str, format: str = "wav"):
        project = project_or_404(pid)
        v = store.find_version(project, vid)
        wav = ensure_version_file(pid, v)
        base = download_name(f"{project.get('title') or 'song'}_{v.get('label') or vid}", "")
        if format == "wav":
            return FileResponse(wav, media_type="audio/wav", filename=base + ".wav")
        if format == "mp3":
            mp3 = wav.with_suffix(".mp3")
            with mp3_lock:
                if not mp3.is_file():
                    tmp = wav.with_name(f"{vid}.tmp.mp3")
                    audio_tools.to_mp3(s.ffmpeg, wav, tmp, title=project.get("title", ""), artist=project.get("artist", ""))
                    os.replace(tmp, mp3)
            return FileResponse(mp3, media_type="audio/mpeg", filename=base + ".mp3")
        raise StudioError("invalid_request", "ទម្រង់ត្រូវតែជា wav ឬ mp3", status=422)

    # ------------------------------------------------------------------ own voice + mix
    @app.post("/api/projects/{pid}/voice")
    def upload_voice(pid: str, file: UploadFile = File(...), label: str = Form(""), offset: float = Form(0.0)):
        project_or_404(pid)
        rid = new_id("r")
        tmp_dir = Path(tempfile.mkdtemp(prefix="voice_", dir=str(store.sub(pid, "jobs"))))
        try:
            raw = tmp_dir / ("upload" + (Path(file.filename or "").suffix[:8] or ".bin"))
            save_upload(file, raw, s.max_upload_mb)
            audio_tools.probe(s.ffprobe, raw)  # unreadable/non-audio upload -> clear 422 instead of an FFmpeg 500
            dst = store.sub(pid, "voice") / f"{rid}.wav"
            audio_tools.to_wav(s.ffmpeg, raw, dst, sample_rate=48000, channels=1)
            meta = audio_tools.probe(s.ffprobe, dst)
        finally:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)
        entry = {
            "id": rid, "file": f"voice/{rid}.wav", "duration": meta["duration"], "label": (label or "").strip()[:80] or "សំឡេងខ្ញុំ",
            # seconds between "music started" and "recording started" when sung along in the browser; used as the default mix offset
            "offset": round(max(0.0, min(5.0, float(offset or 0.0))), 3), "created_at": now_iso(),
        }
        store.update(pid, lambda p: p["voice_recordings"].append(entry))
        return entry

    @app.delete("/api/projects/{pid}/voice/{rid}")
    def delete_voice(pid: str, rid: str):
        def mut(p: Dict[str, Any]) -> None:
            if not any(r["id"] == rid for r in p["voice_recordings"]):
                raise StudioError("not_found", "រកមិនឃើញសំឡេងដែលបានថត", status=404)
            p["voice_recordings"] = [r for r in p["voice_recordings"] if r["id"] != rid]
            (store.project_dir(pid) / "voice" / f"{rid}.wav").unlink(missing_ok=True)

        return store.update(pid, mut)

    @app.post("/api/projects/{pid}/versions/upload")
    def upload_audio_version(pid: str, file: UploadFile = File(...), label: str = Form(""), instrumental: str = Form("0")):
        project = project_or_404(pid)
        vid = new_id("v")
        tmp_dir = Path(tempfile.mkdtemp(prefix="up_", dir=str(store.sub(pid, "jobs"))))
        try:
            raw = tmp_dir / ("upload" + (Path(file.filename or "").suffix[:8] or ".bin"))
            save_upload(file, raw, s.max_upload_mb)
            audio_tools.probe(s.ffprobe, raw)
            dst = store.sub(pid, "audio") / f"{vid}.wav"
            audio_tools.to_wav(s.ffmpeg, raw, dst)
            meta = audio_tools.probe(s.ffprobe, dst)
            stats = audio_tools.analyze(s.ffmpeg, dst, meta["duration"])
        finally:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)
        version = {
            "id": vid, "label": (label or "").strip()[:80], "kind": "upload", "created_at": now_iso(),
            "engine": {"id": "upload", "name": "ឯកសារនាំចូល", "is_ai": False, "license": ""},
            "instrumental": instrumental == "1", "duration": meta["duration"], "sample_rate": meta["sample_rate"], "channels": meta["channels"],
            "file": f"audio/{vid}.wav", "analysis": stats, "seed": None, "caption": "",
            "lyrics_snapshot": [{"id": sec["id"], "type": sec["type"], "lines": list(sec["lines"])} for sec in project["lyrics"]["sections"]],
            "request": {"filename": file.filename}, "engine_meta": {}, "notes": [], "warnings": pipeline.quality_warnings({"analysis": stats, "duration": meta["duration"]}),
            "job_id": None, "source": None,
        }
        pipeline.add_version(store, pid, version, select=instrumental != "1")
        return store.get(pid)

    @app.post("/api/projects/{pid}/mix/preview")
    def mix_preview(pid: str, body: MixBody):
        project = project_or_404(pid)
        inst = store.find_version(project, body.instrumental_version_id)
        voice = next((r for r in project["voice_recordings"] if r["id"] == body.voice_id), None)
        if not voice:
            raise StudioError("not_found", "រកមិនឃើញសំឡេងដែលបានថត", status=404)
        audio_dir = store.sub(pid, "audio")
        for old in sorted(audio_dir.glob("preview_*.wav"))[:-3]:
            old.unlink(missing_ok=True)
        name = f"preview_{int(time.time() * 1000)}.wav"
        audio_tools.mix_voice_and_music(
            s.ffmpeg, ensure_version_file(pid, inst), store.project_dir(pid) / voice["file"], audio_dir / name,
            music_db=body.music_db, voice_db=body.voice_db, voice_offset=body.voice_offset, preview_seconds=body.seconds or 30,
        )
        return {"url": f"/media/{pid}/audio/{name}"}

    @app.post("/api/projects/{pid}/mix")
    def mix(pid: str, body: MixBody):
        project = project_or_404(pid)
        store.find_version(project, body.instrumental_version_id)
        if not any(r["id"] == body.voice_id for r in project["voice_recordings"]):
            raise StudioError("not_found", "រកមិនឃើញសំឡេងដែលបានថត", status=404)
        params = body.model_dump()

        def runner(ctx):
            return pipeline.run_mix(ctx, settings=s, store=store, params=params)

        return jobs.submit(pid, "mix", runner, queue_name="media", label="លាយសំឡេងខ្ញុំ + ភ្លេង", params=params)

    # ------------------------------------------------------------------ cover / thumbnail
    def _decode_image(data: bytes) -> Image.Image:
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception as exc:  # noqa: BLE001
            raise StudioError("invalid_image", "ឯកសាររូបភាពមិនអាចអានបាន", detail=str(exc)[:200], status=422) from exc
        if img.width > 6000 or img.height > 6000:
            raise StudioError("invalid_image", "រូបភាពធំពេក (អតិបរមា 6000 px)", status=422)
        return ImageOps.exif_transpose(img)

    @app.post("/api/projects/{pid}/cover/source")
    def cover_source(pid: str, image: UploadFile = File(...)):
        project_or_404(pid)
        data = image.file.read(s.max_upload_mb * 1024 * 1024 + 1)
        if len(data) > s.max_upload_mb * 1024 * 1024:
            raise StudioError("too_large", "រូបភាពធំពេក", status=413)
        img = _decode_image(data).convert("RGB")
        img.thumbnail((3000, 3000))
        name = f"source_{int(time.time() * 1000)}.jpg"
        img.save(store.sub(pid, "covers") / name, "JPEG", quality=92)
        return {"file": name, "url": f"/media/{pid}/covers/{name}", "width": img.width, "height": img.height}

    @app.post("/api/projects/{pid}/cover")
    def save_cover(
        pid: str,
        final: UploadFile = File(...),
        plain: Optional[UploadFile] = File(None),
        aspect: str = Form(...),
        title: str = Form(""),
        has_text: str = Form("1"),
        mv_use: str = Form(""),
        editor: str = Form("{}"),
    ):
        project_or_404(pid)
        if aspect not in ASPECTS:
            raise StudioError("invalid_request", "សមាមាត្ររូបភាពមិនត្រឹមត្រូវ", status=422)
        stamp = int(time.time() * 1000)
        slug = aspect.replace(":", "x")
        covers = store.sub(pid, "covers")
        img = _decode_image(final.file.read(32 * 1024 * 1024)).convert("RGB")
        fname = f"cover_{slug}_{stamp}.png"
        img.save(covers / fname, "PNG", optimize=True)
        pname = None
        if plain is not None and plain.filename:
            pimg = _decode_image(plain.file.read(32 * 1024 * 1024)).convert("RGB")
            pname = f"plain_{slug}_{stamp}.png"
            pimg.save(covers / pname, "PNG", optimize=True)
        try:
            editor_state = json.loads(editor) if editor else {}
        except json.JSONDecodeError:
            editor_state = {}
        if len(json.dumps(editor_state)) > 20000:
            editor_state = {}

        def mut(p: Dict[str, Any]) -> None:
            p["cover"]["files"][aspect] = {
                "file": fname, "plain": pname, "title": title[:200], "has_text": has_text == "1",
                "width": img.width, "height": img.height, "created_at": now_iso(),
            }
            p["cover"]["editor"][aspect] = editor_state
            if mv_use == "final":
                p["cover"]["mv_background"] = fname
            elif mv_use == "plain" and pname:
                p["cover"]["mv_background"] = pname

        return store.update(pid, mut)

    @app.post("/api/projects/{pid}/cover/mv-background")
    def set_mv_background(pid: str, payload: Dict[str, Any]):
        name = payload.get("file")

        def mut(p: Dict[str, Any]) -> None:
            if name:
                store.safe_media_path(pid, "covers", name)
            p["cover"]["mv_background"] = name or None

        return store.update(pid, mut)

    @app.delete("/api/projects/{pid}/cover/{aspect}")
    def delete_cover(pid: str, aspect: str):
        aspect = aspect.replace("x", ":")

        def mut(p: Dict[str, Any]) -> None:
            entry = p["cover"]["files"].pop(aspect, None)
            p["cover"]["editor"].pop(aspect, None)
            for key in ("file", "plain"):
                if entry and entry.get(key):
                    (store.project_dir(pid) / "covers" / entry[key]).unlink(missing_ok=True)
                    if p["cover"].get("mv_background") == entry[key]:
                        p["cover"]["mv_background"] = None

        return store.update(pid, mut)

    # ------------------------------------------------------------------ karaoke
    def _lines_from_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{"text": x["text"], "section": x["section_type"], "start": None} for x in lyr.flatten_lines(sections)]

    @app.post("/api/projects/{pid}/karaoke/init")
    def karaoke_init(pid: str, body: KaraokeInit):
        project = project_or_404(pid)
        version = store.find_version(project, body.version_id)
        sections = project["lyrics"]["sections"] if body.use_current_lyrics else (version.get("lyrics_snapshot") or project["lyrics"]["sections"])
        fresh = _lines_from_sections(sections)
        old = project["karaoke"].get("lines", [])
        if project["karaoke"].get("version_id") == version["id"] and not body.use_current_lyrics:
            pool = list(old)
        else:
            pool = list(old) if body.use_current_lyrics else []
        for ln in fresh:  # keep timings you already tapped for lines whose text did not change
            for i, cand in enumerate(pool):
                if cand.get("text") == ln["text"] and cand.get("start") is not None:
                    ln["start"] = cand["start"]
                    pool.pop(i)
                    break

        def mut(p: Dict[str, Any]) -> None:
            p["karaoke"]["version_id"] = version["id"]
            p["karaoke"]["lines"] = fresh
            p["selected_version_id"] = version["id"] if not version.get("instrumental") else p.get("selected_version_id")

        return store.update(pid, mut)

    @app.put("/api/projects/{pid}/karaoke")
    def karaoke_put(pid: str, body: KaraokePut):
        project_or_404(pid)
        lines = []
        for ln in body.lines[:500]:
            start = ln.get("start")
            lines.append({
                "text": str(ln.get("text", ""))[:500], "section": ln.get("section"),
                "start": round(float(start), 2) if isinstance(start, (int, float)) else None,
            })

        def mut(p: Dict[str, Any]) -> None:
            if body.version_id:
                store.find_version(p, body.version_id)
                p["karaoke"]["version_id"] = body.version_id
            p["karaoke"]["lines"] = lines
            if body.style:
                p["karaoke"]["style"].update(body.style)

        return store.update(pid, mut)

    def _background_for(project: Dict[str, Any], pid: str, choice: str, resolution: str) -> Optional[str]:
        covers_dir = store.project_dir(pid) / "covers"
        if choice == "none":
            return None
        if choice not in ("auto", ""):
            store.safe_media_path(pid, "covers", choice)
            return choice
        w, h = karaoke.RESOLUTIONS[resolution]
        wanted = "16:9" if w > h else ("9:16" if h > w else "1:1")
        entry = project["cover"]["files"].get(wanted)
        if project["cover"].get("mv_background") and (covers_dir / project["cover"]["mv_background"]).is_file():
            return project["cover"]["mv_background"]
        if entry:
            return entry.get("plain") or entry["file"]
        return None

    @app.post("/api/projects/{pid}/karaoke/frame")
    def karaoke_frame(pid: str, body: KaraokeRender):
        project = project_or_404(pid)
        vid = body.version_id or project["karaoke"].get("version_id") or project.get("selected_version_id")
        version = store.find_version(project, vid) if vid else None
        lines = body.lines if body.lines is not None else project["karaoke"]["lines"]
        timed = [dict(x) for x in lines if str(x.get("text", "")).strip()]
        for i, ln in enumerate(timed):  # preview may show untimed lines: spread them out
            if ln.get("start") is None:
                ln["start"] = 1.0 + 4.0 * i
        if not timed:
            raise StudioError("mv_no_lines", "មិនមានទំនុកសម្រាប់មើលជាមុនទេ", status=422)
        duration = float(version["duration"]) if version else max(float(x["start"]) for x in timed) + 8
        at = body.at if body.at is not None else float(min(x["start"] for x in timed)) + 0.5
        bg = _background_for(project, pid, body.background, body.resolution)
        style = {**project["karaoke"]["style"], **(body.style or {})}
        with tempfile.TemporaryDirectory(prefix="frame_") as tmp:
            out = Path(tmp) / "frame.png"
            karaoke.render_frame(
                s.ffmpeg, Path(tmp) / "work", out, timed, resolution=body.resolution, at=at, duration=duration, style=style,
                title=project.get("title", ""), artist=project.get("artist", ""), background=(store.project_dir(pid) / "covers" / bg) if bg else None,
            )
            return Response(out.read_bytes(), media_type="image/png", headers={"Cache-Control": "no-store"})

    @app.post("/api/projects/{pid}/karaoke/render")
    def karaoke_render(pid: str, body: KaraokeRender):
        project = project_or_404(pid)
        if body.resolution not in karaoke.RESOLUTIONS:
            raise StudioError("invalid_request", "ទំហំវីដេអូមិនត្រឹមត្រូវ", status=422)
        vid = body.version_id or project["karaoke"].get("version_id") or project.get("selected_version_id")
        if not vid:
            raise StudioError("mv_no_audio", "សូមជ្រើសកំណែបទចម្រៀងសម្រាប់ MV ជាមុន", status=422)
        version = store.find_version(project, vid)
        ensure_version_file(pid, version)
        lines = body.lines if body.lines is not None else project["karaoke"]["lines"]
        karaoke.validate_lines(lines)  # fail fast with a clear Khmer message instead of inside the job
        style = {**project["karaoke"]["style"], **(body.style or {})}
        bg = _background_for(project, pid, body.background, body.resolution)
        params = {"version_id": vid, "lines": lines, "resolution": body.resolution, "style": style, "background_file": bg}

        def mut(p: Dict[str, Any]) -> None:
            p["karaoke"]["version_id"] = vid
            p["karaoke"]["lines"] = [{"text": x.get("text", ""), "section": x.get("section"), "start": x.get("start")} for x in lines]
            p["karaoke"]["style"].update(body.style or {})

        store.update(pid, mut)

        def runner(ctx):
            return pipeline.run_mv(ctx, settings=s, store=store, params=params)

        return jobs.submit(pid, "mv", runner, queue_name="media", label=f"MV ខារ៉ាអូខេ {body.resolution}", params={"resolution": body.resolution, "version_id": vid, "version_label": version.get("label", "")})

    @app.delete("/api/projects/{pid}/mv/{mid}")
    def delete_mv(pid: str, mid: str):
        def mut(p: Dict[str, Any]) -> None:
            p["karaoke"]["outputs"] = [m for m in p["karaoke"]["outputs"] if m["id"] != mid]
            (store.project_dir(pid) / "mv" / f"{mid}.mp4").unlink(missing_ok=True)

        return store.update(pid, mut)

    # ------------------------------------------------------------------ publish
    @app.post("/api/projects/{pid}/publish/generate")
    def publish_generate(pid: str, body: PublishGenerate):
        project = project_or_404(pid)
        info = {**project["publish"]["info"], **(body.info or {})}
        texts = publish.generate(project, info, engine_summary_for(project), include_lyrics=body.include_lyrics)

        def mut(p: Dict[str, Any]) -> None:
            p["publish"]["info"] = info
            p["publish"]["texts"] = texts

        store.update(pid, mut)
        return {"info": info, "texts": texts}

    @app.put("/api/projects/{pid}/publish")
    def publish_put(pid: str, body: PublishPut):
        def mut(p: Dict[str, Any]) -> None:
            if body.info:
                p["publish"]["info"].update(body.info)
            if body.texts:
                for platform, fields in body.texts.items():
                    if platform in publish.PLATFORMS:
                        cur = p["publish"]["texts"].setdefault(platform, {})
                        cur.update({k: str(v)[:20000] for k, v in fields.items()})

        return store.update(pid, mut)

    # ------------------------------------------------------------------ media (Range requests supported: iOS needs them)
    @app.get("/media/{pid}/{kind}/{name}")
    def media(pid: str, kind: str, name: str, dl: int = 0, as_name: Optional[str] = None):
        path = store.safe_media_path(pid, kind, name)
        media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
        headers = {"Cache-Control": "private, max-age=3600"} if kind in ("audio", "mv") else {"Cache-Control": "no-cache"}
        if dl:
            return FileResponse(path, media_type=media_type, filename=as_name or name, headers=headers)
        return FileResponse(path, media_type=media_type, headers=headers)

    @app.get("/api/projects/{pid}/mv/{mid}/download")
    def download_mv(pid: str, mid: str):
        project = project_or_404(pid)
        entry = next((m for m in project["karaoke"]["outputs"] if m["id"] == mid), None)
        if not entry:
            raise StudioError("not_found", "រកមិនឃើញវីដេអូនេះ", status=404)
        path = store.safe_media_path(pid, "mv", f"{mid}.mp4")
        return FileResponse(path, media_type="video/mp4", filename=download_name(f"{project.get('title') or 'karaoke'}_{entry['resolution']}", ".mp4"))

    # ------------------------------------------------------------------ web UI (must be last)
    app.mount("/fonts", StaticFiles(directory=str(FONTS_DIR)), name="fonts")
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
    return app
