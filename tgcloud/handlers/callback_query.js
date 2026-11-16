// handlers/callback_query.js — روی فشردن دکمه‌های شیشه‌ای (Inline Keyboard) اجرا می‌شود.

import { api, db, fetch, InputFile } from 'sdk';
import { handleCallback } from '../lib/bot.js';
import { createStore } from '../lib/store.js';

export default async function (query) {
  await handleCallback(query, { api, store: createStore(db), fetch, InputFile });
}
