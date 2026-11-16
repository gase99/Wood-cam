// اسکریپت محلی (فقط روی ماشین توسعهدهنده / CI اجرا می‌شود — هرگز دیپلوی نمی‌شود).
// `tgcloud/lib/secrets.js` را می‌سازد تا ایمپورت config.js همیشه معتبر بماند.
// اگر GEMINI_API_KEY (یا AI_API_KEY) در محیط لوکال ست شده باشد، کلید تزریق می‌شود.
// در غیر این صورت فایل موجود دستنخورده باقی میماند (امکان ویرایش دستی).

import fs from 'node:fs';
import path from 'node:path';

const target = path.join('tgcloud', 'lib', 'secrets.js');
const example = path.join('scripts', 'secrets.example.js');

const key = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '').trim();
const model = (process.env.GEMINI_MODEL || '').trim();

const render = (k, m) =>
  '// ساخته‌شده توسط scripts/prepare-secrets.mjs — این فایل را کامیت نکنید.\n' +
  `export const aiApiKey = ${JSON.stringify(k)};\n` +
  `export const geminiModel = ${JSON.stringify(m)};\n`;

if (key) {
  fs.writeFileSync(target, render(key, model));
  console.log(`[secrets] کلید Gemini در ${target} نوشته شد (گیتignore شده است).`);
} else if (!fs.existsSync(target)) {
  fs.copyFileSync(example, target);
  console.log(`[secrets] ${target} از الگو ساخته شد؛ کلیدی تنظیم نشده → حالت نمایشی.`);
} else {
  console.log(`[secrets] ${target} موجود است و دستنخورده ماند.`);
}
