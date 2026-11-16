// تست توابع کمکی (Node.js داخلی — بدون وابستگی)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Encode, parseDimensions, escapeXml, extractJson, toLatinDigits } from '../tgcloud/lib/util.js';

test('base64Encode — بردارهای شناخته‌شده', () => {
  assert.equal(base64Encode(new Uint8Array([])), '');
  assert.equal(base64Encode(new TextEncoder().encode('f')), 'Zg==');
  assert.equal(base64Encode(new TextEncoder().encode('fo')), 'Zm8=');
  assert.equal(base64Encode(new TextEncoder().encode('foo')), 'Zm9v');
  assert.equal(base64Encode(new TextEncoder().encode('foobar')), 'Zm9vYmFy');
  // بایت‌های باینری
  assert.equal(base64Encode(new Uint8Array([0xff, 0xfe, 0xfd])), '//79');
});

test('parseDimensions — ابعاد لاتین و فارسی', () => {
  assert.deepEqual(parseDimensions('3000x3600'), [3000, 3600]);
  assert.deepEqual(parseDimensions('ابعاد: ۳۲۰۰×۳۸۰۰'), [3200, 3800]);
  assert.deepEqual(parseDimensions('3200 X 3800'), [3200, 3800]);
  assert.equal(parseDimensions('سلام'), null);
});

test('toLatinDigits', () => {
  assert.equal(toLatinDigits('۱۲۳٤٥'), '12345');
});

test('escapeXml', () => {
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});

test('extractJson — با و بدون code fence', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('متن قبل {"a":1} متن بعد'), { a: 1 });
  assert.throws(() => extractJson('بدون json'));
});
