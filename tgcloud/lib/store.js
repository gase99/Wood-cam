// store.js — ذخیره‌سازی وضعیت گفتگو در دیتابیس داخلی تلگرام (SQLite).
// `db` از SDK تزریق می‌شود تا ماژول قابل تست بماند.

import { eq } from 'sdk/db';
import { sessions } from '../schema.js';

export function createStore(db) {
  return {
    async get(userId) {
      const rows = await db.select().from(sessions).where(eq(sessions.userId, userId)).all();
      return rows[0] ?? null;
    },

    async set(userId, state, analysis = null) {
      const updatedAt = new Date();
      await db.insert(sessions)
        .values({ userId, state, analysis, updatedAt })
        .onConflictDoUpdate({
          target: sessions.userId,
          set: { state, analysis, updatedAt },
        })
        .run();
    },

    async clear(userId) {
      await db.delete(sessions).where(eq(sessions.userId, userId)).run();
    },
  };
}
