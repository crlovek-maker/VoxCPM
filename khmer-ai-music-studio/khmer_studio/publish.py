"""Description / credits / hashtags for YouTube, Facebook and TikTok (plain templates, fully editable).

Nothing here calls a network service. The texts are a starting point: the UI lets you edit and copy
them. Length limits shown in the UI are soft hints, not guarantees about each platform's current rules.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

PLATFORMS = ["youtube", "facebook", "tiktok"]

STYLE_TAGS = {
    "kantrum": ["#កន្ទ្រឹម", "#Kantrum", "#KhmerFolk"],
    "ballad": ["#បាឡាដ", "#KhmerBallad"],
    "rap": ["#រ៉េប", "#KhmerRap", "#KhmerHipHop"],
    "rock": ["#រ៉ុក", "#KhmerRock"],
    "pop": ["#ប៉ុប", "#KhmerPop"],
    "ramvong": ["#រាំវង់", "#Ramvong"],
}
BASE_TAGS = ["#ចម្រៀងខ្មែរ", "#KhmerSong", "#KhmerMusic", "#Cambodia"]
AI_TAGS = ["#AIMusic", "#AIGenerated"]


def make_hashtag(text: str) -> str:
    """'My Artist!' -> '#MyArtist'. Khmer letters are kept; spaces/punctuation dropped."""
    cleaned = re.sub(r"[^\wក-៿]+", "", text or "", flags=re.UNICODE)
    return f"#{cleaned}" if cleaned else ""


def _dedupe(tags: Iterable[str]) -> List[str]:
    seen, out = set(), []
    for t in tags:
        t = t.strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def build_hashtags(project: Dict[str, Any], info: Dict[str, Any], limit: int) -> List[str]:
    """Priority order when the platform allows only `limit` tags: the user's own tags and artist first,
    then style/genre/mood, the two core Khmer discovery tags, the AI tags, and finally the rest."""
    extras: List[str] = []
    for extra in re.split(r"[\s,]+", info.get("extra_tags", "") or ""):
        if extra:
            extras.append(extra if extra.startswith("#") else make_hashtag(extra))
    styles = [STYLE_TAGS.get(sid, []) for sid in (project.get("music", {}).get("styles", []) or [])]
    ordered: List[str] = []
    ordered += extras
    ordered.append(make_hashtag(project.get("artist") or ""))
    ordered += [group[0] for group in styles if group]
    ordered.append(make_hashtag(info.get("genre") or ""))
    ordered.append(make_hashtag(info.get("mood") or ""))
    ordered += BASE_TAGS[:2]
    if info.get("ai_disclosure"):
        ordered += AI_TAGS
    ordered += [t for group in styles for t in group[1:]]
    ordered += BASE_TAGS[2:]
    return _dedupe(ordered)[:limit]


def credits_block(project: Dict[str, Any], info: Dict[str, Any], engine: Optional[Dict[str, Any]]) -> str:
    artist = project.get("artist") or ""
    rows: List[str] = []
    rows.append(f"✍️ ទំនុក: {info.get('lyrics_by') or artist or '—'}")
    rows.append(f"🎼 ភ្លេង: {info.get('music_by') or artist or '—'}")
    rows.append(f"🎤 សំឡេងច្រៀង: {info.get('vocals_by') or ('AI' if engine and engine.get('is_ai') else artist or '—')}")
    if info.get("year"):
        rows.append(f"📅 ឆ្នាំ: {info['year']}")
    if info.get("ai_disclosure") and engine and engine.get("is_ai"):
        lic = f" ({engine['license']})" if engine.get("license") else ""
        rows.append(f"🤖 បង្កើតដោយជំនួយ AI: {engine.get('name', 'AI')}{lic} — ដំណើរការលើម៉ាស៊ីនផ្ទាល់ខ្លួន")
    return "\n".join(rows)


def _blurb(project: Dict[str, Any], info: Dict[str, Any]) -> str:
    bits = []
    if info.get("genre"):
        bits.append(f"ប្រភេទ {info['genre']}")
    if info.get("mood"):
        bits.append(f"អារម្មណ៍ {info['mood']}")
    if info.get("language"):
        bits.append(f"ភាសា{info['language']}")
    detail = " · ".join(bits)
    title = project.get("title") or "បទថ្មី"
    return f"«{title}» — ចម្រៀងថ្មី" + (f" ({detail})" if detail else "") + "។ សូមស្ដាប់ ចុច Like, Share និង Subscribe ដើម្បីគាំទ្រ!"


def lyrics_text(project: Dict[str, Any]) -> str:
    out: List[str] = []
    for s in project.get("lyrics", {}).get("sections", []):
        lines = [ln for ln in s.get("lines", []) if str(ln).strip()]
        if lines:
            out.append("\n".join(lines))
    return "\n\n".join(out)


def generate(
    project: Dict[str, Any],
    info: Dict[str, Any],
    engine: Optional[Dict[str, Any]] = None,
    *,
    include_lyrics: bool = True,
) -> Dict[str, Dict[str, str]]:
    """Return {platform: {title, description, credits, hashtags, full}}."""
    title = (project.get("title") or "").strip() or "បទថ្មី"
    artist = (project.get("artist") or "").strip()
    head = f"{title} — {artist}" if artist else title
    credits = credits_block(project, info, engine)
    links = (info.get("links") or "").strip()
    blurb = _blurb(project, info)
    lyrics = lyrics_text(project) if include_lyrics else ""
    out: Dict[str, Dict[str, str]] = {}

    # ---- YouTube: title <= ~100 chars; first 3 hashtags are shown above the title
    yt_tags = build_hashtags(project, info, 12)
    yt_title = head if len(head) <= 95 else head[:92] + "…"
    yt_desc = [head, "", blurb]
    if lyrics:
        yt_desc += ["", "🎵 ទំនុកច្រៀង / Lyrics", lyrics]
    yt_desc += ["", "—— Credits ——", credits]
    if links:
        yt_desc += ["", "🔗 តំណ / Links", links]
    yt_desc += ["", " ".join(yt_tags)]
    out["youtube"] = {
        "title": yt_title,
        "description": "\n".join(yt_desc).strip(),
        "credits": credits,
        "hashtags": " ".join(yt_tags),
    }

    # ---- Facebook: friendly post, a few hashtags
    fb_tags = build_hashtags(project, info, 8)
    fb = [f"🎶 {head}", "", blurb]
    if lyrics:
        preview = "\n".join(lyrics.split("\n")[:8])
        fb += ["", preview + ("\n…" if len(lyrics.split("\n")) > 8 else "")]
    fb += ["", credits]
    if links:
        fb += ["", f"👉 {links}"]
    fb += ["", " ".join(fb_tags)]
    out["facebook"] = {"title": head, "description": "\n".join(fb).strip(), "credits": credits, "hashtags": " ".join(fb_tags)}

    # ---- TikTok: short caption, 3-5 hashtags
    tt_tags = build_hashtags(project, info, 5)
    tt = [f"🎶 {head}", ""]
    first_lines = [ln for ln in lyrics.split("\n") if ln.strip()][:2] if lyrics else []
    if first_lines:
        tt += first_lines + [""]
    if info.get("ai_disclosure") and engine and engine.get("is_ai"):
        tt.append("🤖 បង្កើតដោយ AI")
    tt.append(" ".join(tt_tags))
    out["tiktok"] = {"title": head, "description": "\n".join(tt).strip(), "credits": credits, "hashtags": " ".join(tt_tags)}

    for p, d in out.items():
        d["full"] = d["description"]
        d["platform"] = p
    return out
