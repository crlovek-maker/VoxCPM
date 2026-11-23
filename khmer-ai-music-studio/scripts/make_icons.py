#!/usr/bin/env python3
"""Regenerate the app icons (needs Pillow):  python scripts/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / "khmer_studio" / "web" / "icons"


def draw(size: int) -> Image.Image:
    s = size
    img = Image.new("RGB", (s, s), (15, 18, 38))
    px = ImageDraw.Draw(img)
    for y in range(s):  # indigo -> violet gradient
        f = y / (s - 1)
        px.line([(0, y), (s, y)], fill=(int(15 + 45 * f), int(18 + 14 * f), int(38 + 80 * f)))
    glow = Image.new("RGB", (s, s), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = int(s * 0.34)
    gd.ellipse([s / 2 - r, s * 0.42 - r, s / 2 + r, s * 0.42 + r], fill=(245, 192, 74))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.09))
    img = Image.blend(img, Image.composite(glow, img, glow.convert("L")), 0.7)
    d = ImageDraw.Draw(img)
    gold = (255, 213, 74)
    # music note
    hx, hy, hr = s * 0.40, s * 0.66, s * 0.10  # note head
    d.ellipse([hx - hr * 1.15, hy - hr * 0.85, hx + hr * 1.15, hy + hr * 0.85], fill=gold)
    sx = hx + hr * 1.0
    d.rectangle([sx - s * 0.018, s * 0.26, sx + s * 0.018, hy], fill=gold)
    d.polygon([(sx + s * 0.018, s * 0.26), (s * 0.74, s * 0.34), (s * 0.74, s * 0.46), (sx + s * 0.018, s * 0.38)], fill=gold)
    return img


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        draw(size * 2).resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, "PNG", optimize=True)
        print("wrote", OUT / name)
