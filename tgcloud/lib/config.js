// config.js — تنظیمات ربات.
// ⚠️ محیط Telegram Serverless متغیر محیطی (env) ندارد؛ کلید API را اینجا وارد کنید.
//    این فایل را در گیت عمومی منتشر نکنید یا از کلید محدوداستفاده کنید.

export const config = {
  // کلید API مدل هوش مصنوعی سازگار با OpenAI (اختیاری)
  // خالی = حالت نمایشی (داده‌ی نمونه بر اساس نقشه‌ی مرجع F204)
  aiApiKey: '',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
};
