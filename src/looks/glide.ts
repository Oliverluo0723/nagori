import { positionAt, timeOfBar } from '../analysis/tempo';
import type { BassNote } from '../analysis/types';
import { pcName } from './music';
import type { Painter, Point } from './painter/painter';
import { bassAt } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [{ key: 'windowBars', label: '視窗小節數', min: 1, max: 8, default: 4 }];

/** 播放線在圖框寬度的位置（右邊留一點給還沒響的音） */
export const NOW_X = 0.8;
/** 音域至少顯示兩個八度，網格才像 Oto 一樣滿 */
const MIN_SPAN = 24;
/** 前一個音結束到下一個音開始少於這麼久，就畫成一條連著的跳線（808 的 L 形） */
const JOIN_GAP = 0.2;

/** 26 → 'D1'（C4 = 60） */
export function midiName(midi: number): string {
  const m = Math.round(midi);
  return `${pcName(m)}${Math.floor(m / 12) - 1}`;
}

/** midi（可帶小數）→ Hz，A4 = 440。 */
export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function num(ctx: LookContext, key: string): number {
  const v = ctx.params[key];
  if (typeof v === 'number') return v;
  return params.find((p) => p.key === key)?.default ?? 0;
}

function windowSeconds(ctx: LookContext): number {
  const { tempo } = ctx.readings;
  const bar = positionAt(tempo, ctx.t).bar;
  const s = timeOfBar(tempo, bar + 1) - timeOfBar(tempo, bar);
  return num(ctx, 'windowBars') * (s > 0 ? s : 2);
}

/** 整首 bass 的最低、最高音（沒有 bass 時 null）。 */
function songRange(bass: BassNote[]): [number, number] | null {
  if (bass.length === 0) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const n of bass) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  return [lo, hi];
}

/** 顯示的音域：整首的音域上下各留 2 半音，不足兩個八度就往兩邊撐開。 */
export function displayRange(bass: BassNote[]): [number, number] {
  const r = songRange(bass);
  if (!r) return [24, 48];
  let lo = r[0] - 2;
  let hi = r[1] + 2;
  const short = MIN_SPAN - (hi - lo);
  if (short > 0) {
    lo -= Math.floor(short / 2);
    hi += Math.ceil(short / 2);
  }
  return [lo, hi];
}

/** 圖框（含左側音名欄）在繪圖框裡的位置。 */
export function plotFrame(w: number, h: number) {
  const u = Math.min(w, h) / 1000;
  const small = Math.max(18 * u, 14);
  const gutter = small * 3.2;
  return { u, small, x0: gutter, x1: w - 1, y0: 1, y1: h - 1 };
}

function noteAt(n: BassNote, time: number): number {
  let semis = 0;
  for (const b of n.bends) if (b.time <= time) semis = b.semitones;
  return n.midi + semis;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const bass = ctx.readings.bass ?? [];
  const [lo, hi] = displayRange(bass);
  const F = plotFrame(w, h);
  const { u, small } = F;
  const yOf = (midi: number) => F.y1 - ((midi - lo) / (hi - lo)) * (F.y1 - F.y0);
  const win = windowSeconds(ctx);
  const pxPerSec = (F.x1 - F.x0) / win;
  const nowX = F.x0 + (F.x1 - F.x0) * NOW_X;
  const xOf = (time: number) => nowX + (time - t) * pxPerSec;
  const tFrom = t - (nowX - F.x0) / pxPerSec;
  const tTo = t + (F.x1 - nowX) / pxPerSec;
  const hair = Math.max(1, 1.2 * u);

  p.background(theme.paper);

  // 半音細線；C 線最亮、G 線次之
  p.noFill();
  for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
    const pc = ((m % 12) + 12) % 12;
    if (pc === 0) p.stroke(theme.mute, hair * 1.3, 0.75);
    else p.stroke(theme.line, hair, pc === 7 ? 1 : 0.8);
    p.line(F.x0, yOf(m), F.x1, yOf(m));
  }

  // 拍線與小節線（跟著時間往左捲）
  const { tempo } = ctx.readings;
  const firstBar = Math.max(1, positionAt(tempo, Math.max(0, tFrom)).bar);
  for (let bar = firstBar; ; bar++) {
    const b0 = timeOfBar(tempo, bar);
    const b1 = timeOfBar(tempo, bar + 1);
    if (!(b1 > b0) || b0 > tTo) break;
    const beats = 4;
    for (let k = 0; k < beats; k++) {
      const x = xOf(b0 + ((b1 - b0) * k) / beats);
      if (x < F.x0 || x > F.x1) continue;
      p.stroke(theme.line, k === 0 ? hair * 1.4 : hair, k === 0 ? 0.95 : 0.4);
      p.line(x, F.y0, x, F.y1);
    }
    if (bar > firstBar + 64) break;
  }

  // 左欄音名：C 用墨色粗體，G 用灰
  p.noStroke();
  for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
    const pc = ((m % 12) + 12) % 12;
    if (pc !== 0 && pc !== 7) continue;
    p.fill(pc === 0 ? theme.ink : theme.mute, pc === 0 ? 0.9 : 1);
    p.text(midiName(m), 0, Math.max(0, Math.min(h - small * 1.15, yOf(m) - small * 0.55)), {
      size: small,
      font: 'mono',
      weight: pc === 0 ? 700 : 400,
    });
  }

  // bass 路徑：已經響過的用強調色，還沒響的淡淡預告
  const thick = Math.max(2, 5 * u);
  let prev: BassNote | null = null;
  for (const n of bass) {
    const end = n.time + n.duration;
    if (end < tFrom - JOIN_GAP) {
      prev = n;
      continue;
    }
    if (n.time > tTo) break;
    const pts: Point[] = [];
    // 緊接著前一個音：從前一個音的尾音高直接拉上來（跳線）
    if (prev && n.time - (prev.time + prev.duration) < JOIN_GAP) {
      pts.push({ x: xOf(n.time), y: yOf(noteAt(prev, prev.time + prev.duration)) });
    }
    pts.push({ x: xOf(n.time), y: yOf(n.midi) });
    for (const b of n.bends) pts.push({ x: xOf(b.time), y: yOf(n.midi + b.semitones) });
    pts.push({ x: xOf(end), y: yOf(noteAt(n, end)) });
    prev = n;

    // 切成已響 / 未響兩段：用 now 線剪開
    const past: Point[] = [];
    const future: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      if (a.x <= nowX) past.push(a);
      if (a.x >= nowX) future.push(a);
      const b = pts[i + 1];
      if (b && a.x < nowX && b.x > nowX) {
        const k = (nowX - a.x) / (b.x - a.x);
        const cut = { x: nowX, y: a.y + (b.y - a.y) * k };
        past.push(cut);
        future.push(cut);
      }
    }
    p.noFill();
    if (past.length >= 2) {
      if (theme.glow) {
        p.stroke(theme.accent, thick * 3.2, 0.14);
        p.polyline(past);
      }
      p.stroke(theme.accent, thick);
      p.polyline(past);
    }
    if (future.length >= 2) {
      p.stroke(theme.accent, thick * 0.6, 0.3);
      p.polyline(future);
    }
  }

  // 圖框
  p.noFill();
  p.stroke(theme.mute, hair, 0.7);
  p.rect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);

  // 播放線
  p.stroke(theme.ink, hair * 1.3, 0.55);
  p.line(nowX, F.y0, nowX, F.y1);

  // 最近的音（正在響或剛響完）：空心圈 + 大字音名
  const now = bassAt(bass, t, true);
  if (now) {
    const y = yOf(now.midi);
    const d = Math.max(14, 30 * u);
    if (theme.glow) p.haze(nowX, y, d * 5, theme.accent, 0.22);
    p.fill(theme.paper);
    p.stroke(theme.ink, Math.max(2, 3.2 * u));
    p.circle(nowX, y, d);
    p.noStroke();
    p.fill(theme.ink);
    const big = Math.max(56 * u, 24);
    const labelX = nowX + d * 0.9;
    const tooRight = labelX + big * 1.4 > F.x1;
    p.text(midiName(now.midi), tooRight ? nowX - d * 0.9 : labelX, y - big * 0.55, {
      size: big,
      font: 'sans',
      weight: 700,
      align: tooRight ? 'right' : 'left',
      tracking: -0.03,
    });
  }
}

function readouts(ctx: LookContext): Readout[] {
  const bass = ctx.readings.bass ?? [];
  const held = bassAt(bass, ctx.t, true);
  const range = songRange(bass);
  const win = windowSeconds(ctx);
  return [
    { label: 'NOTE', value: held ? midiName(held.midi) : '—' },
    { label: 'FREQUENCY', value: held ? `${midiHz(held.midi).toFixed(1)} Hz` : '—' },
    { label: 'RANGE', value: range ? `${midiName(range[0])} – ${midiName(range[1])}` : '—' },
    { label: 'WINDOW', value: `${win.toFixed(win < 10 ? 1 : 0)} s` },
  ];
}

/** Bass 路徑：808 的音高折線，含滑音與跳音。 */
export const glideLook: Look = {
  id: 'glide',
  number: 3,
  name: 'Bass 路徑',
  listens: ['bass', 'tempo'],
  params,
  draw,
  readouts,
};
