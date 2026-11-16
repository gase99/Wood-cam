// schema.js — جداول دیتابیس داخلی تلگرام (SQLite).
// استقرار این فایل فقط اسکیما را ثبت می‌کند؛ اعمال تغییرات با `npx tgcloud migrate`.

import { table, integer, text, json, sql } from 'sdk/db';

// وضعیت گفتگوی هر کاربر (جایگزین حافظه‌ی داخلی در نسخه‌ی پایتون)
export const sessions = table('sessions', {
  userId: integer('user_id').primaryKey(),
  state: text('state').notNull().default('idle'),
  analysis: json('analysis'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
