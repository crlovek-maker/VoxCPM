"""Error type shared by every layer. `message` is Khmer (shown to the user); `detail` is technical."""
from __future__ import annotations

from typing import Any, Dict, Optional


class StudioError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        detail: Optional[str] = None,
        hint: Optional[str] = None,
        status: int = 400,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail
        self.hint = hint
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": self.detail, "hint": self.hint}

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        extra = f" [{self.detail}]" if self.detail else ""
        return f"{self.code}: {self.message}{extra}"


class Cancelled(StudioError):
    def __init__(self, message: str = "ការងារត្រូវបានបោះបង់") -> None:
        super().__init__("cancelled", message, status=409)


class EngineUnavailable(StudioError):
    def __init__(self, message: str, *, detail: Optional[str] = None, hint: Optional[str] = None) -> None:
        super().__init__("engine_unreachable", message, detail=detail, hint=hint, status=503)
