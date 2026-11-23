"""System-test engine. NOT AI.

It synthesises a plain chord/beat loop with a few "test beeps" at the start so nobody mistakes it
for a model result. It has no voice and ignores the lyrics. Its only job is to let the whole
pipeline (jobs, versions, download, karaoke MV, publishing) be exercised on machines where the real
model is not installed (CI, laptops, first-time setup).
"""
from __future__ import annotations

import os
import time
import wave
from typing import Optional

from ..config import Settings
from ..errors import StudioError
from .base import Engine, EngineContext, EngineInfo, GenerationRequest, GenerationResult, Health

SAMPLE_RATE = 44100


def _note_freq(name: str) -> float:
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
    semitone = names.get(name, 9)
    return 220.0 * (2 ** ((semitone - 9) / 12.0))  # octave 3 reference


class SelfTestEngine(Engine):
    id = "selftest"

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.delay = float(os.environ.get("STUDIO_SELFTEST_DELAY", "1.2"))

    def info(self) -> EngineInfo:
        return EngineInfo(
            id=self.id,
            name="របៀបសាកល្បងប្រព័ន្ធ (មិនមែន AI)",
            is_ai=False,
            summary="បង្កើតភ្លេងសាមញ្ញៗដោយកូដ គ្មានសំឡេងច្រៀង មិនប្រើទំនុក — សម្រាប់តែសាកល្បងថាកម្មវិធីដំណើរការទាំងមូល",
            license_name="—",
            release_terms="មិនមែនបទចម្រៀងពិត សូមកុំចេញផ្សាយ",
            hardware="មិនត្រូវការ GPU",
            khmer_status="not_ai",
            khmer_note="មិនពាក់ព័ន្ធ — ម៉ូដែលនេះមិនច្រៀង និងមិនអានទំនុកទេ។",
            supports_vocals=False,
            supports_instrumental=True,
            min_duration=5,
            max_duration=300,
            native_controls=[
                {"key": "duration", "label": "រយៈពេល (វិនាទី)", "type": "number", "min": 5, "max": 300, "step": 5, "default": 30},
                {"key": "bpm", "label": "ល្បឿន BPM", "type": "number", "min": 50, "max": 200, "step": 1, "default": 100},
                {"key": "seed", "label": "Seed", "type": "number", "min": 0, "max": 2147483647, "default": None},
            ],
            notes=["សំឡេងចាប់ផ្ដើមដោយ «bip bip bip» បីដង ដើម្បីបញ្ជាក់ថាជាការសាកល្បង។"],
        )

    def health(self) -> Health:
        try:
            import numpy  # noqa: F401
        except ImportError:
            return Health(False, "error", "ត្រូវការ numpy សម្រាប់របៀបសាកល្បងប្រព័ន្ធ (pip install numpy)")
        return Health(True, "ready", "របៀបសាកល្បងប្រព័ន្ធរួចរាល់ (មិនមែន AI)")

    def generate(self, req: GenerationRequest, ctx: EngineContext) -> GenerationResult:
        try:
            import numpy as np
        except ImportError as exc:
            raise StudioError("engine_failed", "របៀបសាកល្បងត្រូវការ numpy", hint="pip install numpy", status=500) from exc

        duration = float(req.duration or 30)
        duration = max(5.0, min(300.0, duration))
        bpm = int(req.bpm or 100)
        seed = int(req.seed) if req.seed is not None else int(time.time()) % 100000
        rng = np.random.default_rng(seed)

        ctx.progress(0.05, "generating", "កំពុងសំយោគភ្លេងសាកល្បង (មិនមែន AI)")
        time.sleep(self.delay / 3)
        ctx.check_cancelled()

        n = int(duration * SAMPLE_RATE)
        t = np.arange(n) / SAMPLE_RATE
        key = (req.key_scale or "A minor").split()
        root_name = key[0] if key else "A"
        minor = (key[1].lower() if len(key) > 1 else "minor") == "minor"
        root = _note_freq(root_name)
        # i-VI-III-VII (minor) or I-V-vi-IV (major) as semitone offsets of chord roots
        prog = [0, 8, 3, 10] if minor else [0, 7, 9, 5]
        third = 3 if minor else 4
        beat = 60.0 / bpm
        bar = beat * 4

        audio = np.zeros(n, dtype=np.float64)
        for i, off in enumerate(prog * int(duration / (bar * 2) + 2)):
            start = i * bar * 2
            if start >= duration:
                break
            end = min(duration, start + bar * 2)
            i0, i1 = int(start * SAMPLE_RATE), int(end * SAMPLE_RATE)
            seg = t[i0:i1] - start
            env = np.minimum(1.0, seg / 0.15) * np.minimum(1.0, (end - start - seg) / 0.25)
            f0 = root * 2 ** (off / 12.0)
            for mult, amp in ((1.0, 0.16), (2 ** (third / 12.0), 0.12), (2 ** (7 / 12.0), 0.12)):
                audio[i0:i1] += amp * env * np.sin(2 * np.pi * f0 * mult * seg + 0.3 * np.sin(2 * np.pi * 5 * seg))
            # bass on every beat
            for b in range(int((end - start) / beat)):
                bs = start + b * beat
                j0, j1 = int(bs * SAMPLE_RATE), min(n, int((bs + beat * 0.9) * SAMPLE_RATE))
                bt = t[j0:j1] - bs
                audio[j0:j1] += 0.22 * np.exp(-3 * bt) * np.sin(2 * np.pi * (f0 / 2) * bt)
        ctx.progress(0.5, "generating", "កំពុងបន្ថែមចង្វាក់")
        time.sleep(self.delay / 3)
        ctx.check_cancelled()
        # kick + hat
        for b in range(int(duration / beat)):
            bs = b * beat
            j0, j1 = int(bs * SAMPLE_RATE), min(n, int((bs + 0.12) * SAMPLE_RATE))
            bt = t[j0:j1] - bs
            if b % 2 == 0:
                audio[j0:j1] += 0.35 * np.exp(-25 * bt) * np.sin(2 * np.pi * (90 - 400 * bt) * bt)
            h1 = min(n, int((bs + beat / 2 + 0.03) * SAMPLE_RATE))
            h0 = int((bs + beat / 2) * SAMPLE_RATE)
            if h0 < h1:
                audio[h0:h1] += 0.05 * rng.standard_normal(h1 - h0) * np.exp(-60 * (t[h0:h1] - t[h0]))
        # three "this is a test" beeps at the start
        for k in range(3):
            b0, b1 = int((0.2 + k * 0.45) * SAMPLE_RATE), int((0.2 + k * 0.45 + 0.25) * SAMPLE_RATE)
            if b1 < n:
                audio[b0:b1] += 0.35 * np.sin(2 * np.pi * 880 * (t[b0:b1] - t[b0]))
        audio *= 0.7 / max(1e-6, float(np.max(np.abs(audio))))
        fade = int(0.5 * SAMPLE_RATE)
        audio[-fade:] *= np.linspace(1, 0, fade)

        ctx.progress(0.9, "encoding", "កំពុងរក្សាទុកឯកសារ WAV")
        out = ctx.workdir / "engine_out.wav"
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
        stereo = np.repeat(pcm[:, None], 2, axis=1)
        with wave.open(str(out), "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(stereo.tobytes())
        notes = ["របៀបសាកល្បងមិនប្រើទំនុក និងគ្មានសំឡេងច្រៀង — មិនមែនលទ្ធផល AI"]
        return GenerationResult(
            path=out,
            seed=seed,
            engine_meta={"engine": "selftest", "synth": "numpy chords+beat"},
            sent={"duration": duration, "bpm": bpm, "key_scale": req.key_scale or "A minor", "seed": seed, "lyrics_ignored": True},
            notes=notes,
        )
