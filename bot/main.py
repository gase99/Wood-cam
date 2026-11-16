"""اجرای محلی ربات با Long Polling — برای تست و VPS.

استفاده:
    export TELEGRAM_BOT_TOKEN=...
    export AI_API_KEY=...        # اختیاری؛ بدون آن حالت نمایشی فعال است
    python -m bot.main
"""

from __future__ import annotations

import logging
import time

from .config import Config
from .handlers import Bot
from .store import MemoryStore
from .telegram import TelegramClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


def run_polling() -> None:
    config = Config.from_env()
    if not config.telegram_bot_token:
        raise SystemExit("TELEGRAM_BOT_TOKEN تنظیم نشده است. فایل .env را بررسی کنید.")
    client = TelegramClient(config.telegram_bot_token)
    bot = Bot(client, MemoryStore(), config)
    log.info("Bot started (polling mode). Demo mode: %s", config.demo_mode)

    offset = None
    while True:
        try:
            updates = client.get_updates(offset=offset, timeout=30)
        except Exception:  # noqa: BLE001
            log.exception("getUpdates failed, retrying in 5s")
            time.sleep(5)
            continue
        for update in updates:
            offset = update["update_id"] + 1
            try:
                bot.handle_update(update)
            except Exception:  # noqa: BLE001
                log.exception("Error handling update %s", update.get("update_id"))


if __name__ == "__main__":
    run_polling()
