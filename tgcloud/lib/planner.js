// planner.js — موتور ترسیم شیت فنی حرفه‌ای آشپزخانه به‌صورت SVG (خالص، بدون وابستگی).
// خروجی: رشته‌ی SVG شامل پلان کف، نماهای روبه‌رو، پلان کابینت‌های بالا/پایین و کادر عنوان.
// تلگرام فایل‌های SVG را به‌صورت سند رندر می‌کند؛ بایت‌های آن با InputFile آپلود می‌شوند.

import { escapeXml } from './util.js';

// ---------- ثابت‌های استاندارد طراحی (میلی‌متر) ----------
export const BASE_DEPTH = 600;
export const WALL_DEPTH = 350;
export const MODULE = 600;
export const SINK_W = 800;
export const STOVE_W = 600;
export const FRIDGE_W = 700;
export const FRIDGE_DEPTH = 700;
export const MIN_STOVE_GAP = 300;
export const WALL_MM = 100;
export const BASE_H = 900;
export const COUNTER_T = 40;
export const WALLCAB_BOTTOM = 1400;
export const WALLCAB_H = 720;
export const TALL_H = 2100;
export const HOOD_BOTTOM = 1550;
export const ELEV_TOP = 2400;

const INK = '#191919';
const GRAY = '#6e6e6e';
const LIGHT = '#f6f6f6';
const WALL_FILL = '#cecece';
const SINK_FILL = '#d6e7f5';
const STOVE_FILL = '#e9e9e9';
const FRIDGE_FILL = '#faf4d6';
const COUNTER_FILL = '#e1e1e1';
const TRIANGLE = '#c63c3c';

const LAYOUT_WALLS = {
  L: ['north', 'west'],
  U: ['north', 'west', 'east'],
  I: ['north'],
  PARALLEL: ['north', 'south'],
};
const WALL_LABELS = { north: 'NORTH', south: 'SOUTH', west: 'WEST', east: 'EAST' };

export const SHEET_W = 2600;
export const SHEET_H = 1800;

const FONT = 'DejaVu Sans, Arial, sans-serif';
const r1 = (n) => Math.round(n * 10) / 10;

// ---------- سازنده‌ی SVG ----------
class Svg {
  constructor() { this.parts = []; }
  add(s) { this.parts.push(s); }
  rect(x, y, w, h, a = {}) {
    this.add(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ` +
      `fill="${a.fill ?? 'none'}" stroke="${a.stroke ?? 'none'}" stroke-width="${a.sw ?? 1}"` +
      (a.dash ? ` stroke-dasharray="${a.dash}"` : '') + '/>');
  }
  line(x1, y1, x2, y2, a = {}) {
    this.add(`<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ` +
      `stroke="${a.stroke ?? INK}" stroke-width="${a.sw ?? 1}"` +
      (a.dash ? ` stroke-dasharray="${a.dash}"` : '') + '/>');
  }
  circle(cx, cy, r, a = {}) {
    this.add(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" ` +
      `fill="${a.fill ?? 'none'}" stroke="${a.stroke ?? INK}" stroke-width="${a.sw ?? 1}"/>`);
  }
  polygon(points, a = {}) {
    const pts = points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
    this.add(`<polygon points="${pts}" fill="${a.fill ?? 'none'}" stroke="${a.stroke ?? INK}" stroke-width="${a.sw ?? 1}"/>`);
  }
  path(d, a = {}) {
    this.add(`<path d="${d}" fill="${a.fill ?? 'none'}" stroke="${a.stroke ?? INK}" stroke-width="${a.sw ?? 1}"` +
      (a.dash ? ` stroke-dasharray="${a.dash}"` : '') + '/>');
  }
  text(x, y, str, a = {}) {
    this.add(`<text x="${r1(x)}" y="${r1(y)}" font-family="${FONT}" font-size="${a.size ?? 16}" ` +
      `fill="${a.fill ?? INK}" text-anchor="${a.anchor ?? 'middle'}">${escapeXml(str)}</text>`);
  }
  toString() { return this.parts.join('\n'); }
}

// ---------- نمای ترسیم (تبدیل mm به px) ----------
class View {
  constructor(svg, box, wMm, hMm, { ox = 0, oy = 0, flipY = false, pad = 8 } = {}) {
    const [x0, y0, x1, y1] = box;
    this.svg = svg;
    this.s = Math.min((x1 - x0 - 2 * pad) / wMm, (y1 - y0 - 2 * pad) / hMm);
    this.cx = x0 + ((x1 - x0) - wMm * this.s) / 2;
    this.cy = y0 + ((y1 - y0) - hMm * this.s) / 2;
    this.ox = ox; this.oy = oy; this.flipY = flipY; this.hMm = hMm;
  }
  X(mx) { return this.cx + (mx - this.ox) * this.s; }
  Y(my) { return this.flipY ? this.cy + (this.hMm - (my - this.oy)) * this.s : this.cy + (my - this.oy) * this.s; }
  P(mx, my) { return [this.X(mx), this.Y(my)]; }
  rect(mx, my, mw, mh) {
    const [x1, y1] = this.P(mx, my);
    const [x2, y2] = this.P(mx + mw, my + mh);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  box(mx, my, mw, mh, a) { const r = this.rect(mx, my, mw, mh); this.svg.rect(r.x, r.y, r.w, r.h, a); }
  line(p1, p2, a) { const [x1, y1] = this.P(...p1); const [x2, y2] = this.P(...p2); this.svg.line(x1, y1, x2, y2, a); }
  text(mx, my, str, a) { const [x, y] = this.P(mx, my); this.svg.text(x, y, str, a); }
}

// ---------- شیت فنی ----------
export class Sheet {
  constructor(analysis) {
    const room = analysis?.room ?? {};
    this.width = parseInt(room.width_mm, 10) || 3000;
    this.depth = parseInt(room.depth_mm, 10) || 3600;
    this.height = parseInt(room.height_mm, 10) || 2700;
    this.layout = String(analysis?.layout ?? 'L').toUpperCase();
    if (!(this.layout in LAYOUT_WALLS)) this.layout = 'L';
    this.doors = Array.isArray(analysis?.doors) ? analysis.doors : [];
    this.windows = Array.isArray(analysis?.windows) ? analysis.windows : [];
    this.obstacles = Array.isArray(analysis?.obstacles) ? analysis.obstacles : [];
    this.notes = String(analysis?.notes ?? '');
    this.svg = new Svg();

    this.runs = {};
    this.runSpan = {};
    for (const wall of LAYOUT_WALLS[this.layout]) {
      const offset = (wall === 'west' || wall === 'east') ? BASE_DEPTH : 0;
      const { units, span } = this.planRun(wall, offset);
      this.runs[wall] = units;
      this.runSpan[wall] = span;
    }
  }

  // ---------- اطلاعات دیوار ----------
  wallLen(wall) { return (wall === 'north' || wall === 'south') ? this.width : this.depth; }

  findObstacle(kind, wall) {
    return this.obstacles.find((o) => String(o.type ?? '').toLowerCase() === kind && String(o.wall ?? '') === wall) ?? null;
  }
  windowOn(wall) {
    return this.windows.find((w) => String(w.wall ?? '') === wall) ?? null;
  }
  doorSpan(wall) {
    for (const d of this.doors) {
      if (String(d.wall ?? '') === wall) {
        const pos = parseFloat(d.position_mm) || 0;
        const w = parseFloat(d.width_mm) || 900;
        return [pos - w / 2 - 100, pos + w / 2 + 100];
      }
    }
    return null;
  }
  skipSpans(wall) {
    const spans = [];
    const win = this.windowOn(wall);
    if (win) {
      const pos = parseFloat(win.position_mm) || 0;
      const w = parseFloat(win.width_mm) || 1500;
      spans.push([pos - w / 2, pos + w / 2]);
    }
    const stove = this.findObstacle('stove', wall);
    if (stove) {
      const pos = parseFloat(stove.position_mm) || 0;
      spans.push([pos - STOVE_W / 2 - 60, pos + STOVE_W / 2 + 60]);
    }
    return spans;
  }

  // ---------- جانمایی یونیت‌ها ----------
  static fillUnits(start, length) {
    const units = [];
    let cursor = start, remaining = length;
    while (remaining >= MODULE - 1) {
      units.push({ kind: 'base', start: cursor, length: MODULE });
      cursor += MODULE; remaining -= MODULE;
    }
    if (remaining >= 200) units.push({ kind: 'base', start: cursor, length: remaining });
    return units;
  }

  planRun(wall, cornerOffset = 0) {
    const total = this.wallLen(wall);
    const ds = this.doorSpan(wall);
    let runStart = cornerOffset, runEnd = total;
    if (ds) {
      if (ds[0] < total / 2) runStart = Math.max(runStart, ds[1]);
      else runEnd = ds[0];
    }
    const units = [];
    const span = [runStart, runEnd];
    if (runEnd - runStart < 600) return { units, span };

    let cursor = runStart;
    if (this.findObstacle('fridge', wall) && runEnd - runStart > FRIDGE_W + 900) {
      units.push({ kind: 'fridge', start: cursor, length: FRIDGE_W });
      cursor += FRIDGE_W;
    }
    const sink = this.findObstacle('sink', wall);
    const win = this.windowOn(wall);
    let sinkPos = sink ? parseFloat(sink.position_mm) || 0 : null;
    if (sinkPos === null && win) sinkPos = parseFloat(win.position_mm) || 0;
    if (sinkPos !== null) {
      const sinkStart = Math.max(runStart, Math.min(sinkPos - SINK_W / 2, runEnd - SINK_W));
      if (sinkStart > cursor) {
        units.push(...Sheet.fillUnits(cursor, sinkStart - cursor));
        cursor = sinkStart;
      }
      units.push({ kind: 'sink', start: cursor, length: SINK_W });
      cursor += SINK_W;
    }
    if (this.findObstacle('stove', wall)) {
      const gap = cursor + MIN_STOVE_GAP + STOVE_W <= runEnd ? MIN_STOVE_GAP : 0;
      if (gap) {
        units.push(...Sheet.fillUnits(cursor, gap));
        cursor += gap;
      }
      if (cursor + STOVE_W <= runEnd) {
        units.push({ kind: 'stove', start: cursor, length: STOVE_W });
        cursor += STOVE_W;
      }
    }
    units.push(...Sheet.fillUnits(cursor, runEnd - cursor));
    return { units, span };
  }

  // ---------- عناصر مشترک ----------
  dimLine(p1, p2, label, fontSize = 18) {
    this.svg.line(p1[0], p1[1], p2[0], p2[1], { stroke: GRAY, sw: 1 });
    for (const p of [p1, p2]) this.svg.line(p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5, { stroke: GRAY, sw: 1 });
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    this.svg.rect(mid[0] - 38, mid[1] - 13, 76, 26, { fill: 'white' });
    this.svg.text(mid[0], mid[1] + 6, label, { size: fontSize, fill: INK });
  }

  viewTag(box, text) {
    const [x0, y0] = box;
    const tw = text.length * 20 * 0.62 + 28;
    this.svg.rect(x0, y0, tw, 34, { fill: INK });
    this.svg.text(x0 + tw / 2, y0 + 23, text, { size: 20, fill: 'white' });
  }

  // ---------- پلان (نمای بالا) ----------
  planView(box) {
    const ext = WALL_MM + 520;
    return new View(this.svg, box, this.width + 2 * ext, this.depth + 2 * ext, { ox: -ext, oy: -ext, pad: 4 });
  }

  drawWalls(v) {
    const w = this.width, dep = this.depth;
    v.box(0, 0, w, dep, { fill: LIGHT, stroke: INK, sw: 2 });
    const bands = [
      [-WALL_MM, -WALL_MM, w + 2 * WALL_MM, WALL_MM],
      [-WALL_MM, dep, w + 2 * WALL_MM, WALL_MM],
      [-WALL_MM, 0, WALL_MM, dep],
      [w, 0, WALL_MM, dep],
    ];
    for (const [bx, by, bw, bh] of bands) v.box(bx, by, bw, bh, { fill: WALL_FILL, stroke: INK, sw: 2 });
    v.line([-WALL_MM / 2, -WALL_MM / 2], [w + WALL_MM / 2, -WALL_MM / 2], { stroke: GRAY, sw: 1 });
    v.line([-WALL_MM / 2, dep + WALL_MM / 2], [w + WALL_MM / 2, dep + WALL_MM / 2], { stroke: GRAY, sw: 1 });
    v.line([-WALL_MM / 2, 0], [-WALL_MM / 2, dep], { stroke: GRAY, sw: 1 });
    v.line([w + WALL_MM / 2, 0], [w + WALL_MM / 2, dep], { stroke: GRAY, sw: 1 });
    for (const d of this.doors) this.drawDoor(v, d);
    for (const win of this.windows) this.drawWindow(v, win);
  }

  gap(v, wall, center, width) {
    const half = width / 2;
    if (wall === 'north') v.box(center - half, -WALL_MM, width, WALL_MM, { fill: 'white' });
    else if (wall === 'south') v.box(center - half, this.depth, width, WALL_MM, { fill: 'white' });
    else if (wall === 'west') v.box(-WALL_MM, center - half, WALL_MM, width, { fill: 'white' });
    else v.box(this.width, center - half, WALL_MM, width, { fill: 'white' });
  }

  drawDoor(v, door) {
    const wall = String(door.wall ?? 'south');
    const pos = parseFloat(door.position_mm) || 0;
    const w = parseFloat(door.width_mm) || 900;
    this.gap(v, wall, pos, w);
    let hinge, openEnd, sweep;
    if (wall === 'north') { hinge = v.P(pos - w / 2, 0); openEnd = v.P(pos - w / 2, w); sweep = 1; }
    else if (wall === 'south') { hinge = v.P(pos - w / 2, this.depth); openEnd = v.P(pos - w / 2, this.depth - w); sweep = 0; }
    else if (wall === 'west') { hinge = v.P(0, pos - w / 2); openEnd = v.P(w, pos - w / 2); sweep = 0; }
    else { hinge = v.P(this.width, pos - w / 2); openEnd = v.P(this.width - w, pos - w / 2); sweep = 1; }
    const leafEnd = wall === 'north' ? v.P(pos + w / 2, 0)
      : wall === 'south' ? v.P(pos + w / 2, this.depth)
      : wall === 'west' ? v.P(0, pos + w / 2)
      : v.P(this.width, pos + w / 2);
    this.svg.line(hinge[0], hinge[1], openEnd[0], openEnd[1], { stroke: INK, sw: 3 });
    const r = w * v.s;
    this.svg.path(`M ${r1(leafEnd[0])} ${r1(leafEnd[1])} A ${r1(r)} ${r1(r)} 0 0 ${sweep} ${r1(openEnd[0])} ${r1(openEnd[1])}`,
      { stroke: GRAY, sw: 1 });
    let lx, ly;
    if (wall === 'north' || wall === 'south') { [lx, ly] = v.P(pos, wall === 'north' ? 0 : this.depth); ly += wall === 'north' ? -26 : 26; }
    else { [lx, ly] = v.P(wall === 'west' ? 0 : this.width, pos); lx += wall === 'west' ? -26 : 26; }
    this.svg.text(lx, ly + 5, `D${Math.round(w)}`, { size: 16, fill: GRAY });
  }

  drawWindow(v, win) {
    const wall = String(win.wall ?? 'north');
    const pos = parseFloat(win.position_mm) || 0;
    const w = parseFloat(win.width_mm) || 1500;
    this.gap(v, wall, pos, w);
    let lx, ly;
    if (wall === 'north' || wall === 'south') {
      const y = wall === 'north' ? 0 : this.depth;
      for (const off of [-WALL_MM * 0.3, 0, WALL_MM * 0.3]) v.line([pos - w / 2, y + off], [pos + w / 2, y + off], { stroke: INK, sw: 2 });
      [lx, ly] = v.P(pos, y); ly += wall === 'north' ? -30 : 30;
    } else {
      const x = wall === 'west' ? 0 : this.width;
      for (const off of [-WALL_MM * 0.3, 0, WALL_MM * 0.3]) v.line([x + off, pos - w / 2], [x + off, pos + w / 2], { stroke: INK, sw: 2 });
      [lx, ly] = v.P(x, pos); lx += wall === 'west' ? -30 : 30;
    }
    const sill = win.sill_height_mm;
    const label = `W${Math.round(w)}` + (sill ? ` h${sill}` : '');
    this.svg.text(lx, ly + 5, label, { size: 16, fill: GRAY });
  }

  unitRectTop(v, wall, start, length, depth) {
    if (wall === 'north') return v.rect(start, 0, length, depth);
    if (wall === 'south') return v.rect(start, this.depth - depth, length, depth);
    if (wall === 'west') return v.rect(0, start, depth, length);
    return v.rect(this.width - depth, start, depth, length);
  }

  drawCabinetsTop(v, { showBase = true, showWall = true, showTriangle = false } = {}) {
    const centers = {};
    for (const [wall, units] of Object.entries(this.runs)) {
      const [runStart, runEnd] = this.runSpan[wall];
      if (showBase) {
        for (const u of units) {
          const depth = u.kind === 'fridge' ? FRIDGE_DEPTH : BASE_DEPTH;
          const fill = { sink: SINK_FILL, stove: STOVE_FILL, fridge: FRIDGE_FILL }[u.kind];
          const rect = this.unitRectTop(v, wall, u.start, u.length, depth);
          this.svg.rect(rect.x, rect.y, rect.w, rect.h, { fill: fill ?? 'none', stroke: INK, sw: 2 });
          const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
          if (u.kind === 'sink') {
            const r = 95 * v.s;
            this.svg.circle(cx, cy, r, { stroke: INK, sw: 2 });
            this.svg.circle(cx, cy, 7, { fill: INK });
          } else if (u.kind === 'stove') {
            const r = 72 * v.s;
            for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
              this.svg.circle(cx + dx * r, cy + dy * r, r * 0.55, { stroke: INK, sw: 2 });
            }
          }
          const label = { sink: 'SINK', stove: 'STOVE', fridge: 'FRIDGE' }[u.kind];
          if (label) this.svg.text(cx, cy + 5, label, { size: 15, fill: INK });
          if (['sink', 'stove', 'fridge'].includes(u.kind)) centers[u.kind] = [cx, cy];
        }
      }
      if (showWall) {
        const skip = this.skipSpans(wall);
        let cursor = runStart;
        while (cursor < runEnd - 200) {
          const segEnd = Math.min(cursor + MODULE, runEnd);
          if (skip.some(([s0, s1]) => cursor < s1 && segEnd > s0)) { cursor = segEnd; continue; }
          const rect = this.unitRectTop(v, wall, cursor, segEnd - cursor, WALL_DEPTH);
          this.svg.rect(rect.x, rect.y, rect.w, rect.h, { stroke: GRAY, sw: 2, dash: '8 5' });
          cursor = segEnd;
        }
        const stove = this.findObstacle('stove', wall);
        if (stove) {
          const pos = parseFloat(stove.position_mm) || 0;
          const rect = this.unitRectTop(v, wall, pos - 450, 900, 600);
          this.svg.rect(rect.x, rect.y, rect.w, rect.h, { stroke: INK, sw: 2 });
          this.svg.text(rect.x + rect.w / 2, rect.y + rect.h / 2 + 4, 'HOOD', { size: 13, fill: INK });
        }
      }
    }
    if (showTriangle) {
      const pts = ['sink', 'stove', 'fridge'].filter((k) => centers[k]).map((k) => centers[k]);
      if (pts.length >= 2) {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          this.svg.line(a[0], a[1], b[0], b[1], { stroke: TRIANGLE, sw: 2, dash: '10 6' });
        }
      }
    }
  }

  drawPlanDims(v) {
    const w = this.width, dep = this.depth;
    const off = WALL_MM + 300;
    for (const [y, sgn] of [[-off, -1], [dep + off, 1]]) {
      this.dimLine(v.P(0, y), v.P(w, y), `${w}`);
      for (const x of [0, w]) {
        const a = v.P(x, sgn < 0 ? -WALL_MM : dep + WALL_MM);
        const b = v.P(x, y + (sgn < 0 ? 30 : -30));
        this.svg.line(a[0], a[1], b[0], b[1], { stroke: GRAY, sw: 1 });
      }
    }
    for (const [x, sgn] of [[-off, -1], [w + off, 1]]) {
      this.dimLine(v.P(x, 0), v.P(x, dep), `${dep}`);
      for (const yy of [0, dep]) {
        const a = v.P(sgn < 0 ? -WALL_MM : w + WALL_MM, yy);
        const b = v.P(x + (sgn < 0 ? 30 : -30), yy);
        this.svg.line(a[0], a[1], b[0], b[1], { stroke: GRAY, sw: 1 });
      }
    }
  }

  drawPlanView(box, title, { showBase = true, showWall = true, showTriangle = false, showDims = true } = {}) {
    const v = this.planView(box);
    this.drawWalls(v);
    this.drawCabinetsTop(v, { showBase, showWall, showTriangle });
    if (showDims) this.drawPlanDims(v);
    this.viewTag(box, title);
    return v;
  }

  // ---------- نمای روبه‌رو ----------
  drawElevation(box, wall) {
    const units = this.runs[wall];
    const [runStart, runEnd] = this.runSpan[wall];
    const wallLen = this.wallLen(wall);
    const v = new View(this.svg, box, wallLen + 500, ELEV_TOP, { ox: -380, oy: 0, flipY: true, pad: 4 });
    v.line([-120, 0], [wallLen + 120, 0], { stroke: INK, sw: 4 });
    let counterStart = runStart;
    for (const u of units) {
      if (u.kind === 'fridge') {
        v.box(u.start, 0, u.length, TALL_H, { fill: FRIDGE_FILL, stroke: INK, sw: 2 });
        v.line([u.start, 1300], [u.start + u.length, 1300], { stroke: INK, sw: 1 });
        v.text(u.start + u.length / 2, 700, 'FRIDGE', { size: 16, fill: INK });
        v.text(u.start + u.length / 2, 1700, 'TALL UNIT', { size: 13, fill: GRAY });
        counterStart = Math.max(counterStart, u.start + u.length);
        continue;
      }
      const fill = { sink: SINK_FILL, stove: STOVE_FILL }[u.kind];
      v.box(u.start, 0, u.length, BASE_H, { fill: fill ?? 'none', stroke: INK, sw: 2 });
      const n = Math.max(1, Math.round(u.length / MODULE));
      for (let i = 1; i < n; i++) {
        const x = u.start + (u.length * i) / n;
        v.line([x, 60], [x, BASE_H - 60], { stroke: GRAY, sw: 1 });
      }
      v.line([u.start + 60, BASE_H - 90], [u.start + u.length - 60, BASE_H - 90], { stroke: GRAY, sw: 2 });
      if (u.kind === 'sink') {
        const cx = u.start + u.length / 2;
        v.box(cx - 300, 520, 600, 340, { stroke: INK, sw: 2 });
        v.line([cx, BASE_H + COUNTER_T], [cx, 1180], { stroke: INK, sw: 3 });
        v.line([cx, 1180], [cx + 90, 1180], { stroke: INK, sw: 3 });
        v.text(cx, 300, 'SINK', { size: 16, fill: INK });
        const win = this.windowOn(wall);
        if (win) {
          const pos = parseFloat(win.position_mm) || cx;
          const ww = parseFloat(win.width_mm) || 1500;
          const sill = parseFloat(win.sill_height_mm) || 900;
          const r = v.rect(pos - ww / 2, sill, ww, 2100 - sill);
          this.svg.rect(r.x, r.y, r.w, r.h, { stroke: GRAY, sw: 1, dash: '8 5' });
        }
      } else if (u.kind === 'stove') {
        const cx = u.start + u.length / 2;
        v.box(u.start + 40, BASE_H, u.length - 80, COUNTER_T, { fill: STOVE_FILL, stroke: INK, sw: 1 });
        const hood = [v.P(cx - 450, HOOD_BOTTOM), v.P(cx + 450, HOOD_BOTTOM),
          v.P(cx + 225, WALLCAB_BOTTOM + WALLCAB_H), v.P(cx - 225, WALLCAB_BOTTOM + WALLCAB_H)];
        this.svg.polygon(hood, { stroke: INK, sw: 2 });
        v.box(cx - 140, WALLCAB_BOTTOM + WALLCAB_H, 280, 2250 - (WALLCAB_BOTTOM + WALLCAB_H), { stroke: INK, sw: 1 });
        v.text(cx, 400, 'STOVE', { size: 16, fill: INK });
        v.text(cx, HOOD_BOTTOM + 180, 'HOOD', { size: 13, fill: GRAY });
      } else if (u.length >= 400) {
        v.text(u.start + u.length / 2, 420, 'BASE CAB', { size: 13, fill: GRAY });
      }
    }
    if (runEnd > counterStart) {
      v.box(counterStart, BASE_H, runEnd - counterStart, COUNTER_T, { fill: COUNTER_FILL, stroke: INK, sw: 2 });
    }
    const skip = this.skipSpans(wall);
    let cursor = runStart;
    while (cursor < runEnd - 200) {
      const segEnd = Math.min(cursor + MODULE, runEnd);
      if (skip.some(([s0, s1]) => cursor < s1 && segEnd > s0)) { cursor = segEnd; continue; }
      v.box(cursor, WALLCAB_BOTTOM, segEnd - cursor, WALLCAB_H, { stroke: INK, sw: 2 });
      v.line([cursor + 50, WALLCAB_BOTTOM + 70], [segEnd - 50, WALLCAB_BOTTOM + 70], { stroke: GRAY, sw: 2 });
      cursor = segEnd;
    }
    const topY = ELEV_TOP - 70;
    this.dimLine(v.P(0, topY), v.P(wallLen, topY), `${wallLen}`);
    for (const x of [0, wallLen]) {
      const a = v.P(x, WALLCAB_BOTTOM + WALLCAB_H);
      const b = v.P(x, topY + 40);
      this.svg.line(a[0], a[1], b[0], b[1], { stroke: GRAY, sw: 1 });
    }
    for (const [h1, h2] of [[0, BASE_H], [BASE_H, WALLCAB_BOTTOM], [WALLCAB_BOTTOM, WALLCAB_BOTTOM + WALLCAB_H]]) {
      this.dimLine(v.P(-300, h1), v.P(-300, h2), `${h2 - h1}`, 15);
      const a = v.P(0, h2), b = v.P(-340, h2);
      this.svg.line(a[0], a[1], b[0], b[1], { stroke: GRAY, sw: 1 });
    }
    this.viewTag(box, `ELEVATION - ${WALL_LABELS[wall]} WALL`);
  }

  // ---------- کادر عنوان ----------
  drawTitleBlock(box) {
    const [x0, y0, x1, y1] = box;
    this.svg.rect(x0, y0, x1 - x0, y1 - y0, { stroke: INK, sw: 3 });
    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      ['PROJECT', 'KITCHEN DESIGN'],
      ['CLIENT', 'HV HOUSE'],
      ['DRAWING', 'FLOOR PLAN & ELEVATIONS'],
      ['SCALE', '1:50 @ A3'],
      ['DATE', today],
      ['DWG NO', 'F204'],
      ['REV', '01'],
      ['LAYOUT', this.layout],
      ['ROOM (mm)', `${this.width} x ${this.depth} x H${this.height}`],
    ];
    const totalH = y1 - y0;
    const rowH = (totalH * 0.42) / rows.length;
    this.svg.rect(x0, y0, x1 - x0, totalH * 0.26, { fill: INK });
    this.svg.text((x0 + x1) / 2, y0 + totalH * 0.13 + 9, 'TITLE BLOCK', { size: 26, fill: 'white' });
    let y = y0 + totalH * 0.26;
    for (const [key, val] of rows) {
      this.svg.line(x0, y, x1, y, { stroke: INK, sw: 1 });
      this.svg.text(x0 + 16, y + rowH / 2 + 6, key, { size: 17, fill: GRAY, anchor: 'start' });
      this.svg.text(x0 + 190, y + rowH / 2 + 6, val, { size: 19, fill: INK, anchor: 'start' });
      y += rowH;
    }
    let ly = y + 20;
    this.svg.text(x0 + 16, ly, 'LEGEND', { size: 19, fill: INK, anchor: 'start' });
    ly += 30;
    const legend = [
      ['WALL (100 THK)', 'wall'],
      ['BASE CABINET 600 DEEP', 'solid'],
      ['WALL CABINET 350 DEEP', 'dashed'],
      ['WORK TRIANGLE', 'red'],
      ['D = DOOR   W = WINDOW', 'wall'],
    ];
    for (const [label, style] of legend) {
      if (style === 'solid') this.svg.rect(x0 + 16, ly - 7, 40, 14, { stroke: INK, sw: 2 });
      else if (style === 'dashed') this.svg.rect(x0 + 16, ly - 7, 40, 14, { stroke: GRAY, sw: 2, dash: '8 5' });
      else if (style === 'red') this.svg.line(x0 + 16, ly, x0 + 56, ly, { stroke: TRIANGLE, sw: 2, dash: '10 6' });
      else this.svg.rect(x0 + 16, ly - 7, 40, 14, { fill: WALL_FILL, stroke: INK, sw: 1 });
      this.svg.text(x0 + 68, ly + 5, label, { size: 15, fill: INK, anchor: 'start' });
      ly += 26;
    }
  }

  drawNotes(box, planScale) {
    const [x0, y0, x1, y1] = box;
    this.svg.rect(x0, y0, x1 - x0, y1 - y0, { stroke: INK, sw: 2 });
    const seg = 500 * planScale;
    const bx = x1 - 4 * seg - 30;       // محل شروع خط مقیاس
    const notes = [
      'NOTES:',
      '1. ALL DIMENSIONS IN MM',
      '2. BASE CAB H900 / WALL CAB BOTTOM H1400 / TALL UNIT H2100',
      '3. SINK UNDER WINDOW - STOVE WITH HOOD',
    ];
    if (this.notes) {
      const safe = this.notes.replace(/[^\x00-\x7F]/g, '').trim();
      if (safe) notes.push(`4. ${safe}`);
    }
    // یادداشت چهارم (خروجی مدل) طول متغیری دارد: آن را دقیقاً تا قبل از
    // خط مقیاس کوتاه میکنیم تا روی شیت همپوشانی ایجاد نشود.
    const size = 16;
    const charW = size * 0.6;
    const gap = 40;
    const rightLimit = bx - 24;
    let x = x0 + 16;
    const midY = (y0 + y1) / 2 + 5;
    for (let i = 0; i < notes.length; i++) {
      let label = notes[i];
      const available = rightLimit - x - (i < notes.length - 1 ? gap : 0);
      const maxChars = Math.floor(available / charW);
      if (label.length > maxChars) {
        label = maxChars > 5 ? `${label.slice(0, maxChars - 3)}...` : '';
      }
      if (!label) break;
      this.svg.text(x, midY, label, { size, fill: INK, anchor: 'start' });
      x += label.length * charW + gap;
    }
    const by = (y0 + y1) / 2;
    for (let i = 0; i < 4; i++) {
      this.svg.rect(bx + i * seg, by - 8, seg, 16, { fill: i % 2 === 0 ? INK : 'white', stroke: INK, sw: 1 });
      this.svg.text(bx + i * seg, by + 24, `${i * 500}`, { size: 13, fill: GRAY });
    }
    this.svg.text(bx + 4 * seg, by + 24, '2000 mm', { size: 13, fill: GRAY });
  }

  // ---------- رندر نهایی ----------
  render() {
    this.svg.rect(24, 24, SHEET_W - 48, SHEET_H - 48, { stroke: INK, sw: 3 });
    this.svg.rect(36, 36, SHEET_W - 72, SHEET_H - 72, { stroke: INK, sw: 1 });

    const planBox = [56, 56, 1690, 1150];
    const titleBox = [1720, 56, 2544, 560];
    const upperBox = [1720, 590, 2544, 1090];
    const lowerBox = [1720, 1120, 2544, 1700];
    const notesBox = [56, 1712, 2544, 1752];

    const planView = this.drawPlanView(planBox, 'A-101 - FLOOR PLAN', { showTriangle: true });
    this.drawTitleBlock(titleBox);
    this.drawPlanView(upperBox, 'A-102 - UPPER CABINET PLAN', { showBase: false, showWall: true, showDims: false });
    this.drawPlanView(lowerBox, 'A-103 - LOWER CABINET PLAN', { showBase: true, showWall: false, showDims: false });

    const walls = LAYOUT_WALLS[this.layout];
    const n = walls.length;
    const elevY0 = 1180, elevY1 = 1700;
    const totalW = 1690 - 56, gap = 20;
    const bw = (totalW - (n - 1) * gap) / n;
    walls.forEach((wall, i) => {
      const bx0 = 56 + i * (bw + gap);
      this.drawElevation([bx0, elevY0, bx0 + bw, elevY1], wall);
    });

    this.drawNotes(notesBox, planView.s);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">\n` +
      `<rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="white"/>\n` +
      this.svg.toString() +
      '\n</svg>';
  }
}

/** نقطه‌ی ورود اصلی: تولید SVG شیت فنی از دیکشنری تحلیل. */
export function renderPlanSvg(analysis) {
  return new Sheet(analysis).render();
}
