import { binHz, binValue } from '../analysis/audio/spectrum';
import type { Spectrum } from '../analysis/types';
import { FIFTHS } from './music';
import type { Painter } from './painter/painter';
import { paramNum, smoothAt } from './sheet';
import { quantile, stretch } from './sheetPrint';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Chakra：18 個對數頻帶疊成一根直立的光柱——air 在頂、sub 在底，每帶一個小色塊，亮度跟著能量呼吸。
 * 柱子外面是一團柔和的橢圓光：上半偏冷（紫藍，跟高頻走）、下半偏暖（橘黃，跟低頻走），往邊緣淡進黑裡。
 */

const params: ParamDef[] = [
  { key: 'smooth', label: '平滑秒數', min: 0.03, max: 0.6, default: 0.12 },
];

export const CHAKRA_BANDS = 18;
const LO_HZ = 40;
const HI_HZ = 16000;
/** 讀數用：低頻／高頻的分界（Hz）。 */
const LOWS_BELOW = 250;
const HIGHS_ABOVE = 2000;

export function bandEdges(i: number): [number, number] {
  const r = HI_HZ / LO_HZ;
  return [LO_HZ * r ** (i / CHAKRA_BANDS), LO_HZ * r ** ((i + 1) / CHAKRA_BANDS)];
}

/** 第 i 帶的幾何中心頻率。 */
export function bandCentre(i: number): number {
  const [lo, hi] = bandEdges(i);
  return Math.sqrt(lo * hi);
}

export function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
  return `${Math.round(hz)} Hz`;
}

const seriesCache = new WeakMap<Spectrum, Float32Array[]>();

/** 18 帶的逐幀能量；一個 Spectrum 算一次。帶內沒有 bin 就取最近的 bin。 */
export function chakraSeries(s: Spectrum): Float32Array[] {
  const hit = seriesCache.get(s);
  if (hit) return hit;
  const series: Float32Array[] = [];
  for (let i = 0; i < CHAKRA_BANDS; i++) {
    const [lo, hi] = bandEdges(i);
    let bins: number[] = [];
    for (let b = 0; b < s.bins; b++) {
      const hz = binHz(s, b);
      if (hz >= lo && hz < hi) bins.push(b);
    }
    if (bins.length === 0) {
      const mid = Math.sqrt(lo * hi);
      let best = 0;
      for (let b = 1; b < s.bins; b++)
        if (Math.abs(Math.log(binHz(s, b) / mid)) < Math.abs(Math.log(binHz(s, best) / mid)))
          best = b;
      bins = [best];
    }
    const out = new Float32Array(s.frameCount);
    for (let f = 0; f < s.frameCount; f++) {
      let sum = 0;
      for (const b of bins) sum += binValue(s, f, b);
      out[f] = sum / bins.length;
    }
    series.push(out);
  }
  seriesCache.set(s, series);
  return series;
}

interface Bands {
  /** 原始平滑能量 0..1。 */
  raw: number[];
  /** 依整首該帶的 0.1 / 0.98 分位數拉開的亮度 0..1。 */
  level: number[];
}

function bandsAt(s: Spectrum | undefined, t: number, smooth: number): Bands {
  const raw: number[] = [];
  const level: number[] = [];
  if (!s) {
    for (let i = 0; i < CHAKRA_BANDS; i++) {
      raw.push(0);
      level.push(0);
    }
    return { raw, level };
  }
  const series = chakraSeries(s);
  for (let i = 0; i < CHAKRA_BANDS; i++) {
    const v = smoothAt(series[i], s.fps, t, smooth);
    raw.push(v);
    level.push(stretch(v, quantile(series[i], 0.1), quantile(series[i], 0.98)));
  }
  return { raw, level };
}

/** 低於 LOWS_BELOW／高於 HIGHS_ABOVE 的能量佔比（0..1）。 */
function shares(raw: number[]): { lows: number; highs: number } {
  let total = 0;
  let lows = 0;
  let highs = 0;
  for (let i = 0; i < CHAKRA_BANDS; i++) {
    const c = bandCentre(i);
    total += raw[i];
    if (c < LOWS_BELOW) lows += raw[i];
    if (c > HIGHS_ABOVE) highs += raw[i];
  }
  return total > 0 ? { lows: lows / total, highs: highs / total } : { lows: 0, highs: 0 };
}

function brightestOf(raw: number[]): number {
  let best = 0;
  for (let i = 1; i < CHAKRA_BANDS; i++) if (raw[i] > raw[best]) best = i;
  return best;
}

/** 第 i 帶的色塊顏色：五度圈順序輪 12 色，鄰帶色相跳得開。 */
export function swatchColor(theme: LookContext['theme'], i: number): string {
  return theme.noteColors[FIFTHS[i % 12]] ?? theme.ink;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const smooth = paramNum(ctx, params, 'smooth');
  const s = ctx.readings.spectrum;
  const unit = Math.min(w, h);
  const dark = theme.glow;
  const bands = bandsAt(s, t, smooth);
  const { lows, highs } = shares(bands.raw);
  const bright = s ? brightestOf(bands.raw) : -1;
  const cx = w / 2;
  const cy = h / 2;
  const warm = theme.noteColors[2] ?? theme.accent;
  const warmer = theme.noteColors[3] ?? warm;
  const cool = theme.noteColors[10] ?? theme.ink;
  const cooler = theme.noteColors[9] ?? cool;

  p.background(theme.paper);

  // 橢圓光：中性的光疊三團成一個直立的橢圓（黑底加 ink 的光、紙上乘 line 的灰），
  // 上三分之一冷（紫藍，跟高頻走）、下三分之一暖（橘黃，跟低頻走），中心一團白在柱子後面
  const R = unit * 0.7;
  const k = dark ? 1 : 0.6;
  p.blend(dark ? 'add' : 'multiply');
  const neutral = dark ? theme.ink : theme.line;
  p.haze(cx, cy + h * 0.03, R, neutral, 0.4 * k);
  p.haze(cx, cy - h * 0.14, R * 0.8, neutral, 0.28 * k);
  p.haze(cx, cy + h * 0.16, R * 0.8, neutral, 0.22 * k);
  p.haze(cx, cy - h * 0.24, R * 0.85, cool, (0.14 + 0.36 * highs) * k);
  p.haze(cx, cy - h * 0.34, R * 0.5, cooler, (0.06 + 0.24 * highs) * k);
  p.haze(cx, cy + h * 0.24, R * 0.85, warm, (0.18 + 0.4 * lows) * k);
  p.haze(cx, cy + h * 0.36, R * 0.5, warmer, (0.1 + 0.3 * lows) * k);
  p.haze(cx, cy, R * 0.4, neutral, 0.3 * k);
  p.blend('normal');

  // 柱子：18 個色塊，air 在頂、sub 在底
  const size = unit * 0.022;
  const gap = size * 0.35;
  const pitch = size + gap;
  const total = pitch * CHAKRA_BANDS - gap;
  const top = cy - total / 2;
  const thin = Math.max(0.6, unit * 0.0008);
  p.stroke(theme.mute, thin, dark ? 0.35 : 0.3);
  p.line(cx, top - size * 1.5, cx, top + total + size * 1.5);
  p.noStroke();
  const fs = Math.max(7, unit * 0.011);
  // 光暈中央很亮，黑底用 ink 才讀得到
  const labelInk = dark ? theme.ink : theme.mute;
  for (let i = 0; i < CHAKRA_BANDS; i++) {
    const row = CHAKRA_BANDS - 1 - i;
    const y = top + row * pitch + size / 2;
    const lv = bands.level[i];
    const color = swatchColor(theme, i);
    const scale = i === bright ? 1.3 : 1;
    const d = size * scale;
    if (i === bright) {
      p.blend(dark ? 'add' : 'multiply');
      p.haze(cx, y, size * 2.6, color, dark ? 0.35 : 0.25);
      p.blend('normal');
      p.noStroke();
    }
    p.fill(color, 0.35 + 0.65 * lv);
    p.rect(cx - d / 2, y - d / 2, d, d);
    // 每三帶標一次頻率，讀起來像儀表
    if (i % 3 === 0) {
      p.fill(labelInk, 0.7);
      p.text(formatHz(bandCentre(i)), cx - size * 1.4, y + fs * 0.35, {
        size: fs,
        font: 'mono',
        align: 'right',
      });
    }
  }
  p.fill(labelInk, 0.7);
  p.text('air', cx + size * 1.4, top - size * 0.4, { size: fs, font: 'mono', align: 'left' });
  p.text('sub', cx + size * 1.4, top + total + size * 0.9, {
    size: fs,
    font: 'mono',
    align: 'left',
  });
}

function readouts(ctx: LookContext): Readout[] {
  const s = ctx.readings.spectrum;
  const smooth = paramNum(ctx, params, 'smooth');
  const bands = bandsAt(s, ctx.t, smooth);
  const { lows, highs } = shares(bands.raw);
  return [
    { label: 'BRIGHTEST', value: s ? formatHz(bandCentre(brightestOf(bands.raw))) : '—' },
    { label: 'LOWS', value: `${Math.round(lows * 100)} %` },
    { label: 'HIGHS', value: `${Math.round(highs * 100)} %` },
  ];
}

/** Chakra：柔和橢圓光暈裡一排 18 個頻帶色塊，上冷下暖，最亮的那帶放大發光。 */
export const chakraLook: Look = {
  id: 'chakra',
  number: 37,
  name: '脈輪',
  listens: ['spectrum'],
  params,
  draw,
  readouts,
};
