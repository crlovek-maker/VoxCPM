"""Optional lyric helper that uses a LOCAL text model (any OpenAI-compatible server: Ollama,
llama.cpp server, LM Studio, vLLM...). Suggestions are only proposed; the user reads them and
chooses before anything in the lyrics is replaced.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from .config import Settings
from .errors import StudioError
from .util import HttpError, NetworkError, http_json

MODES = {
    "rhyme": "កែពាក្យចុងបន្ទាត់ឱ្យជួន (rhyme)",
    "rewrite": "សរសេរឡើងវិញតាមការណែនាំ",
    "continue": "បន្ថែមឃ្លាបន្ត",
    "translate": "បកប្រែ ខ្មែរ ↔ អង់គ្លេស",
}

SYSTEM_PROMPT = (
    "You are a careful songwriting assistant for Khmer (ភាសាខ្មែរ) and English lyrics. "
    "You only propose alternatives; the user decides. Keep lyrics natural, singable and respectful. "
    "Write Khmer in correct Khmer Unicode spelling. Reply with STRICT JSON only, no markdown, no commentary."
)


def llm_status(s: Settings) -> Dict[str, Any]:
    if not s.llm_model:
        return {
            "configured": False, "reachable": False, "model": None, "base_url": s.llm_base_url,
            "message": "មិនទាន់កំណត់ម៉ូដែលអត្ថបទ (LLM_MODEL) — ជំនួយទំនុកដោយ AI មិនអាចប្រើបាន",
        }
    headers = {"Authorization": f"Bearer {s.llm_api_key}"} if s.llm_api_key else {}
    try:
        http_json("GET", s.llm_base_url + "/models", headers=headers, timeout=4)
    except NetworkError as exc:
        return {"configured": True, "reachable": False, "model": s.llm_model, "base_url": s.llm_base_url,
                "message": f"មិនអាចភ្ជាប់ទៅម៉ូដែលអត្ថបទ ({s.llm_base_url}): {exc.reason}"}
    except HttpError:
        # some servers do not implement /models; reachable anyway
        pass
    return {"configured": True, "reachable": True, "model": s.llm_model, "base_url": s.llm_base_url, "message": "ម៉ូដែលអត្ថបទរួចរាល់"}


def build_prompt(
    *,
    mode: str,
    lines: List[str],
    context_before: List[str],
    context_after: List[str],
    instruction: str,
    count: int,
    section_type: str,
    new_lines: int,
) -> str:
    numbered = "\n".join(f"{i + 1}. {ln}" for i, ln in enumerate(lines)) or "(none)"
    ctx_b = "\n".join(context_before) or "(none)"
    ctx_a = "\n".join(context_after) or "(none)"
    common = (
        f"Section type: {section_type}\nLines before the selection:\n{ctx_b}\n\nSELECTED LINES:\n{numbered}\n\n"
        f"Lines after the selection:\n{ctx_a}\n\n"
    )
    if mode == "rhyme":
        task = (
            "TASK: Rewrite the selected lines so the line endings rhyme (in Khmer this is ពាក្យជួន: the last syllable of "
            "neighbouring lines shares the same vowel/final sound; internal rhyme is a bonus). Keep the meaning, mood "
            f"and a similar syllable count. Return exactly {len(lines)} lines per suggestion."
        )
    elif mode == "continue":
        task = (
            f"TASK: Write {new_lines} NEW lines that continue the song after the selected lines, same language, mood and "
            "rhyme pattern. Return only the new lines."
        )
    elif mode == "translate":
        task = (
            "TASK: Translate the selected lines: Khmer -> natural singable English, or English -> natural Khmer. "
            f"Return exactly {len(lines)} lines per suggestion; keep rhythm in mind."
        )
    else:
        task = f"TASK: Rewrite the selected lines following the user's instruction. Return exactly {len(lines)} lines per suggestion."
    extra = f"\nUSER INSTRUCTION: {instruction.strip()}\n" if instruction.strip() else ""
    fmt = (
        f'\nGive {count} different suggestions. Output JSON exactly like: '
        '{"suggestions":[{"lines":["line 1","line 2"],"note":"one short sentence in Khmer saying what you changed"}]}'
    )
    return common + task + extra + fmt


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def parse_suggestions(content: str, expected_lines: Optional[int], count: int) -> List[Dict[str, Any]]:
    text = _THINK_RE.sub("", content or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    data: Any = None
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            data = None
    items: List[Any] = []
    if isinstance(data, dict) and isinstance(data.get("suggestions"), list):
        items = data["suggestions"]
    elif isinstance(data, list):
        items = data
    out: List[Dict[str, Any]] = []
    for i, it in enumerate(items):
        lines = it.get("lines") if isinstance(it, dict) else it
        if isinstance(lines, str):
            lines = [ln for ln in lines.split("\n")]
        if not isinstance(lines, list):
            continue
        clean = [re.sub(r"^\s*\d+[.)]\s*", "", str(x)).strip() for x in lines if str(x).strip()]
        if not clean:
            continue
        note = str(it.get("note", "")).strip() if isinstance(it, dict) else ""
        out.append({
            "id": f"a{i + 1}", "lines": clean, "note": note,
            "line_count_ok": expected_lines is None or len(clean) == expected_lines,
        })
    if not out and text:  # model ignored the JSON instruction: treat plain lines as one suggestion
        plain = [re.sub(r"^\s*[-*\d.)]+\s*", "", ln).strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("{")]
        if plain:
            out.append({"id": "a1", "lines": plain[: expected_lines or len(plain)], "note": "", "line_count_ok": expected_lines is None or len(plain) == expected_lines})
    return out[:count]


def suggest(
    s: Settings,
    *,
    mode: str,
    lines: List[str],
    context_before: Optional[List[str]] = None,
    context_after: Optional[List[str]] = None,
    instruction: str = "",
    count: int = 3,
    section_type: str = "verse",
    new_lines: int = 2,
) -> List[Dict[str, Any]]:
    if not s.llm_model:
        raise StudioError(
            "llm_not_configured", "មិនទាន់កំណត់ម៉ូដែលអត្ថបទក្នុងម៉ាស៊ីន",
            hint="ដំឡើង Ollama (ollama pull qwen3:8b) ហើយកំណត់ LLM_MODEL=qwen3:8b ក្នុង .env", status=503,
        )
    if mode not in MODES:
        raise StudioError("invalid_request", "របៀបជំនួយមិនត្រឹមត្រូវ", status=422)
    lines = [ln for ln in lines if ln.strip()]
    if mode != "continue" and not lines:
        raise StudioError("invalid_request", "សូមជ្រើសបន្ទាត់ទំនុកជាមុន", status=422)
    prompt = build_prompt(
        mode=mode, lines=lines, context_before=context_before or [], context_after=context_after or [],
        instruction=instruction, count=max(1, min(5, count)), section_type=section_type, new_lines=max(1, min(8, new_lines)),
    )
    body = {
        "model": s.llm_model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
        "temperature": 0.8,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {s.llm_api_key}"} if s.llm_api_key else {}
    try:
        _, resp = http_json("POST", s.llm_base_url + "/chat/completions", body=body, headers=headers, timeout=s.llm_timeout_seconds)
    except NetworkError as exc:
        raise StudioError("llm_unreachable", "មិនអាចភ្ជាប់ទៅម៉ូដែលអត្ថបទក្នុងម៉ាស៊ីនបានទេ", detail=exc.reason,
                          hint="ពិនិត្យថា Ollama កំពុងដំណើរការ (ollama serve) និង LLM_BASE_URL", status=503) from exc
    except HttpError as exc:
        raise StudioError("llm_failed", f"ម៉ូដែលអត្ថបទឆ្លើយកំហុស HTTP {exc.status}", detail=exc.body[:500], status=502) from exc
    try:
        content = resp["choices"][0]["message"]["content"]
    except (TypeError, KeyError, IndexError) as exc:
        raise StudioError("llm_failed", "ម៉ូដែលអត្ថបទឆ្លើយក្នុងទម្រង់ដែលមិនស្គាល់", detail=str(resp)[:400], status=502) from exc
    expected = None if mode == "continue" else len(lines)
    suggestions = parse_suggestions(content, expected, count)
    if not suggestions:
        raise StudioError("llm_failed", "ម៉ូដែលអត្ថបទមិនបានផ្ដល់ការណែនាំដែលអាចប្រើបាន — សូមសាកល្បងម្ដងទៀត", detail=content[:400], status=502)
    return suggestions
