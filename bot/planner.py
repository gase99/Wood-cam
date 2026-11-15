"""موتور ترسیم پلان دوبعدی آشپزخانه و جانمایی استاندارد یونیت‌های کابینت.

ورودی: دیکشنری تحلیل (خروجی `bot.ai_analyzer`)
خروجی: بایت‌های PNG آماده‌ی ارسال در تلگرام

قواعد ارگونومی اعمال‌شده:
- عمق کابینت زمینی ۶۰۰ میلی‌متر، کابینت دیواری ۳۵۰ میلی‌متر
- سینک زیر پنجره، اجاق کنار سینک (حداقل ۳۰۰ میلی‌متر فاصله)، یخچال در انتهای ردیف
- مثلث کاری (سینک–اجاق–یخچال) به‌صورت خط‌چین نمایش داده می‌شود
- یونیت‌ها با مدول استاندارد ۶۰۰ میلی‌متری تقسیم می‌شوند
"""

from __future__ import annotations

import io
import math
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont

# ---------- ثابت‌های استاندارد طراحی (میلی‌متر) ----------
BASE_DEPTH = 600        # عمق کابینت زمینی
WALL_DEPTH = 350        # عمق کابینت دیواری
MODULE = 600            # مدول استاندارد یونیت
SINK_W = 800            # عرض یونیت سینک
STOVE_W = 600           # عرض یونیت اجاق
FRIDGE_W = 700          # عرض یونیت بلند یخچال
MIN_STOVE_GAP = 300     # حداقل فاصله‌ی سینک تا اجاق

# ---------- رنگ‌ها (سبک نقشه‌ی فنی) ----------
INK = (30, 30, 30)
GRAY = (120, 120, 120)
LIGHT = (245, 245, 245)
SINK_FILL = (220, 235, 245)
STOVE_FILL = (235, 235, 235)
FRIDGE_FILL = (250, 245, 220)
TRIANGLE = (200, 60, 60)

# دیوارهای دارای کابینت بر اساس نوع چیدمان
LAYOUT_WALLS = {
    "L": ["north", "west"],
    "U": ["north", "west", "east"],
    "I": ["north"],
    "PARALLEL": ["north", "south"],
}


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


class _Plan:
    """کلاس کمکی برای ترسیم پلان با مختصات واقعی (میلی‌متر)."""

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

        # محاسبه‌ی مقیاس و ابعاد بوم
        self.margin = 140          # حاشیه برای خطوط اندازه
        self.top_margin = 70
        self.title_h = 110
        max_w, max_h = 1600, 1250
        self.scale = min(
            (max_w - 2 * self.margin) / self.width,
            (max_h - self.top_margin - self.margin - self.title_h) / self.depth,
        )
        self.ox = self.margin      # مبدأ (گوشه‌ی شمال‌غربی اتاق) در پیکسل
        self.oy = self.top_margin
        self.canvas_w = int(self.width * self.scale) + 2 * self.margin
        self.canvas_h = int(self.depth * self.scale) + self.top_margin + self.margin + self.title_h

        self.img = Image.new("RGB", (self.canvas_w, self.canvas_h), "white")
        self.d = ImageDraw.Draw(self.img)
        self.wall_t = max(8, min(16, int(100 * self.scale)))  # ضخامت دیوار (پیکسل)

    # ---------- تبدیل مختصات ----------
    def X(self, x_mm: float) -> float:
        return self.ox + x_mm * self.scale

    def Y(self, y_mm: float) -> float:
        return self.oy + y_mm * self.scale

    def wall_point(self, wall: str, pos_mm: float) -> tuple[float, float]:
        """نقطه روی دیوار بر اساس فاصله از گوشه‌ی شروع (میلی‌متر)."""
        if wall == "north":
            return self.X(pos_mm), self.Y(0)
        if wall == "south":
            return self.X(pos_mm), self.Y(self.depth)
        if wall == "west":
            return self.X(0), self.Y(pos_mm)
        return self.X(self.width), self.Y(pos_mm)  # east

    def wall_len(self, wall: str) -> int:
        return self.width if wall in ("north", "south") else self.depth

    # ---------- ترسیم دیوارها با بازشوها ----------
    def draw_walls(self) -> None:
        # کف اتاق
        self.d.rectangle(
            [self.X(0), self.Y(0), self.X(self.width), self.Y(self.depth)],
            fill=LIGHT, outline=INK, width=self.wall_t,
        )
        # بازشوهای در و پنجره روی دیوارها
        for door in self.doors:
            self._draw_door(door)
        for win in self.windows:
            self._draw_window(win)

    def _gap(self, wall: str, center: float, width: float) -> None:
        """پاک‌کردن (سفید کردن) بخش دیوار برای بازشو."""
        half = width / 2
        p1 = self.wall_point(wall, center - half)
        p2 = self.wall_point(wall, center + half)
        t = self.wall_t + 4
        self.d.line([p1, p2], fill="white", width=t)

    def _draw_door(self, door: dict[str, Any]) -> None:
        wall = str(door.get("wall", "south"))
        pos = float(door.get("position_mm") or 0)
        w = float(door.get("width_mm") or 900)
        self._gap(wall, pos, w)
        # لنگه‌ی در + قوس بازشو (ربع‌دایره)
        hinge = self.wall_point(wall, pos - w / 2)
        leaf_end = self.wall_point(wall, pos + w / 2)
        # جهت داخل اتاق
        inward = {"north": (0, 1), "south": (0, -1), "west": (1, 0), "east": (-1, 0)}[wall]
        open_end = (hinge[0] + inward[0] * w * self.scale, hinge[1] + inward[1] * w * self.scale)
        self.d.line([hinge, open_end], fill=INK, width=3)
        r = w * self.scale
        bbox = [hinge[0] - r, hinge[1] - r, hinge[0] + r, hinge[1] + r]
        # زاویه‌های قوس بر اساس جهت دیوار (۰ درجه = شرق، ساعت‌گرد)
        arc_angles = {"north": (0, 90), "south": (270, 360), "west": (0, 90), "east": (90, 180)}
        a0, a1 = arc_angles[wall]
        self.d.arc(bbox, start=a0, end=a1, fill=GRAY, width=1)
        self.d.text(
            ((leaf_end[0] + hinge[0]) / 2, (leaf_end[1] + hinge[1]) / 2),
            f"D{w:.0f}", font=_font(16), fill=GRAY, anchor="mm",
        )

    def _draw_window(self, win: dict[str, Any]) -> None:
        wall = str(win.get("wall", "north"))
        pos = float(win.get("position_mm") or 0)
        w = float(win.get("width_mm") or 1500)
        self._gap(wall, pos, w)
        p1 = self.wall_point(wall, pos - w / 2)
        p2 = self.wall_point(wall, pos + w / 2)
        # سه خط موازی = نماد پنجره
        for off in (-4, 0, 4):
            self.d.line(
                [(p1[0], p1[1] + off), (p2[0], p2[1] + off)],
                fill=INK, width=2,
            )
        sill = win.get("sill_height_mm")
        label = f"W{w:.0f}" + (f" h{sill}" if sill else "")
        # برچسب به سمت بیرون دیوار (تا زیر کابینت نرود)
        outward = {"north": (0, -1), "south": (0, 1), "west": (-1, 0), "east": (1, 0)}[wall]
        lx = (p1[0] + p2[0]) / 2 + outward[0] * 24
        ly = (p1[1] + p2[1]) / 2 + outward[1] * 24
        self.d.text((lx, ly), label, font=_font(16), fill=GRAY, anchor="mm")

    # ---------- جانمایی کابینت‌ها ----------
    def _obstacle(self, kind: str, wall: str) -> Optional[dict[str, Any]]:
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
        """بازه‌ی اشغال‌شده توسط در روی دیوار (برای خالی گذاشتن کابینت)."""
        for door in self.doors:
            if str(door.get("wall", "")) == wall:
                pos = float(door.get("position_mm") or 0)
                w = float(door.get("width_mm") or 900)
                return (pos - w / 2 - 100, pos + w / 2 + 100)
        return None

    def _rect_on_wall(
        self, wall: str, start_mm: float, length_mm: float, depth_mm: float
    ) -> tuple[tuple[float, float], tuple[float, float]]:
        """مستطیل کابینت روی دیوار: (گوشه‌ی نزدیک دیوار، گوشه‌ی دور)."""
        if wall == "north":
            return (self.X(start_mm), self.Y(0)), (self.X(start_mm + length_mm), self.Y(depth_mm))
        if wall == "south":
            return (self.X(start_mm), self.Y(self.depth - depth_mm)), (
                self.X(start_mm + length_mm), self.Y(self.depth))
        if wall == "west":
            return (self.X(0), self.Y(start_mm)), (self.X(depth_mm), self.Y(start_mm + length_mm))
        return (self.X(self.width - depth_mm), self.Y(start_mm)), (
            self.X(self.width), self.Y(start_mm + length_mm))  # east

    def draw_cabinet_run(self, wall: str, corner_offset: float = 0.0) -> Optional[dict[str, tuple[float, float]]]:
        """ترسیم یک ردیف کابینت روی دیوار؛ برمی‌گرداند مراکز سینک/اجاق/یخچال.

        corner_offset: فاصله از گوشه (برای جلوگیری از هم‌پوشانی در چیدمان L/U).
        """
        total = self.wall_len(wall)
        door_span = self._door_span(wall)
        # محدوده‌ی قابل استفاده (با احترام به گوشه و بازشوی در)
        run_start, run_end = corner_offset, float(total)
        if door_span:
            if door_span[0] < total / 2:  # در نیمه‌ی اول دیوار
                run_start = max(run_start, door_span[1])
            else:
                run_end = door_span[0]
        run_len = run_end - run_start
        if run_len < 600:
            return None

        centers: dict[str, tuple[float, float]] = {}
        cursor = run_start

        def place(length: float, label: str, fill=None, dashed: bool = False,
                  font_size: int = 15) -> tuple[float, float]:
            nonlocal cursor
            p1, p2 = self._rect_on_wall(wall, cursor, length, BASE_DEPTH)
            if fill:
                self.d.rectangle([p1, p2], fill=fill, outline=INK, width=2)
            else:
                self.d.rectangle([p1, p2], outline=INK, width=2)
            cx, cy = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
            if label:
                self.d.text((cx, cy), label, font=_font(font_size), fill=INK, anchor="mm")
            cursor += length
            return cx, cy

        # ۱) یخچال در ابتدای ردیف (یونیت بلند)
        fridge = self._obstacle("fridge", wall)
        if fridge and run_len > FRIDGE_W + 900:
            centers["fridge"] = place(FRIDGE_W, "FRIDGE", fill=FRIDGE_FILL)

        # ۲) سینک — زیر پنجره اگر پنجره روی همین دیوار است
        sink = self._obstacle("sink", wall)
        win = self._window_on(wall)
        sink_pos = float(sink.get("position_mm") or 0) if sink else None
        if sink_pos is None and win:
            sink_pos = float(win.get("position_mm") or 0)
        if sink_pos is not None:
            # جابه‌جایی سینک به داخل محدوده‌ی ردیف
            sink_start = max(run_start, min(sink_pos - SINK_W / 2, run_end - SINK_W))
            if sink_start > cursor:
                self._fill_modules(wall, sink_start - cursor, cursor_ref=[cursor])
                cursor = sink_start
            centers["sink"] = place(SINK_W, "", fill=SINK_FILL)
            self._draw_sink_detail(wall, centers["sink"])
            self.d.text(centers["sink"], "SINK", font=_font(15), fill=INK, anchor="mm")

        # ۳) اجاق — کنار سینک با حداقل فاصله‌ی استاندارد
        stove = self._obstacle("stove", wall)
        if stove:
            gap = MIN_STOVE_GAP if cursor + MIN_STOVE_GAP + STOVE_W <= run_end else 0
            if gap:
                self._fill_modules(wall, gap, cursor_ref=[cursor])
                cursor += gap
            if cursor + STOVE_W <= run_end:
                centers["stove"] = place(STOVE_W, "", fill=STOVE_FILL)
                self._draw_stove_detail(wall, centers["stove"])
                self.d.text(centers["stove"], "STOVE", font=_font(15), fill=INK, anchor="mm")

        # ۴) بقیه‌ی مسیر با مدول‌های ۶۰۰ میلی‌متری
        self._fill_modules(wall, run_end - cursor, cursor_ref=[cursor])
        cursor = run_end

        # کابینت‌های دیواری (خط‌چین) بالای یونیت‌های زمینی
        self._draw_wall_cabinets(wall, run_start, run_end, door_span)
        return centers

    def _fill_modules(self, wall: str, length: float, cursor_ref: list[float]) -> None:
        """پر کردن مسیر با مدول‌های ۶۰۰ میلی‌متری (آخرین مدول تنظیم می‌شود)."""
        cursor = cursor_ref[0]
        remaining = length
        while remaining >= MODULE - 1:
            p1, p2 = self._rect_on_wall(wall, cursor, MODULE, BASE_DEPTH)
            self.d.rectangle([p1, p2], outline=INK, width=2)
            cursor += MODULE
            remaining -= MODULE
        if remaining >= 200:  # مدول آخر کوچک‌تر از استاندارد نباشد
            p1, p2 = self._rect_on_wall(wall, cursor, remaining, BASE_DEPTH)
            self.d.rectangle([p1, p2], outline=INK, width=2)
            cursor += remaining
        cursor_ref[0] = cursor

    def _draw_wall_cabinets(self, wall: str, start: float, end: float,
                            door_span: Optional[tuple[float, float]]) -> None:
        """کابینت دیواری به‌صورت مستطیل خط‌چین (بالای کابینت زمینی)."""
        # بالای سینک (پنجره) و اجاق (هود) کابینت دیواری نمی‌گذاریم
        skip: list[tuple[float, float]] = []
        win = self._window_on(wall)
        if win:
            pos = float(win.get("position_mm") or 0)
            w = float(win.get("width_mm") or 1500)
            skip.append((pos - w / 2, pos + w / 2))
        stove = self._obstacle("stove", wall)
        if stove:
            pos = float(stove.get("position_mm") or 0)
            skip.append((pos - STOVE_W / 2 - 50, pos + STOVE_W / 2 + 50))

        cursor = start
        while cursor < end - 200:
            seg_end = min(cursor + MODULE, end)
            if any(cursor < s[1] and seg_end > s[0] for s in skip):
                cursor = seg_end
                continue
            p1, p2 = self._rect_on_wall(wall, cursor, seg_end - cursor, WALL_DEPTH)
            self._dashed_rect(p1, p2, GRAY, width=2, dash=8, gap=5)
            cursor = seg_end

    def _dashed_rect(self, p1, p2, color, width=2, dash=8, gap=5) -> None:
        x1, y1 = p1
        x2, y2 = p2

        def dashed_line(a, b):
            dist = math.hypot(b[0] - a[0], b[1] - a[1])
            if dist == 0:
                return
            ux, uy = (b[0] - a[0]) / dist, (b[1] - a[1]) / dist
            t = 0.0
            while t < dist:
                t2 = min(t + dash, dist)
                self.d.line([(a[0] + ux * t, a[1] + uy * t),
                             (a[0] + ux * t2, a[1] + uy * t2)], fill=color, width=width)
                t += dash + gap

        dashed_line((x1, y1), (x2, y1))
        dashed_line((x2, y1), (x2, y2))
        dashed_line((x2, y2), (x1, y2))
        dashed_line((x1, y2), (x1, y1))

    def _draw_sink_detail(self, wall: str, center: tuple[float, float]) -> None:
        cx, cy = center
        r = 90 * self.scale
        self.d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=INK, width=2)
        self.d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=INK)

    def _draw_stove_detail(self, wall: str, center: tuple[float, float]) -> None:
        cx, cy = center
        r = 70 * self.scale
        for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            self.d.ellipse(
                [cx + dx * r - r * 0.55, cy + dy * r - r * 0.55,
                 cx + dx * r + r * 0.55, cy + dy * r + r * 0.55],
                outline=INK, width=2,
            )

    # ---------- خطوط اندازه و کادر عنوان ----------
    def draw_dimensions(self) -> None:
        f = _font(18)
        # عرض (بالا و پایین)
        self._dim_line((self.X(0), self.Y(0)), (self.X(self.width), self.Y(0)),
                       (0, -34), f"{self.width}")
        self._dim_line((self.X(0), self.Y(self.depth)), (self.X(self.width), self.Y(self.depth)),
                       (0, 34), f"{self.width}")
        # عمق (چپ و راست)
        self._dim_line((self.X(0), self.Y(0)), (self.X(0), self.Y(self.depth)),
                       (-34, 0), f"{self.depth}")
        self._dim_line((self.X(self.width), self.Y(0)), (self.X(self.width), self.Y(self.depth)),
                       (34, 0), f"{self.depth}")

    def _dim_line(self, p1, p2, offset, label: str) -> None:
        q1 = (p1[0] + offset[0], p1[1] + offset[1])
        q2 = (p2[0] + offset[0], p2[1] + offset[1])
        self.d.line([q1, q2], fill=GRAY, width=1)
        for q in (q1, q2):  # تیک‌های انتهایی
            self.d.line([(q[0] - 5, q[1] - 5), (q[0] + 5, q[1] + 5)], fill=GRAY, width=1)
        mid = ((q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2)
        # پس‌زمینه‌ی سفید برای خوانایی برچسب
        self.d.rectangle([mid[0] - 34, mid[1] - 12, mid[0] + 34, mid[1] + 12], fill="white")
        self.d.text(mid, label, font=_font(18), fill=INK, anchor="mm")

    def draw_title(self) -> None:
        y = self.canvas_h - self.title_h + 18
        self.d.line([(self.margin - 40, y - 14), (self.canvas_w - self.margin + 40, y - 14)],
                    fill=INK, width=2)
        title = f"KITCHEN FLOOR PLAN  |  LAYOUT: {self.layout}  |  ROOM: {self.width} x {self.depth} x H{self.height} mm"
        self.d.text((self.canvas_w / 2, y + 22), title, font=_font(24), fill=INK, anchor="mm")
        sub = "Base cabinets 600mm deep  |  Wall cabinets 350mm (dashed)  |  Red dashed = work triangle (sink-stove-fridge)"
        self.d.text((self.canvas_w / 2, y + 58), sub, font=_font(16), fill=GRAY, anchor="mm")
        # جهت شمال
        nx, ny = self.canvas_w - 60, y + 30
        self.d.line([(nx, ny + 22), (nx, ny - 22)], fill=INK, width=2)
        self.d.polygon([(nx, ny - 30), (nx - 7, ny - 16), (nx + 7, ny - 16)], fill=INK)
        self.d.text((nx, ny + 38), "N", font=_font(18), fill=INK, anchor="mm")

    def draw_work_triangle(self, centers: dict[str, tuple[float, float]]) -> None:
        pts = [centers[k] for k in ("sink", "stove", "fridge") if k in centers]
        if len(pts) >= 2:
            for i in range(len(pts)):
                a, b = pts[i], pts[(i + 1) % len(pts)]
                self._dashed_line(a, b, TRIANGLE)

    def _dashed_line(self, a, b, color) -> None:
        dist = math.hypot(b[0] - a[0], b[1] - a[1])
        if dist == 0:
            return
        ux, uy = (b[0] - a[0]) / dist, (b[1] - a[1]) / dist
        t = 0.0
        while t < dist:
            t2 = min(t + 10, dist)
            self.d.line([(a[0] + ux * t, a[1] + uy * t),
                         (a[0] + ux * t2, a[1] + uy * t2)], fill=color, width=2)
            t += 16

    # ---------- رندر نهایی ----------
    def render(self) -> bytes:
        self.draw_walls()
        all_centers: dict[str, tuple[float, float]] = {}
        for wall in LAYOUT_WALLS[self.layout]:
            # دیوارهای غربی/شرقی در چیدمان L/U گوشه را با دیوار شمالی شریک‌اند
            offset = BASE_DEPTH if wall in ("west", "east") else 0.0
            centers = self.draw_cabinet_run(wall, corner_offset=offset)
            if centers:
                all_centers.update(centers)
        self.draw_work_triangle(all_centers)
        self.draw_dimensions()
        self.draw_title()
        buf = io.BytesIO()
        self.img.save(buf, format="PNG")
        return buf.getvalue()


def render_plan_png(analysis: dict[str, Any]) -> bytes:
    """نقطه‌ی ورود اصلی: تولید PNG پلان از دیکشنری تحلیل."""
    return _Plan(analysis).render()
