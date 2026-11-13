import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit, Spectrum } from '../analysis/types';
import { midiName } from './glide';
import type { Painter, Point } from './painter/painter';
import { bandSeries, bassAt, paramNum, smoothAt, softDot } from './sheet';
import { labelSize, quantile, stretch } from './sheetPrint';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [{ key: 'window', label: '視窗秒數', min: 6, max: 24, default: 12 }];

/** 頻帶數：40 Hz 到 16 kHz 對數等分。 */
export const LINES = 22;
const LO_HZ = 40;
const HI_HZ = 16000;
/** 最低的幾條線：粗一點、尾端橘點、kick 在上面捲弧。 */
export const BASS_LINES = 6;
/** 每條線每秒幾個取樣（對齊絕對的 1/RATE 格，線不會隨 t 抖）。 */
const RATE = 30;
/** 「現在」在可用寬度的位置；右邊 14% 只有尾端的點。 */
const NOW_X = 0.86;
/** 每個 kick 畫幾圈弧、最多畫最近幾個 kick。 */
const ARCS = 3;
const MAX_KICKS = 24;
/** 每條線的正規化分位數：山腳與山頂。 */
const Q_LO = 0.1;
const Q_HI = 0.98;

interface Band {
  series: Float32Array;
  lo: number;
  hi: number;
}

const bandCache = new WeakMap<Spectrum, Band[]>();

/** 22 條頻帶整首歌的序列，各自帶 10% / 98% 分位數（每條線各自拉開才看得到起伏）。 */
export function bands(s: Spectrum): Band[] {
  const hit = bandCache.get(s);
  if (hit) return hit;
  const out: Band[] = [];
  for (let i = 0; i < LINES; i++) {
    const lo = LO_HZ * (HI_HZ / LO_HZ) ** (i / LINES);
    const hi = LO_HZ * (HI_HZ / LO_HZ) ** ((i + 1) / LINES);
    const series = bandSeries(s, lo, hi);
    out.push({ series, lo: quantile(series, Q_LO), hi: quantile(series, Q_HI) });
  }
  bandCache.set(s, out);
  return out;
}

/** 第 i 條線在 time 的值，0..1（平滑 0.05 s、依整首歌的分位數拉開）。 */
function valueAt(b: Band, fps: number, time: number): number {
  return stretch(smoothAt(b.series, fps, time, 0.05), b.lo, b.hi);
}

interface Layout {
  left: number;
  xNow: number;
  top: number;
  bottom: number;
  spacing: number;
  unit: number;
  font: number;
}

function layout(ctx: LookContext): Layout {
  const { w, h } = ctx;
  const left = w * 0.04;
  const usable = w * 0.97 - left;
  const top = h * 0.12;
  const bottom = h * 0.92;
  return {
    left,
    xNow: left + usable * NOW_X,
    top,
    bottom,
    spacing: (bottom - top) / (LINES - 1),
    unit: Math.min(w, h),
    font: labelSize(ctx),
  };
}

/** 第 i 條線的基線（0 = 最低頻在底、21 = 最高頻在頂）。 */
function baseY(L: Layout, i: number): number {
  return L.bottom - i * L.spacing;
}

/** 振幅：低頻線 1.6 倍行距（峰會疊到鄰線），往上漸縮到 1 倍。 */
function amplitude(L: Layout, i: number): number {
  return L.spacing * (1.6 - (0.6 * i) / (LINES - 1));
}

/** 半圓（開口朝上）：圓心 (cx, cy)、半徑 r。 */
function halfCircle(cx: number, cy: number, r: number, n = 24): Point[] {
  const out: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const a = Math.PI + (Math.PI * k) / n;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** 視窗內最近的 kick（最多 MAX_KICKS 個），由新到舊。 */
export function kicksIn(drums: DrumHit[], from: number, to: number): DrumHit[] {
  const out: DrumHit[] = [];
  for (let i = drums.length - 1; i >= 0 && out.length < MAX_KICKS; i--) {
    const d = drums[i];
    if (d.time > to) continue;
    if (d.time < from) break;
    if (d.kind === 'kick') out.push(d);
  }
  return out;
}

/** 視窗內（含右邊空白區）的小節線：[小節號, 秒]。 */
export function barsIn(ctx: LookContext, from: number, to: number): [number, number][] {
  const tempo = ctx.readings.tempo;
  const out: [number, number][] = [];
  const first = Math.max(1, positionAt(tempo, Math.max(0, from)).bar);
  for (let bar = first; bar < first + 128; bar++) {
    const time = timeOfBar(tempo, bar);
    if (time > to) break;
    if (time >= from) out.push([bar, time]);
  }
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const win = Math.max(1, paramNum(ctx, params, 'window'));
  const L = layout(ctx);
  const { unit } = L;
  const from = t - win;
  const xOf = (time: number) => L.left + ((time - from) / win) * (L.xNow - L.left);
  const hair = Math.max(0.5, unit * 0.0007);

  p.background(theme.paper);

  // 小節格線與小節號（右邊的空白區也畫，像 Oto 的 11）
  const bars = barsIn(ctx, from, from + win / NOW_X);
  p.noFill();
  p.stroke(theme.line, hair, 0.9);
  for (const [, time] of bars) p.line(xOf(time), h * 0.08, xOf(time), h * 0.94);
  p.noStroke();
  p.fill(theme.mute);
  for (const [bar, time] of bars) {
    p.text(String(bar), xOf(time), h * 0.965, { size: L.font, font: 'mono', align: 'center' });
  }

  // 捲弧：視窗內的每個 kick 在最低幾條線上捲三圈同心半圓，越舊越淡
  const kicks = kicksIn(ctx.readings.drums, from, t);
  if (kicks.length) {
    if (theme.glow) p.blend('add');
    p.noFill();
    for (const k of kicks) {
      const alpha = 0.5 * (1 - (t - k.time) / win);
      p.stroke(theme.accent, Math.max(0.5, unit * 0.001), alpha);
      const x = xOf(k.time);
      for (let i = 0; i < BASS_LINES; i++) {
        for (let a = 1; a <= ARCS; a++) p.polyline(halfCircle(x, baseY(L, i), a * 0.06 * unit));
      }
    }
    if (theme.glow) p.blend('normal');
  }

  // 22 條線：由高頻（頂、淡、細）畫到低頻（底、亮、粗），低頻疊在上面
  const first = Math.ceil(from * RATE);
  const last = Math.floor(t * RATE);
  const nowValues = new Float32Array(LINES);
  if (s) {
    const bs = bands(s);
    p.noFill();
    for (let i = LINES - 1; i >= 0; i--) {
      const b = bs[i];
      const base = baseY(L, i);
      const amp = amplitude(L, i);
      const pts: Point[] = [];
      for (let k = first; k <= last; k++) {
        const time = k / RATE;
        pts.push({ x: xOf(time), y: base - valueAt(b, s.fps, time) * amp });
      }
      const now = valueAt(b, s.fps, t);
      nowValues[i] = now;
      pts.push({ x: L.xNow, y: base - now * amp });
      const frac = i / (LINES - 1);
      const weight = Math.max(0.6, unit * (i < BASS_LINES ? 0.0016 : 0.0011));
      p.stroke(theme.ink, weight, 0.9 - 0.35 * frac);
      p.polyline(pts);
    }
  } else {
    // 沒有頻譜：平的基線，紙還是滿的
    p.noFill();
    for (let i = 0; i < LINES; i++) {
      const frac = i / (LINES - 1);
      p.stroke(theme.ink, Math.max(0.6, unit * 0.0011), 0.9 - 0.35 * frac);
      p.line(L.left, baseY(L, i), L.xNow, baseY(L, i));
    }
  }

  // 尾端的點：現在的值；最低幾條橘色，其餘墨色
  if (theme.glow) p.blend('add');
  p.noStroke();
  for (let i = 0; i < LINES; i++) {
    const y = baseY(L, i) - nowValues[i] * amplitude(L, i);
    softDot(p, theme, L.xNow, y, unit * 0.009, i < BASS_LINES ? theme.accent : theme.ink, 0.95);
  }
  if (theme.glow) p.blend('normal');
}

function readouts(ctx: LookContext): Readout[] {
  const win = Math.max(1, paramNum(ctx, params, 'window'));
  const b = bassAt(ctx.readings.bass ?? [], ctx.t, true);
  return [
    { label: 'LINES', value: String(LINES) },
    { label: 'WINDOW', value: `${Math.round(win)} s` },
    { label: 'BASS', value: b ? midiName(b.midi) : '—' },
  ];
}

/** Trace：22 條頻帶線疊成山脊向左捲，尾端一點；kick 在最低幾條線上捲出同心弧。 */
export const traceLook: Look = {
  id: 'trace',
  number: 33,
  name: '頻帶描線',
  listens: ['spectrum', 'drums', 'bass'],
  params,
  draw,
  readouts,
};
