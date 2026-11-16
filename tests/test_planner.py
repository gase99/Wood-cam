"""تست‌های موتور ترسیم پلان و منطق گفتگو."""

import io
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image

from bot.ai_analyzer import DEMO_ANALYSIS
from bot.handlers import _parse_dimensions, format_analysis
from bot.planner import render_plan_png


def _is_png(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n")


def test_render_demo_plan():
    png = render_plan_png(DEMO_ANALYSIS)
    assert _is_png(png)
    img = Image.open(io.BytesIO(png))
    assert img.size[0] > 800 and img.size[1] > 600


def test_render_all_layouts():
    for layout in ("L", "U", "I", "PARALLEL"):
        analysis = dict(DEMO_ANALYSIS, layout=layout)
        png = render_plan_png(analysis)
        assert _is_png(png), layout


def test_render_minimal_analysis():
    # تحلیل خالی باید با مقادیر پیش‌فرض کار کند
    png = render_plan_png({})
    assert _is_png(png)


def test_parse_dimensions():
    assert _parse_dimensions("3000x3600") == (3000, 3600)
    assert _parse_dimensions("ابعاد: ۳۲۰۰×۳۸۰۰") == (3200, 3800)
    assert _parse_dimensions("سلام") is None


def test_format_analysis():
    text = format_analysis(DEMO_ANALYSIS)
    assert "3000" in text and "3600" in text
    assert "سینک" not in text  # متن فارسی است ولی نام‌ها لاتین می‌مانند
