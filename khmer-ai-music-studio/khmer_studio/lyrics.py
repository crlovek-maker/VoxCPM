"""Lyrics model: sections (Verse / Chorus / Bridge ...) made of lines.

Sections look like {"id": "s1", "type": "verse", "lines": ["...", "..."]}.
Helpers here parse pasted text, build the text a music engine expects, and pick the chorus for
the "short chorus test".
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

SECTION_TYPES: Dict[str, Dict[str, str]] = {
    "intro": {"tag": "Intro", "km": "Intro · ផ្នែកបើក"},
    "verse": {"tag": "Verse", "km": "Verse · ខ"},
    "prechorus": {"tag": "Pre-Chorus", "km": "Pre-Chorus · មុនបន្ទរ"},
    "chorus": {"tag": "Chorus", "km": "Chorus · បន្ទរ"},
    "bridge": {"tag": "Bridge", "km": "Bridge · ស្ពាន"},
    "outro": {"tag": "Outro", "km": "Outro · ផ្នែកបិទ"},
}

_KM_DIGITS = str.maketrans("០១២៣៤៥៦៧៨៩", "0123456789")

# [Verse 1] (Chorus) Verse 2: បន្ទរ ខទី១ ...
_HEADER_RE = re.compile(
    r"""^\s*[\[\(<]?\s*
        (?P<name>intro|pre[\s\-_]?chorus|chorus|refrain|hook|verse|bridge|outro|បន្ទរ|ខទី|ខ|ស្ពាន|សេចក្ដីផ្ដើម|ចុងបទ)
        \s*(?P<num>[0-9០-៩]*)\s*
        [\]\)>]?\s*[:：]?\s*(?:[\-–—].*)?$""",
    re.IGNORECASE | re.VERBOSE,
)

_NAME_TO_TYPE = {
    "intro": "intro", "សេចក្ដីផ្ដើម": "intro",
    "verse": "verse", "ខ": "verse", "ខទី": "verse",
    "prechorus": "prechorus", "pre-chorus": "prechorus", "pre_chorus": "prechorus",
    "chorus": "chorus", "refrain": "chorus", "hook": "chorus", "បន្ទរ": "chorus",
    "bridge": "bridge", "ស្ពាន": "bridge",
    "outro": "outro", "ចុងបទ": "outro",
}


def _type_from_name(name: str) -> Optional[str]:
    key = re.sub(r"[\s]+", "", name.lower())
    key = key.replace("pre-chorus", "prechorus").replace("pre_chorus", "prechorus")
    return _NAME_TO_TYPE.get(key) or _NAME_TO_TYPE.get(name.lower())


def new_section(section_type: str, lines: Optional[List[str]] = None, sid: Optional[str] = None) -> Dict[str, Any]:
    if section_type not in SECTION_TYPES:
        section_type = "verse"
    return {"id": sid or "", "type": section_type, "lines": list(lines or [])}


def assign_ids(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    used = {s.get("id") for s in sections if s.get("id")}
    counter = 1
    for s in sections:
        if not s.get("id"):
            while f"s{counter}" in used:
                counter += 1
            s["id"] = f"s{counter}"
            used.add(s["id"])
    return sections


def normalize_sections(raw: Any) -> List[Dict[str, Any]]:
    """Validate/clean sections coming from the browser."""
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        stype = item.get("type") if item.get("type") in SECTION_TYPES else "verse"
        lines = item.get("lines") or []
        if isinstance(lines, str):
            lines = lines.split("\n")
        clean_lines = [str(x).replace("\r", "").rstrip() for x in lines]
        out.append({"id": str(item.get("id") or ""), "type": stype, "lines": clean_lines})
    return assign_ids(out)


def parse_lyrics_text(text: str) -> List[Dict[str, Any]]:
    """Split pasted lyrics into sections.

    Understands header lines ([Verse 1], Chorus:, បន្ទរ ...). Without headers, blank lines split
    sections: the first block of a repeated text becomes a verse, repeats become a chorus.
    """
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    has_headers = any(_HEADER_RE.match(ln) for ln in lines if ln.strip())
    sections: List[Dict[str, Any]] = []

    if has_headers:
        current: Optional[Dict[str, Any]] = None
        for ln in lines:
            m = _HEADER_RE.match(ln) if ln.strip() else None
            if m and _type_from_name(m.group("name")):
                current = new_section(_type_from_name(m.group("name")) or "verse")
                sections.append(current)
                continue
            if not ln.strip():
                continue
            if current is None:
                current = new_section("verse")
                sections.append(current)
            current["lines"].append(ln.strip())
    else:
        blocks: List[List[str]] = []
        cur: List[str] = []
        for ln in lines:
            if ln.strip():
                cur.append(ln.strip())
            elif cur:
                blocks.append(cur)
                cur = []
        if cur:
            blocks.append(cur)
        seen: Dict[str, int] = {}
        for block in blocks:
            key = "\n".join(block)
            seen[key] = seen.get(key, 0) + 1
            sections.append(new_section("chorus" if seen[key] > 1 else "verse", block))
    return assign_ids([s for s in sections if s["lines"]])


def sections_to_text(sections: Iterable[Dict[str, Any]]) -> str:
    """Human-readable round-trip format: [Verse 1] headers + lines (used by 'copy/paste lyrics')."""
    return build_engine_lyrics(sections, numbered=True)


def build_engine_lyrics(
    sections: Iterable[Dict[str, Any]],
    *,
    numbered: bool = True,
    with_tags: bool = True,
) -> str:
    """Text for the music model: `[Verse 1]` / `[Chorus]` tags followed by the lines."""
    counts: Dict[str, int] = {}
    blocks: List[str] = []
    for s in sections:
        lines = [ln for ln in (s.get("lines") or []) if str(ln).strip()]
        if not lines:
            continue
        stype = s.get("type") if s.get("type") in SECTION_TYPES else "verse"
        counts[stype] = counts.get(stype, 0) + 1
        tag = SECTION_TYPES[stype]["tag"]
        if numbered and stype == "verse":
            tag = f"{tag} {counts[stype]}"
        body = "\n".join(str(ln).strip() for ln in lines)
        blocks.append(f"[{tag}]\n{body}" if with_tags else body)
    return "\n\n".join(blocks)


def flatten_lines(sections: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Every non-empty lyric line in order, remembering which section it came from."""
    out: List[Dict[str, Any]] = []
    for s in sections:
        for idx, ln in enumerate(s.get("lines") or []):
            if str(ln).strip():
                out.append({"text": str(ln).strip(), "section_id": s.get("id"), "section_type": s.get("type"), "index": idx})
    return out


def pick_chorus(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The section(s) used for the short chorus test: first chorus, else the first non-empty section."""
    for s in sections:
        if s.get("type") == "chorus" and any(str(x).strip() for x in s.get("lines", [])):
            return [s]
    for s in sections:
        if any(str(x).strip() for x in s.get("lines", [])):
            return [s]
    return []


def count_lines(sections: Iterable[Dict[str, Any]]) -> int:
    return sum(1 for s in sections for ln in s.get("lines", []) if str(ln).strip())


def suggest_duration(line_count: int, purpose: str = "full") -> int:
    """Rough sensible length. The model keeps ~3-4 s of lead-in silence, so give lines room."""
    if purpose == "chorus_test":
        return int(max(20, min(45, 8 + 5 * max(line_count, 1))))
    return int(max(30, min(240, 15 + 5 * max(line_count, 1))))


def has_khmer(text: str) -> bool:
    return any("ក" <= ch <= "៿" for ch in text or "")
