"""مسیریاب آپدیت‌های تلگرام و ماشین وضعیت گفتگو (State Machine).

جریان کار:
    /start → انتظار عکس → تحلیل AI → نمایش ابعاد + دکمه‌ی تایید
    تایید → ترسیم پلان دوبعدی + جانمایی کابینت → ارسال PNG
    اصلاح → دریافت عکس جدید یا ابعاد متنی → تحلیل مجدد
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .ai_analyzer import analyze_image
from .config import Config
from .planner import render_plan_png
from .store import SessionStore
from .telegram import TelegramClient

log = logging.getLogger(__name__)

# ---------- متن‌های ربات (فارسی) ----------
WELCOME = (
    "👋 سلام! من ربات طراحی پلان آشپزخانه هستم.\n\n"
    "📐 عکس اسکیس دستی یا نقشه‌ی آشپزخانه‌تان را بفرستید تا:\n"
    "۱) ابعاد دیوارها، درها و پنجره‌ها را با هوش مصنوعی استخراج کنم\n"
    "۲) پس از تایید شما، پلان دوبعدی و جانمایی استاندارد کابینت‌ها را ترسیم کنم\n\n"
    "📷 همین حالا عکس نقشه را ارسال کنید.\n"
    "دستورها: /help راهنما | /cancel لغو"
)

HELP = (
    "ℹ️ راهنمای استفاده:\n\n"
    "۱) عکس اسکیس/نقشه‌ی آشپزخانه را بفرستید (بهتر است ابعاد روی آن نوشته شده باشد).\n"
    "۲) ربات ابعاد استخراج‌شده را نمایش می‌دهد؛ اگر درست بود «✅ تایید و ترسیم» را بزنید.\n"
    "۳) پلان دوبعدی با جانمایی کابینت‌ها (زمینی، دیواری، سینک، اجاق، یخچال) برایتان ارسال می‌شود.\n\n"
    "✏️ برای اصلاح: عکس جدید بفرستید یا ابعاد را متنی بنویسید؛ مثلاً: 3000x3600\n"
    "🔄 /cancel برای شروع از اول"
)

ANALYZING = "🔍 در حال تحلیل عکس با هوش مصنوعی... لطفاً صبر کنید."
DRAWING = "✏️ در حال ترسیم پلان دوبعدی و جانمایی کابینت‌ها..."
ERROR = "⚠️ متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید یا /cancel بزنید."
ASK_CORRECTION = (
    "✏️ عکس اصلاح‌شده را بفرستید یا ابعاد جدید را متنی بنویسید "
    "(مثلاً: 3200x3800). برای لغو: /cancel"
)

# ---------- دکمه‌های شیشه‌ای (Inline Keyboard) ----------
KB_CONFIRM = {
    "inline_keyboard": [[
        {"text": "✅ تایید و ترسیم پلان", "callback_data": "confirm_plan"},
        {"text": "✏️ اصلاح ابعاد", "callback_data": "edit_dims"},
    ]]
}
KB_NEW = {
    "inline_keyboard": [[
        {"text": "🔄 نقشه‌ی جدید", "callback_data": "new_plan"},
    ]]
}

# ارقام فارسی/عربی به لاتین
_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _parse_dimensions(text: str) -> tuple[int, int] | None:
    """پارس ابعاد متنی مثل «3000x3600» یا «۳۰۰۰×۳۶۰۰»."""
    text = text.translate(_FA_DIGITS).replace("×", "x").replace("X", "x")
    m = re.search(r"(\d{3,5})\s*x\s*(\d{3,5})", text)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def format_analysis(analysis: dict[str, Any]) -> str:
    """تبدیل JSON تحلیل به متن فارسی خوانا برای کاربر."""
    room = analysis.get("room", {}) or {}
    lines = [
        "📋 ابعاد استخراج‌شده از نقشه:",
        "",
        f"📐 ابعاد اتاق: {room.get('width_mm')} × {room.get('depth_mm')} میلی‌متر "
        f"(ارتفاع {room.get('height_mm')})",
        f"🧩 چیدمان کابینت: {analysis.get('layout')}",
    ]
    doors = analysis.get("doors") or []
    if doors:
        lines.append("🚪 درها:")
        for d in doors:
            lines.append(f"  • دیوار {d.get('wall')}: عرض {d.get('width_mm')}، موقعیت {d.get('position_mm')}")
    windows = analysis.get("windows") or []
    if windows:
        lines.append("🪟 پنجره‌ها:")
        for w in windows:
            lines.append(
                f"  • دیوار {w.get('wall')}: عرض {w.get('width_mm')}، موقعیت {w.get('position_mm')}"
                + (f"، ارتفاع زیر پنجره {w.get('sill_height_mm')}" if w.get("sill_height_mm") else "")
            )
    obstacles = analysis.get("obstacles") or []
    if obstacles:
        lines.append("🔧 موانع/تجهیزات:")
        for ob in obstacles:
            lines.append(f"  • {ob.get('type')} روی دیوار {ob.get('wall')} (موقعیت {ob.get('position_mm')})")
    if analysis.get("notes"):
        lines.append(f"\n📝 {analysis['notes']}")
    lines.append("\nاگر ابعاد درست است، «✅ تایید و ترسیم پلان» را بزنید.")
    return "\n".join(lines)


class Bot:
    """هسته‌ی ربات: پردازش آپدیت‌ها و مدیریت وضعیت هر کاربر."""

    def __init__(self, client: TelegramClient, store: SessionStore, config: Config):
        self.client = client
        self.store = store
        self.config = config

    # ---------- نقطه‌ی ورود ----------
    def handle_update(self, update: dict[str, Any]) -> None:
        """پردازش یک آپدیت تلگرام (پیام یا دکمه)."""
        if "callback_query" in update:
            self._handle_callback(update["callback_query"])
        elif "message" in update:
            self._handle_message(update["message"])

    # ---------- پیام‌ها ----------
    def _handle_message(self, msg: dict[str, Any]) -> None:
        chat_id = msg["chat"]["id"]
        user_id = msg["from"]["id"]
        text = (msg.get("text") or "").strip()
        session = self.store.get(user_id) or {"state": "idle"}

        if text.startswith("/start"):
            self.store.set(user_id, {"state": "awaiting_photo"})
            self.client.send_message(chat_id, WELCOME)
            return
        if text.startswith("/help"):
            self.client.send_message(chat_id, HELP)
            return
        if text.startswith("/cancel"):
            self.store.clear(user_id)
            self.client.send_message(chat_id, "لغو شد. برای شروع دوباره /start بزنید.")
            return

        # دریافت عکس اسکیس
        if "photo" in msg:
            self._process_photo(chat_id, user_id, msg["photo"][-1]["file_id"])
            return

        # اصلاح متنی ابعاد
        if session.get("state") == "awaiting_correction" and text:
            dims = _parse_dimensions(text)
            if dims and session.get("analysis"):
                analysis = session["analysis"]
                analysis["room"]["width_mm"], analysis["room"]["depth_mm"] = dims
                self.store.set(user_id, {"state": "awaiting_confirm", "analysis": analysis})
                self.client.send_message(
                    chat_id, format_analysis(analysis), reply_markup=KB_CONFIRM)
            else:
                self.client.send_message(chat_id, ASK_CORRECTION)
            return

        # پیام پیش‌فرض
        if session.get("state") == "awaiting_photo":
            self.client.send_message(chat_id, "📷 لطفاً عکس نقشه/اسکیس آشپزخانه را بفرستید.")
        elif session.get("state") == "awaiting_confirm":
            self.client.send_message(
                chat_id, "لطفاً یکی از دکمه‌ها را بزنید: تایید یا اصلاح.", reply_markup=KB_CONFIRM)
        else:
            self.client.send_message(chat_id, WELCOME)

    def _process_photo(self, chat_id: int, user_id: int, file_id: str) -> None:
        self.client.send_chat_action(chat_id)
        self.client.send_message(chat_id, ANALYZING)
        try:
            image_bytes = self.client.get_file(file_id)
            analysis = analyze_image(image_bytes, self.config)
        except Exception:  # noqa: BLE001
            log.exception("AI analysis failed")
            self.client.send_message(chat_id, ERROR)
            return
        self.store.set(user_id, {"state": "awaiting_confirm", "analysis": analysis})
        self.client.send_message(chat_id, format_analysis(analysis), reply_markup=KB_CONFIRM)

    # ---------- دکمه‌ها ----------
    def _handle_callback(self, query: dict[str, Any]) -> None:
        data = query.get("data", "")
        chat_id = query["message"]["chat"]["id"]
        user_id = query["from"]["id"]
        self.client.answer_callback_query(query["id"])
        session = self.store.get(user_id) or {}

        if data == "confirm_plan":
            analysis = session.get("analysis")
            if not analysis:
                self.client.send_message(chat_id, "⚠️ ابتدا عکس نقشه را بفرستید.")
                return
            self.client.send_chat_action(chat_id)
            self.client.send_message(chat_id, DRAWING)
            try:
                png = render_plan_png(analysis)
            except Exception:  # noqa: BLE001
                log.exception("Plan rendering failed")
                self.client.send_message(chat_id, ERROR)
                return
            self.store.clear(user_id)
            self.client.send_photo(
                chat_id, png, filename="kitchen_plan.png",
                caption="📐 پلان دوبعدی و جانمایی استاندارد کابینت‌ها آماده شد!",
                reply_markup=KB_NEW,
            )

        elif data == "edit_dims":
            self.store.set(user_id, {"state": "awaiting_correction",
                                     "analysis": session.get("analysis")})
            self.client.send_message(chat_id, ASK_CORRECTION)

        elif data == "new_plan":
            self.store.set(user_id, {"state": "awaiting_photo"})
            self.client.send_message(chat_id, "📷 عکس نقشه‌ی جدید را بفرستید.")
