"""ذخیره‌سازی وضعیت گفتگو (Session Store).

پیاده‌سازی پیش‌فرض: حافظه‌ی داخلی (مناسب تست و استقرار تک‌نمونه‌ای).
برای استقرار سرورلس چندنمونه‌ای در پروداکشن، همین اینترفیس را با
Redis/Upstash KV یا Cloudflare KV پیاده‌سازی کنید — بقیه‌ی کد بدون تغییر کار می‌کند.
"""

from __future__ import annotations

import time
from typing import Any, Optional


class SessionStore:
    """اینترفیس ذخیره‌سازی سشن کاربر."""

    def get(self, user_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def set(self, user_id: int, data: dict[str, Any]) -> None:
        raise NotImplementedError

    def clear(self, user_id: int) -> None:
        raise NotImplementedError


class MemoryStore(SessionStore):
    """ذخیره‌سازی در حافظه با انقضای خودکار (TTL)."""

    def __init__(self, ttl_seconds: int = 3600):
        self._data: dict[int, tuple[float, dict[str, Any]]] = {}
        self._ttl = ttl_seconds

    def get(self, user_id: int) -> Optional[dict[str, Any]]:
        item = self._data.get(user_id)
        if not item:
            return None
        ts, data = item
        if time.time() - ts > self._ttl:
            self._data.pop(user_id, None)
            return None
        return data

    def set(self, user_id: int, data: dict[str, Any]) -> None:
        self._data[user_id] = (time.time(), data)

    def clear(self, user_id: int) -> None:
        self._data.pop(user_id, None)
