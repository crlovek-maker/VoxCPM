"""ACE-Step 1.5 engine — talks to the model's OFFICIAL REST API (`uv run acestep-api`).

Flow (documented in ACE-Step-1.5/docs/en/API.md and verified against the server source):
  POST /release_task   -> {"data": {"task_id", "status": "queued", "queue_position"}}
  POST /query_result   -> {"data": [{"task_id", "status": 0|1|2, "result": "<json list>", "progress_text"}]}
                          while running, result[0] carries {"stage", "progress"(0..1), "error"}
  GET  /v1/audio?path= -> the audio bytes
The model weights and the server run on the user's own machine / GPU server. Nothing leaves it.
"""
from __future__ import annotations

import json
import time
import urllib.parse
from typing import Any, Dict, List, Optional

from ..config import Settings
from ..errors import EngineUnavailable, StudioError
from ..util import HttpError, NetworkError, http_download, http_json
from .base import (
    ACESTEP_VALID_LANGUAGES,
    KEY_OPTIONS,
    Engine,
    EngineContext,
    EngineInfo,
    GenerationRequest,
    GenerationResult,
    Health,
    clean_log_text,
)

CAPTION_LIMIT = 512  # documented max characters for the caption/prompt
LYRICS_LIMIT = 4096  # documented max characters for lyrics

START_HINT = (
    "ចាប់ផ្ដើម server ម៉ូដែលជាមុន៖ នៅក្នុងថត ACE-Step-1.5 រត់ `uv run acestep-api` "
    "(ឬ start_api_server.bat លើ Windows) រួចពិនិត្យតម្លៃ ACESTEP_URL"
)


class AceStepEngine(Engine):
    id = "acestep"

    def __init__(self, settings: Settings) -> None:
        self.s = settings

    # ------------------------------------------------------------------ info / health
    def info(self) -> EngineInfo:
        km_note = (
            "ឯកសារផ្លូវការអះអាងថាគាំទ្រទំនុក «50+ ភាសា» ប៉ុន្តែមិនបានរាយឈ្មោះភាសាទេ។ "
            "កូដផ្លូវការ (acestep/constants.py → VALID_LANGUAGES) មាន th, vi, id, ms, tl ប៉ុន្តែគ្មាន «km» (ខ្មែរ)។ "
            "ត្រង់ខាងស្ទីល បញ្ជី genres_vocab.txt មានពាក្យគន្លឹះ «Khmer pop / rock / rap / folk»។ "
            "សន្និដ្ឋាន៖ មិនមានឯកសារបញ្ជាក់ថាច្រៀងទំនុកខ្មែរបានច្បាស់ → ត្រូវសាកល្បងបន្ថែមលើម៉ាស៊ីនរបស់អ្នក។"
        )
        return EngineInfo(
            id=self.id,
            name="ACE-Step 1.5 (turbo)",
            is_ai=True,
            summary="ម៉ូដែល open-weights បង្កើតចម្រៀងពីទំនុក + ការពិពណ៌នា ដំណើរការលើកុំព្យូទ័រ/GPU របស់អ្នក",
            homepage="https://github.com/ace-step/ACE-Step-1.5",
            weights_url="https://huggingface.co/ACE-Step/Ace-Step1.5",
            license_name="MIT",
            license_url="https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE",
            release_terms=(
                "កូដ និងទម្ងន់ម៉ូដែលប្រើអាជ្ញាបណ្ណ MIT។ Model card ចែងថា «អាចប្រើបទដែលបង្កើតសម្រាប់ពាណិជ្ជកម្មបាន» "
                "ហើយអះអាងថាបង្ហាត់ដោយទិន្នន័យមានអាជ្ញាបណ្ណ/គ្មានកម្មសិទ្ធិ/សំយោគ។ "
                "អ្នកនិពន្ធណែនាំឱ្យពិនិត្យថាបទមិនស្រដៀងបទដែលមានស្រាប់ ប្រាប់សាធារណៈថាប្រើ AI និងសុំការអនុញ្ញាតបើយកស្ទីលអ្នកដទៃ។ "
                "(នេះជាការសង្ខេបពីឯកសារ មិនមែនយោបល់ផ្លូវច្បាប់ទេ។)"
            ),
            hardware=(
                "ឯកសារផ្លូវការ៖ DiT-only ត្រូវការ VRAM ≥ 4GB (INT8 + offload), មាន LM ≥ 6GB; "
                "បទពេញក្នុង <10 វិនាទីលើ RTX 3090; ថាស ~10GB; Python 3.11–3.12។ "
                "អាចដំណើរការលើ CPU តែយឺតខ្លាំង និងត្រូវការ RAM ច្រើន។"
            ),
            khmer_status="not_documented",
            khmer_note=km_note,
            supports_vocals=True,
            supports_instrumental=True,
            min_duration=10,
            max_duration=600,
            native_controls=self._native_controls(),
            notes=[
                "ម៉ូដែលទទួលទំនុក ≤ 4096 តួអក្សរ និងការពិពណ៌នា (caption) ≤ 512 តួអក្សរ។",
                "ស្ទីល ឧបករណ៍ អារម្មណ៍ ជាអត្ថបទពិពណ៌នា — ម៉ូដែលអាចមិនធ្វើតាមទាំងស្រុង។",
            ],
        )

    @staticmethod
    def _native_controls() -> List[Dict[str, Any]]:
        langs = [{"value": "unknown", "label": "ស្វ័យប្រវត្តិ (unknown) — ណែនាំសម្រាប់ទំនុកខ្មែរ"}]
        langs.append({"value": "km", "label": "ខ្មែរ (km) — មិនមានក្នុងបញ្ជីផ្លូវការ សាកល្បងបាន"})
        names = {
            "en": "អង់គ្លេស", "th": "ថៃ", "vi": "វៀតណាម", "id": "ឥណ្ឌូនេស៊ី", "ms": "ម៉ាឡេ", "tl": "តាហ្គាឡុក",
            "zh": "ចិន", "yue": "កាតាំង", "ja": "ជប៉ុន", "ko": "កូរ៉េ", "fr": "បារាំង", "es": "អេស្ប៉ាញ",
            "de": "អាល្លឺម៉ង់", "hi": "ហិណ្ឌី", "ru": "រុស្ស៊ី", "pt": "ព័រទុយហ្គាល់",
        }
        for code, label in names.items():
            langs.append({"value": code, "label": f"{label} ({code})"})
        return [
            {"key": "duration", "label": "រយៈពេល (វិនាទី)", "type": "number", "min": 10, "max": 600, "step": 5,
             "default": 120, "note": "ម៉ូដែលគាំទ្រ 10–600 វិនាទី"},
            {"key": "bpm", "label": "ល្បឿន BPM", "type": "number", "min": 30, "max": 300, "step": 1,
             "default": None, "note": "ទទេ = ម៉ូដែលជ្រើសរើសខ្លួនឯង"},
            {"key": "key_scale", "label": "សំឡេងគន្លឹះ (Key)", "type": "select",
             "options": [{"value": k, "label": k or "ស្វ័យប្រវត្តិ"} for k in KEY_OPTIONS], "default": ""},
            {"key": "time_signature", "label": "ចង្វាក់ក្នុងមួយរង្វាស់", "type": "select", "default": "",
             "options": [
                 {"value": "", "label": "ស្វ័យប្រវត្តិ"}, {"value": "2", "label": "2/4"},
                 {"value": "3", "label": "3/4"}, {"value": "4", "label": "4/4"}, {"value": "6", "label": "6/8"},
             ]},
            {"key": "vocal_language", "label": "ភាសាសំឡេងច្រៀង", "type": "select", "options": langs,
             "default": "unknown", "note": "បញ្ជីផ្លូវការមិនមាន km — បើច្រៀងមិនច្បាស់ សាកល្បងប្តូរតម្លៃ"},
            {"key": "seed", "label": "Seed (ឱ្យលទ្ធផលដដែល)", "type": "number", "min": 0, "max": 2147483647,
             "default": None, "note": "ទទេ = ចៃដន្យ"},
            {"key": "steps", "label": "ចំនួន step", "type": "number", "min": 1, "max": 20, "step": 1,
             "default": 8, "note": "turbo ណែនាំ 8"},
        ]

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.s.acestep_api_key}"} if self.s.acestep_api_key else {}

    def health(self) -> Health:
        url = self.s.acestep_url + "/health"
        try:
            _, body = http_json("GET", url, headers=self._headers(), timeout=4)
        except NetworkError as exc:
            return Health(False, "unreachable", "មិនទាន់ភ្ជាប់ទៅម៉ូដែល ACE-Step", {"url": self.s.acestep_url, "error": exc.reason})
        except HttpError as exc:
            return Health(False, "error", f"ម៉ូដែល ACE-Step ឆ្លើយកំហុស HTTP {exc.status}", {"url": self.s.acestep_url})
        data = (body or {}).get("data", {}) if isinstance(body, dict) else {}
        loaded = bool(data.get("models_initialized"))
        msg = "ម៉ូដែល ACE-Step រួចរាល់" if loaded else "ម៉ូដែល ACE-Step ភ្ជាប់បាន (នឹងផ្ទុកម៉ូដែលពេលបង្កើតលើកដំបូង)"
        return Health(True, "ready", msg, {
            "url": self.s.acestep_url,
            "models_initialized": loaded,
            "llm_initialized": bool(data.get("llm_initialized")),
            "loaded_model": data.get("loaded_model"),
        })

    # ------------------------------------------------------------------ generation
    def build_payload(self, req: GenerationRequest, health: Optional[Health] = None) -> Dict[str, Any]:
        notes: List[str] = []
        caption = (req.caption or "").strip()
        if len(caption) > CAPTION_LIMIT:
            cut = caption[:CAPTION_LIMIT]
            if "," in cut:
                cut = cut[: cut.rfind(",")]
            caption = cut.strip()
            notes.append(f"ការពិពណ៌នាវែងលើស {CAPTION_LIMIT} តួអក្សរ ត្រូវបានកាត់ខ្លី")
        lyrics = "[Instrumental]" if req.instrumental else (req.lyrics or "").strip()
        if not req.instrumental and not lyrics:
            raise StudioError("invalid_request", "សូមបញ្ចូលទំនុកជាមុន ឬជ្រើស «ភ្លេងសុទ្ធ»", status=422)
        if len(lyrics) > LYRICS_LIMIT:
            raise StudioError(
                "invalid_request",
                f"ទំនុកវែងពេក ({len(lyrics)} តួអក្សរ) — ម៉ូដែលទទួលបានអតិបរមា {LYRICS_LIMIT} តួអក្សរ",
                status=422,
            )
        language = "unknown" if req.instrumental else (req.vocal_language or "unknown")
        if language not in ACESTEP_VALID_LANGUAGES:
            notes.append(f"ភាសា «{language}» មិនមានក្នុងបញ្ជីផ្លូវការរបស់ ACE-Step — លទ្ធផលអាចមិនប្រាកដ")

        payload: Dict[str, Any] = {
            "prompt": caption,
            "lyrics": lyrics,
            "vocal_language": language,
            "audio_format": "wav",
            "batch_size": 1,
            "thinking": False,
            "use_cot_caption": False,  # keep our caption exactly as written
            "use_cot_language": False,  # do not let the LM re-detect (and mis-detect) Khmer
        }
        lm_available = bool(health and health.detail.get("llm_initialized"))
        if req.use_lm and lm_available:
            payload["thinking"] = True
        elif req.use_lm and not lm_available:
            notes.append("LM ផែនការមិនត្រូវបានផ្ទុកក្នុង server ទេ — បិទ thinking")
        if req.duration:
            payload["audio_duration"] = float(max(10, min(600, req.duration)))
        if req.bpm:
            payload["bpm"] = int(max(30, min(300, req.bpm)))
        if req.key_scale:
            payload["key_scale"] = req.key_scale
        if req.time_signature:
            payload["time_signature"] = str(req.time_signature)
        if req.steps:
            payload["inference_steps"] = int(req.steps)
        if req.seed is not None:
            payload["use_random_seed"] = False
            payload["seed"] = int(req.seed)
        else:
            payload["use_random_seed"] = True
        model = self.s.acestep_model
        if model:
            payload["model"] = model
        if req.guidance and not (model or "turbo").lower().count("turbo"):
            payload["guidance_scale"] = float(req.guidance)  # only meaningful for base/sft models
        payload.update(req.extra.get("acestep", {}) if isinstance(req.extra, dict) else {})
        payload["__notes__"] = notes  # popped by generate(); never sent
        return payload

    def generate(self, req: GenerationRequest, ctx: EngineContext) -> GenerationResult:
        ctx.progress(None, "engine_check", "កំពុងពិនិត្យការភ្ជាប់ទៅម៉ូដែល ACE-Step")
        health = self.health()
        if not health.ok:
            raise EngineUnavailable(
                f"មិនអាចភ្ជាប់ទៅម៉ូដែល ACE-Step បានទេ ({self.s.acestep_url})",
                detail=json.dumps(health.detail, ensure_ascii=False),
                hint=START_HINT,
            )
        payload = self.build_payload(req, health)
        notes: List[str] = payload.pop("__notes__")
        first_load = not health.detail.get("models_initialized")
        ctx.log(f"ACE-Step ភ្ជាប់បាន; models_initialized={not first_load}")
        ctx.check_cancelled()

        ctx.progress(None, "submitting", "កំពុងផ្ញើទំនុក និងការកំណត់ទៅម៉ូដែល")
        try:
            _, resp = http_json("POST", self.s.acestep_url + "/release_task", body=payload, headers=self._headers(), timeout=60)
        except NetworkError as exc:
            raise EngineUnavailable("ការភ្ជាប់ទៅម៉ូដែលដាច់ពេលផ្ញើការងារ", detail=exc.reason, hint=START_HINT) from exc
        except HttpError as exc:
            if exc.status == 429:
                raise StudioError("engine_busy", "ជួរការងាររបស់ម៉ូដែលពេញ សូមរង់ចាំបន្តិចរួចសាកល្បងម្ដងទៀត", detail=exc.body, status=503) from exc
            raise StudioError("engine_failed", f"ម៉ូដែលបដិសេធសំណើ (HTTP {exc.status})", detail=exc.body[:800], status=502) from exc
        try:
            task_id = resp["data"]["task_id"]
        except (TypeError, KeyError) as exc:
            raise StudioError("engine_failed", "ម៉ូដែលឆ្លើយតបក្នុងទម្រង់ដែលមិនស្គាល់", detail=str(resp)[:500], status=502) from exc
        position = (resp.get("data") or {}).get("queue_position")
        ctx.log(f"task_id={task_id} queue_position={position}")

        started = time.monotonic()
        empty_polls = 0
        last_key = None
        while True:
            if ctx.cancelled():
                ctx.log("អ្នកប្រើបោះបង់ — ឈប់រង់ចាំ (ម៉ូដែលអាចនៅតែបញ្ចប់ការងារខាងក្នុងរបស់វា)")
                ctx.check_cancelled()
            elapsed = time.monotonic() - started
            if elapsed > self.s.acestep_timeout_seconds:
                raise StudioError(
                    "engine_timeout",
                    f"ម៉ូដែលប្រើពេលយូរជាង {self.s.acestep_timeout_seconds // 60} នាទី",
                    hint="បើប្រើ CPU វាយឺតខ្លាំង — សូមប្រើ GPU ឬកាត់បន្ថយរយៈពេលបទ",
                    status=504,
                )
            time.sleep(self.s.acestep_poll_seconds)
            try:
                _, q = http_json(
                    "POST", self.s.acestep_url + "/query_result",
                    body={"task_id_list": [task_id]}, headers=self._headers(), timeout=30,
                )
            except NetworkError as exc:
                raise EngineUnavailable(
                    "ការភ្ជាប់ទៅម៉ូដែលដាច់ពេលកំពុងបង្កើត (server ប្រហែលជាត្រូវបានបិទ ឬអស់អង្គចងចាំ)",
                    detail=exc.reason, hint=START_HINT,
                ) from exc
            item = (q or {}).get("data", [{}])[0] if isinstance(q, dict) else {}
            status = item.get("status", 0)
            progress_text = clean_log_text(item.get("progress_text"))
            try:
                result_list = json.loads(item.get("result") or "[]")
            except (TypeError, json.JSONDecodeError):
                result_list = []
            first = result_list[0] if result_list and isinstance(result_list[0], dict) else {}

            if status == 1:
                return self._finish(first, ctx, payload, notes, task_id)
            if status == 2:
                err = first.get("error") or progress_text or "unknown error"
                raise StudioError(
                    "engine_failed", "ម៉ូដែលរាយការណ៍កំហុសពេលបង្កើតសំឡេង",
                    detail=str(err)[:1500], hint="មើលកំណត់ហេតុ (log) ក្នុង terminal របស់ server ម៉ូដែល", status=502,
                )
            if not result_list:
                empty_polls += 1
                if empty_polls >= 5:
                    raise StudioError(
                        "engine_failed", "ម៉ូដែលលែងស្គាល់ការងារនេះ (server ប្រហែលជាបានចាប់ផ្ដើមឡើងវិញ)", detail=task_id, status=502,
                    )
                continue
            empty_polls = 0

            stage = str(first.get("stage") or "queued")
            frac = first.get("progress")
            frac = float(frac) if isinstance(frac, (int, float)) and frac > 0 else None
            pct = f" {int(frac * 100)}%" if frac is not None else ""
            if stage.lower() == "queued" and frac is None:
                msg = "ម៉ូដែលកំពុងផ្ទុក/រៀបចំ"
                if first_load:
                    msg = "កំពុងផ្ទុកម៉ូដែលចូលអង្គចងចាំ (ការបង្កើតលើកដំបូងអាចយូរ)"
                ctx.progress(None, "engine_loading", msg)
            elif any(k in stage.lower() for k in ("prepar", "sav", "encod")):
                # the server's last step ("Preparing audio data...", progress 0.99): writing the audio file
                ctx.progress(frac, "encoding", f"កំពុងរៀបចំឯកសារសំឡេងក្នុង server ម៉ូដែល{pct}")
            elif "decod" in stage.lower():
                # latents -> waveform (VAE). On CPU this is slow and the server reports a flat 80%.
                ctx.progress(frac, "decoding", f"កំពុងបំលែងលទ្ធផលទៅជាសំឡេង (decode){pct}")
            else:
                ctx.progress(frac, "generating", f"កំពុងបង្កើតសំឡេង{pct}")
            key = (status, stage, frac, progress_text)
            if key != last_key:
                ctx.log(f"[ម៉ូដែល] stage={stage!r} progress={frac} {progress_text}".strip())
                last_key = key

    def _finish(self, first: Dict[str, Any], ctx: EngineContext, payload: Dict[str, Any], notes: List[str], task_id: str) -> GenerationResult:
        file_ref = first.get("file") or ""
        if not file_ref:
            raise StudioError("engine_bad_output", "ម៉ូដែលរាយការណ៍ថាជោគជ័យ តែមិនបានផ្ដល់ឯកសារសំឡេង", detail=json.dumps(first, ensure_ascii=False)[:600], status=502)
        if file_ref.startswith("/v1/audio") or file_ref.startswith("http"):
            url = file_ref if file_ref.startswith("http") else self.s.acestep_url + file_ref
        else:
            url = self.s.acestep_url + "/v1/audio?path=" + urllib.parse.quote(file_ref, safe="")
        ctx.progress(None, "downloading", "កំពុងទាញយកឯកសារសំឡេងពីម៉ូដែល")
        ext = ".wav" if ".wav" in file_ref.lower() else (".mp3" if ".mp3" in file_ref.lower() else ".bin")
        dest = ctx.workdir / f"engine_out{ext}"
        try:
            size = http_download(url, dest, headers=self._headers(), timeout=300)
        except (HttpError, NetworkError) as exc:
            raise StudioError("engine_bad_output", "ទាញយកឯកសារសំឡេងពីម៉ូដែលមិនបាន", detail=str(exc)[:500], status=502) from exc
        if size < 1024:
            raise StudioError("engine_bad_output", "ឯកសារសំឡេងដែលម៉ូដែលផ្ដល់ឱ្យទទេ ឬខូច", detail=f"{size} bytes", status=502)
        seed_value = str(first.get("seed_value") or "").split(",")[0].strip()
        seed = int(seed_value) if seed_value.lstrip("-").isdigit() else payload.get("seed")
        ctx.log(f"បានទទួលឯកសារសំឡេង {size} bytes")
        sent = {k: v for k, v in payload.items()}
        return GenerationResult(
            path=dest,
            seed=seed,
            engine_meta={
                "task_id": task_id,
                "dit_model": first.get("dit_model"),
                "lm_model": first.get("lm_model"),
                "metas": first.get("metas"),
                "generation_info": (first.get("generation_info") or "")[:600],
            },
            sent=sent,
            notes=notes,
        )
