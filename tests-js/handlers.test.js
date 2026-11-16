// تست یکپارچه‌ی نقاط ورود مستقرشونده: handlers/* دقیقاً همانطور که tgcloud صدا می‌زند
// (ورودی = payload آپدیت)، با ماک SDK. این تست سازگاری importها و تزریق وابستگی‌ها را تضمین می‌کند.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./mocks/loader.mjs', import.meta.url);
const sdk = await import('sdk');

function installSdk() {
  const rows = new Map();
  const calls = [];
  Object.assign(sdk.api, {
    sendMessage: async (p) => { calls.push(['sendMessage', p]); return {}; },
    sendChatAction: async () => true,
    answerCallbackQuery: async () => true,
    getFileContent: async (fileId) => { calls.push(['download', fileId]); return new Uint8Array([0xff, 0xd8, 0xff]); },
    sendDocument: async (p) => { calls.push(['sendDocument', p]); return {}; },
  });
  Object.assign(sdk.db, {
    select: () => ({
      from: () => ({
        where: (cond) => ({ all: async () => (rows.has(cond.right) ? [rows.get(cond.right)] : []) }),
      }),
    }),
    insert: () => ({
      values: (values) => ({
        onConflictDoUpdate: (opts) => ({
          run: async () => { rows.set(values.userId, { ...(rows.get(values.userId) ?? {}), ...values, ...opts.set }); return { rowsAffected: 1 }; },
        }),
      }),
    }),
    delete: () => ({
      where: (cond) => ({ run: async () => { rows.delete(cond.right); return { rowsAffected: 1 }; } }),
    }),
  });
  return { rows, calls };
}

test('handlers/message و handlers/callback_query — مسیر کامل تا آپلود SVG', async () => {
  const { rows, calls } = installSdk();

  const messageHandler = (await import('../tgcloud/handlers/message.js')).default;
  const callbackHandler = (await import('../tgcloud/handlers/callback_query.js')).default;

  // ۱) شروع
  await messageHandler({ chat: { id: 55 }, from: { id: 7 }, text: '/start' });
  assert.equal(rows.get(7).state, 'awaiting_photo');

  // ۲) عکس اسکیس
  await messageHandler({ chat: { id: 55 }, from: { id: 7 }, photo: [{ file_id: 'small' }, { file_id: 'large' }] });
  assert.ok(calls.some(([m, arg]) => m === 'download' && arg === 'large'));
  assert.equal(rows.get(7).state, 'awaiting_confirm');
  assert.ok(calls.some(([m, p]) => m === 'sendMessage' && p.text.includes('ابعاد استخراج')));

  // ۳) تایید و ترسیم
  await callbackHandler({ id: 'q1', data: 'confirm_plan', from: { id: 7 }, message: { chat: { id: 55 } } });
  const doc = calls.filter(([m]) => m === 'sendDocument');
  assert.equal(doc.length, 1);
  assert.ok(doc[0][1].document instanceof sdk.InputFile);
  assert.ok(new TextDecoder().decode(doc[0][1].document.bytes).includes('</svg>'));
  assert.equal(rows.has(7), false);
});
