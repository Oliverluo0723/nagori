import type { Spectrum } from '../analysis/types';
import type { Painter } from './painter/painter';
import { bandSeries, barTimes, drawLabel, meanOver, paramNum, printedBeat, rngFor } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'threads', label: '絲線數', min: 8, max: 24, default: 16 },
  { key: 'threshold', label: '門檻', min: 0, max: 0.95, default: 0.72 },
  { key: 'fall', label: '下滑秒數', min: 1, max: 6, default: 3.2 },
];

const TOP = 0.03;
const BOTTOM = 1;
const LEFT = 0.07;
const RIGHT = 0.93;
const LO_HZ = 40;
const HI_HZ = 14000;
/** 每小節幾個出珠的時刻（四分音符） */
const SLOTS_PER_BAR = 4;
/** 絲線從左到右的色相：綠 → 黃 → 橙 → 紅 → 紫 → 藍 → 青（theme.noteColors 的索引） */
const HUE_RING = [6, 5, 3, 2, 1, 0, 11, 10, 9, 8, 7];

interface Thread {
  lo: number;
  hi: number;
  color: number;
  /** 絲線長度（0..1，乘上可用高度） */
  length: number;
}

/** 第 i 條線聽的頻段：40 Hz–14 kHz 對數均分。 */
function threadsOf(n: number, seed: number): Thread[] {
  const out: Thread[] = [];
  const rng = rngFor(seed ^ 0x3c6ef372, n);
  for (let i = 0; i < n; i++) {
    const lo = LO_HZ * (HI_HZ / LO_HZ) ** (i / n);
    const hi = LO_HZ * (HI_HZ / LO_HZ) ** ((i + 1) / n);
    const color = HUE_RING[Math.min(HUE_RING.length - 1, Math.floor((i / n) * HUE_RING.length))];
    out.push({ lo, hi, color, length: 0.62 + 0.38 * rng() });
  }
  return out;
}

const levelCache = new WeakMap<Spectrum, Map<string, number>>();

/** 一段頻帶整首歌的「響」：第 90 百分位（抽樣估），拿來把各頻帶正規化（高頻天生比低頻小）。 */
function loudLevel(s: Spectrum, lo: number, hi: number): number {
  let m = levelCache.get(s);
  if (!m) {
    m = new Map();
    levelCache.set(s, m);
  }
  const key = `${lo}-${hi}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  const series = bandSeries(s, lo, hi);
  // 每 4 幀取一個樣就夠估百分位，第一幀才不會卡
  const sample = new Float32Array(Math.ceil(series.length / 4));
  for (let i = 0; i < sample.length; i++) sample[i] = series[i * 4];
  const sorted = sample.sort();
  const v = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.9)] ?? 0);
  m.set(key, v);
  return v;
}

/** 頻帶在 [from, to] 的正規化能量，0..~1.3。 */
function swell(s: Spectrum, th: Thread, from: number, to: number): number {
  const v = meanOver(bandSeries(s, th.lo, th.hi), s.fps, from, Math.max(from, to));
  return v / loudLevel(s, th.lo, th.hi);
}

/** 0..1 的進度改成 steps 段階梯：每段前 35% 滑過去（緩入緩出），其餘停住。 */
function stepped(u: number, steps: number): number {
  const n = Math.max(1, Math.round(steps));
  const x = u * n;
  const k = Math.floor(x);
  const g = Math.min(1, (x - k) / 0.35);
  return (k + g * g * (3 - 2 * g)) / n;
}

interface Drop {
  thread: number;
  y: number;
  size: number;
  alpha: number;
}

/** 這一幀還在線上的所有露珠：每條線、每一拍，頻帶夠響就出一滴，沿線越滑越快。 */
function dropsAt(ctx: LookContext, threads: Thread[]): Drop[] {
  const { h, t } = ctx;
  const s = ctx.readings.spectrum;
  if (!s) return [];
  const threshold = paramNum(ctx, params, 'threshold');
  const fall = paramNum(ctx, params, 'fall');
  const top = h * TOP;
  const span = h * (BOTTOM - TOP);
  const unit = Math.min(ctx.w, h);
  const slots = barTimes(ctx.readings.tempo, t, SLOTS_PER_BAR);
  const beat = printedBeat(ctx.readings.tempo, t);
  const out: Drop[] = [];
  for (let k = slots.length - 1; k >= 0; k--) {
    const from = slots[k];
    if (from < t - fall) break;
    const to = k + 1 < slots.length ? slots[k + 1] : from + (from - (slots[k - 1] ?? from - 0.25));
    for (let i = 0; i < threads.length; i++) {
      const th = threads[i];
      const rng = rngFor(ctx.seed + i * 7919, k);
      const r = rng();
      const e = swell(s, th, from, Math.min(to, t));
      const chance = (e - threshold) / Math.max(1e-6, 1.05 - threshold);
      if (r > chance) continue;
      const age = t - from;
      // 一拍一拍地滑：每拍開頭滑一小段、其餘時間掛著，同一拍出的珠子排成一列
      const u = stepped(age / fall, fall / beat);
      const y = top + span * th.length * (0.04 + 0.96 * u ** 1.3);
      if (y > top + span * th.length) continue;
      const size = unit * (0.01 + 0.02 * Math.min(1, Math.max(0, chance)));
      out.push({ thread: i, y, size, alpha: 1 - 0.55 * u });
    }
  }
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const dark = theme.glow;
  const n = Math.max(1, Math.round(paramNum(ctx, params, 'threads')));
  const threads = threadsOf(n, ctx.seed);
  const xOf = (i: number) => w * LEFT + ((i + 0.5) / n) * w * (RIGHT - LEFT);
  const top = h * TOP;
  const span = h * (BOTTOM - TOP);
  const unit = Math.min(w, h);
  const color = (th: Thread) => theme.noteColors[th.color] ?? theme.ink;

  p.background(theme.paper);
  p.noStroke();

  // 彩霧：每條線一團慢慢呼吸的色暈（約一秒的平均），疊成一整片從左到右變色的光
  if (s) {
    p.blend(dark ? 'add' : 'multiply');
    const R = Math.max(w, h) * 0.42;
    for (let i = 0; i < n; i += 2) {
      const e = Math.min(1.2, swell(s, threads[i], Math.max(0, t - 1.2), t));
      const a = (dark ? 0.05 : 0.035) + (dark ? 0.09 : 0.05) * e;
      p.haze(xOf(i), h * (0.3 + 0.35 * ((i * 0.37) % 1)), R, color(threads[i]), a);
    }
    p.blend('normal');
  }

  // 絲線與頂上的珠子
  for (let i = 0; i < n; i++) {
    const th = threads[i];
    const x = xOf(i);
    p.stroke(color(th), Math.max(1, unit * 0.0011), dark ? 0.45 : 0.55);
    p.line(x, top, x, top + span * th.length);
    p.noStroke();
    p.fill(color(th), 0.85);
    p.circle(x, top, unit * 0.014);
  }

  // 露珠：上面拖幾節越來越淡的尾巴，中間一點白光
  const drops = dropsAt(ctx, threads);
  if (dark) p.blend('add');
  for (const d of drops) {
    const th = threads[d.thread];
    const c = color(th);
    const x = xOf(d.thread);
    for (let k = 4; k >= 1; k--) {
      const f = k / 5;
      p.fill(c, d.alpha * 0.36 * (1 - f));
      p.ellipse(x, d.y - d.size * (0.4 + k * 1.05), d.size * (0.85 - 0.45 * f), d.size * 1.9);
    }
    if (dark) {
      p.fill(c, d.alpha * 0.22);
      p.circle(x, d.y, d.size * 2);
    }
  }
  p.blend('normal');
  for (const d of drops) {
    const c = color(threads[d.thread]);
    const x = xOf(d.thread);
    p.fill(c, Math.min(1, d.alpha + 0.2));
    p.circle(x, d.y, d.size);
    p.fill(dark ? theme.ink : theme.paper, 0.9 * d.alpha);
    p.circle(x, d.y, d.size * (dark ? 0.32 : 0.24));
  }

  drawLabel(p, ctx);
}

function readouts(ctx: LookContext): Readout[] {
  const n = Math.max(1, Math.round(paramNum(ctx, params, 'threads')));
  const threads = threadsOf(n, ctx.seed);
  const s = ctx.readings.spectrum;
  const drops = dropsAt(ctx, threads);
  let fullest = 0;
  let best = -1;
  let haze = 0;
  if (s) {
    for (let i = 0; i < n; i++) {
      const e = swell(s, threads[i], Math.max(0, ctx.t - 1.2), ctx.t);
      haze += Math.min(1, e) / n;
      if (e > best) {
        best = e;
        fullest = i;
      }
    }
  }
  return [
    { label: 'THREADS', value: String(n) },
    { label: 'FALLING', value: String(drops.length) },
    { label: 'FULLEST', value: s ? `band ${fullest + 1}` : '—' },
    { label: 'HAZE', value: `${Math.round(haze * 100)} %` },
  ];
}

/** 露珠：16 條絲線各聽一段頻帶，頻帶一漲就在拍點上出一滴光珠，拖著尾巴沿線滑下；背後是跟著頻帶呼吸的彩霧。 */
export const dewLook: Look = {
  id: 'dew',
  number: 20,
  name: '露珠',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
  readouts,
};

/** 測試用：露珠的純資料版本。 */
export { dropsAt as dewDropsAt, threadsOf as dewThreads };
