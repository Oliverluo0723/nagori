import type { Spectrum, TempoMap } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { printedBeat } from './sheet';
import type { LookContext } from './types';

/**
 * 八個 Sheet look（Ridge、Drum、Disc、Mesh、Gel、Corona、String、Polygraph）共用的「印刷」工具：
 * 版面字級、筆頭游標、還沒印到的淡格線、整首歌的幾何快取、序列的分位數正規化。
 * 都是純函式或以輸入物件為鍵的快取，同輸入同輸出。
 */

/** 小標字級：跟著格子短邊走，太小的格子也不會小到看不見。 */
export function labelSize(ctx: LookContext): number {
  const unit = Math.min(ctx.w, ctx.h);
  return Math.max(8, Math.min(22, unit * 0.0135));
}

/** 「正在印」的長度：最近兩拍用強調色。 */
export function accentWindow(tempo: TempoMap, t: number): number {
  return printedBeat(tempo, t) * 2;
}

/** Oto 的筆頭：一圈細環加中心一點，墨色。 */
export function penCursor(p: Painter, ctx: LookContext, x: number, y: number): void {
  const d = Math.max(7, Math.min(ctx.w, ctx.h) * 0.016);
  p.noFill();
  p.stroke(ctx.theme.ink, Math.max(1, d * 0.12));
  p.circle(x, y, d);
  p.noStroke();
  p.fill(ctx.theme.ink);
  p.circle(x, y, d * 0.28);
}

/** 依目標刻度數挑一個好讀的秒數間隔（5、10、15、20、30、60、120 秒…）。 */
export function tickStep(total: number, target = 10): number {
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
  for (const s of steps) if (total / s <= target) return s;
  return steps[steps.length - 1];
}

/**
 * 兩層快取：外層以讀數物件（spectrum、drums 陣列…）為鍵，自動隨它回收；
 * 內層以版面字串（尺寸、參數）為鍵，最多留幾份，拖格線改尺寸時不會無限長大。
 */
export function geometryCache<K extends object, V>(
  limit = 6,
): (key: K, sig: string, build: () => V) => V {
  const outer = new WeakMap<K, Map<string, V>>();
  return (key, sig, build) => {
    let inner = outer.get(key);
    if (!inner) {
      inner = new Map();
      outer.set(key, inner);
    }
    const hit = inner.get(sig);
    if (hit !== undefined) return hit;
    const v = build();
    if (inner.size >= limit) {
      const first = inner.keys().next().value;
      if (first !== undefined) inner.delete(first);
    }
    inner.set(sig, v);
    return v;
  };
}

const quantileCache = new WeakMap<Float32Array, Map<number, number>>();

/** 序列的 q 分位數（0..1），以序列物件快取。 */
export function quantile(series: Float32Array, q: number): number {
  let m = quantileCache.get(series);
  if (!m) {
    m = new Map();
    quantileCache.set(series, m);
  }
  const hit = m.get(q);
  if (hit !== undefined) return hit;
  let v = 0;
  if (series.length > 0) {
    const sorted = Float32Array.from(series).sort();
    v = sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
  }
  m.set(q, v);
  return v;
}

/** 把值依整首歌的 lo..hi 分位數拉到 0..1（大部分歌的頻譜都擠在中段，拉開才看得出起伏）。 */
export function stretch(v: number, lo: number, hi: number): number {
  if (!(hi > lo)) return v > lo ? 1 : 0;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

/** 固定的「波形」抖動：第 i 個取樣點一上一下，振幅帶一點確定性的變化，看起來像真的音訊波形。 */
export function wiggle(i: number): number {
  let x = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  const r = ((x ^ (x >>> 13)) >>> 0) / 4294967296;
  return (i % 2 === 0 ? 1 : -1) * (0.55 + 0.45 * r);
}

const drumEnvCache = new WeakMap<object, Float32Array>();
/** 鼓包絡的取樣率（每秒幾點）。 */
export const DRUM_ENV_RATE = 200;
const DRUM_VOICE = {
  kick: { amp: 1, decay: 0.32 },
  snare: { amp: 0.85, decay: 0.22 },
  hat: { amp: 0.32, decay: 0.07 },
} as const;

/**
 * 整首歌的鼓包絡（0..1，每秒 DRUM_ENV_RATE 點）：每個 hit 一段快起慢落，取最大值。
 * 以 drums 陣列快取；Drum 的地震列、Disc 的溝槽都拿它當波形的振幅。
 */
export function drumEnvelope(
  drums: { time: number; kind: 'kick' | 'snare' | 'hat'; velocity: number }[],
  duration: number,
): Float32Array {
  const hit = drumEnvCache.get(drums);
  if (hit && hit.length >= Math.ceil(duration * DRUM_ENV_RATE)) return hit;
  const n = Math.max(1, Math.ceil(duration * DRUM_ENV_RATE) + 1);
  const out = new Float32Array(n);
  for (const d of drums) {
    const v = DRUM_VOICE[d.kind];
    const start = Math.max(0, Math.floor(d.time * DRUM_ENV_RATE));
    const len = Math.ceil(v.decay * 5 * DRUM_ENV_RATE);
    for (let k = 0; k < len && start + k < n; k++) {
      const dt = k / DRUM_ENV_RATE;
      const e = v.amp * d.velocity * Math.exp(-dt / v.decay) * Math.min(1, (k + 1) / 2);
      if (e > out[start + k]) out[start + k] = e;
    }
  }
  drumEnvCache.set(drums, out);
  return out;
}

/** 包絡在 time 秒的值（越界回 0）。 */
export function envAt(env: Float32Array, time: number): number {
  const i = Math.floor(time * DRUM_ENV_RATE);
  return i >= 0 && i < env.length ? env[i] : 0;
}

/** 頻譜某幀的值（越界夾住）；序列以 fps 取樣。 */
export function seriesAt(series: Float32Array, fps: number, time: number): number {
  if (series.length === 0) return 0;
  const i = Math.max(0, Math.min(series.length - 1, Math.floor(time * fps)));
  return series[i];
}

/** 把點列在 index 處切成「已印」與「正在印」兩段，兩段共用接點，畫起來不斷。 */
export function splitPrinted<T extends Point>(pts: T[], index: number): [T[], T[]] {
  const k = Math.max(0, Math.min(pts.length, index));
  return [pts.slice(0, k), pts.slice(Math.max(0, k - 1))];
}

/** 用 spectrum 的 fps 換算 [from, to) 的平均。 */
export function windowMean(s: Spectrum, series: Float32Array, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * s.fps));
  const b = Math.min(series.length, Math.max(a + 1, Math.ceil(to * s.fps)));
  if (b <= a) return 0;
  let sum = 0;
  for (let f = a; f < b; f++) sum += series[f];
  return sum / (b - a);
}
