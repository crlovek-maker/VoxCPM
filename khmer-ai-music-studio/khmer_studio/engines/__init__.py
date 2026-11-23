"""Engine registry. Add a new model by writing an `Engine` subclass and listing it in `build_engines`."""
from __future__ import annotations

from typing import Dict

from ..config import Settings
from .acestep import AceStepEngine
from .base import Engine
from .heartmula import HeartMuLaEngine
from .selftest import SelfTestEngine


def build_engines(settings: Settings) -> Dict[str, Engine]:
    engines: Dict[str, Engine] = {"acestep": AceStepEngine(settings)}
    if settings.heartmula_dir:  # only offered once the user points us at their heartlib checkout
        engines["heartmula"] = HeartMuLaEngine(settings)
    if settings.enable_selftest:
        engines["selftest"] = SelfTestEngine(settings)
    return engines
