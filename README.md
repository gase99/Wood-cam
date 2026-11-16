# Wood-cam — ربات تلگرام طراحی پلان آشپزخانه

ربات تلگرامی که عکس اسکیس/نقشه‌ی آشپزخانه را دریافت می‌کند، با هوش مصنوعی
ابعاد را استخراج می‌کند و پس از تایید کاربر، یک **شیت فنی حرفه‌ای چندنما**
(مشابه نقشه‌های اجرایی F204) شامل پلان کف، نماهای روبه‌رو، پلان کابینت‌های بالا
و پایین و کادر عنوان ترسیم و ارسال می‌کند.

دو پیاده‌سازی کامل در مخزن وجود دارد:

| پیاده‌سازی | محل اجرا | وضعیت |
| --- | --- | --- |
| **JavaScript / tgcloud** | [Telegram Serverless](https://core.telegram.org/bots/serverless) (پیشنهادی، بدون سرور و بدون توکن ربات در کد) | `tgcloud/` |
| Python | اجرای محلی (Long Polling) یا Vercel/Netlify (وبهوک) | `bot/`, `api/webhook.py` |

![پلان نمونه — نسخه‌ی پایتون](assets/sample_plan.png)

پیشنمایش خروجی نسخه‌ی tgcloud: `assets/sample_plan_tgcloud.svg`
(رندر شده: `assets/sample_plan_tgcloud.png`)

## جریان کار ربات

1. کاربر عکس اسکیس دستی آشپزخانه را در چت ربات می‌فرستد.
2. مدل بینا (Vision AI) تصویر را تحلیل و ابعاد دیوارها، موقعیت درها/پنجره‌ها
   و موانع (سینک، اجاق، یخچال، لوله و...) را به‌صورت JSON ساخت‌یافته استخراج می‌کند.
3. ربات ابعاد استخراج‌شده را به‌صورت متن فارسی به همراه دکمه‌های «تایید و ترسیم»
   و «اصلاح ابعاد» نمایش می‌دهد.
4. پس از تایید، شیت فنی ترسیم و ارسال می‌شود:
   - **پلان کف (A-101):** دیوارها، درها، پنجره‌ها، جانمایی کابینت و مثلث کاری
   - **نماهای روبه‌رو (Elevation):** کابینت زمینی/دیواری، سینک، اجاق، هود،
     یخچال و خطوط اندازه‌ی ارتفاعی
   - **پلان کابینت‌های بالا (A-102) و پایین (A-103)**
   - **کادر عنوان (Title Block):** پروژه، مقیاس، تاریخ، شماره نقشه و راهنما
5. امکان اصلاح ابعاد با عکس جدید یا متن (مثلاً `3200x3800` یا `۳۲۰۰×۳۸۰۰`) وجود دارد.

## ساختار پروژه

از ۶ اکتبر ۲۰۲۶ در CLI نسخه‌ی ۰.۲.۰، **همه‌ی ماژول‌های اجرایی داخل `tgcloud/`**
قرار می‌گیرند و فایل‌های پیکربندی در ریشه‌ی پروژه هستند:

```
Wood-cam/
├── tgcloud/                       # فقط این ماژول‌ها روی پلتفرم مستقر می‌شوند
│   ├── schema.js                  # جدول sessions (SQLite داخلی تلگرام)
│   ├── handlers/
│   │   ├── message.js             # آپدیت message (عکس، دستورها، اصلاح متنی)
│   │   └── callback_query.js      # دکمه‌های تایید / اصلاح / نقشه‌ی جدید
│   └── lib/
│       ├── config.js              # تنظیمات (بدون متغیر محیطی!)
│       ├── ai.js                  # تحلیل تصویر با fetch خروجی SDK + حالت نمایشی
│       ├── bot.js                 # ماشین وضعیت گفتگو + متن‌های فارسی
│       ├── store.js               # دسترسی به db با تزریق وابستگی
│       ├── planner.js             # موتور ترسیم شیت فنی → SVG
│       └── util.js                # Base64 دستی، ارقام فارسی، پارس ابعاد، escape XML
├── tests-js/                      # تست‌های Node (شبیه‌ساز sdk برای اجرای محلی)
├── package.json                   # اسکریپت‌ها + @tgcloud/cli (devDependency)
├── tgcloud.jsonc                  # پیکربندی پروژه (بدون Mini App)
├── api/webhook.py                 # نسخه‌ی پایتون: وبهوک Vercel/Netlify
├── bot/                           # نسخه‌ی پایتون: هسته‌ی ربات و ترسیم PNG
├── tests/                         # تست‌های پایتون
└── assets/                        # نقشه‌ی مرجع F204 و خروجی نمونه
```

## استقرار روی Telegram Serverless (tgcloud)

### ۱) فعال‌سازی در BotFather

1. در [@BotFather](https://t.me/BotFather) با `/newbot` ربات بسازید.
2. در تنظیمات همان ربات، **Serverless** را روشن کنید.
3. از منوی Serverless، **CLI Access** token بگیرید (شکلی شبیه `app123:abc...`).
   این توکن **جدا از توکن ربات** است و فقط برای `tgcloud login` استفاده می‌شود.

### ۲) نصب و اتصال پروژه

```bash
npm install                 # @tgcloud/cli به‌صورت devDependency نصب می‌شود
npx tgcloud login           # توکن CLI Access را اینجا بچسبانید
```

توکن و وضعیت محلی در `.tgcloud/` ذخیره می‌شود که در `.gitignore` است —
**هرگز آن را کامیت نکنید.** پلتفرم خودش توکن ربات و وبهوک را مدیریت می‌کند؛
نیازی به `TELEGRAM_BOT_TOKEN` یا تنظیم دستی وبهوک نیست.

### ۳) تنظیم کلید هوش مصنوعی (اختیاری)

محیط tgcloud **متغیر محیطی ندارد**؛ تنظیمات در `tgcloud/lib/config.js` هستند:

```js
export const config = {
  aiApiKey: '',                            // خالی = حالت نمایشی (داده‌ی نمونه F204)
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
};
```

هر API سازگار با OpenAI (OpenAI، Azure، OpenRouter و...) قابل استفاده است.
اگر مخزن عمومی است، کلید واقعی را کامیت نکنید؛ از کلید محدودشده استفاده کنید
یا کلید را فقط قبل از `push` به‌صورت محلی وارد کنید.

### ۴) تست و استقرار

```bash
npm test                    # ۲۵ تست واحد/سرتاسری، بدون نیاز به اکانت تلگرام
npm run deploy              # = npx tgcloud push  (آپلود ماژول‌ها)
npm run migrate             # = npx tgcloud migrate  (ساخته شدن جدول sessions)
npm run webhook             # بررسی وبهوک تنظیم‌شده توسط پلتفرم
```

سپس به ربات `/start` بدهید و عکس اسکیس بفرستید. برای اجرای مستقیم یک هندلر
روی پلتفرم (بدون دیپلوی):

```bash
npx tgcloud run handlers/message '{ "chat": { "id": 123 }, "from": { "id": 123 }, "text": "/start" }'
```

> ترتیب مهم است: `push` فقط کد را آپلود می‌کند و **هیچ تغییری در دیتابیس
> نمی‌دهد**؛ بعد از هر تغییر در `tgcloud/schema.js` حتماً `migrate` را اجرا کنید.

### نکات سازگاری با محدودیت‌های tgcloud

| محدودیت | راهکار در این پروژه |
| --- | --- |
| فقط JavaScript در V8 isolate؛ بدون npm، fs، `process`، `Buffer`، `atob`/`btoa` | Base64 دستی در `lib/util.js`، ترسیم شیت با رشته‌ی SVG، بدون هیچ پکیج خارجی |
| بدون متغیر محیطی | `tgcloud/lib/config.js` |
| فقط `sdk` و ماژول‌های خود پروژه قابل import هستند | `from 'sdk'` / `from 'sdk/db'` و ایمپورت‌های **نسبی با `.js`** (`../lib/bot.js`) |
| حافظه‌ی پایدار لازم است | جدول `sessions` در SQLite داخلی (`sdk/db`) به جای حافظه‌ی نسخه‌ی پایتون |
| دانلود عکس ارسالی | `api.getFileContent(file_id)` (تا ۲۰ مگابایت) — نیازی به توکن و `file_path` نیست |
| آپلود خروجی | `new InputFile(bytes, 'kitchen_plan.svg', { type: 'image/svg+xml' })` + `api.sendDocument` |
| شبکه‌ی خروجی | فقط `fetch` واردشده از `sdk` (همراه `fetch.body.json`) برای Vision API |
| هندلرها تخت و هم نام نوع آپدیت | `handlers/message.js`, `handlers/callback_query.js` |
| فقط فایل‌های `.js` داخل `schema.js`، `lib/`، `handlers/`، `endpoints/` دیپلوی می‌شوند | تست‌ها و ماک‌ها در `tests-js/` بیرون `tgcloud/` نگه داشته شده‌اند |

نسخه‌ی tgcloud خروجی را به شکل **SVG** میفرستد (در تلگرام به صورت سند باز
میشود و در صورت نیاز به PNG/PDF قابل تبدیل است)، چون در این محیط کتابخانه‌ی
تصویریای مثل Pillow وجود ندارد. نسخه‌ی پایتون همان شیت را با Pillow به PNG
تبدیل میکند.

## نسخه‌ی پایتون (اجرای محلی / Vercel)

```bash
pip install -r requirements.txt
cp .env.example .env     # TELEGRAM_BOT_TOKEN و در صورت نیاز AI_API_KEY
python -m bot.main       # Long Polling محلی
```

برای Vercel، متغیرهای `TELEGRAM_BOT_TOKEN`، `AI_API_KEY` و `WEBHOOK_SECRET` را
تنظیم و `api/webhook.py` را به `/api/webhook` متصل کنید سپس:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/webhook"
```

در این نسخه سشنها در حافظهاند؛ برای استقرار چندنمونه‌ای، اینترفیس
`SessionStore` را با Redis/Upstash KV پیادهسازی کنید (در نسخه‌ی tgcloud این
مشکل با دیتابیس داخلی حل شده است).

## تست

```bash
npm test                    # تست‌های JavaScript / tgcloud
python -m pytest tests/ -q  # تست‌های پایتون
```

## نکات فنی

- **استانداردهای ارگونومی:** عمق کابینت زمینی ۶۰۰ و دیواری ۳۵۰ میلیمتر،
  مدول استاندارد ۶۰۰، ارتفاع زمینی ۹۰۰ / شروع دیواری ۱۴۰۰ / یونیت بلند ۲۱۰۰،
  سینک زیر پنجره، حداقل فاصله‌ی ۳۰۰ میلیمتری سینک تا اجاق، هود بالای اجاق،
  نمایش مثلث کاری (سینک–اجاق–یخچال) و خط مقیاس (Scale Bar).
- **چیدمانهای پشتیبانی‌شده:** L، U، I (مستقیم)، موازی (Parallel).
- **نقشه‌ی مرجع:** `assets/sample_F204.jpg` مبنای داده‌ی نمایشی و تست هاست.
- **منبع رسمی:** [core.telegram.org/bots/serverless](https://core.telegram.org/bots/serverless)
