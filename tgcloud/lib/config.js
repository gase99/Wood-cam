// config.js — تنظیمات ربات.
// ⚠️ محیط Telegram Serverless متغیر محیطی (env) ندارد. کلید API در فایل
//    `secrets.js` کنار همین فایل نگهداری می‌شود؛ آن فایل در .gitignore است ولی
//    همراه کد دیپلوی می‌شود. ساخت آن: `npm install` یا `npm run deploy`.
//    هرگز `secrets.js` حاوی کلید واقعی را کامیت نکنید.

import * as secrets from './secrets.js';

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'; // پشتیبانی از تصویر + خروجی JSON ساخت‌یافته

export const config = {
  // 'gemini' = REST بومی Gemini (پیشفرض) | 'openai' = هر API سازگار با OpenAI
  provider: 'gemini',

  // کلید از secrets.js (خالی = حالت نمایشی F204)
  aiApiKey: typeof secrets.aiApiKey === 'string' ? secrets.aiApiKey : '',

  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: typeof secrets.geminiModel === 'string' && secrets.geminiModel
      ? secrets.geminiModel
      : DEFAULT_GEMINI_MODEL,
  },

  // فقط در صورت تغییر provider به 'openai' استفاده می‌شود
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
};
