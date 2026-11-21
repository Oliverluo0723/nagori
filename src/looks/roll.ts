import { positionAt, timeOfBar } from '../analysis/tempo';
import type { NoteEvent, TempoMap } from '../analysis/types';
import { midiName } from './glide';
import type { Painter } from './painter/painter';
import { paramNum } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * 25 Roll（鋼琴捲）：列 = 音高（一列一個半音），時間由左到右捲動，現在線固定在 38%。
 * 只聽 notes 與 tempo；座標用小節換算（timeOfBar / positionAt），tempo 變了格線仍對齊。
 */

const params: ParamDef[] = [{ key: 'bars', label: '視窗小節數', min: 1, max: 8, default: 2 }];

/** 現在線在畫布左起的比例 */
export const NOW_X = 0.38;
/** 列數上限：超過就裁掉極端音 */
export const MAX_ROWS = 48;
/** 沒有 notes 時的預設列範圍 */
const DEFAULT_RANGE: [number, number] = [36, 72];
const BLACK = new Set([1, 3, 6, 8, 10]);

export const isBlackKey = (midi: number) => BLACK.has(((midi % 12) + 12) % 12);

const rangeCache = new WeakMap<readonly NoteEvent[], [number, number]>();

/**
 * 列範圍：整首最低到最高音各外擴 2 個半音；超過 48 列時取音符最多的連續 48 列
 * （同數取較低的那段，bass 比較重要）。結果依 notes 陣列快取。
 */
export function rollRange(notes: readonly NoteEvent[]): [number, number] {
  if (notes.length === 0) return DEFAULT_RANGE;
  const hit = rangeCache.get(notes);
  if (hit) return hit;
  const count = new Array<number>(128).fill(0);
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    count[n.midi]++;
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  let range: [number, number] = [Math.max(0, lo - 2), Math.min(127, hi + 2)];
  if (range[1] - range[0] + 1 > MAX_ROWS) {
    let best = lo;
    let bestSum = -1;
    for (let a = lo; a + MAX_ROWS - 1 <= hi + 2 && a <= hi; a++) {
      let sum = 0;
      for (let m = a; m < a + MAX_ROWS && m < 128; m++) sum += count[m];
      if (sum > bestSum) {
        bestSum = sum;
        best = a;
      }
    }
    range = [best, best + MAX_ROWS - 1];
  }
  rangeCache.set(notes, range);
  return range;
}

/** '#rrggbb' 的粗略亮度（只拿來比 paper / ink 誰亮） */
function luma(hex: string): number {
  const v = Number.parseInt(hex.slice(1, 7), 16);
  return 0.3 * ((v >> 16) & 255) + 0.59 * ((v >> 8) & 255) + 0.11 * (v & 255);
}

/** 秒 → 小節座標（1 起算，含小數）：第 3 小節正中 = 3.5 */
function barPos(tempo: TempoMap, time: number): number {
  const pos = positionAt(tempo, time);
  return pos.bar + pos.barPhase;
}

/** 這一刻正在響的音（time ≤ t < time + duration） */
export function soundingAt(notes: readonly NoteEvent[], t: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const n of notes) {
    if (n.time > t) break;
    if (t < n.time + n.duration) out.push(n);
  }
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme, readings } = ctx;
  const notes = readings.notes ?? [];
  const tempo = readings.tempo;
  const bars = Math.max(1, Math.min(8, Math.round(paramNum(ctx, params, 'bars'))));
  const [lo, hi] = readings.noteRange ?? rollRange(notes);
  const rows = hi - lo + 1;
  const u = Math.min(w, h);

  // 版面：左邊一條琴鍵，上面一條小節號，其餘滿版是捲
  const keyW = Math.max(u * 0.045, w * 0.06);
  const headH = Math.max(u * 0.035, h * 0.018);
  const top = headH;
  const rowH = (h - top) / rows;
  const yOf = (midi: number) => top + (hi - midi) * rowH;
  const rollW = w - keyW;
  const nowX = w * NOW_X;
  const barW = rollW / bars;
  const nowBar = barPos(tempo, t);
  const xOfBar = (b: number) => nowX + (b - nowBar) * barW;
  const xOf = (time: number) => xOfBar(barPos(tempo, time));
  const leftBar = nowBar - (nowX - keyW) / barW;
  const rightBar = nowBar + (w - nowX) / barW;
  const tLeft = timeOfBar(tempo, Math.floor(leftBar));
  const tRight = timeOfBar(tempo, Math.ceil(rightBar) + 1);
  const hair = Math.max(1, u * 0.0012);

  p.background(theme.paper);
  p.blend('normal');

  // 列底色：黑鍵列淡淡一層 mute，白鍵列就是紙色
  p.noStroke();
  p.fill(theme.mute, theme.glow ? 0.12 : 0.14);
  for (let m = lo; m <= hi; m++) if (isBlackKey(m)) p.rect(keyW, yOf(m), rollW, rowH);

  // 列與列之間的細線；B/C 之間（八度）粗一點
  p.noFill();
  for (let m = lo; m <= hi + 1; m++) {
    const octave = m % 12 === 0;
    p.stroke(theme.line, octave ? hair * 2 : hair, octave ? 1 : 0.7);
    const y = yOf(m - 1);
    p.line(keyW, y, w, y);
  }

  // 拍線（淡）與小節線，上方標小節號
  const beatsPerBar = Math.max(1, tempo.timeSignatures[0]?.numerator ?? 4);
  for (let b = Math.floor(leftBar); b <= Math.ceil(rightBar); b++) {
    for (let k = 1; k < beatsPerBar; k++) {
      const x = xOfBar(b + k / beatsPerBar);
      if (x <= keyW || x >= w) continue;
      p.stroke(theme.line, hair, 0.55);
      p.line(x, top, x, h);
    }
    const x = xOfBar(b);
    if (x <= keyW || x >= w) continue;
    p.stroke(theme.mute, hair * 1.4, 0.6);
    p.line(x, top * 0.55, x, h);
    if (b >= 1) {
      p.noStroke();
      p.fill(theme.mute);
      p.text(String(b), x + u * 0.008, top * 0.62, { size: u * 0.02, font: 'mono', align: 'left' });
      p.noFill();
    }
  }

  // 音符：accent 矩形；高度隨 velocity，正在響的實心，過去 0.55，未來 0.35
  const sounding: { n: NoteEvent; x0: number; x1: number; y: number; nh: number }[] = [];
  p.noStroke();
  for (const n of notes) {
    if (n.time > tRight) break;
    if (n.time + n.duration < tLeft || n.midi < lo || n.midi > hi) continue;
    const x0 = Math.max(keyW, xOf(n.time));
    const x1 = Math.min(w, xOf(n.time + n.duration));
    if (x1 <= x0) continue;
    const nh = rowH * 0.72 * (0.5 + 0.5 * n.velocity);
    const y = yOf(n.midi) + (rowH - nh) / 2;
    const now = n.time <= t && t < n.time + n.duration;
    if (now) {
      sounding.push({ n, x0, x1, y, nh });
      continue;
    }
    p.fill(theme.accent, n.time > t ? 0.35 : 0.55);
    p.rect(x0, y, x1 - x0, nh);
  }

  // 正在響的：底下一圈便宜的色暈（黑底用光相加），再畫實心；發光最多幾十顆
  if (sounding.length) {
    if (theme.glow) {
      p.blend('add');
      for (const s of sounding)
        p.haze(nowX, s.y + s.nh / 2, rowH * 4, theme.accent, 0.22 + 0.2 * s.n.velocity);
      p.blend('normal');
    }
    p.noStroke();
    if (theme.glow) p.glow(theme.accent, u * 0.012);
    p.fill(theme.accent);
    for (const s of sounding.slice(0, 32)) p.rect(s.x0, s.y, s.x1 - s.x0, s.nh);
    if (theme.glow) p.noGlow();
    for (const s of sounding.slice(32)) p.rect(s.x0, s.y, s.x1 - s.x0, s.nh);
    // 起音那一刻在現在線上亮一下
    for (const s of sounding) {
      const age = t - s.n.time;
      if (age > 0.18) continue;
      p.fill(theme.ink, 1 - age / 0.18);
      p.rect(nowX - rowH * 0.18, s.y, rowH * 0.36, s.nh);
    }
  }

  // 現在線
  p.noFill();
  p.stroke(theme.ink, Math.max(1.5, u * 0.0028));
  p.line(nowX, top * 0.35, nowX, h);
  p.noStroke();
  p.fill(theme.ink);
  p.circle(nowX, top * 0.35, u * 0.012);

  // 左邊琴鍵：亮色白鍵、暗色黑鍵（兩個主題都用 paper/ink 中較亮與較暗的那個），正在響的鍵填 accent
  const [light, dark] =
    luma(theme.paper) > luma(theme.ink) ? [theme.paper, theme.ink] : [theme.ink, theme.paper];
  const on = new Set(sounding.map((s) => s.n.midi));
  p.noStroke();
  p.fill(theme.paper);
  p.rect(0, 0, keyW, top);
  p.fill(light, 0.9);
  p.rect(0, top, keyW, h - top);
  for (let m = lo; m <= hi; m++) {
    if (isBlackKey(m) || !on.has(m)) continue;
    p.fill(theme.accent);
    p.rect(0, yOf(m), keyW, rowH);
  }
  p.noFill();
  // 白鍵的縫：E/F、B/C 之間在列界上，其餘在黑鍵正中（黑鍵右邊那段）
  p.stroke(dark, hair, 0.35);
  for (let m = lo; m <= hi; m++) {
    if (isBlackKey(m)) p.line(keyW * 0.6, yOf(m) + rowH / 2, keyW, yOf(m) + rowH / 2);
    else if (!isBlackKey(m - 1)) p.line(0, yOf(m - 1), keyW, yOf(m - 1));
  }
  p.stroke(dark, hair * 1.5, 0.5);
  p.line(keyW, top, keyW, h);
  p.noStroke();
  for (let m = lo; m <= hi; m++) {
    if (!isBlackKey(m)) continue;
    p.fill(on.has(m) ? theme.accent : dark);
    p.rect(0, yOf(m) + rowH * 0.08, keyW * 0.6, rowH * 0.84);
  }
  p.noStroke();
  const labelSize = Math.min(u * 0.018, rowH * 1.4);
  for (let m = lo; m <= hi; m++) {
    if (m % 12 !== 0) continue;
    p.fill(on.has(m) ? light : dark, on.has(m) ? 1 : 0.55);
    p.text(midiName(m), keyW - u * 0.006, yOf(m) + rowH / 2 + labelSize * 0.35, {
      size: labelSize,
      font: 'mono',
      align: 'right',
    });
  }
}

function readouts(ctx: LookContext): Readout[] {
  const notes = ctx.readings.notes ?? [];
  const bars = Math.max(1, Math.min(8, Math.round(paramNum(ctx, params, 'bars'))));
  const [lo, hi] = ctx.readings.noteRange ?? rollRange(notes);
  const src = ctx.readings.source?.notes ?? (notes.length ? 'audio' : 'none');
  return [
    { label: 'WINDOW', value: `${bars} ${bars === 1 ? 'bar' : 'bars'}` },
    { label: 'NOTES', value: `${soundingAt(notes, ctx.t).length}/${notes.length}` },
    { label: 'RANGE', value: `${midiName(lo)}–${midiName(hi)}` },
    { label: 'SOURCE', value: src === 'stem' ? 'stems' : src },
  ];
}

/** 鋼琴捲：音符隨小節格向左捲過現在線。 */
export const rollLook: Look = {
  id: 'roll',
  number: 25,
  name: '鋼琴捲',
  listens: ['notes', 'tempo'],
  params,
  draw,
  readouts,
};
