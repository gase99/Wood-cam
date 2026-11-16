// تست تحلیلگر بینا: حالت نمایشی، فراخوانی real API، نرمال‌سازی و خطاها
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, DEMO_ANALYSIS, SYSTEM_PROMPT } from '../tgcloud/lib/ai.js';
import { config } from '../tgcloud/lib/config.js';

function mockFetch(content, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  fn.body = { json: (value) => ({ __fetchBody: true, value }) };
  return { fn, calls };
}

test('analyzeImage — حالت نمایشی، کپی مستقل از داده‌ی ثابت', async () => {
  const saved = config.aiApiKey;
  config.aiApiKey = '';
  try {
    const a = await analyzeImage(new Uint8Array([1, 2, 3]), () => { throw new Error('نباید صدا زده شود'); });
    assert.deepEqual(a, DEMO_ANALYSIS);
    a.room.width_mm = 9999;
    assert.equal(DEMO_ANALYSIS.room.width_mm, 3000);
  } finally {
    config.aiApiKey = saved;
  }
});

test('analyzeImage — فراخوانی مدل، Base64 تصویر و نرمال‌سازی JSON', async () => {
  const content = 'پاسخ:\n```json\n{"room":{"width_mm":"3200","depth_mm":"3800","height_mm":2600},' +
    '"layout":"u","doors":[],"windows":[],"obstacles":[],"notes":"ok"}\n```';
  const { fn, calls } = mockFetch(content);
  const savedKey = config.aiApiKey;
  const savedBase = config.aiBaseUrl;
  config.aiApiKey = 'test-key';
  config.aiBaseUrl = 'https://example.test/v1/';
  try {
    const out = await analyzeImage(new Uint8Array([1, 2, 3]), fn);
    assert.equal(out.room.width_mm, 3200);
    assert.equal(out.room.depth_mm, 3800);
    assert.equal(out.room.height_mm, 2600);
    assert.equal(out.layout, 'U');
    assert.deepEqual(out.doors, []);
    assert.equal(out.notes, 'ok');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
    const payload = calls[0].init.body.value;
    assert.equal(payload.model, config.aiModel);
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    const image = payload.messages[1].content[1].image_url.url;
    assert.equal(image, 'data:image/jpeg;base64,AQID'); // Base64 دستی، بدون Buffer/atob
    assert.ok(SYSTEM_PROMPT.includes('STRICT JSON'));
  } finally {
    config.aiApiKey = savedKey;
    config.aiBaseUrl = savedBase;
  }
});

test('analyzeImage — مقادیر ناقص با پیش‌فرض‌ها پر می‌شوند', async () => {
  const { fn } = mockFetch('{"layout":"wrong","room":{}}');
  const saved = config.aiApiKey;
  config.aiApiKey = 'test-key';
  try {
    const out = await analyzeImage(new Uint8Array([]), fn);
    assert.equal(out.room.width_mm, 3000);
    assert.equal(out.room.depth_mm, 3600);
    assert.equal(out.layout, 'L');
  } finally {
    config.aiApiKey = saved;
  }
});

test('analyzeImage — خطای HTTP و JSON نامعتبر', async () => {
  const saved = config.aiApiKey;
  config.aiApiKey = 'test-key';
  try {
    const bad = mockFetch('{}', { ok: false, status: 429 });
    await assert.rejects(() => analyzeImage(new Uint8Array([]), bad.fn), /AI API error: HTTP 429/);
    const invalid = mockFetch('not json at all');
    await assert.rejects(() => analyzeImage(new Uint8Array([]), invalid.fn), /JSON/);
  } finally {
    config.aiApiKey = saved;
  }
});
