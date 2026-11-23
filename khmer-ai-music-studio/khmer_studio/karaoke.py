"""Karaoke MV: build an ASS subtitle script and let FFmpeg (libass + HarfBuzz) burn it in.

Why ASS/libass: Khmer needs real OpenType shaping (subscript consonants via coeng, pre-base vowels).
libass shapes with HarfBuzz and the bundled Noto Sans Khmer font has the `khmr` GSUB features, so
the text in the MP4 is rendered correctly. Text widths are measured with Pillow+Raqm (the same
shaping engine) so long lines wrap at spaces instead of running off screen.

Layout: previous line (dim) / CURRENT line (highlighted) / next line (dim), re-timed per line.
"""
from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, features

from . import audio as audio_tools
from .config import FONTS_DIR
from .errors import StudioError

RESOLUTIONS: Dict[str, Tuple[int, int]] = {
    "1920x1080": (1920, 1080),  # YouTube (landscape)
    "1080x1920": (1080, 1920),  # YouTube Shorts / TikTok / Reels (portrait)
    "1280x720": (1280, 720),  # faster draft
}

FONT_FILES = {
    ("Noto Sans Khmer", False): "NotoSansKhmer-Regular.ttf",
    ("Noto Sans Khmer", True): "NotoSansKhmer-Bold.ttf",
    ("Hanuman", False): "Hanuman-Regular.ttf",
    ("Hanuman", True): "Hanuman-Bold.ttf",
    ("Moul", False): "Moul-Regular.ttf",
    ("Moul", True): "Moul-Regular.ttf",
}
FONT_FAMILIES = ["Noto Sans Khmer", "Hanuman", "Moul"]

DEFAULT_STYLE: Dict[str, Any] = {
    "font": "Noto Sans Khmer",
    "size": 84,  # px at 1080 short side
    "color": "#FFD54A",  # highlighted (current) line
    "dim": "#FFFFFF",  # context lines
    "show_title": True,
    "dim_background": 0.28,  # 0..0.8 darkening so text stays readable on any picture
    "text_box": False,  # translucent dark box behind each line (best legibility on bright pictures)
    "progress_bar": True,
    "max_hold": 9.0,  # seconds a line stays highlighted at most
    "trim_silence": True,  # cut a silent tail (>2.5 s) off the end of the video
}


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------
def hex_to_ass(color: str, opacity: float = 1.0) -> str:
    """'#RRGGBB' + opacity(0..1) -> ASS '&HAABBGGRR' (alpha is inverted in ASS)."""
    c = (color or "#FFFFFF").lstrip("#")
    if len(c) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", c):
        c = "FFFFFF"
    r, g, b = c[0:2], c[2:4], c[4:6]
    alpha = int(round((1.0 - max(0.0, min(1.0, opacity))) * 255))
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def ass_escape(text: str) -> str:
    text = (text or "").replace("\\", "/").replace("{", "(").replace("}", ")").replace("\r", "")
    return text.replace("\n", "\\N")


def font_path(family: str, bold: bool = True) -> Path:
    name = FONT_FILES.get((family, bold)) or FONT_FILES[("Noto Sans Khmer", bold)]
    return FONTS_DIR / name


_HAS_RAQM: Optional[bool] = None


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    global _HAS_RAQM
    if _HAS_RAQM is None:
        _HAS_RAQM = bool(features.check("raqm"))
    engine = ImageFont.Layout.RAQM if _HAS_RAQM else ImageFont.Layout.BASIC
    return ImageFont.truetype(str(path), size, layout_engine=engine)


def measure(text: str, path: Path, size: int) -> float:
    """Pixel width of `text`. With Raqm this equals what libass draws; without it we use a safe estimate."""
    width = _font(path, size).getlength(text)
    return width if _HAS_RAQM else width * 0.9  # BASIC layout over-estimates Khmer by ~20% (no subscript shaping)


def _greedy_rows(widths: List[float], space: float, limit: float) -> List[List[int]]:
    rows: List[List[int]] = []
    cur: List[int] = []
    cur_w = 0.0
    for i, w in enumerate(widths):
        add = w if not cur else space + w
        if cur and cur_w + add > limit:
            rows.append(cur)
            cur, cur_w = [i], w
        else:
            cur.append(i)
            cur_w += add
    if cur:
        rows.append(cur)
    return rows


def wrap_text(text: str, path: Path, size: int, max_width: float) -> Tuple[List[str], float]:
    """Return (rows, scale). Break only at spaces (Khmer has no spaces inside phrases).

    1) greedy fill gives the minimum number of rows; 2) a binary search on the row limit then balances
    the rows so the last one is not a stub. A single word wider than the screen cannot be broken, so
    the font is scaled down (scale < 1, never below 0.55) instead of running off the picture.
    """
    text = " ".join(text.split())
    if not text:
        return [""], 1.0
    if measure(text, path, size) <= max_width:
        return [text], 1.0
    words = text.split(" ")
    widths = [measure(w, path, size) for w in words]
    space = max(measure("ក ក", path, size) - 2 * measure("ក", path, size), size * 0.2)
    rows = _greedy_rows(widths, space, max_width)
    lo, hi = max(widths), max_width
    for _ in range(14):  # binary search: smallest limit that still gives the same number of rows
        mid = (lo + hi) / 2
        if len(_greedy_rows(widths, space, mid)) <= len(rows):
            hi = mid
        else:
            lo = mid
    rows = _greedy_rows(widths, space, hi)
    out = [" ".join(words[i] for i in r) for r in rows]
    widest = max(sum(widths[i] for i in r) + space * (len(r) - 1) for r in rows)
    scale = 1.0 if widest <= max_width * 1.001 else max(0.55, max_width / widest)
    return out, scale


@dataclass
class Layout:
    width: int
    height: int
    base: int  # current-line font size in px
    max_w: float


def make_layout(width: int, height: int, style: Dict[str, Any]) -> Layout:
    short = min(width, height)
    base = int(round(style.get("size", 64) * short / 1080 * (1.0 if width >= height else 1.0)))
    base = max(24, min(160, base))
    return Layout(width, height, base, width * (0.86 if width >= height else 0.9))


# ---------------------------------------------------------------------------------------------
# ASS script
# ---------------------------------------------------------------------------------------------
def build_ass(
    lines: Sequence[Dict[str, Any]],
    *,
    width: int,
    height: int,
    duration: float,
    style: Optional[Dict[str, Any]] = None,
    title: str = "",
    artist: str = "",
) -> str:
    st = dict(DEFAULT_STYLE)
    st.update({k: v for k, v in (style or {}).items() if v is not None})
    family = st["font"] if st["font"] in FONT_FAMILIES else "Noto Sans Khmer"
    fpath = font_path(family, True)
    lay = make_layout(width, height, st)
    row_h = lay.base * 1.62  # Khmer stacks vowels/subscripts above and below: needs generous row height
    gap = lay.base * 0.55
    dim_size = int(lay.base * 0.7)
    cur_c, dim_c = hex_to_ass(st["color"]), hex_to_ass(st["dim"], 0.62)
    outline = max(3, int(lay.base * 0.09))
    if st.get("text_box"):  # BorderStyle 3 = opaque box drawn with the outline colour (alpha makes it translucent)
        bstyle, cur_out, dim_out, shadow, out_col = 3, max(8, int(lay.base * 0.2)), max(6, int(dim_size * 0.18)), 0, "&H99000000"
    else:
        bstyle, cur_out, dim_out, shadow, out_col = 1, outline, max(2, outline - 1), 2, "&H00000000"

    timed = sorted((ln for ln in lines if ln.get("start") is not None and str(ln.get("text", "")).strip()), key=lambda x: float(x["start"]))
    header = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: None\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Cur,{family},{lay.base},{cur_c},&H000000FF,{out_col},&H80000000,-1,0,0,0,100,100,0,0,{bstyle},{cur_out},{shadow},8,20,20,20,1\n"
        f"Style: Dim,{family},{dim_size},{dim_c},&H000000FF,{out_col},&H80000000,-1,0,0,0,100,100,0,0,{bstyle},{dim_out},{min(shadow, 1)},8,20,20,20,1\n"
        f"Style: Title,{family},{int(lay.base * 1.25)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline},2,8,20,20,20,1\n"
        f"Style: Tag,{family},{int(lay.base * 0.5)},&H99FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,1,40,20,{int(height * 0.035)},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events: List[str] = []

    def block(text: str, size: int) -> Tuple[str, float, int]:
        rows, scale = wrap_text(text, fpath, size, lay.max_w)
        eff = int(size * scale)
        return "\\N".join(ass_escape(r) for r in rows), len(rows) * eff * 1.62, eff

    def add(start: float, end: float, style_name: str, text: str, x: float, y_top: float, fsize: int, extra: str = "") -> None:
        if end - start <= 0.01:
            return
        tags = f"{{\\an8\\pos({x:.0f},{y_top:.0f})\\fs{fsize}{extra}}}"
        events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},{style_name},,0,0,0,,{tags}{text}")

    cx = width / 2
    center_y = height * (0.52 if width >= height else 0.5)
    max_hold = float(st.get("max_hold", 9.0))

    if timed and st["show_title"] and (title or artist) and timed[0]["start"] > 2.0:
        text = ass_escape(title) + (f"\\N{{\\fs{int(lay.base * 0.8)}}}{ass_escape(artist)}" if artist else "")
        add(0.0, float(timed[0]["start"]) - 0.2, "Title", text, cx, height * 0.36, int(lay.base * 1.25), "\\fad(300,300)")

    for i, ln in enumerate(timed):
        s = float(ln["start"])
        nxt = float(timed[i + 1]["start"]) if i + 1 < len(timed) else duration
        e = min(nxt, s + max_hold, duration)
        text_c, h_c, size_c = block(ln["text"], lay.base)
        top_c = center_y - h_c / 2
        add(s, e, "Cur", text_c, cx, top_c, size_c, "\\fad(120,80)")
        if i > 0:
            text_p, h_p, size_p = block(timed[i - 1]["text"], dim_size)
            add(s, e, "Dim", text_p, cx, top_c - gap - h_p, size_p)
        if i + 1 < len(timed):
            text_n, _h_n, size_n = block(timed[i + 1]["text"], dim_size)
            add(s, e, "Dim", text_n, cx, top_c + h_c + gap, size_n)

    if st["show_title"] and (title or artist) and timed:
        tag = ass_escape(title) + (f" — {ass_escape(artist)}" if artist else "")
        events.append(f"Dialogue: 1,{ass_time(0)},{ass_time(duration)},Tag,,0,0,0,,{{\\an1}}{tag}")
    return header + "\n".join(events) + "\n"


# ---------------------------------------------------------------------------------------------
# background
# ---------------------------------------------------------------------------------------------

def _default_background(width: int, height: int) -> Image.Image:
    """Built-in 'temple sunrise' gradient used when no cover picture is chosen."""
    stops = [(0.0, (10, 18, 82)), (0.5, (74, 30, 128)), (1.0, (176, 56, 72))]
    img = Image.new("RGB", (width, height))
    px = ImageDraw.Draw(img)
    for y in range(height):
        f = y / max(1, height - 1)
        for (f0, c0), (f1, c1) in zip(stops, stops[1:]):
            if f0 <= f <= f1:
                t = (f - f0) / (f1 - f0)
                px.line([(0, y), (width, y)], fill=tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)))
                break
    # Soft golden "sunrise" glow. Pillow's radial_gradient is 0 at the centre and ~180 at the middle of
    # each edge (255 only in the corners), so subtract from 175 to make the glow fade to nothing
    # before it reaches the square's border (otherwise a visible rectangle appears).
    size = int(min(width, height) * 1.6)
    grad = Image.radial_gradient("L").resize((size, size), Image.Resampling.BICUBIC)
    mask = grad.point(lambda v: int(max(0, 175 - v) * 0.8))
    glow = Image.new("RGB", (size, size), (255, 176, 72))
    img.paste(glow, (int(width / 2 - size / 2), int(height * 0.2 - size / 2)), mask)
    return img


def make_background(src: Optional[Path], width: int, height: int, dst: Path) -> None:
    """Exactly width x height RGB PNG: your picture cover-cropped, or a built-in gradient."""
    if src and src.is_file():
        img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        img = ImageOps.fit(img, (width, height), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    else:
        img = _default_background(width, height)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "PNG")


# ---------------------------------------------------------------------------------------------
# FFmpeg
# ---------------------------------------------------------------------------------------------
def ffmpeg_has_ass(ffmpeg: str) -> bool:
    res = audio_tools.run([ffmpeg, "-hide_banner", "-filters"], timeout=30)
    return " ass " in (res.stdout or "")


def _video_filter(style: Dict[str, Any], duration: float, height: int, offset: float = 0.0, has_picture: bool = True) -> str:
    parts = ["format=yuv420p"]
    dim = float(style.get("dim_background", DEFAULT_STYLE["dim_background"]))
    if not has_picture:
        dim = min(dim, 0.12)  # the built-in gradient is already dark enough
    if dim > 0:
        parts.append(f"drawbox=x=0:y=0:w=iw:h=ih:color=black@{dim:.2f}:t=fill")
    if offset:
        parts.append(f"setpts=PTS+{offset:.3f}/TB")
    parts.append("ass=lyrics.ass:fontsdir=fonts")
    if style.get("progress_bar", True) and not offset:
        bar_h = max(4, int(height * 0.006))
        parts.append(f"drawbox=x=0:y=ih-{bar_h}:w='iw*t/{max(duration, 0.1):.3f}':h={bar_h}:color=white@0.85:t=fill")
    return ",".join(parts)


def _prepare_workdir(workdir: Path, lines, *, width, height, duration, style, title, artist, background: Optional[Path]) -> None:
    workdir.mkdir(parents=True, exist_ok=True)
    fonts_dst = workdir / "fonts"
    fonts_dst.mkdir(exist_ok=True)
    for f in FONTS_DIR.glob("*.ttf"):
        shutil.copy2(f, fonts_dst / f.name)
    (workdir / "lyrics.ass").write_text(
        build_ass(lines, width=width, height=height, duration=duration, style=style, title=title, artist=artist), encoding="utf-8"
    )
    make_background(background, width, height, workdir / "bg.png")


def validate_lines(lines: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    clean = [ln for ln in lines if str(ln.get("text", "")).strip()]
    if not clean:
        raise StudioError("mv_no_lines", "មិនមានទំនុកសម្រាប់ MV ទេ — សូមបញ្ចូលទំនុកជាមុន", status=422)
    missing = [i + 1 for i, ln in enumerate(clean) if ln.get("start") is None]
    if missing:
        shown = ", ".join(str(i) for i in missing[:8]) + ("…" if len(missing) > 8 else "")
        raise StudioError("mv_missing_times", f"នៅមានឃ្លា {len(missing)} ដែលមិនទាន់កំណត់ពេល (ឃ្លាទី {shown})", status=422)
    return clean


def render_frame(
    ffmpeg: str,
    workdir: Path,
    out_png: Path,
    lines: Sequence[Dict[str, Any]],
    *,
    resolution: str,
    at: float,
    duration: float,
    style: Optional[Dict[str, Any]] = None,
    title: str = "",
    artist: str = "",
    background: Optional[Path] = None,
) -> None:
    """One real frame (same libass renderer as the MP4) for the 'preview' button."""
    width, height = RESOLUTIONS[resolution]
    st = dict(DEFAULT_STYLE)
    st.update({k: v for k, v in (style or {}).items() if v is not None})
    _prepare_workdir(workdir, lines, width=width, height=height, duration=duration, style=st, title=title, artist=artist, background=background)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "0.2", "-i", "bg.png",
        "-vf", _video_filter(st, duration, height, offset=max(0.0, at), has_picture=bool(background and background.is_file())), "-frames:v", "1", str(out_png.resolve()),
    ]
    res = audio_tools.run(cmd, timeout=120, cwd=workdir)
    if res.returncode != 0 or not out_png.is_file():
        raise StudioError("ffmpeg_failed", "FFmpeg បង្កើតស៊ុមមើលជាមុនមិនបាន", detail=(res.stderr or "")[-700:], status=500)


def render_mv(
    ffmpeg: str,
    audio_path: Path,
    out_mp4: Path,
    lines: Sequence[Dict[str, Any]],
    *,
    resolution: str,
    duration: float,
    workdir: Path,
    style: Optional[Dict[str, Any]] = None,
    title: str = "",
    artist: str = "",
    background: Optional[Path] = None,
    progress: Optional[Callable[[Optional[float], str, Optional[str]], None]] = None,
    log: Optional[Callable[[str], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    fps: int = 30,
) -> None:
    if resolution not in RESOLUTIONS:
        raise StudioError("invalid_request", "ទំហំវីដេអូមិនត្រឹមត្រូវ", status=422)
    if not ffmpeg_has_ass(ffmpeg):
        raise StudioError(
            "ffmpeg_no_ass", "FFmpeg របស់អ្នកមិនមាន libass (filter «ass») ទេ — មិនអាចបង្ហាញអក្សរខ្មែរបាន",
            hint="ដំឡើង FFmpeg កំណែពេញ (Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg)", status=500,
        )
    clean = validate_lines(lines)
    width, height = RESOLUTIONS[resolution]
    st = dict(DEFAULT_STYLE)
    st.update({k: v for k, v in (style or {}).items() if v is not None})
    if progress:
        progress(0.02, "rendering", "កំពុងរៀបចំអក្សរ និងផ្ទៃខាងក្រោយ")
    _prepare_workdir(workdir, clean, width=width, height=height, duration=duration, style=st, title=title, artist=artist, background=background)
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = workdir / "out.mp4"
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-nostats", "-progress", "pipe:1",
        "-loop", "1", "-framerate", str(fps), "-i", "bg.png",
        "-i", str(audio_path.resolve()),
        "-vf", _video_filter(st, duration, height, has_picture=bool(background and background.is_file())),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "21", "-pix_fmt", "yuv420p", "-r", str(fps),
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
        "-t", f"{duration:.3f}", "out.mp4",
    ]
    out_time = re.compile(r"out_time_us=(\d+)")

    def on_out(line: str) -> None:
        m = out_time.search(line)
        if m and progress:
            frac = min(0.99, int(m.group(1)) / 1_000_000 / max(duration, 0.1))
            progress(0.05 + 0.93 * frac, "rendering", f"កំពុងបង្កើតវីដេអូ MP4 {int(frac * 100)}%")

    res = audio_tools.run(cmd, timeout=3 * 3600, cancel_check=cancel_check, on_stdout_line=on_out, cwd=workdir)
    if res.returncode != 0 or not tmp_out.is_file():
        raise StudioError("ffmpeg_failed", "FFmpeg បង្កើត MP4 មិនបាន", detail=(res.stderr or "")[-900:], status=500)
    shutil.move(str(tmp_out), str(out_mp4))
    if log:
        log(f"MP4 {out_mp4.stat().st_size // 1024} KB, {width}x{height}")
