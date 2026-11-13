import type { DrumHit, DrumKind, Spectrum } from '../analysis/types';
import { noteColor } from './music';
import type { Painter } from './painter/painter';
import { BANDS7, bandSeries, paramNum, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Aura：一圈細細的競技場裡，兩團光球在中心點相碰。上面那團跟著高頻、下面跟著低頻呼吸。
 * kick 一來整對往上跳再落回來（落地時稍微壓扁）；snare 一來換一組顏色（五組輪流，0.15 秒交叉淡入）。
 * 沒有狀態：跳躍是最近 1 秒內每個 kick 的衰減函式相加，顏色是 t 之前 snare 的數目 mod 5。
 */

const params: ParamDef[] = [{ key: 'size', label: '大小', min: 0.6, max: 1.6, default: 1 }];

/** 五組顏色（noteColors 索引）：上冷下暖，第一組是 Oto 海報的紫／桃紅。 */
export const PALETTES: [number, number][] = [
  [10, 11],
  [9, 1],
  [8, 2],
  [7, 0],
  [6, 3],
];
/** 上球聽 high-mids、presence、air；下球聽 sub、bass、low-mids。 */
const HIGH_BANDS = [4, 5, 6];
const LOW_BANDS = [0, 1, 2];
const SMOOTH = 0.12;
/** 跳躍：高度（unit 比例）、回落時間常數、起跳時間常數、只看最近幾秒的 kick。 */
const LEAP = 0.12;
const LEAP_DECAY = 0.18;
const LEAP_RISE = 0.03;
const LEAP_WINDOW = 1;
/** snare 換色的交叉淡入秒數。 */
const FADE = 0.15;
/** 競技場直徑（unit 比例）。 */
const ARENA = 0.72;

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

/** 幾個頻帶「比平常響多少」的平均，0..1；沒有頻譜就 0.4。 */
export function levelOf(s: Spectrum | undefined, bands: number[], t: number): number {
  if (!s) return 0.4;
  let sum = 0;
  for (const band of bands) {
    const b = BANDS7[band];
    const series = bandSeries(s, b.lo, b.hi);
    const mean = songMean(series);
    if (mean > 0) sum += Math.min(1, smoothAt(series, s.fps, t, SMOOTH) / (mean * 2.2));
  }
  return sum / bands.length;
}

const prefixCache = new WeakMap<DrumHit[], Record<DrumKind, Uint32Array>>();
/** 每種鼓的前綴計數：prefix[i] = 前 i 個 hit 裡有幾個；以 drums 陣列快取。 */
function prefixes(drums: DrumHit[]): Record<DrumKind, Uint32Array> {
  const hit = prefixCache.get(drums);
  if (hit) return hit;
  const out: Record<DrumKind, Uint32Array> = {
    kick: new Uint32Array(drums.length + 1),
    snare: new Uint32Array(drums.length + 1),
    hat: new Uint32Array(drums.length + 1),
  };
  for (let i = 0; i < drums.length; i++) {
    for (const k of ['kick', 'snare', 'hat'] as const) out[k][i + 1] = out[k][i];
    out[drums[i].kind][i + 1]++;
  }
  prefixCache.set(drums, out);
  return out;
}

/** time ≤ t 的 hit 有幾個（drums 依時間排序，二分搜尋）。 */
function indexAfter(drums: DrumHit[], t: number): number {
  let lo = 0;
  let hi = drums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (drums[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** t 之前（含）某種鼓打了幾下。 */
export function countBefore(drums: DrumHit[], kind: DrumKind, t: number): number {
  return prefixes(drums)[kind][indexAfter(drums, t)];
}

/** 最近一個 time ≤ t 的 snare 的時間；沒有就 -Infinity。 */
function lastSnare(drums: DrumHit[], t: number): number {
  for (let i = indexAfter(drums, t) - 1; i >= 0; i--)
    if (drums[i].kind === 'snare') return drums[i].time;
  return Number.NEGATIVE_INFINITY;
}

/** 跳躍的高度 0..1+：最近 1 秒內每個 kick 的（快起慢落）包絡相加。 */
export function leapAt(drums: DrumHit[], t: number): number {
  let sum = 0;
  for (let i = indexAfter(drums, t) - 1; i >= 0; i--) {
    const d = drums[i];
    const age = t - d.time;
    if (age > LEAP_WINDOW) break;
    if (d.kind !== 'kick') continue;
    sum += d.velocity * Math.exp(-age / LEAP_DECAY) * (1 - Math.exp(-age / LEAP_RISE));
  }
  return sum;
}

interface Orb {
  x: number;
  y: number;
  r: number;
  /** 壓扁 0..1：落地時變寬變扁。 */
  squash: number;
}

/** 一團光球：三層 haze（寬、中、核心）；壓扁時每層拆成左右兩團。 */
function orb(p: Painter, theme: LookContext['theme'], o: Orb, color: string, alpha: number): void {
  const core = theme.glow ? mixHex(color, theme.ink, 0.35) : color;
  const layers: [number, number, string][] = [
    [1.6, 0.25, color],
    [1.05, 0.5, color],
    [0.55, 0.8, core],
  ];
  const gain = theme.glow ? 1 : 0.7;
  for (const [k, a, c] of layers) {
    const r = o.r * k * (1 - 0.08 * o.squash);
    const dx = o.r * k * 0.1 * o.squash;
    p.haze(o.x - dx, o.y, r, c, a * alpha * gain * 0.55);
    p.haze(o.x + dx, o.y, r, c, a * alpha * gain * 0.55);
  }
}

/** 顏色字串 #rrggbb 線性插值。 */
function mixHex(a: string, b: string, k: number): string {
  const pa = Number.parseInt(a.slice(1, 7), 16);
  const pb = Number.parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const drums = ctx.readings.drums;
  const size = paramNum(ctx, params, 'size');
  const unit = Math.min(w, h);
  const dark = theme.glow;
  const highs = levelOf(s, HIGH_BANDS, t);
  const lows = levelOf(s, LOW_BANDS, t);
  const rUp = unit * (0.1 + 0.07 * highs) * size;
  const rLo = unit * (0.12 + 0.08 * lows) * size;

  // 跳躍：往上是負的 y；落地中（高度在減少）就壓扁
  const leap = leapAt(drums, t);
  const before = leapAt(drums, t - 0.02);
  const fall = Math.max(0, (before - leap) / 0.02);
  const squash = Math.min(1, fall / 4);
  const cx = w / 2;
  const cy = h / 2 - unit * LEAP * leap;

  // 顏色：snare 的數目 mod 5；剛換色的 0.15 秒把上一組也畫出來交叉淡入
  const snares = countBefore(drums, 'snare', t);
  const since = t - lastSnare(drums, t);
  const fading = snares > 0 && since < FADE;
  const palettes: [number, number][] = [PALETTES[snares % PALETTES.length]];
  const alphas = [1];
  if (fading) {
    palettes.push(PALETTES[(snares - 1) % PALETTES.length]);
    alphas[0] = since / FADE;
    alphas.push(1 - since / FADE);
  }

  p.background(theme.paper);

  // 競技場：一圈細線，中心固定（球跳、圈不動）
  p.noFill();
  p.stroke(theme.line, Math.max(1, unit * 0.0014));
  p.circle(w / 2, h / 2, unit * ARENA * Math.min(1.3, size));

  p.blend(dark ? 'add' : 'multiply');
  const up: Orb = { x: cx, y: cy - rUp, r: rUp, squash };
  const lo: Orb = { x: cx, y: cy + rLo, r: rLo, squash: squash * 0.6 };
  for (let i = 0; i < palettes.length; i++) {
    const [top, bottom] = palettes[i];
    const warm = noteColor(theme, bottom);
    // 場內淡淡的環境光，讓圈裡比圈外亮一點
    p.haze(w / 2, h / 2 + unit * 0.05, unit * ARENA * 0.55, warm, (dark ? 0.08 : 0.05) * alphas[i]);
    orb(p, theme, up, noteColor(theme, top), alphas[i]);
    orb(p, theme, lo, warm, alphas[i]);
    // 相碰的那一點：一粒亮光
    p.haze(cx, cy, unit * 0.025, dark ? theme.ink : warm, (dark ? 0.5 : 0.35) * alphas[i]);
  }
  p.blend('normal');
}

function readouts(ctx: LookContext): Readout[] {
  const s = ctx.readings.spectrum;
  const drums = ctx.readings.drums;
  const pct = (bands: number[]) => Math.round((s ? levelOf(s, bands, ctx.t) : 0) * 100);
  return [
    { label: 'ABOVE', value: `highs ${pct(HIGH_BANDS)} %` },
    { label: 'BELOW', value: `lows ${pct(LOW_BANDS)} %` },
    { label: 'JUMPS', value: String(countBefore(drums, 'kick', ctx.t)) },
    {
      label: 'COLOUR',
      value: `${(countBefore(drums, 'snare', ctx.t) % PALETTES.length) + 1} / ${PALETTES.length}`,
    },
  ];
}

/** Aura：兩團光球，kick 往上跳、snare 換色。 */
export const auraLook: Look = {
  id: 'aura',
  number: 36,
  name: '光球',
  listens: ['drums', 'spectrum'],
  params,
  draw,
  readouts,
};
