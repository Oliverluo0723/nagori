import { binValue } from '../analysis/audio/spectrum';
import type { Readings, Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { mulberry32 } from './prng';
import {
  bandSeries,
  bassAt,
  drawLabel,
  energySeries,
  paramNum,
  pitchRange,
  printedBeat,
} from './sheet';
import {
  accentWindow,
  geometryCache,
  penCursor,
  quantile,
  stretch,
  windowMean,
} from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'spread', label: '散開', min: 0.5, max: 1.5, default: 1 },
  { key: 'jitter', label: '抖動', min: 0, max: 1, default: 0.4 },
];

/** 背景的紙屑點數。 */
const DUST = 110;
/** 段落特徵的視窗：前後各幾小節（4 拍一小節）。 */
const SECTION_BARS = 4;
/** 局部特徵（bass 音高、亮度）沿著 hit 的平滑係數：越小線越順、越少跳。 */
const SMOOTH = 0.12;
/** 拉開時留給極端值的邊（0..1 的比例）。 */
const EDGE = 0.05;
/** 位置 = 段落區域 × REGION + 局部 × LOCAL；段落決定落在紙上哪一區，局部在區裡繞。 */
const REGION = 1;
const LOCAL = 0.3;
/** snare 釘相對 kick 的偏移（正規化後的單位），讓線在兩種鼓之間鋸齒狀來回。 */
const SNARE_STEP = 0.08;
/** 段落區域拉開時，名次（均勻攤開）佔的比例；其餘照原值（保留疏密）。 */
const RANK_MIX = 0.55;
/** 圖形在格子裡留的邊（短邊倍數）。 */
const MARGIN = 0.035;
/** 絲線每幾段切一條 polyline：分開畫透明度才會疊，重複的段落會打成深色的結。 */
const CHUNK = 24;

interface Pin extends Point {
  time: number;
}

/** 0..1 的釘位置（跟格子尺寸無關），畫的時候再撐滿格子。 */
const unitCache = geometryCache<Readings, Pin[]>();
const pinCache = geometryCache<Pin[], Pin[]>();
const centroidCache = new WeakMap<Spectrum, Float32Array>();

/** 每幀的頻譜重心（bin 索引 / bins，0..1）：越高越亮。 */
function centroidSeries(s: Spectrum): Float32Array {
  const hit = centroidCache.get(s);
  if (hit) return hit;
  const out = new Float32Array(s.frameCount);
  for (let f = 0; f < s.frameCount; f++) {
    let sum = 0;
    let wsum = 0;
    for (let b = 0; b < s.bins; b++) {
      const v = binValue(s, f, b);
      sum += v;
      wsum += v * b;
    }
    out[f] = sum > 0 && s.bins > 1 ? wsum / sum / (s.bins - 1) : 0;
  }
  centroidCache.set(s, out);
  return out;
}

/** 依整首歌的 5%..95% 分位數拉到 0..1。 */
function normed(series: Float32Array): (v: number) => number {
  const lo = quantile(series, 0.05);
  const hi = quantile(series, 0.95);
  return (v) => stretch(v, lo, hi);
}

/** 一組數的 lo..hi 分位數（小陣列用，直接排序）。 */
function range(values: number[], lo: number, hi: number): [number, number] {
  if (values.length === 0) return [0, 1];
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
  return [at(lo), at(hi)];
}

/** 把一個軸的值依自身分位數置中、拉到約 -0.5..0.5。 */
function centre(values: number[]): number[] {
  const [lo, hi] = range(values, 0.05, 0.95);
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  const mid = (lo + hi) / 2;
  return values.map((v) => (v - mid) / span);
}

/** 依名次攤平到 -0.5..0.5：同樣的值同樣的名次（重複的段落還是落在同一處），但安靜的前奏不會把主體擠成一團。 */
function ranked(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0);
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) out[order[k][1]] = k / (n - 1) - 0.5;
  return out;
}

/** 名次與線性各半：主體攤開，但常回去的段落還是比較密，打得出結。 */
function spreadOut(values: number[]): number[] {
  const r = ranked(values);
  const l = centre(values);
  return values.map((_, i) => r[i] * RANK_MIX + l[i] * (1 - RANK_MIX));
}

/** 前兩個主成分（共變異矩陣的冪次迭代，固定起點，同輸入同輸出）。 */
function principal(rows: number[][], dims: number): [number[], number[]] {
  const n = rows.length;
  const mean = new Array<number>(dims).fill(0);
  for (const r of rows) for (let k = 0; k < dims; k++) mean[k] += r[k] / n;
  const cov: number[][] = Array.from({ length: dims }, () => new Array<number>(dims).fill(0));
  for (const r of rows)
    for (let i = 0; i < dims; i++)
      for (let j = 0; j < dims; j++) cov[i][j] += ((r[i] - mean[i]) * (r[j] - mean[j])) / n;
  const power = (deflate: number[] | null): number[] => {
    let v = Array.from({ length: dims }, (_, k) => 1 / Math.sqrt(dims) + k * 0.01);
    for (let it = 0; it < 60; it++) {
      const next = cov.map((row) => row.reduce((acc, c, j) => acc + c * v[j], 0));
      if (deflate) {
        const d = next.reduce((acc, x, k) => acc + x * deflate[k], 0);
        for (let k = 0; k < dims; k++) next[k] -= d * deflate[k];
      }
      const len = Math.sqrt(next.reduce((acc, x) => acc + x * x, 0));
      if (!(len > 1e-12)) break;
      v = next.map((x) => x / len);
    }
    return v;
  };
  const a = power(null);
  const b = power(a);
  return [a, b];
}

/**
 * 釘的位置（整首歌，快取，0..1）：每根釘是這首歌在那一下的「長相」。
 * - 段落區域：前後幾小節的音量、低／中／高頻、亮度，投影到前兩個主成分（seed 只決定翻面／對調軸），
 *   同樣的段落（主歌、副歌重複）特徵相近，會回到紙上同一區，越重複結打得越密；換段時一筆長線跨過去。
 * - 局部：bass 音高（橫）與頻譜亮度（縱，亮的在上）。kick 沿著 hit 平滑，線在區裡慢慢繞；
 *   snare 不平滑、再依亮度偏一小步，從 kick 的路徑伸出長短不一的直線。再加一點依 seed 的抖動。
 * 全部只看讀數與 seed，同輸入同輸出；最後每軸依分位數拉開，撐滿格子。
 */
function buildUnitPins(r: Readings, seed: number, jitter: number): Pin[] {
  const hits = r.drums.filter((d) => d.kind !== 'hat');
  if (hits.length === 0) return [];
  const s = r.spectrum;
  const rng = mulberry32((seed ^ 0x27d4eb2f) >>> 0);

  const dims = 5;
  // seed 只翻面／對調兩軸（旋轉會把兩個主成分又混在一起，圖形變成一條斜帶）
  const flipX = rng() < 0.5 ? -1 : 1;
  const flipY = rng() < 0.5 ? -1 : 1;
  const swap = rng() < 0.5;
  const snareAngle = rng() * Math.PI * 2;

  const series = s
    ? [
        energySeries(s),
        bandSeries(s, 30, 150),
        bandSeries(s, 250, 2000),
        bandSeries(s, 4000, 16000),
        centroidSeries(s),
      ]
    : [];
  const norms = series.map(normed);
  const bright = s ? centroidSeries(s) : null;
  const brightN = bright ? norms[4] : null;
  const lowS = s ? series[1] : null;
  const midS = s ? series[2] : null;
  const bass = r.bass ?? [];
  const [pLo, pHi] = pitchRange(bass);

  const feats: number[][] = [];
  const lx: number[] = [];
  const ly: number[] = [];
  const rawB: number[] = [];
  let sx = Number.NaN;
  let sy = Number.NaN;
  for (const hit of hits) {
    const t = hit.time;
    // 段落：前後 SECTION_BARS 小節的平均
    const span = printedBeat(r.tempo, t) * 4 * SECTION_BARS;
    const fv: number[] = [];
    for (let k = 0; k < dims; k++)
      fv.push(s ? norms[k](windowMean(s, series[k], t - span, t + span)) : 0.5);
    feats.push(fv);

    // 局部：bass 音高（沒有 bass 就用低頻／中頻比）與亮度
    let pitch = 0.5;
    const note = bass.length ? bassAt(bass, t, true) : null;
    if (note) pitch = (note.midi - pLo) / Math.max(1, pHi - pLo);
    else if (s && lowS && midS) {
      const lo = windowMean(s, lowS, t - 0.1, t + 0.1);
      const mi = windowMean(s, midS, t - 0.1, t + 0.1);
      pitch = lo + mi > 0 ? lo / (lo + mi) : 0.5;
    }
    const b = s && bright && brightN ? brightN(windowMean(s, bright, t - 0.12, t + 0.12)) : 0.5;
    sx = Number.isNaN(sx) ? pitch : sx + (pitch - sx) * SMOOTH;
    sy = Number.isNaN(sy) ? b : sy + (b - sy) * SMOOTH;
    // snare 不平滑：從 kick 的平滑路徑上直接伸到那一下的音高／亮度，拉出長短不一的直線
    const loose = hit.kind === 'snare';
    lx.push(loose ? pitch : sx);
    ly.push(1 - (loose ? b : sy));
    rawB.push(b);
  }

  // 段落特徵投影到前兩個主成分（彼此不相關，圖形往兩個方向都撐開），再依 seed 轉一個角度
  const [pc1, pc2] = principal(feats, dims);
  const turned = feats.map((fv) => {
    const a = fv.reduce((acc, x, k) => acc + x * pc1[k], 0);
    const b = fv.reduce((acc, x, k) => acc + x * pc2[k], 0);
    return swap ? [b * flipX, a * flipY] : [a * flipX, b * flipY];
  });
  const cx = spreadOut(turned.map((q) => q[0]));
  const cy = spreadOut(turned.map((q) => q[1]));
  const kx = centre(lx);
  const ky = centre(ly);
  const raw: Pin[] = hits.map((hit, i) => {
    let x = cx[i] * REGION + kx[i] * LOCAL;
    let y = cy[i] * REGION + ky[i] * LOCAL;
    if (hit.kind === 'snare') {
      // 再偏一小步，方向與長度跟著那一下的亮度：同樣的聲音伸向同樣的地方
      const step = SNARE_STEP * (0.5 + 0.5 * rawB[i]) * (0.7 + 0.3 * hit.velocity);
      const a = snareAngle + (rawB[i] - 0.5) * Math.PI * 2;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    x += (rng() - 0.5) * 0.05 * jitter;
    y += (rng() - 0.5) * 0.05 * jitter;
    return { x, y, time: hit.time };
  });

  // 每軸拉開：3%..97% 分位數之間線性撐滿（保住圖形的比例感），兩端的少數幾根用 tanh 收進邊緣
  const fitAxis = (values: number[]): number[] => {
    const [lo, hi] = range(values, 0.03, 0.97);
    const span = hi - lo > 1e-9 ? hi - lo : 1;
    return values.map((v) => {
      const z = (v - lo) / span;
      if (z < 0) return EDGE * (1 + Math.tanh(z * 4));
      if (z > 1) return 1 - EDGE * (1 - Math.tanh((z - 1) * 4));
      return EDGE + z * (1 - EDGE * 2);
    });
  };
  const xs = fitAxis(raw.map((p) => p.x));
  const ys = fitAxis(raw.map((p) => p.y));
  return raw.map((p, i) => ({ x: xs[i], y: ys[i], time: p.time }));
}

/** 0..1 的釘撐到格子裡（spread < 1 往中間收）。 */
function layoutPins(unit: Pin[], w: number, h: number, spread: number): Pin[] {
  const m = Math.min(w, h) * MARGIN;
  const k = Math.min(1, spread);
  const bw = (w - m * 2) * k;
  const bh = (h - m * 2) * k;
  const ox = (w - bw) / 2;
  const oy = (h - bh) / 2;
  return unit.map((p) => ({ x: ox + p.x * bw, y: oy + p.y * bh, time: p.time }));
}

const dustCache = new Map<number, Point[]>();

/** 背景紙屑：0..1 的固定散點（依 seed），畫的時候再乘上格子尺寸。 */
function dust(seed: number): Point[] {
  const hit = dustCache.get(seed);
  if (hit) return hit;
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const out: Point[] = [];
  for (let i = 0; i < DUST; i++) out.push({ x: rng(), y: rng() });
  if (dustCache.size > 16) dustCache.clear();
  dustCache.set(seed, out);
  return out;
}

/** 分段畫折線（每段 CHUNK 個線段，段與段共用接點）。 */
function chunked(p: Painter, pts: Point[]): void {
  for (let i = 0; i < pts.length - 1; i += CHUNK) p.polyline(pts.slice(i, i + CHUNK + 1));
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, duration } = ctx.readings;
  const spread = paramNum(ctx, params, 'spread');
  const jitter = paramNum(ctx, params, 'jitter');
  const unit = Math.min(w, h);
  const total = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const printedTo = Math.min(t, total);

  p.background(theme.paper);

  // 紙屑
  p.noStroke();
  p.fill(theme.mute, 0.35);
  const speck = Math.max(1, unit * 0.0018);
  for (const d of dust(ctx.seed)) p.circle(d.x * w, d.y * h, speck);

  const unitPins = unitCache(ctx.readings, `${ctx.seed}:${jitter}`, () =>
    buildUnitPins(ctx.readings, ctx.seed, jitter),
  );
  const all = pinCache(unitPins, `${w}x${h}:${spread}`, () => layoutPins(unitPins, w, h, spread));
  let count = 0;
  while (count < all.length && all[count].time <= printedTo) count++;
  const thread = Math.max(0.6, unit * 0.0009);
  const pin = Math.max(1.5, unit * 0.0036);

  // 整張圖先淡淡地在紙上：還沒織到的線與釘
  p.noFill();
  if (count < all.length) {
    p.stroke(theme.accent, thread, theme.glow ? 0.13 : 0.11);
    chunked(p, all.slice(Math.max(0, count - 1)));
  }

  // 筆頭：從最後一根釘往下一根釘走（依兩下之間的時間比例）
  const pins = all.slice(0, count);
  const next = all[count];
  let pen: Point | null = null;
  if (pins.length > 0 && t < total) {
    const last = pins[pins.length - 1];
    if (next && next.time > last.time) {
      const f = Math.max(0, Math.min(1, (printedTo - last.time) / (next.time - last.time)));
      pen = { x: last.x + (next.x - last.x) * f, y: last.y + (next.y - last.y) * f };
    } else pen = { x: last.x, y: last.y };
  }

  // 已織的絲線：細的暖色；最近兩拍是實的強調色
  const window = accentWindow(tempo, t);
  let splitAt = pins.length;
  while (splitAt > 0 && pins[splitAt - 1].time >= printedTo - window) splitAt--;
  if (splitAt > 1) {
    p.stroke(theme.accent, thread, theme.glow ? 0.5 : 0.42);
    chunked(p, pins.slice(0, splitAt));
  }
  const recent: Point[] = pins.slice(Math.max(0, splitAt - 1));
  if (pen && recent.length > 0) recent.push(pen);
  if (recent.length > 1) {
    if (theme.glow) p.glow(theme.accent, unit * 0.005);
    p.stroke(theme.accent, thread * 2);
    p.polyline(recent);
    if (theme.glow) p.noGlow();
  }

  // 釘：小小的深色圖釘；還沒織到的更淡
  p.noStroke();
  if (count < all.length) {
    p.fill(theme.mute, 0.22);
    for (let i = count; i < all.length; i++) p.circle(all[i].x, all[i].y, pin * 0.8);
  }
  p.fill(theme.glow ? theme.mute : theme.ink, theme.glow ? 0.9 : 0.55);
  for (const pt of pins) p.circle(pt.x, pt.y, pin);

  if (pen) penCursor(p, ctx, pen.x, pen.y);

  drawLabel(p, ctx);
}

/**
 * 鼓釘絲線：kick / snare 是釘，一條線依時間順序把釘串起來。
 * 釘的位置是這首歌在那一下的長相（段落特徵決定區域、bass 音高與亮度在區裡繞），
 * 重複的段落回到同一區打結，換段時長線跨過紙面，織出這首歌自己的圖形。
 */
export const stringLook: Look = {
  id: 'string',
  number: 9,
  name: '鼓釘絲線',
  listens: ['drums', 'tempo', 'spectrum', 'bass'],
  params,
  draw,
};
