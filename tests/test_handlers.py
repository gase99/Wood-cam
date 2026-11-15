"""تست سرتاسری جریان گفتگو با کلاینت تلگرام جعلی."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config import Config
from bot.handlers import Bot
from bot.store import MemoryStore


class FakeClient:
    """کلاینت جعلی برای تست — همه‌ی فراخوانی‌ها را ضبط می‌کند."""

    def __init__(self):
        self.messages = []   # (chat_id, text)
        self.photos = []     # (chat_id, bytes)
        self.markups = []

    def send_message(self, chat_id, text, reply_markup=None, parse_mode=None):
        self.messages.append((chat_id, text))
        self.markups.append(reply_markup)
        return {}

    def send_photo(self, chat_id, photo, filename="plan.png", caption=None, reply_markup=None):
        self.photos.append((chat_id, photo))
        return {}

    def send_chat_action(self, chat_id, action="typing"):
        pass

    def answer_callback_query(self, callback_query_id, text=None):
        pass

    def get_file(self, file_id):
        return b"fake-image-bytes"


def _msg(text=None, photo=False):
    m = {"chat": {"id": 1}, "from": {"id": 42}}
    if text:
        m["text"] = text
    if photo:
        m["photo"] = [{"file_id": "fid"}]
    return {"message": m}


def _callback(data):
    return {"callback_query": {
        "id": "q1", "data": data,
        "from": {"id": 42}, "message": {"chat": {"id": 1}},
    }}


def test_full_flow():
    client = FakeClient()
    config = Config(telegram_bot_token="x", demo_mode=True)
    bot = Bot(client, MemoryStore(), config)

    bot.handle_update(_msg("/start"))
    assert any("سلام" in t for _, t in client.messages)

    bot.handle_update(_msg(photo=True))
    assert any("ابعاد استخراج‌شده" in t for _, t in client.messages)

    bot.handle_update(_callback("confirm_plan"))
    assert len(client.photos) == 1
    assert client.photos[0][1].startswith(b"\x89PNG")  # PNG معتبر


def test_correction_flow():
    client = FakeClient()
    config = Config(telegram_bot_token="x", demo_mode=True)
    bot = Bot(client, MemoryStore(), config)

    bot.handle_update(_msg("/start"))
    bot.handle_update(_msg(photo=True))
    bot.handle_update(_callback("edit_dims"))
    bot.handle_update(_msg("3200x3800"))
    assert any("3200" in t and "3800" in t for _, t in client.messages)


def test_cancel():
    client = FakeClient()
    config = Config(telegram_bot_token="x", demo_mode=True)
    bot = Bot(client, MemoryStore(), config)

    bot.handle_update(_msg("/start"))
    bot.handle_update(_msg("/cancel"))
    assert any("لغو" in t for _, t in client.messages)
