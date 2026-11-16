// تست لایه‌ی ذخیره‌سازی SQLite با ماک `sdk/db` (همان کد مستقرشونده روی tgcloud)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./mocks/loader.mjs', import.meta.url);

const { createStore } = await import('../tgcloud/lib/store.js');

function makeDb() {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    select() {
      return {
        from(table) {
          assert.equal(table.__table.name, 'sessions');
          return {
            where(cond) {
              assert.equal(cond.op, 'eq');
              return { all: async () => (rows.has(cond.right) ? [rows.get(cond.right)] : []) };
            },
          };
        },
      };
    },
    insert(table) {
      return {
        values(values) {
          return {
            onConflictDoUpdate(opts) {
              return {
                run: async () => {
                  const prev = rows.get(values.userId) ?? {};
                  rows.set(values.userId, { ...prev, ...values, ...opts.set });
                  calls.push(['upsert', values.userId]);
                  return { rowsAffected: 1 };
                },
              };
            },
          };
        },
      };
    },
    delete(table) {
      return {
        where(cond) {
          return {
            run: async () => {
              rows.delete(cond.right);
              calls.push(['delete', cond.right]);
              return { rowsAffected: 1 };
            },
          };
        },
      };
    },
  };
}

test('store — get/set/clear و upsert', async () => {
  const db = makeDb();
  const store = createStore(db);
  assert.equal(await store.get(42), null);

  await store.set(42, 'awaiting_confirm', { room: { width_mm: 3000 } });
  const row = await store.get(42);
  assert.equal(row.state, 'awaiting_confirm');
  assert.deepEqual(row.analysis, { room: { width_mm: 3000 } });
  assert.ok(row.updatedAt instanceof Date);

  // بار دوم همان کاربر باید به‌روزرسانی شود، نه ردیف تکراری
  await store.set(42, 'awaiting_correction', { room: { width_mm: 3200 } });
  assert.equal(db.rows.size, 1);
  assert.equal((await store.get(42)).state, 'awaiting_correction');
  assert.equal((await store.get(42)).analysis.room.width_mm, 3200);

  await store.clear(42);
  assert.equal(await store.get(42), null);
  assert.deepEqual(db.calls, [['upsert', 42], ['upsert', 42], ['delete', 42]]);
});

test('store — تحلیل null در شروع و لغو', async () => {
  const db = makeDb();
  const store = createStore(db);
  await store.set(7, 'awaiting_photo');
  assert.equal((await store.get(7)).analysis, null);
});
