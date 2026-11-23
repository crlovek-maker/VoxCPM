import re

import pytest

from conftest import KHMER_4_LINES, needs_ffmpeg
from khmer_studio import karaoke
from khmer_studio.errors import StudioError


def timed(n=4, step=2.0, start=1.0):
    return [{"text": KHMER_4_LINES[i % 4], "start": start + i * step} for i in range(n)]


def test_hex_and_time_formats():
    assert karaoke.hex_to_ass("#FFD54A") == "&H004AD5FF"  # ASS order is &HAABBGGRR: B=4A G=D5 R=FF
    assert karaoke.hex_to_ass("#FFFFFF", 0.5) == "&H80FFFFFF"
    assert karaoke.hex_to_ass("bad") == "&H00FFFFFF"
    assert karaoke.ass_time(0) == "0:00:00.00" and karaoke.ass_time(3661.5) == "1:01:01.50"


def test_ass_contains_khmer_timings_and_safe_escaping():
    lines = [{"text": "ក{ខ}\\គ", "start": 1.0}, {"text": KHMER_4_LINES[1], "start": 5.0}]
    ass = karaoke.build_ass(lines, width=1920, height=1080, duration=12.0, title="ចំណងជើង", artist="សិល្បករ")
    assert "PlayResX: 1920" in ass and "PlayResY: 1080" in ass and "WrapStyle: 2" in ass
    assert "Style: Cur,Noto Sans Khmer," in ass
    assert KHMER_4_LINES[1] in ass
    # override-tag characters from lyrics must not reach libass raw
    body = [ln for ln in ass.splitlines() if ln.startswith("Dialogue") and "Cur," in ln][0]
    assert "ក(ខ)/គ" in body and "ក{ខ}" not in body
    cur = [ln for ln in ass.splitlines() if ln.startswith("Dialogue") and ",Cur," in ln]
    assert cur[0].split(",")[1] == "0:00:01.00" and cur[0].split(",")[2] == "0:00:05.00"  # line 1 shown until line 2 starts
    assert cur[1].split(",")[1] == "0:00:05.00" and cur[1].split(",")[2] == "0:00:12.00"  # last line: until the song ends (5+9=14 > 12)
    # no title card when the first line starts within 2 s; with a longer intro the title is shown first
    assert not any(",Title," in ln for ln in ass.splitlines())
    late = karaoke.build_ass([{"text": "ក", "start": 6.0}], width=1920, height=1080, duration=12.0, title="ចំណងជើង", artist="សិល្បករ")
    card = [ln for ln in late.splitlines() if ",Title," in ln]
    assert len(card) == 1 and card[0].split(",")[1] == "0:00:00.00" and card[0].split(",")[2] == "0:00:05.80"


def test_highlight_hold_is_capped_during_long_gaps():
    ass = karaoke.build_ass([{"text": "ក", "start": 1.0}, {"text": "ខ", "start": 60.0}], width=1920, height=1080, duration=70.0)
    first = [ln for ln in ass.splitlines() if ",Cur," in ln][0]
    assert first.split(",")[2] == "0:00:10.00"  # 1.0 + max_hold(9)


def test_untimed_lines_are_ignored_in_ass_but_rejected_for_render():
    lines = [{"text": "ក", "start": 1.0}, {"text": "ខ", "start": None}]
    ass = karaoke.build_ass(lines, width=1280, height=720, duration=5.0)
    assert ",Cur," in ass and "ខ" not in ass.split("[Events]")[1]
    with pytest.raises(StudioError) as exc:
        karaoke.validate_lines(lines)
    assert exc.value.code == "mv_missing_times"
    with pytest.raises(StudioError) as exc:
        karaoke.validate_lines([])
    assert exc.value.code == "mv_no_lines"


def test_long_lines_wrap_at_spaces_and_shrink_when_unbreakable():
    path = karaoke.font_path("Noto Sans Khmer", True)
    long = " ".join(["ស្រុកខ្មែរអើយ"] * 6)
    rows, scale = karaoke.wrap_text(long, path, 84, 900)
    assert len(rows) >= 2 and scale == 1.0 and all(karaoke.measure(r, path, 84) <= 900 * 1.02 for r in rows)
    assert " ".join(rows) == long  # no word lost or duplicated
    counts = [len(r.split(" ")) for r in rows]
    assert max(counts) - min(counts) <= 1  # balanced rows, no tiny stub at the end
    one_word = "ស្រុកខ្មែរអើយ" * 8  # no spaces: cannot wrap, must scale down
    rows2, scale2 = karaoke.wrap_text(one_word, path, 84, 500)
    assert rows2 == [one_word] and 0.55 <= scale2 < 1.0
    assert karaoke.wrap_text("", path, 84, 500) == ([""], 1.0)


def test_portrait_layout_uses_smaller_width():
    p = karaoke.make_layout(1080, 1920, karaoke.DEFAULT_STYLE)
    l = karaoke.make_layout(1920, 1080, karaoke.DEFAULT_STYLE)
    assert p.base == l.base and p.max_w < l.max_w


@needs_ffmpeg
def test_render_frame_has_gold_highlight_pixels_where_text_is(tmp_path):
    from PIL import Image

    out = tmp_path / "f.png"
    karaoke.render_frame("ffmpeg", tmp_path / "w", out, timed(), resolution="1280x720", at=3.5, duration=10.0, title="x", artist="y")
    img = Image.open(out).convert("RGB")
    assert img.size == (1280, 720)
    # the current line is drawn in the highlight colour (#FFD54A): there must be a good number of such pixels
    gold = sum(1 for px in img.getdata() if abs(px[0] - 255) < 25 and abs(px[1] - 213) < 25 and abs(px[2] - 74) < 40)
    assert gold > 800
    # and a frame before any line starts has none
    out2 = tmp_path / "g.png"
    karaoke.render_frame("ffmpeg", tmp_path / "w2", out2, timed(start=20), resolution="1280x720", at=1.0, duration=40.0)
    gold2 = sum(1 for px in Image.open(out2).convert("RGB").getdata() if abs(px[0] - 255) < 25 and abs(px[1] - 213) < 25 and abs(px[2] - 74) < 40)
    assert gold2 < 50


def test_ffmpeg_missing_gives_actionable_error(tmp_path):
    with pytest.raises(StudioError) as exc:
        karaoke.render_mv("/nonexistent/ffmpeg", tmp_path / "a.wav", tmp_path / "o.mp4", timed(), resolution="1280x720", duration=5.0, workdir=tmp_path / "w")
    assert exc.value.code == "ffmpeg_missing" and "FFmpeg" in exc.value.hint
