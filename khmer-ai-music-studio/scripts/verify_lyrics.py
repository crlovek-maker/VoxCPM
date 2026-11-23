#!/usr/bin/env python3
"""Indicative check: what does an ASR model hear in a generated WAV compared with the lyrics?

    pip install faster-whisper
    python scripts/verify_lyrics.py data/check_engine/<run>/chorus.wav --lyrics samples/khmer_chorus_4lines.txt --model small --lang km

NOT a proof. Khmer ASR is weak and sung vocals are hard; ALWAYS have a Khmer speaker listen as well.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from khmer_studio import verify  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav")
    ap.add_argument("--lyrics", required=True, help="text file, one lyric line per row")
    ap.add_argument("--model", default="small", help="tiny | base | small | medium | large-v3")
    ap.add_argument("--lang", default="km", help="language hint for the ASR (km = Khmer, or 'auto' for none)")
    args = ap.parse_args()
    lines = [ln.strip() for ln in Path(args.lyrics).read_text(encoding="utf-8").splitlines() if ln.strip()]
    try:
        r = verify.compare(Path(args.wav), lines, args.model, None if args.lang == "auto" else args.lang)
    except RuntimeError as exc:
        print(f"✗ {exc}")
        return 2
    print(f"ASR model      : faster-whisper {r['model']}  (language={r['language']}, p={r['language_probability']})")
    print(f"Original lyrics: {r['target']}")
    print(f"ASR heard      : {r['text'] or '(nothing)'}")
    print(f"Character error: {r['cer']:.0%}   (0% identical; >100% possible. Indicator only!)")
    for s in r["segments"]:
        print(f"   [{s['start']:6.2f}-{s['end']:6.2f}] {s['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
