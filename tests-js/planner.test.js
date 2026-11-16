// تست موتور ترسیم SVG (Node.js داخلی)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlanSvg } from '../tgcloud/lib/planner.js';
import { DEMO_ANALYSIS } from '../tgcloud/lib/ai.js';

test('renderPlanSvg — خروجی SVG معتبر و کامل', () => {
  const svg = renderPlanSvg(DEMO_ANALYSIS);
  assert.ok(svg.startsWith('<svg'), 'شروع با تگ svg');
  assert.ok(svg.trimEnd().endsWith('</svg>'), 'پایان با تگ بسته');
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  // عناصر کلیدی شیت فنی
  for (const s of ['A-101 - FLOOR PLAN', 'ELEVATION - NORTH WALL', 'ELEVATION - WEST WALL',
    'A-102 - UPPER CABINET PLAN', 'A-103 - LOWER CABINET PLAN', 'TITLE BLOCK',
    'SINK', 'STOVE', 'FRIDGE', 'HOOD', 'F204', '3000', '3600']) {
    assert.ok(svg.includes(s), `شامل: ${s}`);
  }
  // بدون کاراکتر خراب (tofu) — همه‌ی متن‌ها ASCII هستند
  assert.ok(/^[\x00-\x7F]*$/.test(svg), 'فقط ASCII');
});

test('renderPlanSvg — همه‌ی چیدمان‌ها', () => {
  for (const layout of ['L', 'U', 'I', 'PARALLEL']) {
    const svg = renderPlanSvg({ ...DEMO_ANALYSIS, layout });
    assert.ok(svg.includes('</svg>'), layout);
    assert.ok(svg.includes('ELEVATION'), layout);
  }
});

test('renderPlanSvg — تحلیل خالی با پیش‌فرض‌ها', () => {
  const svg = renderPlanSvg({});
  assert.ok(svg.includes('</svg>'));
  assert.ok(svg.includes('3000'));
});

test('renderPlanSvg — یادداشت بلند کوتاه می‌شود تا روی خط مقیاس نرود', () => {
  const long = 'X'.repeat(300);
  const svg = renderPlanSvg({ ...DEMO_ANALYSIS, notes: long });
  assert.ok(!svg.includes(long), 'متن بلند به طور کامل چاپ نشود');
  assert.ok(svg.includes('...'), 'با سه نقطه کوتاه شود');
  assert.ok(svg.includes('NOTES:'));
});

test('renderPlanSvg — اندازه‌ی معقول برای آپلود', () => {
  const svg = renderPlanSvg(DEMO_ANALYSIS);
  const bytes = new TextEncoder().encode(svg).length;
  assert.ok(bytes > 5000 && bytes < 500_000, `حجم: ${bytes} بایت`);
});
