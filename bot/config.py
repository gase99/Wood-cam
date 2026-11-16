"""پیکربندی ربات — خواندن تنظیمات از متغیرهای محیطی (Environment Variables).

همه‌ی تنظیمات از طریق فایل .env یا متغیرهای محیطی هاست سرورلس خوانده می‌شوند
تا کد بدون تغییر در هر محیطی (Vercel، Netlify، VPS، ...) اجرا شود.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # توکن ربات تلگرام (از @BotFather)
    telegram_bot_token: str = ""
    # (اختیاری) سکرت وب‌هوک برای اعتبارسنجی درخواست‌ها
    webhook_secret: str = ""
    # --- تنظیمات مدل هوش مصنوعی (سازگار با OpenAI؛ Gemini هم از لایه‌ی
    #     OpenAI-compatible با AI_BASE_URL=.../v1beta/openai پشتیبانی می‌شود) ---
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-4o-mini"
    # اگر کلید AI تنظیم نشود، ربات در «حالت نمایشی» با داده‌ی نمونه کار می‌کند
    demo_mode: bool = True

    @classmethod
    def from_env(cls) -> "Config":
        """ساخت کانفیگ از متغیرهای محیطی."""
        api_key = os.getenv("AI_API_KEY", "").strip()
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
            webhook_secret=os.getenv("WEBHOOK_SECRET", "").strip(),
            ai_api_key=api_key,
            ai_base_url=os.getenv("AI_BASE_URL", "https://api.openai.com/v1").strip(),
            ai_model=os.getenv("AI_MODEL", "gpt-4o-mini").strip(),
            demo_mode=not api_key,
        )
