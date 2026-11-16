// bot.js — ماشین وضعیت گفتگو (State Machine). خالص و قابل تست:
// وابستگی‌ها (api, store, fetch) تزریق می‌شوند؛ handlers فقط SDK را پاس می‌دهند.

import { analyzeImage } from './ai.js';
import { renderPlanSvg } from './planner.js';
import { parseDimensions } from './util.js';

// ---------- متن‌های ربات (فارسی) ----------
export const WELCOME =
  '👋 سلام! من ربات طراحی پلان آشپزخانه هستم.\n\n' +
  '📐 عکس اسکیس دستی یا نقشه‌ی آشپزخانه‌تان را بفرستید تا:\n' +
  '۱) ابعاد دیوارها، درها و پنجره‌ها را با هوش مصنوعی استخراج کنم\n' +
  '۲) پس از تایید شما، شیت فنی (پلان + نماها + کادر عنوان) را ترسیم کنم\n\n' +
  '📷 همین حالا عکس نقشه را ارسال کنید.\n' +
  'دستورها: /help راهنما | /cancel لغو';

export const HELP =
  'ℹ️ راهنمای استفاده:\n\n' +
  '۱) عکس اسکیس/نقشه‌ی آشپزخانه را بفرستید (بهتر است ابعاد روی آن نوشته شده باشد).\n' +
  '۲) ربات ابعاد استخراج‌شده را نمایش می‌دهد؛ اگر درست بود «✅ تایید و ترسیم» را بزنید.\n' +
  '۳) شیت فنی شامل پلان کف، نماهای روبه‌رو، پلان کابینت‌های بالا و پایین و کادر عنوان برایتان ارسال می‌شود.\n\n' +
  '✏️ برای اصلاح: عکس جدید بفرستید یا ابعاد را متنی بنویسید؛ مثلاً: 3000x3600\n' +
  '🔄 /cancel برای شروع از اول';

const ANALYZING = '🔍 در حال تحلیل عکس با هوش مصنوعی... لطفاً صبر کنید.';
const DRAWING = '✏️ در حال ترسیم شیت فنی...';
const ERROR = '⚠️ متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید یا /cancel بزنید.';
const ASK_CORRECTION =
  '✏️ عکس اصلاح‌شده را بفرستید یا ابعاد جدید را متنی بنویسید ' +
  '(مثلاً: 3200x3800). برای لغو: /cancel';

const KB_CONFIRM = {
  inline_keyboard: [[
    { text: '✅ تایید و ترسیم', callback_data: 'confirm_plan' },
    { text: '✏️ اصلاح ابعاد', callback_data: 'edit_dims' },
  ]],
};
const KB_NEW = {
  inline_keyboard: [[
    { text: '🔄 نقشه‌ی جدید', callback_data: 'new_plan' },
  ]],
};

export function formatAnalysis(analysis) {
  const room = analysis?.room ?? {};
  const lines = [
    '📋 ابعاد استخراج‌شده از نقشه:',
    '',
    `📐 ابعاد اتاق: ${room.width_mm} × ${room.depth_mm} میلی‌متر (ارتفاع ${room.height_mm})`,
    `🧩 چیدمان کابینت: ${analysis?.layout}`,
  ];
  const doors = analysis?.doors ?? [];
  if (doors.length) {
    lines.push('🚪 درها:');
    for (const d of doors) lines.push(`  • دیوار ${d.wall}: عرض ${d.width_mm}، موقعیت ${d.position_mm}`);
  }
  const windows = analysis?.windows ?? [];
  if (windows.length) {
    lines.push('🪟 پنجره‌ها:');
    for (const w of windows) {
      lines.push(`  • دیوار ${w.wall}: عرض ${w.width_mm}، موقعیت ${w.position_mm}` +
        (w.sill_height_mm ? `، ارتفاع زیر پنجره ${w.sill_height_mm}` : ''));
    }
  }
  const obstacles = analysis?.obstacles ?? [];
  if (obstacles.length) {
    lines.push('🔧 موانع/تجهیزات:');
    for (const ob of obstacles) lines.push(`  • ${ob.type} روی دیوار ${ob.wall} (موقعیت ${ob.position_mm})`);
  }
  if (analysis?.notes) lines.push(`\n📝 ${analysis.notes}`);
  lines.push('\nاگر ابعاد درست است، «✅ تایید و ترسیم» را بزنید.');
  return lines.join('\n');
}

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i;

/** اگر پیام به صورت سند تصویری ارسال شده باشد، file_id آن را برمیگرداند. */
function imageDocumentId(doc) {
  if (!doc) return null;
  const mime = String(doc.mime_type ?? '');
  const name = String(doc.file_name ?? '');
  return mime.startsWith('image/') || IMAGE_EXT.test(name) ? doc.file_id : null;
}

// ---------- پردازش پیام ----------
export async function handleMessage(message, { api, store, fetch: fetchFn }) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const text = (message.text ?? '').trim();
  const session = (await store.get(userId)) ?? { state: 'idle' };

  if (text.startsWith('/start')) {
    await store.set(userId, 'awaiting_photo');
    await api.sendMessage({ chat_id: chatId, text: WELCOME });
    return;
  }
  if (text.startsWith('/help')) {
    await api.sendMessage({ chat_id: chatId, text: HELP });
    return;
  }
  if (text.startsWith('/cancel')) {
    await store.clear(userId);
    await api.sendMessage({ chat_id: chatId, text: 'لغو شد. برای شروع دوباره /start بزنید.' });
    return;
  }

  // دریافت عکس اسکیس: هم عکس فشرده‌شده (photo) و هم فایل تصویری (document)
  const photoId = message.photo?.length
    ? message.photo[message.photo.length - 1].file_id
    : imageDocumentId(message.document);
  if (photoId) {
    await processPhoto(chatId, userId, photoId, { api, store, fetchFn });
    return;
  }

  // اصلاح متنی ابعاد
  if (session.state === 'awaiting_correction' && text) {
    const dims = parseDimensions(text);
    if (dims && session.analysis) {
      const analysis = session.analysis;
      analysis.room.width_mm = dims[0];
      analysis.room.depth_mm = dims[1];
      await store.set(userId, 'awaiting_confirm', analysis);
      await api.sendMessage({ chat_id: chatId, text: formatAnalysis(analysis), reply_markup: KB_CONFIRM });
    } else {
      await api.sendMessage({ chat_id: chatId, text: ASK_CORRECTION });
    }
    return;
  }

  // پیام پیش‌فرض بر اساس وضعیت
  if (session.state === 'awaiting_photo') {
    await api.sendMessage({ chat_id: chatId, text: '📷 لطفاً عکس نقشه/اسکیس آشپزخانه را بفرستید.' });
  } else if (session.state === 'awaiting_confirm') {
    await api.sendMessage({ chat_id: chatId, text: 'لطفاً یکی از دکمه‌ها را بزنید: تایید یا اصلاح.', reply_markup: KB_CONFIRM });
  } else {
    await api.sendMessage({ chat_id: chatId, text: WELCOME });
  }
}

async function processPhoto(chatId, userId, fileId, { api, store, fetchFn }) {
  try { await api.sendChatAction({ chat_id: chatId, action: 'typing' }); } catch { /* نادیده */ }
  await api.sendMessage({ chat_id: chatId, text: ANALYZING });
  let analysis;
  try {
    const bytes = await api.getFileContent(fileId); // دانلود عکس از تلگرام (حداکثر ۲۰ مگ)
    analysis = await analyzeImage(bytes, fetchFn);
  } catch (err) {
    console.error('AI analysis failed:', err);
    await api.sendMessage({ chat_id: chatId, text: ERROR });
    return;
  }
  await store.set(userId, 'awaiting_confirm', analysis);
  await api.sendMessage({ chat_id: chatId, text: formatAnalysis(analysis), reply_markup: KB_CONFIRM });
}

// ---------- پردازش دکمه‌ها ----------
export async function handleCallback(query, { api, store, InputFile }) {
  const data = query.data ?? '';
  const chatId = query.message.chat.id;
  const userId = query.from?.id ?? chatId;
  try { await api.answerCallbackQuery({ callback_query_id: query.id }); } catch { /* نادیده */ }
  const session = (await store.get(userId)) ?? {};

  if (data === 'confirm_plan') {
    const analysis = session.analysis;
    if (!analysis) {
      await api.sendMessage({ chat_id: chatId, text: '⚠️ ابتدا عکس نقشه را بفرستید.' });
      return;
    }
    try { await api.sendChatAction({ chat_id: chatId, action: 'typing' }); } catch { /* نادیده */ }
    await api.sendMessage({ chat_id: chatId, text: DRAWING });
    let svg;
    try {
      svg = renderPlanSvg(analysis);
    } catch (err) {
      console.error('Plan rendering failed:', err);
      await api.sendMessage({ chat_id: chatId, text: ERROR });
      return;
    }
    await store.clear(userId);
    // آپلود SVG با InputFile — تلگرام سندهای SVG را رندر می‌کند
    const file = new InputFile(new TextEncoder().encode(svg), 'kitchen_plan.svg', { type: 'image/svg+xml' });
    await api.sendDocument({
      chat_id: chatId,
      document: file,
      caption: '📐 شیت فنی آماده شد: پلان کف + نماهای روبه‌رو + پلان کابینت‌های بالا و پایین + کادر عنوان',
      reply_markup: KB_NEW,
    });
  } else if (data === 'edit_dims') {
    await store.set(userId, 'awaiting_correction', session.analysis ?? null);
    await api.sendMessage({ chat_id: chatId, text: ASK_CORRECTION });
  } else if (data === 'new_plan') {
    await store.set(userId, 'awaiting_photo');
    await api.sendMessage({ chat_id: chatId, text: '📷 عکس نقشه‌ی جدید را بفرستید.' });
  }
}
