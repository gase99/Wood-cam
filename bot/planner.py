"""موتور ترسیم شیت فنی حرفه‌ای آشپزخانه (مشابه نقشه‌های اجرایی F204).

خروجی: یک شیت A3 شامل:
- پلان کف (FLOOR PLAN) با دیوارها، درها، پنجره‌ها و جانمایی کابینت
- نماهای روبه‌رو (ELEVATION) هر دیوار کابینت‌دار — کابینت زمینی/دیواری، سینک، اجاق، هود، یخچال
- پلان کابینت‌های بالا (UPPER CABINET PLAN) و پایین (LOWER CABINET PLAN)
- کادر عنوان (TITLE BLOCK) با اطلاعات پروژه، مقیاس و راهنما

قواعد ارگونومی:
- عمق کابینت زمینی ۶۰۰ و دیواری ۳۵۰ میلی‌متر، مدول استاندارد ۶۰۰
- ارتفاع کابینت زمینی ۹۰۰، شروع کابینت دیواری ۱۴۰۰، یونیت بلند ۲۱۰۰
- سینک زیر پنجره، اجاق کنار سینک (حداقل ۳۰۰ میلی‌متر)، هود بالای اجاق
- مثلث کاری (سینک–اجاق–یخچال) با خط‌چین قرمز
"""

from __future__ import annotations

import datetime
import io
import math
from dataclasses import dataclass
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont

# ---------- ثابت‌های استاندارد طراحی (میلی‌متر) ----------
BASE_DEPTH = 600        # عمق کابینت زمینی
WALL_DEPTH = 350        # عمق کابینت دیواری
MODULE = 600            # مدول استاندارد یونیت
SINK_W = 800            # عرض یونیت سینک
STOVE_W = 600           # عرض یونیت اجاق
FRIDGE_W = 700          # عرض یونیت بلند یخچال
FRIDGE_DEPTH = 700      # عمق یونیت بلند
MIN_STOVE_GAP = 300     # حداقل فاصله‌ی سینک تا اجاق
WALL_MM = 100           # ضخامت دیوار در پلان
BASE_H = 900            # ارتفاع کابینت زمینی
COUNTER_T = 40          # ضخامت صفحه کابینت
WALLCAB_BOTTOM = 1400   # ارتفاع شروع کابینت دیواری از کف
WALLCAB_H = 720         # ارتفاع کابینت دیواری
TALL_H = 2100           # ارتفاع یونیت بلند
HOOD_BOTTOM = 1550      # ارتفاع زیر هود
ELEV_TOP = 2400         # سقف فضای نمای روبه‌رو

# ---------- رنگ‌ها (سبک نقشه‌ی فنی) ----------
INK = (25, 25, 25)
GRAY = (110, 110, 110)
LIGHT = (246, 246, 246)
WALL_FILL = (206, 206, 206)
SINK_FILL = (214, 231, 245)
STOVE_FILL = (233, 233, 233)
FRIDGE_FILL = (250, 244, 214)
TRIANGLE = (198, 60, 60)

# دیوارهای دارای کابینت بر اساس نوع چیدمان
LAYOUT_WALLS = {
    "L": ["north", "west"],
    "U": ["north", "west", "east"],
    "I": ["north"],
    "PARALLEL": ["north", "south"],
}
WALL_LABELS = {"north": "NORTH", "south": "SOUTH", "west": "WEST", "east": "EAST"}

# ابعاد شیت (پیکسل) — نسبت A3
SHEET_W, SHEET_H = 2600, 1800


def _font(size: int) -> ImageFont.FreeTypeFont:
    """فونت با اندازه‌ی دلخواه؛ سازگار با محیط‌های مختلف سرورلس."""
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10
    except Exception:
        pass
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()  # type: ignore[return-value]


def _dashed_line(d: ImageDraw.ImageDraw, p1, p2, color, width=2, dash=10, gap=6) -> None:
    dist = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if dist == 0:
        return
    ux, uy = (p2[0] - p1[0]) / dist, (p2[1] - p1[1]) / dist
    t = 0.0
    while t < dist:
        t2 = min(t + dash, dist)
        d.line([(p1[0] + ux * t, p1[1] + uy * t),
                (p1[0] + ux * t2, p1[1] + uy * t2)], fill=color, width=width)
        t += dash + gap


def _dashed_rect(d: ImageDraw.ImageDraw, rect, color, width=2, dash=10, gap=6) -> None:
    x1, y1, x2, y2 = rect
    _dashed_line(d, (x1, y1), (x2, y1), color, width, dash, gap)
    _dashed_line(d, (x2, y1), (x2, y2), color, width, dash, gap)
    _dashed_line(d, (x2, y2), (x1, y2), color, width, dash, gap)
    _dashed_line(d, (x1, y2), (x1, y1), color, width, dash, gap)


@dataclass
class Unit:
    """یک یونیت کابینت روی دیوار."""
    kind: str      # base | sink | stove | fridge
    start: float   # فاصله از ابتدای دیوار (mm)
    length: float  # طول یونیت (mm)


class View:
    """نمای ترسیم با تبدیل مختصات میلی‌متر به پیکسل."""

    def __init__(self, d: ImageDraw.ImageDraw, box, w_mm: float, h_mm: float,
                 ox_mm: float = 0.0, oy_mm: float = 0.0,
                 flip_y: bool = False, pad: float = 8):
        x0, y0, x1, y1 = box
        self.d = d
        self.s = min((x1 - x0 - 2 * pad) / w_mm, (y1 - y0 - 2 * pad) / h_mm)
        self.cx = x0 + ((x1 - x0) - w_mm * self.s) / 2
        self.cy = y0 + ((y1 - y0) - h_mm * self.s) / 2
        self.ox, self.oy = ox_mm, oy_mm
        self.flip_y = flip_y
        self.h_mm = h_mm

    def X(self, mx: float) -> float:
        return self.cx + (mx - self.ox) * self.s

    def Y(self, my: float) -> float:
        if self.flip_y:
            return self.cy + (self.h_mm - (my - self.oy)) * self.s
        return self.cy + (my - self.oy) * self.s

    def P(self, mx: float, my: float) -> tuple[float, float]:
        return (self.X(mx), self.Y(my))

    def rect(self, mx: float, my: float, mw: float, mh: float):
        x1, y1 = self.P(mx, my)
        x2, y2 = self.P(mx + mw, my + mh)
        return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))

    def box(self, mx, my, mw, mh, **kw) -> None:
        self.d.rectangle(self.rect(mx, my, mw, mh), **kw)

    def line(self, p1, p2, **kw) -> None:
        self.d.line([self.P(*p1), self.P(*p2)], **kw)

    def text(self, mx, my, s, **kw) -> None:
        kw.setdefault("anchor", "mm")
        self.d.text(self.P(mx, my), s, **kw)


class Sheet:
    """شیت فنی کامل آشپزخانه."""

    def __init__(self, analysis: dict[str, Any]):
        self.room = analysis.get("room", {}) or {}
        self.width = int(self.room.get("width_mm") or 3000)
        self.depth = int(self.room.get("depth_mm") or 3600)
        self.height = int(self.room.get("height_mm") or 2700)
        self.layout = str(analysis.get("layout") or "L").upper()
        if self.layout not in LAYOUT_WALLS:
            self.layout = "L"
        self.doors = list(analysis.get("doors") or [])
        self.windows = list(analysis.get("windows") or [])
        self.obstacles = list(analysis.get("obstacles") or [])
        self.notes = str(analysis.get("notes") or "")

        self.img = Image.new("RGB", (SHEET_W, SHEET_H), "white")
        self.d = ImageDraw.Draw(self.img)

        # جانمایی یونیت‌ها برای هر دیوار کابینت‌دار
        self.runs: dict[str, list[Unit]] = {}
        self.run_span: dict[str, tuple[float, float]] = {}
        for wall in LAYOUT_WALLS[self.layout]:
            offset = BASE_DEPTH if wall in ("west", "east") else 0.0
            units, span = self.plan_run(wall, offset)
            self.runs[wall] = units
            self.run_span[wall] = span

    # ---------- اطلاعات دیوار ----------
    def wall_len(self, wall: str) -> int:
        return self.width if wall in ("north", "south") else self.depth

    def _find(self, kind: str, wall: str) -> Optional[dict[str, Any]]:
        for ob in self.obstacles:
            if str(ob.get("type", "")).lower() == kind and str(ob.get("wall", "")) == wall:
                return ob
        return None

    def _window_on(self, wall: str) -> Optional[dict[str, Any]]:
        for win in self.windows:
            if str(win.get("wall", "")) == wall:
                return win
        return None

    def _door_span(self, wall: str) -> Optional[tuple[float, float]]:
        for door in self.doors:
            if str(door.get("wall", "")) == wall:
                pos = float(door.get("position_mm") or 0)
                w = float(door.get("width_mm") or 900)
                return (pos - w / 2 - 100, pos + w / 2 + 100)
        return None

    def _skip_spans(self, wall: str) -> list[tuple[float, float]]:
        """بازه‌هایی که کابینت دیواری نمی‌گذاریم (پنجره و هود اجاق)."""
        spans: list[tuple[float, float]] = []
        win = self._window_on(wall)
        if win:
            pos = float(win.get("position_mm") or 0)
            w = float(win.get("width_mm") or 1500)
            spans.append((pos - w / 2, pos + w / 2))
        stove = self._find("stove", wall)
        if stove:
            pos = float(stove.get("position_mm") or 0)
            spans.append((pos - STOVE_W / 2 - 60, pos + STOVE_W / 2 + 60))
        return spans

    # ---------- جانمایی یونیت‌ها ----------
    @staticmethod
    def _fill_units(start: float, length: float) -> list[Unit]:
        """پر کردن مسیر با مدول‌های ۶۰۰ میلی‌متری (آخرین مدول تنظیم می‌شود)."""
        units: list[Unit] = []
        cursor, remaining = start, length
        while remaining >= MODULE - 1:
            units.append(Unit("base", cursor, MODULE))
            cursor += MODULE
            remaining -= MODULE
        if remaining >= 200:
            units.append(Unit("base", cursor, remaining))
        return units

    def plan_run(self, wall: str, corner_offset: float = 0.0) -> tuple[list[Unit], tuple[float, float]]:
        """برنامه‌ریزی یونیت‌های یک دیوار؛ برمی‌گرداند (یونیت‌ها، بازه‌ی ردیف)."""
        total = float(self.wall_len(wall))
        door_span = self._door_span(wall)
        run_start, run_end = corner_offset, total
        if door_span:
            if door_span[0] < total / 2:
                run_start = max(run_start, door_span[1])
            else:
                run_end = door_span[0]
        run_len = run_end - run_start
        units: list[Unit] = []
        if run_len < 600:
            return units, (run_start, run_end)

        cursor = run_start
        # ۱) یخچال در ابتدای ردیف (یونیت بلند)
        if self._find("fridge", wall) and run_len > FRIDGE_W + 900:
            units.append(Unit("fridge", cursor, FRIDGE_W))
            cursor += FRIDGE_W

        # ۲) سینک — زیر پنجره اگر پنجره روی همین دیوار است
        sink = self._find("sink", wall)
        win = self._window_on(wall)
        sink_pos = float(sink.get("position_mm") or 0) if sink else None
        if sink_pos is None and win:
            sink_pos = float(win.get("position_mm") or 0)
        if sink_pos is not None:
            sink_start = max(run_start, min(sink_pos - SINK_W / 2, run_end - SINK_W))
            if sink_start > cursor:
                units += self._fill_units(cursor, sink_start - cursor)
                cursor = sink_start
            units.append(Unit("sink", cursor, SINK_W))
            cursor += SINK_W

        # ۳) اجاق — کنار سینک با حداقل فاصله‌ی استاندارد
        if self._find("stove", wall):
            gap = MIN_STOVE_GAP if cursor + MIN_STOVE_GAP + STOVE_W <= run_end else 0.0
            if gap:
                units += self._fill_units(cursor, gap)
                cursor += gap
            if cursor + STOVE_W <= run_end:
                units.append(Unit("stove", cursor, STOVE_W))
                cursor += STOVE_W

        # ۴) بقیه‌ی مسیر با مدول‌های استاندارد
        units += self._fill_units(cursor, run_end - cursor)
        return units, (run_start, run_end)

    # ---------- عناصر مشترک ----------
    def _dim_line(self, p1, p2, label: str, font_size: int = 18) -> None:
        """خط اندازه با تیک‌های انتهایی و برچسب."""
        self.d.line([p1, p2], fill=GRAY, width=1)
        for p in (p1, p2):
            self.d.line([(p[0] - 5, p[1] - 5), (p[0] + 5, p[1] + 5)], fill=GRAY, width=1)
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        self.d.rectangle([mid[0] - 38, mid[1] - 13, mid[0] + 38, mid[1] + 13], fill="white")
        self.d.text(mid, label, font=_font(font_size), fill=INK, anchor="mm")

    def view_tag(self, box, text: str) -> None:
        """برچسب عنوان نما در گوشه‌ی بالای چپ کادر."""
        x0, y0 = box[0], box[1]
        f = _font(20)
        tw = self.d.textlength(text, font=f) + 28
        self.d.rectangle([x0, y0, x0 + tw, y0 + 34], fill=INK)
        self.d.text((x0 + tw / 2, y0 + 17), text, font=f, fill="white", anchor="mm")

    # ---------- پلان (نمای بالا) ----------
    def _plan_view(self, box) -> View:
        ext = WALL_MM + 520  # فضای خطوط اندازه
        return View(self.d, box, self.width + 2 * ext, self.depth + 2 * ext,
                    ox_mm=-ext, oy_mm=-ext, pad=4)

    def draw_walls(self, v: View) -> None:
        w, dep = self.width, self.depth
        # کف
        v.box(0, 0, w, dep, fill=LIGHT, outline=INK, width=2)
        # باند دیوارها
        bands = [
            (-WALL_MM, -WALL_MM, w + 2 * WALL_MM, WALL_MM),   # شمال
            (-WALL_MM, dep, w + 2 * WALL_MM, WALL_MM),        # جنوب
            (-WALL_MM, 0, WALL_MM, dep),                      # غرب
            (w, 0, WALL_MM, dep),                             # شرق
        ]
        for bx, by, bw, bh in bands:
            v.box(bx, by, bw, bh, fill=WALL_FILL, outline=INK, width=2)
        # خط محور دیوار
        v.line((-WALL_MM / 2, -WALL_MM / 2), (w + WALL_MM / 2, -WALL_MM / 2), fill=GRAY, width=1)
        v.line((-WALL_MM / 2, dep + WALL_MM / 2), (w + WALL_MM / 2, dep + WALL_MM / 2), fill=GRAY, width=1)
        v.line((-WALL_MM / 2, 0), (-WALL_MM / 2, dep), fill=GRAY, width=1)
        v.line((w + WALL_MM / 2, 0), (w + WALL_MM / 2, dep), fill=GRAY, width=1)
        # بازشوها
        for door in self.doors:
            self._draw_door(v, door)
        for win in self.windows:
            self._draw_window(v, win)

    def _gap(self, v: View, wall: str, center: float, width: float) -> None:
        half = width / 2
        if wall == "north":
            v.box(center - half, -WALL_MM, width, WALL_MM, fill="white", outline=None)
        elif wall == "south":
            v.box(center - half, self.depth, width, WALL_MM, fill="white", outline=None)
        elif wall == "west":
            v.box(-WALL_MM, center - half, WALL_MM, width, fill="white", outline=None)
        else:
            v.box(self.width, center - half, WALL_MM, width, fill="white", outline=None)

    def _draw_door(self, v: View, door: dict[str, Any]) -> None:
        wall = str(door.get("wall", "south"))
        pos = float(door.get("position_mm") or 0)
        w = float(door.get("width_mm") or 900)
        self._gap(v, wall, pos, w)
        hinge = v.P(pos - w / 2, 0) if wall in ("north", "south") else v.P(0, pos - w / 2)
        if wall == "north":
            hinge = v.P(pos - w / 2, 0)
            open_end = v.P(pos - w / 2, w)
            angles = (0, 90)
        elif wall == "south":
            hinge = v.P(pos - w / 2, self.depth)
            open_end = v.P(pos - w / 2, self.depth - w)
            angles = (270, 360)
        elif wall == "west":
            hinge = v.P(0, pos - w / 2)
            open_end = v.P(w, pos - w / 2)
            angles = (0, 90)
        else:
            hinge = v.P(self.width, pos - w / 2)
            open_end = v.P(self.width - w, pos - w / 2)
            angles = (90, 180)
        self.d.line([hinge, open_end], fill=INK, width=3)
        r = w * v.s
        self.d.arc([hinge[0] - r, hinge[1] - r, hinge[0] + r, hinge[1] + r],
                   start=angles[0], end=angles[1], fill=GRAY, width=1)
        # برچسب در
        if wall in ("north", "south"):
            lx, ly = v.P(pos, 0 if wall == "north" else self.depth)
            ly += (-26 if wall == "north" else 26)
        else:
            lx, ly = v.P(0 if wall == "west" else self.width, pos)
            lx += (-26 if wall == "west" else 26)
        self.d.text((lx, ly), f"D{w:.0f}", font=_font(16), fill=GRAY, anchor="mm")

    def _draw_window(self, v: View, win: dict[str, Any]) -> None:
        wall = str(win.get("wall", "north"))
        pos = float(win.get("position_mm") or 0)
        w = float(win.get("width_mm") or 1500)
        self._gap(v, wall, pos, w)
        # سه خط موازی = نماد پنجره
        if wall in ("north", "south"):
            y = 0 if wall == "north" else self.depth
            for off in (-WALL_MM * 0.3, 0, WALL_MM * 0.3):
                v.line((pos - w / 2, y + off), (pos + w / 2, y + off), fill=INK, width=2)
            lx, ly = v.P(pos, y)
            ly += (-30 if wall == "north" else 30)
        else:
            x = 0 if wall == "west" else self.width
            for off in (-WALL_MM * 0.3, 0, WALL_MM * 0.3):
                v.line((x + off, pos - w / 2), (x + off, pos + w / 2), fill=INK, width=2)
            lx, ly = v.P(x, pos)
            lx += (-30 if wall == "west" else 30)
        sill = win.get("sill_height_mm")
        label = f"W{w:.0f}" + (f" h{sill}" if sill else "")
        self.d.text((lx, ly), label, font=_font(16), fill=GRAY, anchor="mm")

    def _unit_rect_top(self, v: View, wall: str, start: float, length: float, depth: float):
        """مستطیل یونیت در نمای بالا."""
        if wall == "north":
            return v.rect(start, 0, length, depth)
        if wall == "south":
            return v.rect(start, self.depth - depth, length, depth)
        if wall == "west":
            return v.rect(0, start, depth, length)
        return v.rect(self.width - depth, start, depth, length)

    def draw_cabinets_top(self, v: View, show_base: bool = True, show_wall: bool = True,
                          show_triangle: bool = False) -> None:
        centers: dict[str, tuple[float, float]] = {}
        for wall, units in self.runs.items():
            run_start, run_end = self.run_span[wall]
            # کابینت‌های زمینی + تجهیزات
            if show_base:
                for u in units:
                    depth = FRIDGE_DEPTH if u.kind == "fridge" else BASE_DEPTH
                    fill = {"sink": SINK_FILL, "stove": STOVE_FILL,
                            "fridge": FRIDGE_FILL}.get(u.kind)
                    rect = self._unit_rect_top(v, wall, u.start, u.length, depth)
                    if fill:
                        self.d.rectangle(rect, fill=fill, outline=INK, width=2)
                    else:
                        self.d.rectangle(rect, outline=INK, width=2)
                    cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
                    label = {"sink": "SINK", "stove": "STOVE", "fridge": "FRIDGE"}.get(u.kind, "")
                    if u.kind == "sink":
                        r = 95 * v.s
                        self.d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=INK, width=2)
                        self.d.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=INK)
                    elif u.kind == "stove":
                        r = 72 * v.s
                        for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                            self.d.ellipse(
                                [cx + dx * r - r * 0.55, cy + dy * r - r * 0.55,
                                 cx + dx * r + r * 0.55, cy + dy * r + r * 0.55],
                                outline=INK, width=2)
                    if label:
                        self.d.text((cx, cy), label, font=_font(15), fill=INK, anchor="mm")
                    if u.kind in ("sink", "stove", "fridge"):
                        centers[u.kind] = (cx, cy)
            # کابینت‌های دیواری (خط‌چین)
            if show_wall:
                skip = self._skip_spans(wall)
                cursor = run_start
                while cursor < run_end - 200:
                    seg_end = min(cursor + MODULE, run_end)
                    if any(cursor < s[1] and seg_end > s[0] for s in skip):
                        cursor = seg_end
                        continue
                    rect = self._unit_rect_top(v, wall, cursor, seg_end - cursor, WALL_DEPTH)
                    _dashed_rect(self.d, rect, GRAY, width=2, dash=8, gap=5)
                    cursor = seg_end
                # هود بالای اجاق در پلان بالا
                stove = self._find("stove", wall)
                if stove:
                    pos = float(stove.get("position_mm") or 0)
                    rect = self._unit_rect_top(v, wall, pos - 450, 900, 600)
                    self.d.rectangle(rect, outline=INK, width=2)
                    cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
                    self.d.text((cx, cy), "HOOD", font=_font(13), fill=INK, anchor="mm")
        # مثلث کاری
        if show_triangle:
            pts = [centers[k] for k in ("sink", "stove", "fridge") if k in centers]
            if len(pts) >= 2:
                for i in range(len(pts)):
                    _dashed_line(self.d, pts[i], pts[(i + 1) % len(pts)], TRIANGLE, width=2)

    def draw_plan_dims(self, v: View) -> None:
        w, dep = self.width, self.depth
        off = WALL_MM + 300
        # عرض — بالا و پایین
        for y, sgn in ((-off, -1), (dep + off, 1)):
            p1, p2 = v.P(0, y), v.P(w, y)
            self._dim_line(p1, p2, f"{w}")
            for x in (0, w):  # خطوط امتداد
                a = v.P(x, -WALL_MM if sgn < 0 else dep + WALL_MM)
                b = v.P(x, y + (30 if sgn < 0 else -30))
                self.d.line([a, b], fill=GRAY, width=1)
        # عمق — چپ و راست
        for x, sgn in ((-off, -1), (w + off, 1)):
            p1, p2 = v.P(x, 0), v.P(x, dep)
            self._dim_line(p1, p2, f"{dep}")
            for yy in (0, dep):
                a = v.P(-WALL_MM if sgn < 0 else w + WALL_MM, yy)
                b = v.P(x + (30 if sgn < 0 else -30), yy)
                self.d.line([a, b], fill=GRAY, width=1)

    def draw_plan_view(self, box, title: str, show_base=True, show_wall=True,
                       show_triangle=False, show_dims=True) -> View:
        v = self._plan_view(box)
        self.draw_walls(v)
        self.draw_cabinets_top(v, show_base, show_wall, show_triangle)
        if show_dims:
            self.draw_plan_dims(v)
        self.view_tag(box, title)
        return v

    # ---------- نمای روبه‌رو (Elevation) ----------
    def draw_elevation(self, box, wall: str) -> None:
        units = self.runs[wall]
        run_start, run_end = self.run_span[wall]
        wall_len = float(self.wall_len(wall))
        v = View(self.d, box, wall_len + 500, ELEV_TOP,
                 ox_mm=-380, oy_mm=0, flip_y=True, pad=4)
        # خط کف
        v.line((-120, 0), (wall_len + 120, 0), fill=INK, width=4)
        # یونیت‌ها
        counter_start = run_start
        for u in units:
            if u.kind == "fridge":
                v.box(u.start, 0, u.length, TALL_H, fill=FRIDGE_FILL, outline=INK, width=2)
                v.line((u.start, 1300), (u.start + u.length, 1300), fill=INK, width=1)
                v.text(u.start + u.length / 2, 700, "FRIDGE", font=_font(16), fill=INK)
                v.text(u.start + u.length / 2, 1700, "TALL UNIT", font=_font(13), fill=GRAY)
                counter_start = max(counter_start, u.start + u.length)
                continue
            # کابینت زمینی
            fill = {"sink": SINK_FILL, "stove": STOVE_FILL}.get(u.kind)
            if fill:
                v.box(u.start, 0, u.length, BASE_H, fill=fill, outline=INK, width=2)
            else:
                v.box(u.start, 0, u.length, BASE_H, outline=INK, width=2)
            # تقسیم درها + دستگیره
            n = max(1, round(u.length / MODULE))
            for i in range(1, n):
                x = u.start + u.length * i / n
                v.line((x, 60), (x, BASE_H - 60), fill=GRAY, width=1)
            v.line((u.start + 60, BASE_H - 90), (u.start + u.length - 60, BASE_H - 90),
                   fill=GRAY, width=2)
            if u.kind == "sink":
                cx = u.start + u.length / 2
                v.box(cx - 300, 520, 600, 340, outline=INK, width=2)   # لگن
                v.line((cx, BASE_H + COUNTER_T), (cx, 1180), fill=INK, width=3)  # شیر
                v.line((cx, 1180), (cx + 90, 1180), fill=INK, width=3)
                v.text(cx, 300, "SINK", font=_font(16), fill=INK)
                # پنجره پشت سینک (خط‌چین)
                win = self._window_on(wall)
                if win:
                    pos = float(win.get("position_mm") or cx)
                    ww = float(win.get("width_mm") or 1500)
                    sill = float(win.get("sill_height_mm") or 900)
                    _dashed_rect(self.d, v.rect(pos - ww / 2, sill, ww, 2100 - sill),
                                 GRAY, width=1, dash=8, gap=5)
            elif u.kind == "stove":
                cx = u.start + u.length / 2
                v.box(u.start + 40, BASE_H, u.length - 80, COUNTER_T, fill=STOVE_FILL, outline=INK, width=1)
                # هود (ذوزنقه)
                hood = [v.P(cx - 450, HOOD_BOTTOM), v.P(cx + 450, HOOD_BOTTOM),
                        v.P(cx + 225, WALLCAB_BOTTOM + WALLCAB_H), v.P(cx - 225, WALLCAB_BOTTOM + WALLCAB_H)]
                self.d.polygon(hood, outline=INK, width=2)
                v.box(cx - 140, WALLCAB_BOTTOM + WALLCAB_H, 280, 2250 - (WALLCAB_BOTTOM + WALLCAB_H),
                      outline=INK, width=1)  # دودکش
                v.text(cx, 400, "STOVE", font=_font(16), fill=INK)
                v.text(cx, HOOD_BOTTOM + 180, "HOOD", font=_font(13), fill=GRAY)
            elif u.length >= 400:
                v.text(u.start + u.length / 2, 420, "BASE CAB", font=_font(13), fill=GRAY)
        # صفحه کابینت
        if run_end > counter_start:
            v.box(counter_start, BASE_H, run_end - counter_start, COUNTER_T,
                  fill=(225, 225, 225), outline=INK, width=2)
        # کابینت‌های دیواری
        skip = self._skip_spans(wall)
        cursor = run_start
        while cursor < run_end - 200:
            seg_end = min(cursor + MODULE, run_end)
            if any(cursor < s[1] and seg_end > s[0] for s in skip):
                cursor = seg_end
                continue
            v.box(cursor, WALLCAB_BOTTOM, seg_end - cursor, WALLCAB_H, outline=INK, width=2)
            v.line((cursor + 50, WALLCAB_BOTTOM + 70), (seg_end - 50, WALLCAB_BOTTOM + 70),
                   fill=GRAY, width=2)
            cursor = seg_end
        # برچسب کابینت دیواری (روی اولین قطعه)
        # خطوط اندازه: عرض در بالا، ارتفاع در چپ
        top_y = ELEV_TOP - 70
        self._dim_line(v.P(0, top_y), v.P(wall_len, top_y), f"{wall_len:.0f}")
        for x in (0, wall_len):
            self.d.line([v.P(x, WALLCAB_BOTTOM + WALLCAB_H), v.P(x, top_y + 40)], fill=GRAY, width=1)
        heights = [(0, BASE_H), (BASE_H, WALLCAB_BOTTOM), (WALLCAB_BOTTOM, WALLCAB_BOTTOM + WALLCAB_H)]
        for h1, h2 in heights:
            p1, p2 = v.P(-300, h1), v.P(-300, h2)
            self._dim_line(p1, p2, f"{h2 - h1:.0f}", font_size=15)
            self.d.line([v.P(0, h2), v.P(-340, h2)], fill=GRAY, width=1)
        self.view_tag(box, f"ELEVATION - {WALL_LABELS[wall]} WALL")

    # ---------- کادر عنوان و راهنما ----------
    def draw_title_block(self, box) -> None:
        x0, y0, x1, y1 = box
        self.d.rectangle(box, outline=INK, width=3)
        today = datetime.date.today().isoformat()
        rows = [
            ("PROJECT", "KITCHEN DESIGN"),
            ("CLIENT", "HV HOUSE"),
            ("DRAWING", "FLOOR PLAN & ELEVATIONS"),
            ("SCALE", "1:50 @ A3"),
            ("DATE", today),
            ("DWG NO", "F204"),
            ("REV", "01"),
            ("LAYOUT", self.layout),
            ("ROOM (mm)", f"{self.width} x {self.depth} x H{self.height}"),
        ]
        total_h = y1 - y0
        row_h = total_h * 0.42 / len(rows)
        self.d.rectangle([x0, y0, x1, y0 + total_h * 0.26], fill=INK)
        self.d.text(((x0 + x1) / 2, y0 + total_h * 0.13), "TITLE BLOCK",
                    font=_font(26), fill="white", anchor="mm")
        y = y0 + total_h * 0.26
        for key, val in rows:
            self.d.line([(x0, y), (x1, y)], fill=INK, width=1)
            self.d.text((x0 + 16, y + row_h / 2), key, font=_font(17), fill=GRAY, anchor="lm")
            self.d.text((x0 + 190, y + row_h / 2), val, font=_font(19), fill=INK, anchor="lm")
            y += row_h
        # راهنما
        ly = y + 14
        self.d.text((x0 + 16, ly), "LEGEND", font=_font(19), fill=INK, anchor="lm")
        ly += 30
        legend = [
            ("WALL (100 THK)", None),
            ("BASE CABINET 600 DEEP", "solid"),
            ("WALL CABINET 350 DEEP", "dashed"),
            ("WORK TRIANGLE", "red"),
            ("D = DOOR   W = WINDOW", None),
        ]
        for label, style in legend:
            if style == "solid":
                self.d.rectangle([x0 + 16, ly - 7, x0 + 56, ly + 7], outline=INK, width=2)
            elif style == "dashed":
                _dashed_rect(self.d, [x0 + 16, ly - 7, x0 + 56, ly + 7], GRAY, width=2)
            elif style == "red":
                _dashed_line(self.d, (x0 + 16, ly), (x0 + 56, ly), TRIANGLE, width=2)
            else:
                self.d.rectangle([x0 + 16, ly - 7, x0 + 56, ly + 7], fill=WALL_FILL, outline=INK, width=1)
            self.d.text((x0 + 68, ly), label, font=_font(15), fill=INK, anchor="lm")
            ly += 26

    def draw_notes(self, box, plan_scale: float) -> None:
        x0, y0, x1, y1 = box
        self.d.rectangle(box, outline=INK, width=2)
        notes = [
            "NOTES:",
            "1. ALL DIMENSIONS IN MM",
            "2. BASE CAB H900 / WALL CAB BOTTOM H1400 / TALL UNIT H2100",
            "3. SINK UNDER WINDOW — STOVE WITH HOOD",
        ]
        if self.notes:
            # شیت فنی لاتین است؛ کاراکترهای غیرلاتین را حذف می‌کنیم
            safe = "".join(c for c in self.notes if ord(c) < 128).strip()
            if safe:
                notes.append(f"4. {safe[:80]}")
        x = x0 + 16
        for n in notes:
            self.d.text((x, (y0 + y1) / 2), n, font=_font(16), fill=INK, anchor="lm")
            x += self.d.textlength(n, font=_font(16)) + 40
        # خط مقیاس (Scale Bar) — هر قطعه ۵۰۰ میلی‌متر
        seg = 500 * plan_scale
        bx = x1 - 4 * seg - 30
        by = (y0 + y1) / 2
        for i in range(4):
            fill = INK if i % 2 == 0 else "white"
            self.d.rectangle([bx + i * seg, by - 8, bx + (i + 1) * seg, by + 8],
                             fill=fill, outline=INK, width=1)
            self.d.text((bx + i * seg, by + 22), f"{i * 500}", font=_font(13), fill=GRAY, anchor="mm")
        self.d.text((bx + 4 * seg, by + 22), "2000 mm", font=_font(13), fill=GRAY, anchor="mm")

    # ---------- رندر نهایی ----------
    def render(self) -> bytes:
        # قاب شیت
        self.d.rectangle([24, 24, SHEET_W - 24, SHEET_H - 24], outline=INK, width=3)
        self.d.rectangle([36, 36, SHEET_W - 36, SHEET_H - 36], outline=INK, width=1)

        # چیدمان نما‌ها
        plan_box = (56, 56, 1690, 1150)
        title_box = (1720, 56, 2544, 560)
        upper_box = (1720, 590, 2544, 1090)
        lower_box = (1720, 1120, 2544, 1700)
        notes_box = (56, 1712, 2544, 1752)

        plan_view = self.draw_plan_view(
            plan_box, "A-101 - FLOOR PLAN", show_triangle=True)
        self.draw_title_block(title_box)
        self.draw_plan_view(upper_box, "A-102 - UPPER CABINET PLAN",
                            show_base=False, show_wall=True, show_dims=False)
        self.draw_plan_view(lower_box, "A-103 - LOWER CABINET PLAN",
                            show_base=True, show_wall=False, show_dims=False)

        # نماهای روبه‌رو — به تعداد دیوارهای کابینت‌دار
        walls = LAYOUT_WALLS[self.layout]
        n = len(walls)
        elev_y0, elev_y1 = 1180, 1700
        total_w = 1690 - 56
        gap = 20
        bw = (total_w - (n - 1) * gap) / n
        for i, wall in enumerate(walls):
            bx0 = 56 + i * (bw + gap)
            self.draw_elevation((bx0, elev_y0, bx0 + bw, elev_y1), wall)

        self.draw_notes(notes_box, plan_view.s)

        buf = io.BytesIO()
        self.img.save(buf, format="PNG")
        return buf.getvalue()


def render_plan_png(analysis: dict[str, Any]) -> bytes:
    """نقطه‌ی ورود اصلی: تولید PNG شیت فنی از دیکشنری تحلیل."""
    return Sheet(analysis).render()
