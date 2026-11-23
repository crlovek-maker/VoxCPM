#!/usr/bin/env python3
"""Test the REAL music model connection end to end, outside the web UI.

  python scripts/check_engine.py                       # ACE-Step, 4-line Khmer chorus -> WAV
  python scripts/check_engine.py --engine selftest     # pipeline check without any AI model
  python scripts/check_engine.py --lyrics-file my.txt --duration 30 --style ballad --instruments khloy,guitar
  python scripts/check_engine.py --asr small           # also try an automatic (indicative!) lyric check

It prints what really happened and writes the WAV plus a JSON record to data/check_engine/ so you
can listen to it. Exit code 0 only if a non-empty audio file was produced.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from khmer_studio import audio as audio_tools  # noqa: E402
from khmer_studio.config import FONTS_DIR, Settings  # noqa: E402
from khmer_studio.engines import build_engines  # noqa: E402
from khmer_studio.engines.base import EngineContext, GenerationRequest  # noqa: E402
from khmer_studio.errors import StudioError  # noqa: E402
from khmer_studio.lyrics import build_engine_lyrics, new_section, suggest_duration  # noqa: E402
from khmer_studio.presets import compose_caption  # noqa: E402


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def normalize_for_cer(text: str) -> str:
    return "".join(ch for ch in text if ch.isalnum() or "ក" <= ch <= "៿")


def run_asr(wav: Path, lyrics_lines, model_size: str, language: str) -> None:
    print("\n--- ការពិនិត្យស្វ័យប្រវត្តិ (ASR) — បង្ហាញសូចនាករប៉ុណ្ណោះ មិនអាចជំនួសការស្ដាប់ដោយត្រចៀកបានទេ ---")
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        print("មិនទាន់ដំឡើង faster-whisper  →  pip install faster-whisper")
        return
    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, info = model.transcribe(str(wav), language=language, beam_size=5)
    heard = " ".join(seg.text.strip() for seg in segments).strip()
    target = " ".join(lyrics_lines)
    a, b = normalize_for_cer(heard), normalize_for_cer(target)
    cer = levenshtein(a, b) / max(1, len(b))
    print(f"ទំនុកដើម   : {target}")
    print(f"ASR ស្ដាប់ឃើញ: {heard or '(ទទេ)'}")
    print(f"CER ប្រហែល : {cer:.0%}  (0% = ដូចគ្នាទាំងស្រុង; Whisper ស្ដាប់ភាសាខ្មែរ និងសំឡេងច្រៀងមិនសូវត្រឹមត្រូវ)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", help="acestep | heartmula | selftest (default: STUDIO_ENGINE or acestep)")
    ap.add_argument("--lyrics-file", default=str(ROOT / "samples" / "khmer_chorus_4lines.txt"))
    ap.add_argument("--duration", type=float, help="seconds (default: suggested from line count)")
    ap.add_argument("--style", default="ballad", help="style preset id: kantrum,ballad,rap,rock,pop,ramvong")
    ap.add_argument("--instruments", default="khloy,guitar", help="comma list of instrument preset ids")
    ap.add_argument("--language", default="unknown", help="vocal language code sent to the model (unknown = auto)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--instrumental", action="store_true")
    ap.add_argument("--asr", metavar="MODEL", help="optional faster-whisper model size (tiny/small/medium/large-v3)")
    args = ap.parse_args()

    s = Settings.from_env()
    engines = build_engines(s)
    engine_id = args.engine or s.default_engine
    if engine_id not in engines:
        print(f"✗ មិនមាន engine «{engine_id}» (មាន: {', '.join(engines)})")
        return 2
    engine = engines[engine_id]
    info = engine.info()

    print("=== ការត្រួតពិនិត្យបរិស្ថាន ===")
    print(f"FFmpeg  : {'✓' if audio_tools.tool_available(s.ffmpeg) else '✗ មិនមាន'}  ({s.ffmpeg})")
    fonts = sorted(p.name for p in FONTS_DIR.glob('*.ttf'))
    print(f"ពុម្ពអក្សរខ្មែរ: {'✓ ' + ', '.join(fonts) if fonts else '✗ មិនមានក្នុង khmer_studio/fonts'}")
    print(f"Engine  : {info.name}  [{'AI' if info.is_ai else 'មិនមែន AI'}]")
    print(f"អាជ្ញាបណ្ណ: {info.license_name}  ·  ភាសាខ្មែរ: {info.khmer_status}")
    health = engine.health()
    print(f"ស្ថានភាព : {'✓' if health.ok else '✗'} {health.message}")
    if not health.ok:
        print("   ដំណោះស្រាយ៖ ចាប់ផ្ដើម server ម៉ូដែលជាមុន (មើល README) ហើយសាកល្បងម្ដងទៀត")
        return 3

    lines = [ln.strip() for ln in Path(args.lyrics_file).read_text(encoding="utf-8").splitlines() if ln.strip()]
    section = new_section("chorus", lines)
    duration = args.duration or suggest_duration(len(lines), "chorus_test")
    caption = compose_caption({"styles": [args.style], "instruments": [x for x in args.instruments.split(",") if x]}, instrumental=args.instrumental)
    req = GenerationRequest(
        lyrics=build_engine_lyrics([section]),
        caption=caption,
        instrumental=args.instrumental,
        vocal_language=args.language,
        duration=duration,
        seed=args.seed,
        purpose="chorus_test",
    )
    print("\n=== ការស្នើសុំ ===")
    print(f"caption : {caption}")
    print(f"lyrics  :\n{req.lyrics}")
    print(f"duration: {duration}s  seed: {args.seed}  language: {args.language}")

    out_dir = s.data_dir / "check_engine" / time.strftime("%Y%m%d_%H%M%S")
    t0 = time.time()

    def on_progress(frac, stage, msg):
        pct = f" {int(frac * 100):3d}%" if frac is not None else "     "
        print(f"[{time.time() - t0:6.1f}s]{pct} {stage:<14} {msg or ''}", flush=True)

    ctx = EngineContext(out_dir / "work", progress_cb=on_progress, log_cb=lambda t: print(f"          · {t}", flush=True))
    print("\n=== កំពុងបង្កើត ===")
    try:
        result = engine.generate(req, ctx)
    except StudioError as exc:
        print(f"\n✗ បរាជ័យ [{exc.code}] {exc.message}")
        if exc.detail:
            print(f"   លម្អិត: {exc.detail[:600]}")
        if exc.hint:
            print(f"   ជំនួយ : {exc.hint}")
        return 4

    wav = out_dir / "chorus.wav"
    audio_tools.to_wav(s.ffmpeg, result.path, wav)
    meta = audio_tools.probe(s.ffprobe, wav)
    stats = audio_tools.analyze(s.ffmpeg, wav, meta["duration"])
    record = {
        "engine": info.id, "engine_name": info.name, "is_ai": info.is_ai, "elapsed_seconds": round(time.time() - t0, 1),
        "audio": meta, "analysis": stats, "request_sent": result.sent, "engine_meta": result.engine_meta, "notes": result.notes,
    }
    (out_dir / "record.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== លទ្ធផល ===")
    print(f"✓ ឯកសារសំឡេង: {wav}")
    print(f"  រយៈពេល {meta['duration']}s · {meta['sample_rate']} Hz · {meta['channels']} ch · ប្រើពេលបង្កើត {record['elapsed_seconds']}s")
    print(f"  កម្រិតសំឡេងមធ្យម {stats['mean_db']} dB · កំពូល {stats['peak_db']} dB · ស្ងាត់ដើម {stats['leading_silence']}s / ចុង {stats['trailing_silence']}s")
    for n in result.notes:
        print(f"  ចំណាំ: {n}")
    if meta["duration"] < 1 or (stats["mean_db"] is not None and stats["mean_db"] < -55):
        print("✗ សំឡេងស្ទើរតែស្ងាត់ទាំងស្រុង — មានបញ្ហា")
        return 5
    if info.is_ai:
        print("\nវិធីផ្ទៀងផ្ទាត់ថាពាក្យច្រៀងត្រូវនឹងទំនុក៖")
        print("  1) ស្ដាប់ឯកសារ WAV ខាងលើជាមួយទំនុកដែលបានបោះពុម្ពនៅលើ (ឱ្យអ្នកចេះភាសាខ្មែរស្ដាប់ជាមួយ)")
        print("  2) ក្នុងកម្មវិធី: ផ្ទាំង «MV ខារ៉ាអូខេ» ចុចកំណត់ពេលឃ្លាម្ដងមួយបន្ទាត់ពេលស្ដាប់ — បើពាក្យច្រៀងមិនត្រូវនឹងទំនុក អ្នកនឹងដឹងភ្លាម")
        print("  3) បើមិនច្បាស់ ប្តូរ --language km/unknown, seed, ឬសាកល្បងម៉ូដែល HeartMuLa; ឬប្រើសំឡេងខ្លួនឯងលាយជាមួយភ្លេងសុទ្ធ")
        if args.asr:
            run_asr(wav, lines, args.asr, "km")
    else:
        print("\n(នេះជារបៀបសាកល្បងប្រព័ន្ធ មិនមែនសំឡេង AI ពិតទេ។)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
