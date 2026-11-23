"""Style / instrument / mood presets.

IMPORTANT (shown to the user in the UI): every item here only becomes *text in the caption*.
No model has a "kantrum" or "khloy" switch. We checked ACE-Step 1.5's own genre vocabulary
(acestep/genres_vocab.txt): it contains "Khmer pop / rock / rap / hip-hop / folk / trap" and generic
terms (flute, erhu, marimba, percussion, Southeast Asian, traditional), but NOT kantrum, khloy,
tro sau, roneat, chapei, skor, ramvong. So Khmer-specific names are paired with generic words the
model is known to have seen. Results are a hint, not a guarantee.
"""
from __future__ import annotations

from typing import Any, Dict, List

STYLES: List[Dict[str, str]] = [
    {"id": "kantrum", "km": "កន្ទ្រឹម", "en": "Khmer folk, traditional Khmer folk, lively dance rhythm, hand percussion, Southeast Asian, festive"},
    {"id": "ballad", "km": "បាឡាដ", "en": "Khmer pop ballad, slow tempo, emotional, tender, soft piano and acoustic guitar"},
    {"id": "rap", "km": "រ៉េប", "en": "Khmer rap, Khmer hip-hop, rhythmic rap flow, trap beat, deep bass"},
    {"id": "rock", "km": "រ៉ុក", "en": "Khmer rock, electric guitar, driving drums, energetic, powerful vocal"},
    {"id": "pop", "km": "ប៉ុប", "en": "Khmer pop, catchy melody, modern pop production, upbeat"},
    {"id": "ramvong", "km": "រាំវង់", "en": "traditional Khmer folk, circle dance music, steady rhythm, Southeast Asian percussion"},
]

INSTRUMENTS: List[Dict[str, str]] = [
    {"id": "khloy", "km": "ខ្លុយ", "en": "bamboo flute (khloy), flute"},
    {"id": "trosau", "km": "ទ្រសោ", "en": "tro sau Khmer two-string fiddle, erhu"},
    {"id": "guitar", "km": "ហ្គីតា (អាកូស្ទិក)", "en": "acoustic guitar"},
    {"id": "eguitar", "km": "ហ្គីតាអគ្គិសនី", "en": "electric guitar"},
    {"id": "piano", "km": "ព្យាណូ", "en": "piano"},
    {"id": "skor", "km": "ស្គរ", "en": "Khmer skor hand drums, hand percussion"},
    {"id": "roneat", "km": "រនាត", "en": "roneat xylophone, marimba"},
    {"id": "chapei", "km": "ចាប៉ី", "en": "chapei long-neck lute, plucked strings"},
    {"id": "bass", "km": "បាស", "en": "bass guitar"},
    {"id": "strings", "km": "ហ្វូងវីយូឡុង", "en": "string section"},
    {"id": "synth", "km": "ស៊ីនធីសាយហ្សើរ", "en": "synthesizer"},
]

MOODS: List[Dict[str, str]] = [
    {"id": "gentle", "km": "ស្រទន់", "en": "gentle, warm"},
    {"id": "sad", "km": "សោកសៅ", "en": "sad, melancholic"},
    {"id": "happy", "km": "រីករាយ", "en": "joyful, happy, uplifting"},
    {"id": "romantic", "km": "ស្នេហា", "en": "romantic, tender"},
    {"id": "nostalgic", "km": "នឹករលឹក", "en": "nostalgic"},
    {"id": "energetic", "km": "ស្វាហាប់", "en": "energetic, high energy"},
    {"id": "patriotic", "km": "ស្នេហាជាតិ", "en": "patriotic, anthemic, proud"},
]

VOCALS: List[Dict[str, str]] = [
    {"id": "female", "km": "សំឡេងស្រី", "en": "female vocal"},
    {"id": "male", "km": "សំឡេងប្រុស", "en": "male vocal"},
    {"id": "duet", "km": "ច្រៀងគូ", "en": "male and female duet vocal"},
    {"id": "choir", "km": "ក្រុមចម្រៀង", "en": "choir, group vocals"},
]


def catalog() -> Dict[str, Any]:
    return {"styles": STYLES, "instruments": INSTRUMENTS, "moods": MOODS, "vocals": VOCALS}


def _lookup(table: List[Dict[str, str]], ids: Any) -> List[str]:
    wanted = ids if isinstance(ids, list) else ([ids] if ids else [])
    by_id = {x["id"]: x["en"] for x in table}
    return [by_id[i] for i in wanted if i in by_id]


def compose_caption(music: Dict[str, Any], *, instrumental: bool = False) -> str:
    """Build the English caption from the user's choices + free text (all description-only)."""
    parts: List[str] = []
    parts += _lookup(STYLES, music.get("styles") or music.get("style"))
    parts += _lookup(INSTRUMENTS, music.get("instruments"))
    parts += _lookup(MOODS, music.get("moods"))
    if instrumental:
        parts.append("instrumental, no vocals")
    else:
        parts += _lookup(VOCALS, music.get("vocal"))
    extra = (music.get("extra") or "").strip()
    if extra:
        parts.append(extra)
    # De-duplicate individual tags ("acoustic guitar" may come from both the style and the
    # instrument list) while keeping the original order; caption space is limited (512 chars).
    seen = set()
    tags: List[str] = []
    for part in parts:
        for tag in part.split(","):
            tag = tag.strip()
            if tag and tag.lower() not in seen:
                seen.add(tag.lower())
                tags.append(tag)
    return ", ".join(tags)
