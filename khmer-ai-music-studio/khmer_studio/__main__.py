"""Command line launcher:  python -m khmer_studio [--lan] [--port 8000]"""
from __future__ import annotations

import argparse
import secrets
import socket
import sys
from pathlib import Path
from typing import List, Optional

from . import APP_NAME, __version__
from . import audio as audio_tools
from .config import FONTS_DIR, Settings


def lan_ips() -> List[str]:
    ips = set()
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 1))  # no packet is sent; just selects the outgoing interface
        ips.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


def print_qr(url: str) -> None:
    try:
        import qrcode  # type: ignore

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except Exception:  # optional nicety only
        print("   (ដំឡើង «pip install qrcode» ដើម្បីបង្ហាញ QR code សម្រាប់ស្កេនពីទូរសព្ទ)")


def main(argv: Optional[List[str]] = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Khmer text on Windows consoles
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(prog="khmer_studio", description=APP_NAME)
    ap.add_argument("--host", help="ឧ. 127.0.0.1 (តែកុំព្យូទ័រនេះ) ឬ 0.0.0.0 (ឱ្យទូរសព្ទក្នុង Wi-Fi ដូចគ្នាចូលបាន)")
    ap.add_argument("--port", type=int)
    ap.add_argument("--lan", action="store_true", help="ស្ដាប់លើបណ្ដាញទាំងអស់ (សម្រាប់ iPhone) + បង្កើតលេខកូដចូលស្វ័យប្រវត្តិ")
    ap.add_argument("--token", help="លេខកូដចូល (ជំនួស STUDIO_TOKEN)")
    ap.add_argument("--data-dir", help="ថតរក្សាទុកគម្រោង")
    ap.add_argument("--ssl-certfile", help="ឯកសារ cert សម្រាប់ HTTPS (ត្រូវការសម្រាប់ថតសំឡេងពី iPhone ដោយផ្ទាល់)")
    ap.add_argument("--ssl-keyfile")
    args = ap.parse_args(argv)

    s = Settings.from_env()
    if args.data_dir:
        s.data_dir = Path(args.data_dir).expanduser().resolve()
    if args.port:
        s.port = args.port
    if args.host:
        s.host = args.host
    if args.token:
        s.token = args.token
    generated_token = False
    if args.lan:
        s.host = "0.0.0.0"
        if not s.token:
            s.token = secrets.token_urlsafe(9)
            generated_token = True

    https = bool(args.ssl_certfile and args.ssl_keyfile)
    scheme = "https" if https else "http"
    from .main import create_app  # imported late so --help is instant

    print(f"\n=== {APP_NAME} v{__version__} ===")
    print(f"ទិន្នន័យ    : {s.data_dir}")
    print(f"FFmpeg      : {'✓' if audio_tools.tool_available(s.ffmpeg) else '✗ រកមិនឃើញ (ត្រូវដំឡើង)'}")
    print(f"ពុម្ពអក្សរខ្មែរ : {'✓' if list(FONTS_DIR.glob('*.ttf')) else '✗ បាត់ក្នុង khmer_studio/fonts'}")
    print(f"ម៉ូដែលចម្រៀង  : ACE-Step API → {s.acestep_url}  (ត្រូវតែបើក server ម៉ូដែលដាច់ដោយឡែក)")
    print(f"ម៉ូដែលអត្ថបទ  : {s.llm_model or 'មិនទាន់កំណត់ (ជម្រើស)'}")
    print("\nបើកក្នុង browser៖")
    print(f"  កុំព្យូទ័រនេះ  → {scheme}://127.0.0.1:{s.port}/")
    if s.host not in ("127.0.0.1", "localhost"):
        for ip in lan_ips():
            url = f"{scheme}://{ip}:{s.port}/" + (f"?token={s.token}" if s.token else "")
            print(f"  ទូរសព្ទ/Wi-Fi → {url}")
        if lan_ips():
            print_qr(f"{scheme}://{lan_ips()[0]}:{s.port}/" + (f"?token={s.token}" if s.token else ""))
        if s.token:
            print(f"\nលេខកូដចូល (token): {s.token}" + ("   ← បង្កើតស្វ័យប្រវត្តិ; កំណត់ STUDIO_TOKEN ដើម្បីរក្សាដដែល" if generated_token else ""))
        if not https:
            print("ចំណាំ: ការថតសំឡេងពី iPhone ត្រូវការ HTTPS — មើល README (Tailscale / --ssl-certfile)។ ការ upload ឯកសារសំឡេងនៅតែប្រើបាន។")
    else:
        print("  (ទូរសព្ទចូលមិនបានទេ ព្រោះកំពុងស្ដាប់តែលើកុំព្យូទ័រនេះ — ប្រើ --lan ដើម្បីបើកឱ្យទូរសព្ទ)")
    print("\nចុច Ctrl+C ដើម្បីបិទ\n", flush=True)

    import uvicorn

    uvicorn.run(create_app(s), host=s.host, port=s.port, log_level="info", ssl_certfile=args.ssl_certfile, ssl_keyfile=args.ssl_keyfile)
    return 0


if __name__ == "__main__":
    sys.exit(main())
