from khmer_studio import lyrics as lyr
from khmer_studio import presets

KM = ["ខ្ញុំស្រឡាញ់ស្រុកខ្មែរ", "ទឹកដីដូនតា"]


def test_parse_headers_english_and_khmer():
    text = "[Verse 1]\nline a\nline b\n\n[Chorus]\nline c\n\nបន្ទរ\nline d\n\nBridge:\nline e"
    sections = lyr.parse_lyrics_text(text)
    assert [s["type"] for s in sections] == ["verse", "chorus", "chorus", "bridge"]
    assert sections[0]["lines"] == ["line a", "line b"]
    assert len({s["id"] for s in sections}) == 4  # ids are unique


def test_parse_without_headers_repeated_block_becomes_chorus():
    text = "a1\na2\n\nb1\nb2\n\na1\na2"
    sections = lyr.parse_lyrics_text(text)
    assert [s["type"] for s in sections] == ["verse", "verse", "chorus"]


def test_build_engine_lyrics_numbers_verses_only():
    sections = lyr.assign_ids([
        lyr.new_section("verse", ["v1"]), lyr.new_section("chorus", KM), lyr.new_section("verse", ["v2"]), lyr.new_section("bridge", ["b"]),
        lyr.new_section("verse", []),  # empty section is skipped
    ])
    text = lyr.build_engine_lyrics(sections)
    assert text.startswith("[Verse 1]\nv1\n\n[Chorus]\nខ្ញុំស្រឡាញ់ស្រុកខ្មែរ")
    assert "[Verse 2]\nv2" in text and "[Bridge]\nb" in text
    assert text.count("[Verse") == 2


def test_pick_chorus_and_fallback():
    s = lyr.assign_ids([lyr.new_section("verse", ["v"]), lyr.new_section("chorus", KM)])
    assert lyr.pick_chorus(s)[0]["type"] == "chorus"
    only_verse = lyr.assign_ids([lyr.new_section("verse", ["x", "y"])])
    assert lyr.pick_chorus(only_verse)[0]["lines"] == ["x", "y"]
    assert lyr.pick_chorus([]) == []


def test_flatten_and_count_and_duration():
    s = lyr.assign_ids([lyr.new_section("verse", ["a", "", "b"]), lyr.new_section("chorus", ["c"])])
    flat = lyr.flatten_lines(s)
    assert [x["text"] for x in flat] == ["a", "b", "c"]
    assert lyr.count_lines(s) == 3
    assert 20 <= lyr.suggest_duration(4, "chorus_test") <= 45
    assert lyr.suggest_duration(4, "chorus_test") >= 28  # 4 lines need room after the model's lead-in silence
    assert lyr.suggest_duration(24, "full") == 135


def test_has_khmer():
    assert lyr.has_khmer("ស្រុក") and not lyr.has_khmer("country")


def test_compose_caption_dedupes_and_marks_instrumental():
    cap = presets.compose_caption({"styles": ["ballad"], "instruments": ["guitar", "khloy"], "moods": ["sad"], "vocal": ["female"], "extra": "slow"})
    tags = [t.strip().lower() for t in cap.split(",")]
    assert len(tags) == len(set(tags))  # "acoustic guitar" appears once although two presets mention it
    assert "female vocal" in tags and "slow" in tags
    inst = presets.compose_caption({"styles": ["rock"], "vocal": ["female"]}, instrumental=True)
    assert "instrumental, no vocals" in inst and "female vocal" not in inst
