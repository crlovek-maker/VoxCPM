"""HeartMuLa engine (OPTIONAL, EXPERIMENTAL) — runs heartlib's own example script as a subprocess.

Why it exists: its README claims "multilingual support covering almost all languages", so it is a
second model worth trying for Khmer lyrics if ACE-Step sings Khmer unclearly. It was NOT executed
by the developer of this studio (no GPU available) — only the command line was checked against the
official `examples/run_music_generation.py`. Test it with:  python scripts/check_engine.py --engine heartmula
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Dict, List

from ..config import Settings
from ..errors import StudioError
from .. import audio as audio_tools
from .base import Engine, EngineContext, EngineInfo, GenerationRequest, GenerationResult, Health

_PCT = re.compile(r"(\d{1,3})%")


class HeartMuLaEngine(Engine):
    id = "heartmula"

    def __init__(self, settings: Settings) -> None:
        self.s = settings

    # paths ----------------------------------------------------------------------------
    @property
    def script(self) -> Path:
        return (self.s.heartmula_dir or Path(".")) / "examples" / "run_music_generation.py"

    @property
    def ckpt(self) -> Path:
        return self.s.heartmula_ckpt or ((self.s.heartmula_dir or Path(".")) / "ckpt")

    def info(self) -> EngineInfo:
        return EngineInfo(
            id=self.id,
            name=f"HeartMuLa oss-{self.s.heartmula_version} (ពិសោធន៍)",
            is_ai=True,
            experimental=True,
            summary="ម៉ូដែលទីពីរ (Apache-2.0) អះអាងថាគាំទ្រស្ទើរគ្រប់ភាសា — សាកល្បងបើ ACE-Step ច្រៀងខ្មែរមិនច្បាស់",
            homepage="https://github.com/HeartMuLa/heartlib",
            weights_url="https://huggingface.co/HeartMuLa/HeartMuLa-oss-3B-happy-new-year",
            license_name="Apache-2.0",
            license_url="https://github.com/HeartMuLa/heartlib#%EF%B8%8F-license",
            release_terms="README ចែងថា repo និង weights ទាំងអស់ប្រើ Apache 2.0 (សង្ខេបពី README មិនមែនយោបល់ផ្លូវច្បាប់)។",
            hardware="README មិនបញ្ជាក់ VRAM ទេ។ មានជម្រើស --lazy_load សម្រាប់សន្សំ VRAM; ល្បឿនប្រហែល RTF≈1.0 (README)។",
            khmer_status="not_documented",
            khmer_note="README អះអាង «multilingual … almost all languages» ប៉ុន្តែមិនរាយឈ្មោះភាសា ហើយមិនបញ្ជាក់ខ្មែរ → ត្រូវសាកល្បង។",
            supports_vocals=True,
            supports_instrumental=False,
            min_duration=20,
            max_duration=240,
            native_controls=[
                {"key": "duration", "label": "រយៈពេលអតិបរមា (វិនាទី)", "type": "number", "min": 20, "max": 240, "step": 5,
                 "default": 120, "note": "ជាដែនកំណត់អតិបរមា (max_audio_length_ms) មិនមែនរយៈពេលពិតប្រាកដទេ"},
            ],
            notes=[
                "មិនមាន BPM/Key/Seed ក្នុងស្គ្រីបផ្លូវការ — ការពិពណ៌នាស្ទីលជា «tags» អត្ថបទប៉ុណ្ណោះ។",
                "ភ្លេងសុទ្ធមិនត្រូវបានគាំទ្រដោយឯកសារផ្លូវការ។",
                "អ្នកអភិវឌ្ឍមិនទាន់បានដំណើរការម៉ូដែលនេះទេ (គ្មាន GPU) — សូមសាកល្បងដោយខ្លួនឯង។",
            ],
        )

    def health(self) -> Health:
        if not self.s.heartmula_dir:
            return Health(False, "not_configured", "មិនទាន់កំណត់ HEARTMULA_DIR")
        if not self.script.is_file():
            return Health(False, "error", f"រកមិនឃើញ {self.script}", {"script": str(self.script)})
        if not self.ckpt.is_dir():
            return Health(False, "error", f"រកមិនឃើញថត ckpt ({self.ckpt}) — សូមទាញយកម៉ូដែលតាម README របស់ heartlib")
        py = self.s.heartmula_python
        if not (shutil.which(py) or Path(py).is_file()):
            return Health(False, "error", f"រក Python មិនឃើញ ({py}) — កំណត់ HEARTMULA_PYTHON ទៅ python ក្នុង venv របស់ heartlib")
        return Health(True, "ready", "HeartMuLa រួចរាល់ (ម៉ូដែលផ្ទុកពេលបង្កើតម្ដងៗ)", {"dir": str(self.s.heartmula_dir)})

    def generate(self, req: GenerationRequest, ctx: EngineContext) -> GenerationResult:
        health = self.health()
        if not health.ok:
            raise StudioError("engine_unreachable", health.message, status=503)
        if req.instrumental:
            raise StudioError("invalid_request", "HeartMuLa មិនគាំទ្រភ្លេងសុទ្ធ — សូមប្រើ ACE-Step សម្រាប់ភ្លេងសុទ្ធ", status=422)
        if not req.lyrics.strip():
            raise StudioError("invalid_request", "សូមបញ្ចូលទំនុកជាមុន", status=422)

        lyrics_path = ctx.workdir / "lyrics.txt"
        tags_path = ctx.workdir / "tags.txt"
        out_path = ctx.workdir / "engine_out.mp3"
        lyrics_path.write_text(req.lyrics.replace("[Verse 1]", "[Verse]").replace("[Verse 2]", "[Verse]"), encoding="utf-8")
        tags = ",".join(t.strip() for t in req.caption.split(",") if t.strip())
        tags_path.write_text(tags or "pop", encoding="utf-8")
        max_ms = int(max(20, min(240, req.duration or 120)) * 1000)
        cmd = [
            self.s.heartmula_python, str(self.script),
            "--model_path", str(self.ckpt), "--version", self.s.heartmula_version,
            "--lyrics", str(lyrics_path), "--tags", str(tags_path), "--save_path", str(out_path),
            "--max_audio_length_ms", str(max_ms),
            "--lazy_load", "true" if self.s.heartmula_lazy_load else "false",
        ]
        ctx.progress(None, "generating", "កំពុងបង្កើតសំឡេងជាមួយ HeartMuLa (មិនមានភាគរយពិតពីម៉ូដែល)")
        ctx.log("run: " + " ".join(cmd))

        def on_line(line: str) -> None:
            text = line.strip()
            if text:
                ctx.log(text[-200:])
                m = _PCT.search(text)
                if m:
                    ctx.progress(min(0.99, int(m.group(1)) / 100.0), "generating", f"កំពុងបង្កើតសំឡេង {m.group(1)}%")

        res = audio_tools.run(cmd, timeout=self.s.heartmula_timeout_seconds, cancel_check=ctx.cancelled, on_stderr_line=on_line)
        if res.returncode != 0 or not out_path.is_file():
            raise StudioError(
                "engine_failed", "HeartMuLa បរាជ័យ",
                detail=("\n".join((res.stderr or "").strip().splitlines()[-12:]))[-1200:],
                hint="ពិនិត្យថា heartlib ដំឡើងត្រឹមត្រូវ និងមាន VRAM គ្រប់គ្រាន់ (សាកល្បង HEARTMULA_LAZY_LOAD=true)",
                status=502,
            )
        sent: Dict[str, Any] = {"tags": tags, "max_audio_length_ms": max_ms, "lazy_load": self.s.heartmula_lazy_load, "version": self.s.heartmula_version}
        notes: List[str] = ["HeartMuLa មិនគាំទ្រ BPM/Key/Seed — ការកំណត់ទាំងនោះត្រូវបានមិនអើពើ"] if (req.bpm or req.key_scale or req.seed is not None) else []
        return GenerationResult(path=out_path, seed=None, engine_meta={"engine": "heartmula"}, sent=sent, notes=notes)
