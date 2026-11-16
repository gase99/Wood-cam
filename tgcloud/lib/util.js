// util.js — توابع کمکی خالص (بدون وابستگی به SDK) — قابل تست با Node.js

// --- Base64 دستی (محیط tgcloud فاقد atob/btoa/Buffer است) ---
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += has1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += has2 ? B64[b2 & 63] : '=';
  }
  return out;
}

// --- ارقام فارسی/عربی به لاتین ---
const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

export function toLatinDigits(s) {
  return String(s).replace(/[۰-۹٠-٩]/g, (c) => FA_DIGITS[c] ?? c);
}

// --- پارس ابعاد متنی مثل «3000x3600» یا «۳۰۰۰×۳۶۰۰» ---
export function parseDimensions(text) {
  const t = toLatinDigits(text).replace(/×/g, 'x').replace(/X/g, 'x');
  const m = t.match(/(\d{3,5})\s*x\s*(\d{3,5})/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

// --- Escape متن برای SVG/XML ---
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- استخراج JSON از خروجی مدل ---
export function extractJson(text) {
  let t = String(text).trim();
  if (t.startsWith('```')) {
    t = t.split('```')[1] ?? '';
    if (t.trimStart().startsWith('json')) t = t.trimStart().slice(4);
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('پاسخ مدل شامل JSON معتبر نیست.');
  return JSON.parse(t.slice(start, end + 1));
}
