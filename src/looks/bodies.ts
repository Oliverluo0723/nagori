import type { ChordEvent, DrumHit, Spectrum } from '../analysis/types';
import { noteColor } from './music';
import type { Painter, Point } from './painter/painter';
import { bandSeries, paramNum, rngFor, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Blob：六個頻帶各是一個有機的身體，待在自己的細軌道圈裡。
 * 身體大小跟著頻帶能量，輪廓慢慢蠕動；kick 一來，身體被撕成四塊、往外推，再慢慢合回去。
 * 顏色是上下漸層：上半是頻帶自己的顏色，下半是當下和弦的組成音顏色。
 */

const params: ParamDef[] = [
  { key: 'size', label: '大小', min: 0.5, max: 1.5, default: 1 },
  { key: 'tear', label: '撕裂', min: 0, max: 2, default: 1 },
];

/** 六個頻帶（低到高）；top 是漸層上半的顏色（theme.noteColors 索引），alt 是沒有和弦時下半的顏色。 */
export const BODY_BANDS: { name: string; lo: number; hi: number; top: number; alt: number }[] = [
  { name: 'sub', lo: 30, hi: 90, top: 7, alt: 11 },
  { name: 'bass', lo: 90, hi: 250, top: 2, alt: 0 },
  { name: 'low-mids', lo: 250, hi: 500, top: 11, alt: 9 },
  { name: 'mids', lo: 500, hi: 2000, top: 1, alt: 6 },
  { name: 'high-mids', lo: 2000, hi: 6000, top: 10, alt: 4 },
  { name: 'air', lo: 6000, hi: 16000, top: 8, alt: 11 },
];

/** 撕成幾塊。 */
export const PIECES = 4;
/** kick 撕裂的衰減時間常數（秒）。 */
const TEAR_DECAY = 0.32;
/** 輪廓取樣點數。 */
const OUTLINE = 64;
/** 漸層切成幾條水平帶。 */
const SLABS = 14;
/** 低頻的身體撕得比較兇。 */
const TEAR_GAIN = [1, 0.9, 0.75, 0.6, 0.5, 0.4];

const maxCache = new WeakMap<Float32Array, number>();
function seriesMax(series: Float32Array): number {
  const hit = maxCache.get(series);
  if (hit !== undefined) return hit;
  let m = 0;
  for (let i = 0; i < series.length; i++) if (series[i] > m) m = series[i];
  maxCache.set(series, m);
  return m;
}

/** 頻帶能量，用整首的最大值正規化到 0..1；沒有頻譜就 0.5。 */
function energyOf(s: Spectrum | undefined, i: number, t: number): number {
  if (!s) return 0.5;
  const series = bandSeries(s, BODY_BANDS[i].lo, BODY_BANDS[i].hi);
  const m = seriesMax(series);
  return m > 0 ? Math.min(1, smoothAt(series, s.fps, t, 0.18) / m) : 0;
}

/** t 當下的撕裂量 0..1：最近一個 kick 的力度隨時間指數衰減。也回傳那個 kick 的索引（決定撕的方向）。 */
export function tearAt(drums: DrumHit[], t: number): { amount: number; kick: number } {
  for (let i = drums.length - 1; i >= 0; i--) {
    const d = drums[i];
    if (d.time > t || d.kind !== 'kick') continue;
    const age = t - d.time;
    return { amount: Math.min(1, d.velocity * Math.exp(-age / TEAR_DECAY)), kick: i };
  }
  return { amount: 0, kick: -1 };
}

function currentChord(chords: ChordEvent[] | undefined, t: number): ChordEvent | null {
  for (const c of chords ?? []) if (c.time <= t && t < c.time + c.duration) return c;
  return null;
}

interface Orbit {
  x: number;
  y: number;
  r: number;
}

/** 六條軌道：高的框排 2×3，寬的排 3×2，大小與位置有固定種子的小抖動，鄰居會稍微交疊。 */
export function orbits(seed: number, w: number, h: number): Orbit[] {
  const cols = h > w * 1.25 ? 2 : 3;
  const rows = Math.ceil(BODY_BANDS.length / cols);
  const cw = w / cols;
  const ch = h / rows;
  return BODY_BANDS.map((_, i) => {
    const rnd = rngFor(seed, 100 + i);
    const col = i % cols;
    const row = Math.floor(i / cols);
    // 寬排時下面那行往右錯開一點（像 Oto 的 Blob）
    const shift = cols === 3 && row === 1 ? cw * 0.08 : 0;
    return {
      x: cw * (col + 0.5) + shift + (rnd() - 0.5) * cw * 0.08,
      y: ch * (row + 0.5) + (rnd() - 0.5) * ch * 0.06,
      r: Math.min(cw, ch) * 0.5 * (0.9 + 0.14 * rnd()),
    };
  });
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

/** 多邊形與水平帶 y∈[ya, yb] 的交集（Sutherland–Hodgman，對兩個半平面裁）。 */
function clipSlab(poly: Point[], ya: number, yb: number): Point[] {
  const cut = (pts: Point[], inside: (p: Point) => boolean, edgeY: number): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const k = (edgeY - a.y) / (b.y - a.y);
        out.push({ x: a.x + (b.x - a.x) * k, y: edgeY });
      }
    }
    return out;
  };
  const top = cut(poly, (p) => p.y >= ya, ya);
  return top.length < 3 ? [] : cut(top, (p) => p.y <= yb, yb);
}

/** 上下線性漸層填一個多邊形：切成 SLABS 條水平帶，每條往下多蓋一點避免接縫。 */
function gradientFill(p: Painter, poly: Point[], yTop: number, yBot: number, a: string, b: string) {
  const step = (yBot - yTop) / SLABS;
  for (let s = 0; s < SLABS; s++) {
    const ya = s === 0 ? yTop - step : yTop + s * step;
    const yb = s === SLABS - 1 ? yBot + step : yTop + (s + 1.6) * step;
    const piece = clipSlab(poly, ya, yb);
    if (piece.length < 3) continue;
    p.fill(mix(a, b, s / (SLABS - 1)));
    p.shape(piece);
  }
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const size = paramNum(ctx, params, 'size');
  const tearGain = paramNum(ctx, params, 'tear');
  const unit = Math.min(w, h);
  const s = ctx.readings.spectrum;
  const chord = currentChord(ctx.readings.chords, t);
  const tear = tearAt(ctx.readings.drums, t);
  const places = orbits(ctx.seed, w, h);

  p.background(theme.paper);

  // 軌道圈與十字刻度
  p.noFill();
  for (let i = 0; i < places.length; i++) {
    const o = places[i];
    p.stroke(theme.mute, unit * 0.0011, 0.55);
    p.circle(o.x, o.y, o.r * 2);
    const tick = o.r * 0.045;
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      p.line(
        o.x + c * (o.r - tick),
        o.y + sn * (o.r - tick),
        o.x + c * (o.r + tick),
        o.y + sn * (o.r + tick),
      );
    }
  }
  p.noStroke();
  for (let i = 0; i < places.length; i++) {
    const o = places[i];
    p.fill(theme.mute, 0.8);
    p.text(BODY_BANDS[i].name, o.x + o.r * 0.06, o.y + o.r * 0.97, {
      size: Math.max(8, unit * 0.014),
      font: 'mono',
      align: 'left',
    });
  }

  for (let i = 0; i < BODY_BANDS.length; i++) {
    const o = places[i];
    const rnd = rngFor(ctx.seed, i);
    const band = BODY_BANDS[i];
    const top = noteColor(theme, band.top);
    const bottom = chord
      ? noteColor(theme, chord.notes[i % chord.notes.length] ?? band.alt)
      : noteColor(theme, band.alt);
    const e = energyOf(s, i, t);
    const torn = Math.min(1, tear.amount * TEAR_GAIN[i] * tearGain);

    // 身體中心：在軌道裡慢慢漂，kick 把它往某個方向推
    const drift = rnd() * Math.PI * 2;
    const driftSpeed = 0.15 + 0.2 * rnd();
    let cx = o.x + o.r * 0.06 * Math.cos(drift + t * driftSpeed);
    let cy = o.y + o.r * 0.06 * Math.sin(drift + t * driftSpeed * 1.3);
    if (tear.kick >= 0 && torn > 0) {
      const push = rngFor(ctx.seed, 1000 + tear.kick * 8 + i)() * Math.PI * 2;
      cx += Math.cos(push) * o.r * 0.16 * torn;
      cy += Math.sin(push) * o.r * 0.16 * torn;
    }

    // 身體是 PIECES 塊互相重疊的蠕動團塊（同一個上下漸層，疊起來看不出接縫，像一整塊有凹口的身體）。
    // 每塊輪廓是幾個低頻正弦疊起來的半徑，相位隨時間慢慢轉；能量大時更鼓、更扭。
    // kick 把各塊沿自己的方向往外拉開，撕成四塊，再慢慢合回去。
    const base = o.r * 0.6 * size * (0.68 + 0.4 * e);
    const wobble = 0.8 + 0.6 * e + 0.6 * torn;
    const spin = rnd() * Math.PI * 2 + t * (rnd() - 0.5) * 0.12;
    const lobes: Point[][] = [];
    let yTop = Number.POSITIVE_INFINITY;
    let yBot = Number.NEGATIVE_INFINITY;
    for (let q = 0; q < PIECES; q++) {
      const dir = spin + (q * Math.PI * 2) / PIECES + (rnd() - 0.5) * 0.5;
      const reach =
        base * (0.3 + 0.1 * rnd() + 0.05 * Math.sin(t * (0.4 + rnd()) + q)) + base * 0.6 * torn;
      const lx = cx + Math.cos(dir) * reach;
      const ly = cy + Math.sin(dir) * reach;
      const lr = base * (0.56 + 0.14 * rnd());
      const harmonics = [2, 3, 5].map((k) => ({
        k,
        amp: (k === 3 ? 0.07 : 0.045) * (0.6 + 0.8 * rnd()),
        phase: rnd() * Math.PI * 2,
        speed: (rnd() - 0.5) * 1.4,
      }));
      const lobe: Point[] = [];
      for (let n = 0; n < OUTLINE; n++) {
        const a = (n / OUTLINE) * Math.PI * 2;
        let r = 1;
        for (const hm of harmonics)
          r += hm.amp * wobble * Math.sin(hm.k * a + hm.phase + t * hm.speed);
        const pt = { x: lx + Math.cos(a) * lr * r, y: ly + Math.sin(a) * lr * r };
        lobe.push(pt);
        yTop = Math.min(yTop, pt.y);
        yBot = Math.max(yBot, pt.y);
      }
      lobes.push(lobe);
    }

    // 底下一層淡淡的色暈
    p.blend(theme.glow ? 'add' : 'multiply');
    p.haze(cx, cy, base * 1.9, top, theme.glow ? 0.08 + 0.1 * e : 0.05);
    p.blend('normal');

    p.noStroke();
    for (const lobe of lobes) gradientFill(p, lobe, yTop, yBot, top, bottom);
  }
}

function readouts(ctx: LookContext): Readout[] {
  const tear = tearAt(ctx.readings.drums, ctx.t);
  const chord = currentChord(ctx.readings.chords, ctx.t);
  return [
    { label: 'BODIES', value: `${BODY_BANDS.length} × ${PIECES} pieces` },
    { label: 'TORN', value: `${Math.round(tear.amount * 100)} %` },
    { label: 'CHORD', value: chord?.name ?? '—' },
  ];
}

/** Blob：六個頻帶是六個有機的身體，被 kick 撕開；漸層下半是和弦的顏色。 */
export const bodiesLook: Look = {
  id: 'bodies',
  number: 5,
  name: '頻帶形體',
  listens: ['spectrum', 'drums', 'chords'],
  params,
  draw,
  readouts,
};
