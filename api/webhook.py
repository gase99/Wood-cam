"""نقطه‌ی ورود سرورلس (Webhook) — سازگار با Vercel / Netlify / هر هاست HTTP.

تلگرام آپدیت‌ها را با POST به این آدرس می‌فرستد:
    https://<your-domain>/api/webhook

تنظیم وب‌هوک (یک‌بار):
    curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/webhook"

متغیرهای محیطی موردنیاز:
    TELEGRAM_BOT_TOKEN (اجباری)
    AI_API_KEY         (اختیاری — بدون آن حالت نمایشی فعال است)
    WEBHOOK_SECRET     (اختیاری — برای اعتبارسنجی هدر X-Telegram-Bot-Api-Secret-Token)
"""

from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler

# اطمینان از در دسترس بودن پکیج bot در محیط سرورلس
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config import Config  # noqa: E402
from bot.handlers import Bot  # noqa: E402
from bot.store import MemoryStore  # noqa: E402
from bot.telegram import TelegramClient  # noqa: E402

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ساخت نمونه‌های سراسری (reuse بین فراخوانی‌های گرم سرورلس)
_config = Config.from_env()
_client = TelegramClient(_config.telegram_bot_token) if _config.telegram_bot_token else None
_bot = Bot(_client, MemoryStore(), _config) if _client else None


class handler(BaseHTTPRequestHandler):
    """هندلر سازگار با Vercel Python Runtime."""

    def do_POST(self):  # noqa: N802
        if _bot is None:
            self._respond(500, {"ok": False, "error": "TELEGRAM_BOT_TOKEN not configured"})
            return
        # اعتبارسنجی سکرت وب‌هوک (در صورت تنظیم)
        if _config.webhook_secret:
            token = self.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
            if token != _config.webhook_secret:
                self._respond(403, {"ok": False, "error": "forbidden"})
                return
        length = int(self.headers.get("Content-Length", 0))
        try:
            update = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._respond(400, {"ok": False, "error": "invalid json"})
            return
        try:
            _bot.handle_update(update)
        except Exception:  # noqa: BLE001
            log.exception("Error handling update")
        self._respond(200, {"ok": True})

    def do_GET(self):  # noqa: N802
        """بررسی سلامت (Health Check)."""
        self._respond(200, {"ok": True, "service": "Wood-cam Telegram Bot"})

    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # noqa: D102 — بی‌صدا کردن لاگ پیش‌فرض
        pass
