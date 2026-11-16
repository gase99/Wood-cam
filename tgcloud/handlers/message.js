// handlers/message.js — روی هر آپدیت `message` اجرا می‌شود.
// نام فایل = نوع آپدیت تلگرام؛ پلتفرم export default را با payload (Message) صدا میزند.

import { api, db, fetch } from 'sdk';
import { handleMessage } from '../lib/bot.js';
import { createStore } from '../lib/store.js';

export default async function (message) {
  await handleMessage(message, { api, store: createStore(db), fetch });
}
