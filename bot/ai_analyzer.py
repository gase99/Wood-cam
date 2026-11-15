"""تحلیل تصویر اسکیس با مدل بینا (Vision AI).

- اگر کلید API تنظیم شده باشد: فراخوانی مدل سازگار با OpenAI (gpt-4o و...) و
  دریافت JSON ساخت‌یافته‌ی ابعاد.
- در غیر این صورت: «حالت نمایشی» — برگرداندن داده‌ی نمونه بر اساس نقشه‌ی
  مرجع F204 تا ربات بدون کلید هم قابل تست باشد.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

import requests

from .config import Config
from .prompts import ANALYSIS_SYSTEM_PROMPT, ANALYSIS_USER_PROMPT

log = logging.getLogger(__name__)

# داده‌ی نمونه‌ی حالت نمایشی — بر اساس نقشه‌ی مرجع F204 (آشپزخانه‌ی L شکل)
DEMO_ANALYSIS: dict[str, Any] = {
    "room": {"width_mm": 3000, "depth_mm": 3600, "height_mm": 2700},
    "layout": "L",
    "doors": [{"wall": "south", "width_mm": 900, "position_mm": 2200}],
    "windows": [{"wall": "north", "width_mm": 1500, "position_mm": 1500, "sill_height_mm": 900}],
    "obstacles": [
        {"type": "sink", "wall": "north", "position_mm": 1500},
        {"type": "stove", "wall": "north", "position_mm": 2400},
        {"type": "fridge", "wall": "west", "position_mm": 900},
    ],
    "notes": "DEMO MODE: sample data based on reference drawing F204. "
    "Set AI_API_KEY for real analysis.",
}


def _extract_json(text: str) -> dict[str, Any]:
    """استخراج JSON از خروجی مدل (حتی اگر داخل ```json ... ``` باشد)."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("پاسخ مدل شامل JSON معتبر نیست.")
    return json.loads(text[start : end + 1])


def _normalize(data: dict[str, Any]) -> dict[str, Any]:
    """اعتبارسنجی و نرمال‌سازی خروجی مدل با مقادیر پیش‌فرض استاندارد."""
    room = data.get("room", {}) or {}
    normalized = {
        "room": {
            "width_mm": int(room.get("width_mm") or 3000),
            "depth_mm": int(room.get("depth_mm") or 3600),
            "height_mm": int(room.get("height_mm") or 2700),
        },
        "layout": str(data.get("layout") or "L").upper(),
        "doors": list(data.get("doors") or []),
        "windows": list(data.get("windows") or []),
        "obstacles": list(data.get("obstacles") or []),
        "notes": str(data.get("notes") or ""),
    }
    if normalized["layout"] not in ("L", "U", "I", "PARALLEL"):
        normalized["layout"] = "L"
    return normalized


def analyze_image(image_bytes: bytes, config: Config) -> dict[str, Any]:
    """تحلیل عکس اسکیس و برگرداندن دیکشنری ابعاد (JSON ساخت‌یافته)."""
    if config.demo_mode:
        log.info("Demo mode: returning sample analysis.")
        return json.loads(json.dumps(DEMO_ANALYSIS))  # کپی عمیق

    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": config.ai_model,
        "messages": [
            {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ANALYSIS_USER_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
                    },
                ],
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": 1500,
    }
    headers = {
        "Authorization": f"Bearer {config.ai_api_key}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        f"{config.ai_base_url.rstrip('/')}/chat/completions",
        json=payload,
        headers=headers,
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return _normalize(_extract_json(content))
