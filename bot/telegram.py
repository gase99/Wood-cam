"""کلاینت سبک برای Telegram Bot API — بدون وابستگی سنگین، مناسب سرورلس.

تمام فراخوانی‌ها با کتابخانه‌ی استاندارد `requests` انجام می‌شوند تا
حجم پکیج نهایی کم و استارتاپ تابع سرورلس سریع باشد.
"""

from __future__ import annotations

import io
import logging
from typing import Any, Optional

import requests

log = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org/bot{token}/{method}"


class TelegramClient:
    """ارتباط با Bot API تلگرام."""

    def __init__(self, token: str, timeout: int = 30):
        if not token:
            raise ValueError("TELEGRAM_BOT_TOKEN تنظیم نشده است.")
        self._token = token
        self._timeout = timeout
        self._session = requests.Session()

    # ---------- فراخوانی عمومی ----------
    def _call(self, method: str, **params: Any) -> dict:
        url = API_BASE.format(token=self._token, method=method)
        resp = self._session.post(url, json=params, timeout=self._timeout)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(f"Telegram API error in {method}: {data}")
        return data["result"]

    # ---------- متدهای مورد استفاده‌ی ربات ----------
    def send_message(
        self,
        chat_id: int,
        text: str,
        reply_markup: Optional[dict] = None,
        parse_mode: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup:
            params["reply_markup"] = reply_markup
        if parse_mode:
            params["parse_mode"] = parse_mode
        return self._call("sendMessage", **params)

    def send_photo(
        self,
        chat_id: int,
        photo: bytes,
        filename: str = "plan.png",
        caption: Optional[str] = None,
        reply_markup: Optional[dict] = None,
    ) -> dict:
        url = API_BASE.format(token=self._token, method="sendPhoto")
        files = {"photo": (filename, io.BytesIO(photo), "image/png")}
        data: dict[str, Any] = {"chat_id": chat_id}
        if caption:
            data["caption"] = caption
        if reply_markup:
            data["reply_markup"] = reply_markup
        resp = self._session.post(url, files=files, data=data, timeout=self._timeout)
        resp.raise_for_status()
        result = resp.json()
        if not result.get("ok"):
            raise RuntimeError(f"Telegram API error in sendPhoto: {result}")
        return result["result"]

    def send_chat_action(self, chat_id: int, action: str = "typing") -> None:
        """نمایش «در حال تایپ...» — برای تجربه‌ی کاربری بهتر."""
        try:
            self._call("sendChatAction", chat_id=chat_id, action=action)
        except Exception:  # noqa: BLE001 — این متد هرگز نباید ربات را خراب کند
            pass

    def answer_callback_query(self, callback_query_id: str, text: Optional[str] = None) -> None:
        params: dict[str, Any] = {"callback_query_id": callback_query_id}
        if text:
            params["text"] = text
        try:
            self._call("answerCallbackQuery", **params)
        except Exception:  # noqa: BLE001
            pass

    def get_file(self, file_id: str) -> bytes:
        """دانلود فایل (عکس اسکیس) از سرورهای تلگرام."""
        result = self._call("getFile", file_id=file_id)
        file_path = result["file_path"]
        url = f"https://api.telegram.org/file/bot{self._token}/{file_path}"
        resp = self._session.get(url, timeout=self._timeout)
        resp.raise_for_status()
        return resp.content

    # ---------- حالت polling (اجرای محلی / VPS) ----------
    def get_updates(self, offset: Optional[int] = None, timeout: int = 30) -> list[dict]:
        params: dict[str, Any] = {"timeout": timeout, "allowed_updates": ["message", "callback_query"]}
        if offset is not None:
            params["offset"] = offset
        return self._call("getUpdates", **params)

    def set_webhook(self, url: str, secret: str = "") -> dict:
        params: dict[str, Any] = {"url": url, "drop_pending_updates": True}
        if secret:
            params["secret_token"] = secret
        return self._call("setWebhook", **params)

    def delete_webhook(self) -> dict:
        return self._call("deleteWebhook", drop_pending_updates=True)
