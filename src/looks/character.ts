import { binHz, binValue } from '../analysis/audio/spectrum';
import type { DrumHit, Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { BANDS7, bandSeries, energySeries, meanOver, paramNum, smoothAt, softDot } from './sheet';
import { drumEnvelope, envAt, labelSize, quantile, stretch } from './sheetPrint';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [{ key: 'smooth', label: '平滑秒數', min: 0.1, max: 1, default: 0.4 }];

/**
 * 五條量尺（0 = 左邊的字、1 = 右邊的字）。
 * 沒有立體聲讀數，Oto 的 NARROW–WIDE 換成 SOFT–HARD（鼓的瞬態 vs. 頻帶能量）。
 */
export const SCALES: [string, string][] = [
  ['DARK', 'BRIGHT'],
  ['CALM', 'INTENSE'],
  ['SOFT', 'HARD'],
  ['SPARSE', 'DENSE'],
  ['LIGHT', 'HEAVY'],
];
/** 「上一段」：t 之前 8 到 4 秒的平均。 */
const BEFORE_FROM = 8;
const BEFORE_TO = 4;
const Q_LO = 0.05;
const Q_HI = 0.95;

interface Series {
  /** 五條序列，都以頻譜的 fps 取樣。 */
  values: Float32Array[];
  lo: number[];
  hi: number[];
}

const seriesCache = new WeakMap<Spectrum, WeakMap<DrumHit[], Series>>();

/** 整首歌的五條序列（快取於頻譜 × 鼓陣列），各帶 5% / 95% 分位數。 */
export function series(s: Spectrum, drums: DrumHit[], duration: number): Series {
  let inner = seriesCache.get(s);
  if (!inner) {
    inner = new WeakMap();
    seriesCache.set(s, inner);
  }
  const hit = inner.get(drums);
  if (hit) return hit;
  const n = s.frameCount;
  const energy = energySeries(s);
  const env = drumEnvelope(drums, Math.max(duration, n / s.fps));
  const logLo = Math.log(s.minHz);
  const logSpan = Math.max(1e-6, Math.log(s.maxHz) - logLo);
  const logHz = Array.from({ length: s.bins }, (_, b) => (Math.log(binHz(s, b)) - logLo) / logSpan);
  const lowBins = logHz.filter((_, b) => binHz(s, b) < 250).length;
  const bandMedians = BANDS7.map((b) => {
    const series = bandSeries(s, b.lo, b.hi);
    return { series, median: quantile(series, 0.5) };
  });

  const bright = new Float32Array(n);
  const hard = new Float32Array(n);
  const dense = new Float32Array(n);
  const heavy = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    let weighted = 0;
    let low = 0;
    for (let b = 0; b < s.bins; b++) {
      const v = binValue(s, f, b);
      sum += v;
      weighted += v * logHz[b];
      if (b < lowBins) low += v;
    }
    bright[f] = sum > 0 ? weighted / sum : 0.5;
    heavy[f] = sum > 0 ? low / sum : 0;
    const time = f / s.fps;
    // 瞬態：鼓包絡（0.3 s 平均）相對於頻帶能量
    let e = 0;
    const steps = 6;
    for (let k = 0; k < steps; k++) e += envAt(env, time - (0.3 * k) / steps);
    hard[f] = e / steps / (0.1 + energy[f]);
    let count = 0;
    for (const { series, median } of bandMedians) if (series[f] > median) count++;
    dense[f] = count / BANDS7.length;
  }
  const values = [bright, energy, hard, dense, heavy];
  const out: Series = {
    values,
    lo: values.map((v) => quantile(v, Q_LO)),
    hi: values.map((v) => quantile(v, Q_HI)),
  };
  inner.set(drums, out);
  return out;
}

export interface Position {
  now: number;
  before: number;
}

/** 五條量尺在 t 的「現在」與「上一段」，都 0..1。沒有頻譜一律 0.5。 */
export function positions(ctx: LookContext, smooth: number): Position[] {
  const { t, readings: r } = ctx;
  const s = r.spectrum;
  if (!s) return SCALES.map(() => ({ now: 0.5, before: 0.5 }));
  const S = series(s, r.drums, r.duration);
  return S.values.map((v, i) => {
    const now = stretch(smoothAt(v, s.fps, t, smooth), S.lo[i], S.hi[i]);
    const to = t - BEFORE_TO;
    const before =
      to > 0
        ? stretch(meanOver(v, s.fps, Math.max(0, t - BEFORE_FROM), to), S.lo[i], S.hi[i])
        : now;
    return { now, before };
  });
}

/** 現在跟上一段差最多的那條量尺。 */
export function movingIndex(pos: Position[]): number {
  let best = 0;
  for (let i = 1; i < pos.length; i++) {
    if (Math.abs(pos[i].now - pos[i].before) > Math.abs(pos[best].now - pos[best].before)) best = i;
  }
  return best;
}

/** 量尺 i 現在偏向哪個字（小寫）。 */
function sideWord(i: number, v: number): string {
  return SCALES[i][v < 0.5 ? 0 : 1].toLowerCase();
}

/**
 * 段落：最近 2 秒的能量對整首歌的分位數。Oto 的 PART 是真的段落偵測；
 * 這裡只用能量高低近似：Quiet / Build / Drop。
 */
export function partAt(s: Spectrum | undefined, t: number): string {
  if (!s) return '—';
  const energy = energySeries(s);
  const v = stretch(
    meanOver(energy, s.fps, Math.max(0, t - 2), t),
    quantile(energy, Q_LO),
    quantile(energy, Q_HI),
  );
  return v < 0.35 ? 'Quiet' : v < 0.7 ? 'Build' : 'Drop';
}

interface Layout {
  x0: number;
  x1: number;
  unit: number;
  font: number;
}

function layout(ctx: LookContext): Layout {
  return {
    x0: ctx.w * 0.3,
    x1: ctx.w * 0.7,
    unit: Math.min(ctx.w, ctx.h),
    font: labelSize(ctx) * 1.15,
  };
}

function scaleY(ctx: LookContext, i: number): number {
  return ctx.h * (0.14 + (0.72 * i) / (SCALES.length - 1));
}

function draw(p: Painter, ctx: LookContext): void {
  const { theme } = ctx;
  const smooth = paramNum(ctx, params, 'smooth');
  const L = layout(ctx);
  const { unit, font } = L;
  const pos = positions(ctx, smooth);
  const moving = movingIndex(pos);
  const blue = theme.noteColors[9] ?? theme.accent;
  const xOf = (v: number) => L.x0 + v * (L.x1 - L.x0);
  const big: Point[] = pos.map((q, i) => ({ x: xOf(q.now), y: scaleY(ctx, i) }));

  p.background(theme.paper);

  // 量尺
  p.noFill();
  p.stroke(theme.line, Math.max(0.8, unit * 0.0015));
  for (let i = 0; i < SCALES.length; i++) {
    const y = scaleY(ctx, i);
    p.line(L.x0, y, L.x1, y);
  }

  // 串起五個大點的光帶：沿線鋪 haze 當柔光，再一條寬的淡線、一條細的亮線
  p.blend(theme.glow ? 'add' : 'multiply');
  const per = 8;
  for (let i = 0; i + 1 < big.length; i++) {
    const a = big[i];
    const b = big[i + 1];
    for (let k = 0; k < per; k++) {
      const u = k / per;
      p.haze(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, unit * 0.055, blue, 0.09);
    }
  }
  p.noFill();
  p.stroke(blue, unit * 0.02, 0.35);
  p.polyline(big);
  p.stroke(blue, unit * 0.006, 0.7);
  p.polyline(big);
  p.blend('normal');

  // 兩邊的字；正在移動的那條量尺的字加框
  p.noStroke();
  const pad = unit * 0.03;
  for (let i = 0; i < SCALES.length; i++) {
    const y = scaleY(ctx, i);
    const [left, right] = SCALES[i];
    if (i === moving) {
      p.fill(theme.mute, 0.2);
      for (const [word, x, align] of [
        [left, L.x0 - pad, 'right'],
        [right, L.x1 + pad, 'left'],
      ] as const) {
        const tw = word.length * font * 0.7 + font * 1.6;
        p.rect(align === 'right' ? x - tw + font * 0.8 : x - font * 0.8, y - font, tw, font * 2);
      }
    }
    p.fill(theme.ink, 0.8);
    const style = { size: font, font: 'sans' as const, weight: 700 as const, tracking: 0.06 };
    p.text(left, L.x0 - pad, y + font * 0.35, { ...style, align: 'right' });
    p.text(right, L.x1 + pad, y + font * 0.35, { ...style, align: 'left' });
  }

  // 小點：上一段
  p.noStroke();
  for (let i = 0; i < SCALES.length; i++) {
    p.fill(theme.ink, 0.75);
    p.circle(xOf(pos[i].before), scaleY(ctx, i), unit * 0.012);
  }

  // 大點：現在，藍光；移動中的那顆暖色
  if (theme.glow) p.blend('add');
  for (let i = 0; i < SCALES.length; i++) {
    const q = big[i];
    p.haze(q.x, q.y, unit * 0.05, i === moving ? theme.accent : blue, 0.5);
  }
  if (theme.glow) p.blend('normal');
  p.noStroke();
  for (let i = 0; i < SCALES.length; i++) {
    const q = big[i];
    softDot(p, theme, q.x, q.y, unit * 0.03, theme.ink, 1);
  }
}

function readouts(ctx: LookContext): Readout[] {
  const smooth = paramNum(ctx, params, 'smooth');
  const pos = positions(ctx, smooth);
  const extreme = pos
    .map((q, i) => ({ i, d: Math.abs(q.now - 0.5) }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => sideWord(i, pos[i].now));
  const moving = movingIndex(pos);
  return [
    { label: 'NOW', value: extreme.join(' · ') },
    { label: 'MOVING', value: sideWord(moving, pos[moving].now) },
    { label: 'PART', value: partAt(ctx.readings.spectrum, ctx.t) },
  ];
}

/** Character：五條量尺（暗–亮、靜–烈、軟–硬、疏–密、輕–重），現在是大藍光點、上一段是小點，五個現在用發光折線串起來。 */
export const characterLook: Look = {
  id: 'character',
  number: 38,
  name: '聲音性格',
  listens: ['spectrum', 'drums'],
  params,
  draw,
  readouts,
};
