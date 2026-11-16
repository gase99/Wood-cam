// الگوی فایل کلیدها. کپی کنید:  cp scripts/secrets.example.js tgcloud/lib/secrets.js
// سپس aiApiKey را پر کنید. `secrets.js` در .gitignore است ولی توسط tgcloud دیپلوی می‌شود.
//
// روش ساده‌تر (توصیه‌شده): بدون ویرایش دستی، هنگام استقرار بدهید:
//   GEMINI_API_KEY=AIza... npm run deploy
// اسکریپت prepare-secrets این فایل را به صورت خودکار می‌سازد.

export const aiApiKey = '';       // کلید Gemini API (از aistudio.google.com/apikey)
export const geminiModel = '';    // اختیاری؛ خالی = gemini-3.8-flash
