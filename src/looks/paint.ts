import { secondsToTicks, ticksToSeconds } from '../analysis/tempo';
import type { Readings } from '../analysis/types';
import { sources } from './flow';
import type { Painter, Point } from './painter/painter';
import { BANDS7, bandSeries, formatTime, meanOver, paramNum, rngFor } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'steps', label: '筆觸長度', min: 4, max: 24, default: 10 },
  { key: 'strokes', label: '整首筆觸上限', min: 500, max: 8000, default: 3200 },
];

/**
 * 每個頻帶在畫布上的高度帶（0 = 頂、1 = 底）、筆寬（畫布寬的比例）與顏色。
 * 照 Oto 海報：低頻是底下的大片藍，往上是紅、金、綠、紫，最上面是墨色細線與點。
 * color = theme.noteColors 的索引；-1 = theme.ink。
 */
const LAYERS: {
  top: number;
  bottom: number;
  width: number;
  color: number;
  /** 偶爾換成的鄰近色（三成的筆），顏料才不是一整片平塗。 */
  alt: number;
  alpha: number;
}[] = [
  { top: 0.8, bottom: 1.02, width: 0.032, color: 9, alt: 10, alpha: 0.55 }, // sub
  { top: 0.62, bottom: 0.94, width: 0.027, color: 9, alt: 8, alpha: 0.5 }, // bass
  { top: 0.52, bottom: 0.72, width: 0.021, color: 0, alt: 1, alpha: 0.6 }, // low-mids
  { top: 0.36, bottom: 0.6, width: 0.018, color: 4, alt: 2, alpha: 0.62 }, // mids
  { top: 0.26, bottom: 0.46, width: 0.013, color: 7, alt: 6, alpha: 0.66 }, // high-mids
  { top: 0.12, bottom: 0.34, width: 0.008, color: 11, alt: 10, alpha: 0.72 }, // presence
  { top: -0.02, bottom: 0.2, width: 0.0035, color: -1, alt: -1, alpha: 0.8 }, // air
];

/** 一條筆觸：正規化座標（x 以寬、y 以高為 1），時間排序。 */
export interface Stroke {
  time: number;
  band: number;
  pts: Float32Array;
  /** 筆寬，畫布寬的比例。 */
  width: number;
  /** theme.noteColors 的索引；-1 = ink。 */
  color: number;
  /** 這一筆的不透明度（層的基準上下浮動，顏料才有深淺）。 */
  alpha: number;
  /** 0..1：這一刻該帶相對整首歌有多響。 */
  level: number;
  /** 高頻的強拍：筆尾點一顆墨點。 */
  dot: boolean;
}

export interface PaintData {
  /** 每帶一串，各自依時間排序；畫的時候低頻先、高頻後，高頻疊在上面。 */
  bands: Stroke[][];
  /** 每帶筆觸的時間（排序），二分搜尋用。 */
  bandTimes: Float64Array[];
  /** 全部筆觸的時間（排序），算 STROKES 用。 */
  times: Float64Array;
  /** 依畫布尺寸快取的像素座標。 */
  px?: { w: number; h: number; pts: Point[][][] };
}

const cache = new WeakMap<Readings, Map<string, PaintData>>();

function quantile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(q * sorted.length)))];
}

/** 固定的流場（七個漩渦源，跟 t 無關）：回傳單位方向。 */
function fieldFor(seed: number): (x: number, y: number) => [number, number] {
  const src = sources(seed);
  const rng = rngFor(seed, 77);
  const pa = rng() * Math.PI * 2;
  const pb = rng() * Math.PI * 2;
  return (x, y) => {
    // 整體往右上飄，加一點波紋，再被七個漩渦攪動
    let vx = 0.08 + 0.1 * Math.sin(y * 9 + pa);
    let vy = -0.07 + 0.12 * Math.cos(x * 7 + pb);
    for (const s of src) {
      const dx = x - s.x;
      const dy = y - s.y;
      const k = (s.spin * 0.1) / (dx * dx + dy * dy + 0.02);
      vx += -dy * k;
      vy += dx * k;
    }
    const len = Math.hypot(vx, vy) || 1;
    return [vx / len, vy / len];
  };
}

/**
 * 整首歌的筆觸：每個 16 分音符一批，每帶夠響才下一筆（門檻取分位數，
 * 讓整首總數約等於上限），沿固定流場走。純函式，依 readings 物件快取。
 */
export function paintData(
  r: Readings,
  seed: number,
  aspect: number,
  steps: number,
  cap: number,
): PaintData | null {
  const s = r.spectrum;
  if (!s || !(r.duration > 0)) return null;
  const key = `${seed}|${aspect.toFixed(3)}|${steps}|${cap}`;
  let byKey = cache.get(r);
  if (!byKey) {
    byKey = new Map();
    cache.set(r, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;

  // 16 分音符格
  const q = r.tempo.ppq / 4;
  const ticks: [number, number][] = [];
  for (let k = Math.ceil(secondsToTicks(r.tempo, 0) / q); ticks.length < 200000; k++) {
    const a = Math.max(0, ticksToSeconds(r.tempo, k * q));
    if (a >= r.duration) break;
    const b = ticksToSeconds(r.tempo, (k + 1) * q);
    if (!(b > a)) break;
    ticks.push([a, b]);
  }
  const keep = Math.min(0.7, cap / Math.max(1, ticks.length * BANDS7.length));
  const field = fieldFor(seed);
  const stepLen = 0.016;
  const wave = rngFor(seed, 91);
  const phases = BANDS7.map(() => wave() * Math.PI * 2);
  const bands: Stroke[][] = [];
  const all: number[] = [];

  BANDS7.forEach((band, bi) => {
    const series = bandSeries(s, band.lo, band.hi);
    const vals = new Float32Array(ticks.length);
    for (let i = 0; i < ticks.length; i++)
      vals[i] = meanOver(series, s.fps, ticks[i][0], ticks[i][1]);
    const sorted = Float32Array.from(vals).sort();
    const gate = quantile(sorted, 1 - keep);
    const lo = quantile(sorted, 0.3);
    const hi = quantile(sorted, 0.985);
    const layer = LAYERS[bi];
    const out: Stroke[] = [];
    for (let i = 0; i < ticks.length; i++) {
      const v = vals[i];
      if (v <= gate || v <= 0) continue;
      const level = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5;
      const rng = rngFor(seed, bi * 1000003 + i);
      const progress = ticks[i][0] / r.duration;
      let x = -0.05 + progress * 1.04 + (rng() - 0.5) * 0.05;
      // 層與層的邊界是波浪，不是直線
      let y =
        layer.top +
        (layer.bottom - layer.top) * rng() +
        0.07 * Math.sin(progress * Math.PI * 2 * 1.4 + phases[bi]);
      const n = Math.max(2, Math.round(steps * (0.45 + 0.75 * level)));
      const pts = new Float32Array(n * 2);
      let m = 0;
      for (let k = 0; k < n; k++) {
        pts[m++] = x;
        pts[m++] = y;
        const [vx, vy] = field(x, y);
        x += vx * stepLen;
        y += vy * stepLen * aspect;
      }
      const width = layer.width * (0.55 + 0.7 * level) * (0.85 + 0.3 * rng());
      // 不透明度量化到 0.05，p5 的顏色快取才不會爆
      const alpha = Math.round(layer.alpha * (0.6 + 0.55 * rng()) * 20) / 20;
      out.push({
        time: ticks[i][0],
        band: bi,
        pts,
        width,
        color: rng() < 0.3 ? layer.alt : layer.color,
        alpha: Math.min(0.9, alpha),
        level,
        dot: bi >= 5 && level > 0.82,
      });
      all.push(ticks[i][0]);
    }
    bands.push(out);
  });

  all.sort((a, b) => a - b);
  const data: PaintData = {
    bands,
    bandTimes: bands.map((list) => Float64Array.from(list, (st) => st.time)),
    times: Float64Array.from(all),
  };
  byKey.set(key, data);
  return data;
}

/** 時間 ≤ t 的個數（times 已排序）。 */
function countUpTo(times: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function dataFor(ctx: LookContext): PaintData | null {
  const steps = Math.round(paramNum(ctx, params, 'steps'));
  const cap = Math.round(paramNum(ctx, params, 'strokes'));
  return paintData(ctx.readings, ctx.seed, ctx.w / Math.max(1, ctx.h), steps, cap);
}

function pixels(data: PaintData, w: number, h: number): Point[][][] {
  if (data.px && data.px.w === w && data.px.h === h) return data.px.pts;
  const pts = data.bands.map((list) =>
    list.map((st) => {
      const out: Point[] = [];
      for (let i = 0; i < st.pts.length; i += 2)
        out.push({ x: st.pts[i] * w, y: st.pts[i + 1] * h });
      return out;
    }),
  );
  data.px = { w, h, pts };
  return pts;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  p.background(theme.paper);
  const data = dataFor(ctx);
  if (!data) return;
  const px = pixels(data, w, h);
  const unit = Math.min(w, h);

  // 低頻先畫、高頻疊在上面；每帶只畫 t 之前的
  p.noFill();
  let batch: { st: Stroke; pts: Point[] } | null = null;
  const last = data.times[countUpTo(data.times, t) - 1];
  data.bands.forEach((list, bi) => {
    const n = countUpTo(data.bandTimes[bi], t);
    for (let i = 0; i < n; i++) {
      const st = list[i];
      const color = st.color < 0 ? theme.ink : (theme.noteColors[st.color] ?? theme.ink);
      p.stroke(color, Math.max(1, st.width * w), st.alpha);
      p.polyline(px[bi][i]);
      if (st.time === last && (!batch || st.width > batch.st.width)) batch = { st, pts: px[bi][i] };
    }
  });

  // 高頻強拍的墨點
  p.noStroke();
  p.fill(theme.ink, 0.82);
  for (let bi = 5; bi < data.bands.length; bi++) {
    const list = data.bands[bi];
    for (let i = 0; i < list.length && list[i].time <= t; i++) {
      const st = list[i];
      if (!st.dot) continue;
      const q = px[bi][i][px[bi][i].length - 1];
      p.circle(q.x, q.y, w * 0.008 * (0.6 + 0.6 * st.level));
    }
  }

  // 正在畫的那一批：最粗那一筆中間套一個空心圓
  const now = batch as { st: Stroke; pts: Point[] } | null;
  if (now && t < ctx.readings.duration - 0.05) {
    const mid = now.pts[Math.floor(now.pts.length / 2)];
    p.noFill();
    p.stroke(theme.mute, Math.max(1, unit * 0.0018), 0.85);
    p.circle(mid.x, mid.y, now.st.width * w * 1.8 + unit * 0.03);
  }
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings: r } = ctx;
  const data = dataFor(ctx);
  const printed = r.duration > 0 ? Math.min(1, Math.max(0, t / r.duration)) : 0;
  return [
    { label: 'PRINTED', value: `${Math.round(printed * 100)} %` },
    { label: 'PEN', value: 'Paint' },
    { label: 'STROKES', value: String(data ? countUpTo(data.times, t) : 0) },
    { label: 'TIME', value: formatTime(t) },
  ];
}

/** 油畫（Sheet 系）：整首歌一筆一筆畫成一張，頻帶是一層層顏料，低頻在底、高頻在上。 */
export const paintLook: Look = {
  id: 'paint',
  number: 29,
  name: '油畫',
  listens: ['spectrum'],
  params,
  draw,
  readouts,
};
