// ai.js — تحلیل تصویر اسکیس با مدل بینا (Vision AI) از طریق fetch خروجی SDK.
// `fetchFn` تزریق می‌شود تا ماژول قابل تست بماند.

import { config } from './config.js';
import { base64Encode, extractJson } from './util.js';

export const SYSTEM_PROMPT = `You are an expert interior architect and kitchen cabinet designer.
You are given a photo of a hand-drawn kitchen sketch / floor plan (possibly with
dimensions written on it, in any language).

Extract the following information and return it as STRICT JSON only
(no markdown fences, no explanations):

{
  "room": { "width_mm": 3000, "depth_mm": 3600, "height_mm": 2700 },
  "layout": "L",
  "doors": [ { "wall": "south", "width_mm": 900, "position_mm": 1200 } ],
  "windows": [ { "wall": "north", "width_mm": 1500, "position_mm": 1500, "sill_height_mm": 900 } ],
  "obstacles": [
    { "type": "sink", "wall": "north", "position_mm": 1500 },
    { "type": "stove", "wall": "north", "position_mm": 2400 },
    { "type": "fridge", "wall": "west", "position_mm": 900 },
    { "type": "pipe", "wall": "north", "position_mm": 600 },
    { "type": "column", "wall": "west", "position_mm": 1800 }
  ],
  "notes": "short free text summary in English (it will be printed on the drawing sheet)"
}

Rules:
- All dimensions are in millimeters (mm). If the sketch uses cm, convert to mm.
- "layout" is one of: "L", "U", "I", "parallel".
- "wall" is one of: "north", "south", "east", "west" (north = top of the sketch).
- "position_mm" is the distance from the start (left/top corner) of that wall
  to the center of the door/window/obstacle.
- If a dimension is not readable, estimate a standard value
  (room 3000x3600, door 900, window 1500) and mention it in "notes".
- "obstacles" types: sink, stove, fridge, pipe, column, dishwasher, oven.
- Always return valid JSON with all keys present.`;

export const USER_PROMPT =
  'Analyze this kitchen sketch image and extract the room dimensions, ' +
  'door/window positions and obstacles as strict JSON.';

// داده‌ی نمونه‌ی حالت نمایشی — بر اساس نقشه‌ی مرجع F204 (آشپزخانه‌ی L شکل)
export const DEMO_ANALYSIS = {
  room: { width_mm: 3000, depth_mm: 3600, height_mm: 2700 },
  layout: 'L',
  doors: [{ wall: 'south', width_mm: 900, position_mm: 2200 }],
  windows: [{ wall: 'north', width_mm: 1500, position_mm: 1500, sill_height_mm: 900 }],
  obstacles: [
    { type: 'sink', wall: 'north', position_mm: 1500 },
    { type: 'stove', wall: 'north', position_mm: 2400 },
    { type: 'fridge', wall: 'west', position_mm: 900 },
  ],
  notes: 'DEMO MODE: F204 sample data. Set aiApiKey in config.js for real analysis.',
};

function normalize(data) {
  const room = data?.room ?? {};
  const out = {
    room: {
      width_mm: parseInt(room.width_mm, 10) || 3000,
      depth_mm: parseInt(room.depth_mm, 10) || 3600,
      height_mm: parseInt(room.height_mm, 10) || 2700,
    },
    layout: String(data?.layout ?? 'L').toUpperCase(),
    doors: Array.isArray(data?.doors) ? data.doors : [],
    windows: Array.isArray(data?.windows) ? data.windows : [],
    obstacles: Array.isArray(data?.obstacles) ? data.obstacles : [],
    notes: String(data?.notes ?? ''),
  };
  if (!['L', 'U', 'I', 'PARALLEL'].includes(out.layout)) out.layout = 'L';
  return out;
}

/**
 * تحلیل عکس اسکیس (بایت‌های تصویر) و برگرداندن دیکشنری ابعاد.
 * @param {Uint8Array} imageBytes
 * @param {Function} fetchFn — fetch خروجی SDK
 */
export async function analyzeImage(imageBytes, fetchFn) {
  // بررسی پویا (نه const زمان import) تا در تست‌ها بتوان کلید را موقتاً تنظیم کرد.
  if (!config.aiApiKey) {
    return JSON.parse(JSON.stringify(DEMO_ANALYSIS)); // کپی عمیق حالت نمایشی
  }

  const b64 = base64Encode(imageBytes);
  const payload = {
    model: config.aiModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 1500,
  };

  const res = await fetchFn(`${config.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: fetchFn.body.json(payload),
  });
  if (!res.ok) throw new Error(`AI API error: HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices[0].message.content;
  return normalize(extractJson(content));
}
