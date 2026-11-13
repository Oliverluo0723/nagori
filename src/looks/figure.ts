import type { Spectrum } from '../analysis/types';
import { noteColor } from './music';
import type { Painter, Point } from './painter/painter';
import {
  BANDS7,
  bandSeries,
  energySeries,
  paramNum,
  rngFor,
  smoothAt,
  softDot,
  ticksAlive,
} from './sheet';
import { quantile, stretch } from './sheetPrint';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Figure：三團光疊成一個人形。高頻是頭（青藍）、中頻是身（紫紅）、bass 是腳下的地（黃綠）。
 * 每團是幾層便宜的 haze 疊起來（黑底 add、紙感 multiply），大小跟著該頻段「比平常響多少」。
 * 身體裡有一群閃爍的小亮點（下半有幾顆粉的）、地裡有幾顆藍點；畫面四周散著細小的刮痕像塵埃。
 * 沒有狀態：亮點是 (tick, 序號) 的函式，刮痕是固定種子加慢慢漂的位置。
 */

const params: ParamDef[] = [
  { key: 'size', label: '大小', min: 0.6, max: 1.6, default: 1 },
  { key: 'smooth', label: '平滑秒數', min: 0.05, max: 0.6, default: 0.15 },
];

/** 三團身體：BANDS7 的哪幾個頻帶、在中心軸的高度、半徑範圍（unit 的比例）、顏色（noteColors 索引）。 */
export const BODIES = [
  { name: 'head', bands: [5, 6], y: 0.28, rMin: 0.09, rMax: 0.15, color: 8, phase: 0 },
  { name: 'body', bands: [2, 3, 4], y: 0.5, rMin: 0.14, rMax: 0.24, color: 10, phase: 2.1 },
  { name: 'ground', bands: [0, 1], y: 0.76, rMin: 0.16, rMax: 0.28, color: 5, phase: 4.2 },
] as const;

/** 身體裡的亮點：每秒幾個 tick、每顆活幾秒。 */
const SPARK_RATE = 4;
const SPARK_LIFE = 1.5;
/** 中頻滿格時一幀大約幾顆亮點。 */
const SPARKS_FULL = 40;
const SPARKS_MIN = 14;
/** 身體下半的粉色點、地裡的藍點、四周的刮痕。 */
const PINK_SPECKS = 6;
const GROUND_SPECKS = 8;
export const SCRATCHES = 40;

const meanCache = new WeakMap<Float32Array, number>();
function songMean(series: Float32Array): number {
  const hit = meanCache.get(series);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (const v of series) sum += v;
  const m = series.length ? sum / series.length : 0;
  meanCache.set(series, m);
  return m;
}

/** 單一頻帶「比平常響多少」，0..1（跟 Strata 一樣拿整首的平均當基準）。 */
function bandLevel(s: Spectrum, band: number, t: number, smooth: number): number {
  const b = BANDS7[band];
  const series = bandSeries(s, b.lo, b.hi);
  const mean = songMean(series);
  if (!(mean > 0)) return 0;
  return Math.min(1, smoothAt(series, s.fps, t, smooth) / (mean * 2.2));
}

/** 一團身體的能量：它幾個頻帶的平均；沒有頻譜就 0.4（還是畫得出人形）。 */
export function levelOf(
  s: Spectrum | undefined,
  bands: readonly number[],
  t: number,
  smooth: number,
): number {
  if (!s) return 0.4;
  let sum = 0;
  for (const b of bands) sum += bandLevel(s, b, t, smooth);
  return sum / bands.length;
}

/** 段落：最近 2 秒的平均能量對整首歌的分位數。Oto 用真正的段落偵測；這裡只看能量。 */
export function partAt(s: Spectrum | undefined, t: number): 'Quiet' | 'Build' | 'Drop' {
  if (!s) return 'Quiet';
  const energy = energySeries(s);
  const now = smoothAt(energy, s.fps, t, 2);
  const v = stretch(now, quantile(energy, 0.1), quantile(energy, 0.98));
  return v < 0.35 ? 'Quiet' : v < 0.7 ? 'Build' : 'Drop';
}

/** 顏色字串 #rrggbb 線性插值。 */
function mix(a: string, b: string, k: number): string {
  const pa = Number.parseInt(a.slice(1, 7), 16);
  const pb = Number.parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** 四周的刮痕：固定種子的位置（外圍 25 %）、角度、長度，加一點隨 t 的漂移。 */
function scratchAt(
  seed: number,
  k: number,
  t: number,
  w: number,
  h: number,
  unit: number,
): Point[] {
  const rng = rngFor(seed, 7000 + k);
  const edge = Math.floor(rng() * 4);
  const depth = rng() * 0.25;
  const along = rng();
  let x: number;
  let y: number;
  if (edge === 0) {
    x = along * w;
    y = depth * h;
  } else if (edge === 1) {
    x = along * w;
    y = (1 - depth) * h;
  } else if (edge === 2) {
    x = depth * w;
    y = along * h;
  } else {
    x = (1 - depth) * w;
    y = along * h;
  }
  const angle = rng() * Math.PI * 2;
  const len = unit * (0.01 + 0.01 * rng());
  const bend = (rng() - 0.5) * 1.6;
  x += Math.sin(t * 0.21 + k * 1.3) * unit * 0.006;
  y += Math.cos(t * 0.17 + k * 0.7) * unit * 0.006;
  // 三點的小鉤：中點往側邊彎一下，像 Oto 那種短短的弧
  const dx = Math.cos(angle) * len;
  const dy = Math.sin(angle) * len;
  return [
    { x: x - dx / 2, y: y - dy / 2 },
    { x: x - dy * bend * 0.3, y: y + dx * bend * 0.3 },
    { x: x + dx / 2, y: y + dy / 2 },
  ];
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const size = paramNum(ctx, params, 'size');
  const smooth = paramNum(ctx, params, 'smooth');
  const unit = Math.min(w, h);
  const dark = theme.glow;
  const hair = Math.max(1, unit * 0.0012);
  const levels = BODIES.map((b) => levelOf(s, b.bands, t, smooth));
  const colors = BODIES.map((b) => noteColor(theme, b.color));
  const centres = BODIES.map((b, i) => ({
    x: w / 2 + Math.sin(t * 0.6 + b.phase) * unit * 0.01,
    y: h * b.y,
    r: unit * (b.rMin + (b.rMax - b.rMin) * levels[i]) * size,
  }));
  const [head, body, ground] = centres;
  // 紙感：淡彩，用 multiply 疊在米色紙上
  const gain = dark ? 1 : 0.6;

  p.background(theme.paper);
  p.blend(dark ? 'add' : 'multiply');

  // 黑底：整格鋪一層很淡的灰霧，讓格子比外框亮一點（Oto 的炭灰底）
  if (dark) p.haze(w / 2, h / 2, unit * 0.8, theme.mute, 0.08);

  // 整個人形後面一大團紫霧，把三團連成一體
  p.haze(body.x, body.y, unit * 0.5 * size, colors[1], 0.1 * gain);
  p.haze((head.x + body.x) / 2, (head.y + body.y) / 2, body.r * 1.1, colors[1], 0.1 * gain);

  // 頭：三層青藍
  p.haze(head.x, head.y, head.r * 2.3, colors[0], 0.22 * gain);
  p.haze(head.x, head.y, head.r * 1.35, colors[0], 0.45 * gain);
  p.haze(
    head.x,
    head.y,
    head.r * 0.75,
    dark ? mix(colors[0], theme.ink, 0.3) : colors[0],
    0.6 * gain,
  );

  // 身：三層紫，下半偏粉
  p.haze(body.x, body.y, body.r * 2.1, colors[1], 0.22 * gain);
  p.haze(body.x, body.y, body.r * 1.3, colors[1], 0.45 * gain);
  p.haze(body.x, body.y + body.r * 0.15, body.r * 0.7, noteColor(theme, 11), 0.5 * gain);
  p.haze(body.x, body.y + body.r * 0.8, body.r * 0.6, noteColor(theme, 1), 0.3 * gain);

  // 地：壓扁的光池。一個寬霧、左右兩團、一個帶透明度的扁橢圓，再加一圈淡環
  p.haze(ground.x, ground.y, ground.r * 1.7, colors[2], 0.2 * gain);
  p.haze(ground.x - ground.r * 0.3, ground.y, ground.r * 1.05, colors[2], 0.3 * gain);
  p.haze(ground.x + ground.r * 0.3, ground.y, ground.r * 1.05, colors[2], 0.3 * gain);
  p.noStroke();
  p.fill(colors[2], 0.25 * gain);
  p.ellipse(ground.x, ground.y, ground.r * 2.2, ground.r * 1.7);
  p.haze(
    ground.x,
    ground.y,
    ground.r * 0.5,
    dark ? mix(colors[2], theme.ink, 0.3) : colors[2],
    0.45 * gain,
  );
  p.noFill();
  p.stroke(colors[2], hair, 0.3 * gain);
  p.ellipse(ground.x, ground.y, ground.r * 1.2, ground.r * 0.9);
  p.blend('normal');

  // 身體裡的亮點：每個 tick 發幾顆，活 SPARK_LIFE 秒，隨年齡淡入淡出，所以會閃爍但沒有狀態
  p.noStroke();
  const sparkColor = dark ? theme.ink : theme.mute;
  const d = unit * 0.005;
  const [first, last] = ticksAlive(t, SPARK_RATE, SPARK_LIFE);
  for (let k = first; k <= last; k++) {
    const tk = k / SPARK_RATE;
    const age = t - tk;
    if (age < 0 || age > SPARK_LIFE) continue;
    const rng = rngFor(ctx.seed, 1000 + k);
    const e = levelOf(s, BODIES[1].bands, tk, smooth);
    const n = Math.round((SPARKS_MIN + (SPARKS_FULL - SPARKS_MIN) * e) / (SPARK_RATE * SPARK_LIFE));
    const fade = Math.sin((Math.PI * age) / SPARK_LIFE);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const rr = body.r * 0.95 * Math.sqrt(rng());
      const bright = 0.5 + 0.5 * rng();
      // 偏下半，像 Oto 的那叢
      const x = body.x + Math.cos(a) * rr;
      const y = body.y + Math.sin(a) * rr * 0.8 + body.r * 0.2;
      softDot(p, theme, x, y, d * (0.8 + 0.5 * bright), sparkColor, fade * bright);
    }
  }

  // 身體下半的粉點、地裡的藍點：固定位置慢慢漂，亮度隨 t 呼吸
  const pink = noteColor(theme, 1);
  const pinkRng = rngFor(ctx.seed, 2000);
  for (let i = 0; i < PINK_SPECKS; i++) {
    const a = pinkRng() * Math.PI * 2;
    const rr = body.r * (0.3 + 0.6 * pinkRng());
    const ph = pinkRng() * Math.PI * 2;
    const x = body.x + Math.cos(a) * rr * 0.9;
    const y =
      body.y + body.r * 0.45 + Math.abs(Math.sin(a)) * rr * 0.5 + Math.sin(t * 0.8 + ph) * d;
    softDot(p, theme, x, y, d * 1.3, pink, 0.55 + 0.35 * Math.sin(t * 1.7 + ph));
  }
  const blue = noteColor(theme, 9);
  const blueRng = rngFor(ctx.seed, 3000);
  for (let i = 0; i < GROUND_SPECKS; i++) {
    const a = blueRng() * Math.PI * 2;
    const rr = ground.r * (0.15 + 0.6 * blueRng());
    const ph = blueRng() * Math.PI * 2;
    const x = ground.x + Math.cos(a) * rr + Math.sin(t * 0.5 + ph) * d;
    const y = ground.y + Math.sin(a) * rr * 0.75;
    softDot(p, theme, x, y, d * 1.2, blue, 0.6 + 0.3 * Math.sin(t * 1.3 + ph));
  }

  // 四周的塵埃：短短的刮痕
  p.noFill();
  p.stroke(dark ? theme.ink : theme.mute, hair, 0.4);
  for (let k = 0; k < SCRATCHES; k++) p.polyline(scratchAt(ctx.seed, k, t, w, h, unit));
}

function readouts(ctx: LookContext): Readout[] {
  const s = ctx.readings.spectrum;
  const smooth = paramNum(ctx, params, 'smooth');
  const pct = (bands: readonly number[]) =>
    `${Math.round((s ? levelOf(s, bands, ctx.t, smooth) : 0) * 100)} %`;
  return [
    { label: 'PART', value: partAt(s, ctx.t) },
    { label: 'HEAD · HIGHS', value: pct(BODIES[0].bands) },
    { label: 'BODY · MIDS', value: pct(BODIES[1].bands) },
    { label: 'GROUND · BASS', value: pct(BODIES[2].bands) },
  ];
}

/** Figure：高頻是頭、中頻是身、bass 是地，三團光疊成人形。 */
export const figureLook: Look = {
  id: 'figure',
  number: 35,
  name: '發光人形',
  listens: ['spectrum'],
  params,
  draw,
  readouts,
};
