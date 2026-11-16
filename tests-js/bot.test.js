// تست ماشین وضعیت گفتگو با API و Store تزریق‌شده (بدون نیاز به SDK واقعی)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, handleCallback, formatAnalysis, WELCOME, HELP } from '../tgcloud/lib/bot.js';
import { DEMO_ANALYSIS } from '../tgcloud/lib/ai.js';

class FakeInputFile {
  constructor(bytes, filename, opts = {}) {
    this.bytes = bytes;
    this.filename = filename;
    this.type = opts.type;
  }
}

function makeApi(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    sendMessage: async (p) => { calls.push(['sendMessage', p]); return {}; },
    sendChatAction: async (p) => { calls.push(['sendChatAction', p]); return true; },
    answerCallbackQuery: async (p) => { calls.push(['answerCallbackQuery', p]); return true; },
    getFileContent: async (fileId) => { calls.push(['getFileContent', fileId]); return new Uint8Array([1, 2, 3]); },
    sendDocument: async (p) => { calls.push(['sendDocument', p]); return {}; },
    ...overrides,
  };
  return api;
}

function makeStore(initial = null) {
  const data = new Map();
  if (initial) data.set(7, initial);
  return {
    data,
    get: async (uid) => data.get(uid) ?? null,
    set: async (uid, state, analysis = null) => { data.set(uid, { state, analysis }); },
    clear: async (uid) => { data.delete(uid); },
  };
}

const msg = (extra) => ({ chat: { id: 55 }, from: { id: 7 }, ...extra });
const cb = (data) => ({ id: 'q1', data, from: { id: 7 }, message: { chat: { id: 55 } } });
const texts = (api) => api.calls.filter(([m]) => m === 'sendMessage').map(([, p]) => p.text);

test('/start و /help و /cancel', async () => {
  const api = makeApi();
  const store = makeStore();
  await handleMessage(msg({ text: '/start' }), { api, store, fetch: () => {} });
  assert.equal(texts(api)[0], WELCOME);
  assert.equal(store.data.get(7).state, 'awaiting_photo');

  await handleMessage(msg({ text: '/help' }), { api, store, fetch: () => {} });
  assert.equal(texts(api)[1], HELP);

  await handleMessage(msg({ text: '/cancel' }), { api, store, fetch: () => {} });
  assert.equal(store.data.has(7), false);
  assert.ok(texts(api)[2].includes('لغو'));
});

test('دریافت عکس → تحلیل → نمایش ابعاد و دکمه‌ی تایید', async () => {
  const api = makeApi();
  const store = makeStore();
  await handleMessage(msg({ photo: [{ file_id: 'small' }, { file_id: 'large' }] }), { api, store, fetch: () => {} });

  assert.deepEqual(api.calls.find(([m]) => m === 'getFileContent'), ['getFileContent', 'large']);
  const confirmText = texts(api).find((t) => t.includes('ابعاد استخراج'));
  assert.ok(confirmText.includes('3000'));
  assert.ok(confirmText.includes('3600'));
  assert.ok(confirmText.includes('🚪'));
  const kb = api.calls.filter(([m]) => m === 'sendMessage').at(-1)[1].reply_markup;
  assert.deepEqual(kb.inline_keyboard[0].map((b) => b.callback_data), ['confirm_plan', 'edit_dims']);
  assert.equal(store.data.get(7).state, 'awaiting_confirm');
  assert.deepEqual(store.data.get(7).analysis.room, DEMO_ANALYSIS.room);
});

test('عکس ارسالشده به صورت سند (document) هم پذیرفته میشود', async () => {
  const api = makeApi();
  const store = makeStore();
  await handleMessage(msg({ document: { file_id: 'doc-sketch', mime_type: 'image/png', file_name: 'sketch.png' } }),
    { api, store, fetch: () => {} });
  assert.ok(api.calls.some(([m, arg]) => m === 'getFileContent' && arg === 'doc-sketch'));
  assert.equal(store.data.get(7).state, 'awaiting_confirm');

  // سند غیرتصویری نباید وارد جریان تحلیل شود
  const api2 = makeApi();
  const store2 = makeStore();
  await handleMessage(msg({ document: { file_id: 'doc-pdf', mime_type: 'application/pdf', file_name: 'a.pdf' } }),
    { api: api2, store: store2, fetch: () => {} });
  assert.equal(api2.calls.some(([m]) => m === 'getFileContent'), false);
  assert.equal(store2.data.size, 0);
});

test('خطای دانلود عکس → پیام خطا، بدون تغییر وضعیت', async () => {
  const api = makeApi({ getFileContent: async () => { throw new Error('expired file_id'); } });
  const store = makeStore();
  await handleMessage(msg({ photo: [{ file_id: 'x' }] }), { api, store, fetch: () => {} });
  assert.ok(texts(api).at(-1).includes('خطایی رخ داد'));
  assert.equal(store.data.size, 0);
});

test('تایید → آپلود شیت SVG و پاک شدن نشست', async () => {
  const api = makeApi();
  const store = makeStore({ state: 'awaiting_confirm', analysis: DEMO_ANALYSIS });
  await handleCallback(cb('confirm_plan'), { api, store, InputFile: FakeInputFile });

  assert.equal(api.calls[0][0], 'answerCallbackQuery');
  const doc = api.calls.filter(([m]) => m === 'sendDocument');
  assert.equal(doc.length, 1);
  const file = doc[0][1].document;
  assert.ok(file instanceof FakeInputFile);
  assert.equal(file.filename, 'kitchen_plan.svg');
  assert.equal(file.type, 'image/svg+xml');
  const svg = new TextDecoder().decode(file.bytes);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('A-101 - FLOOR PLAN'));
  assert.ok(svg.includes('TITLE BLOCK'));
  assert.equal(store.data.has(7), false);
  assert.equal(doc[0][1].reply_markup.inline_keyboard[0][0].callback_data, 'new_plan');
});

test('تایید بدون تحلیل → هشدار', async () => {
  const api = makeApi();
  const store = makeStore();
  await handleCallback(cb('confirm_plan'), { api, store, InputFile: FakeInputFile });
  assert.ok(texts(api)[0].includes('ابتدا عکس'));
  assert.equal(api.calls.filter(([m]) => m === 'sendDocument').length, 0);
});

test('اصلاح ابعاد → ارسال متن فارسی → به‌روزرسانی و نمایش مجدد', async () => {
  const api = makeApi();
  const store = makeStore({ state: 'awaiting_confirm', analysis: JSON.parse(JSON.stringify(DEMO_ANALYSIS)) });
  await handleCallback(cb('edit_dims'), { api, store, InputFile: FakeInputFile });
  assert.equal(store.data.get(7).state, 'awaiting_correction');

  // متن فاقد ابعاد → درخواست دوباره
  await handleMessage(msg({ text: 'متن نامرتبط' }), { api, store, fetch: () => {} });
  assert.ok(texts(api).at(-1).includes('عکس اصلاح'));
  assert.equal(store.data.get(7).state, 'awaiting_correction');

  await handleMessage(msg({ text: 'ابعاد: ۳۲۰۰×۳۸۰۰' }), { api, store, fetch: () => {} });
  assert.equal(store.data.get(7).state, 'awaiting_confirm');
  assert.equal(store.data.get(7).analysis.room.width_mm, 3200);
  assert.equal(store.data.get(7).analysis.room.depth_mm, 3800);
  const last = texts(api).at(-1);
  assert.ok(last.includes('3200'));
  assert.ok(last.includes('3800'));

  // پس از اصلاح موفق، پیام متنی یادآور دکمه‌های تایید است
  await handleMessage(msg({ text: 'متن نامرتبط' }), { api, store, fetch: () => {} });
  assert.ok(texts(api).at(-1).includes('دکمه'));
});

test('شروع نقشه‌ی جدید و فرمت تحلیل', async () => {
  const api = makeApi();
  const store = makeStore({ state: 'awaiting_confirm', analysis: DEMO_ANALYSIS });
  await handleCallback(cb('new_plan'), { api, store, InputFile: FakeInputFile });
  assert.equal(store.data.get(7).state, 'awaiting_photo');
  assert.ok(texts(api)[0].includes('جدید'));

  const formatted = formatAnalysis({ ...DEMO_ANALYSIS, notes: '' });
  assert.ok(formatted.includes('📐'));
  assert.ok(!formatted.includes('undefined'));
});
