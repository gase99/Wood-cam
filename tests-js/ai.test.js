// تست تحلیلگر بینا: حالت نمایشی، REST بومی Gemini، حالت OpenAI، نرمالسازی و خطاها
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, DEMO_ANALYSIS, SYSTEM_PROMPT } from '../tgcloud/lib/ai.js';
import { config } from '../tgcloud/lib/config.js';

function mockFetch(response, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => response };
  };
  fn.body = { json: (value) => ({ __fetchBody: true, value }) };
  return { fn, calls };
}

const geminiResponse = (text) => ({
  candidates: [{ content: { parts: [{ text }], role: 'model' } }],
});

function withConfig(overrides, fn) {
  const saved = {
    aiApiKey: config.aiApiKey,
    provider: config.provider,
    gemini: { ...config.gemini },
    openai: { ...config.openai },
  };
  Object.assign(config, {
    aiApiKey: 'test-key',
    provider: 'gemini',
    gemini: { ...config.gemini },
    openai: { ...config.openai },
    ...overrides,
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      config.aiApiKey = saved.aiApiKey;
      config.provider = saved.provider;
      config.gemini.baseUrl = saved.gemini.baseUrl;
      config.gemini.model = saved.gemini.model;
      config.openai.baseUrl = saved.openai.baseUrl;
      config.openai.model = saved.openai.model;
    });
}

test('analyzeImage — بدون کلید: حالت نمایشی، کپی مستقل و بدون تماس شبکه', async () => {
  await withConfig({ aiApiKey: '' }, async () => {
    const a = await analyzeImage(new Uint8Array([1, 2, 3]), () => { throw new Error('نباید صدا زده شود'); });
    assert.deepEqual(a, DEMO_ANALYSIS);
    a.room.width_mm = 9999;
    assert.equal(DEMO_ANALYSIS.room.width_mm, 3000);
  });
});

test('analyzeImage — Gemini بومی: URL، هدر x-goog-api-key، inline_data و JSON', async () => {
  const content = '```json\n{"room":{"width_mm":"3200","depth_mm":"3800","height_mm":2600},' +
    '"layout":"u","doors":[],"windows":[],"obstacles":[],"notes":"ok"}\n```';
  const { fn, calls } = mockFetch(geminiResponse(content));
  await withConfig({
    aiApiKey: 'AIzaTestKey123',
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/', model: 'gemini-3.8-flash' },
  }, async () => {
    const out = await analyzeImage(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), fn);
    assert.equal(out.room.width_mm, 3200);
    assert.equal(out.room.depth_mm, 3800);
    assert.equal(out.room.height_mm, 2600);
    assert.equal(out.layout, 'U');
    assert.equal(out.notes, 'ok');
  });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-goog-api-key'], 'AIzaTestKey123');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.Authorization, undefined, 'نباید هدر Bearer OpenAI فرستاده شود');

  const payload = init.body.value;
  assert.ok(payload.systemInstruction.parts[0].text.includes('STRICT JSON'));
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.equal(payload.generationConfig.temperature, 0.1);
  const parts = payload.contents[0].parts;
  assert.equal(parts[0].text, 'Analyze this kitchen sketch image and extract the room dimensions, door/window positions and obstacles as strict JSON.');
  assert.equal(parts[1].inline_data.mime_type, 'image/jpeg');
  assert.equal(parts[1].inline_data.data, '/9j/AQID'); // Base64 دستی بایتهای JPEG
  assert.ok(SYSTEM_PROMPT.includes('All dimensions are in millimeters'));
});

test('analyzeImage — Gemini: تشخیص PNG چندبخشی و الحاق قطعات متن', async () => {
  const { fn, calls } = mockFetch({
    candidates: [{ content: { parts: [{ text: '{"room":{' }, { text: '"width_mm":2800}}' }] } }],
  });
  await withConfig({}, async () => {
    const out = await analyzeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), fn);
    assert.equal(out.room.width_mm, 2800);
    assert.equal(out.room.depth_mm, 3600, 'پیشفرض');
  });
  assert.equal(calls[0].init.body.value.contents[0].parts[1].inline_data.mime_type, 'image/png');
});

test('analyzeImage — provider=openai همچنان پشتیبانی می‌شود', async () => {
  const { fn, calls } = mockFetch({ choices: [{ message: { content: '{"room":{"width_mm":4100}}' } }] });
  await withConfig({
    provider: 'openai',
    openai: { baseUrl: 'https://api.openai.com/v1/', model: 'gpt-4o-mini' },
  }, async () => {
    const out = await analyzeImage(new Uint8Array([1, 2, 3]), fn);
    assert.equal(out.room.width_mm, 4100);
  });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(calls[0].init.body.value.response_format, { type: 'json_object' });
});

test('analyzeImage — مقادیر ناقص با پیشفرضها پر میشوند', async () => {
  const { fn } = mockFetch(geminiResponse('{"layout":"wrong","room":{}}'));
  await withConfig({}, async () => {
    const out = await analyzeImage(new Uint8Array([]), fn);
    assert.equal(out.room.width_mm, 3000);
    assert.equal(out.room.depth_mm, 3600);
    assert.equal(out.layout, 'L');
  });
});

test('analyzeImage — خطای HTTP، پاسخ خالی و JSON نامعتبر', async () => {
  await withConfig({}, async () => {
    const bad = mockFetch(geminiResponse('{}'), { ok: false, status: 429 });
    await assert.rejects(() => analyzeImage(new Uint8Array([]), bad.fn), /Gemini API error: HTTP 429/);

    const empty = mockFetch({ candidates: [{ finishReason: 'SAFETY' }] });
    await assert.rejects(() => analyzeImage(new Uint8Array([]), empty.fn), /Gemini returned no text \(SAFETY\)/);

    const invalid = mockFetch(geminiResponse('not json at all'));
    await assert.rejects(() => analyzeImage(new Uint8Array([]), invalid.fn), /JSON/);
  });
});
