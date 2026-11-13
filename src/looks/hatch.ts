import type { Spectrum } from '../analysis/types';
import type { Painter } from './painter/painter';
import { BANDS7, bandSeries, energySeries, formatTime, paramNum, rngFor } from './sheet';
import {
  accentWindow,
  geometryCache,
  penCursor,
  quantile,
  stretch,
  windowMean,
} from './sheetPrint';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Sheet·Hatch：整首歌印成一張，時間由上往下。每一列是一小段時間，七個頻帶各畫一條橫向墨線，
 * 從中軸往左右兩邊鏡射出去（像水中倒影），大聲的地方寬、安靜的地方窄；
 * 最響的那些列再多射出一兩條長線或掉在身體外面的短線。已印的列是藍墨，還沒印的列是淡淡的灰。
 */

const params: ParamDef[] = [
  { key: 'rows', label: '列數', min: 120, max: 600, default: 360 },
  { key: 'width', label: '寬度', min: 0.5, max: 1.5, default: 1 },
];

/** 藍墨：theme.noteColors 的 A（跟 Rings 一樣）。 */
const INK_COLOR = 9;
/** 上下留白（高度比例）。 */
const MARGIN = 0.06;
/** 最長半幅（寬度比例）。 */
const MAX_HALF = 0.42;
/** 每個頻帶的幅度比例：低頻最寬、air 最窄。 */
const BAND_SCALE = [1, 0.95, 0.85, 0.75, 0.65, 0.55, 0.45];
/** 最窄的半幅（最長半幅的比例）：安靜時仍是一條細脊，不會斷掉。 */
const FLOOR = 0.03;
/** 能量在整首歌前 15% 的列才有飛出去的線。 */
const STRAY_Q = 0.85;
/** 墨線透明度分三級，同一級的一次 stroke 畫完，省掉每條線一個 stroke 呼叫。 */
const ALPHAS = [0.55, 0.68, 0.8];

/** 一條左側的墨線（右側是 x 對軸鏡射）；row 用來判斷印到哪裡。 */
interface Stroke {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  row: number;
}

interface Geometry {
  /** 依透明度分級的墨線。 */
  levels: Stroke[][];
  rowH: number;
  top: number;
  axis: number;
}

interface Layout {
  rows: number;
  top: number;
  bottom: number;
  rowH: number;
  axis: number;
  maxHalf: number;
}

function layout(ctx: LookContext): Layout {
  const { w, h } = ctx;
  const rows = Math.max(1, Math.round(paramNum(ctx, params, 'rows')));
  const top = h * MARGIN;
  const bottom = h * (1 - MARGIN);
  return {
    rows,
    top,
    bottom,
    rowH: (bottom - top) / rows,
    axis: w / 2,
    maxHalf: w * MAX_HALF * paramNum(ctx, params, 'width'),
  };
}

/** 每列的平均（series 以 fps 取樣，列長 rowSec 秒）。 */
function rowMeans(s: Spectrum, series: Float32Array, rows: number, rowSec: number): Float32Array {
  const out = new Float32Array(rows);
  for (let r = 0; r < rows; r++) out[r] = windowMean(s, series, r * rowSec, (r + 1) * rowSec);
  return out;
}

const geoCache = geometryCache<Spectrum, Geometry>();

/**
 * 整首歌的墨線：每列每個頻帶一條，長度是該頻帶在整首歌 8%..98% 分位數之間拉開的值；
 * 長度、上下位置、離軸的空隙都帶固定種子的抖動。能量最高的列再加 1–2 條飛線。
 */
function buildGeometry(
  s: Spectrum,
  L: Layout,
  w: number,
  duration: number,
  seed: number,
): Geometry {
  const rowSec = duration / L.rows;
  const unit = Math.min(w, L.bottom - L.top);
  const levels: Stroke[][] = ALPHAS.map(() => []);
  const bands = BANDS7.map((b) => {
    const means = rowMeans(s, bandSeries(s, b.lo, b.hi), L.rows, rowSec);
    return { means, lo: quantile(means, 0.08), hi: quantile(means, 0.98) };
  });
  const energy = rowMeans(s, energySeries(s), L.rows, rowSec);
  const strayAt = quantile(energy, STRAY_Q);
  const push = (st: Stroke, level: number) => levels[level].push(st);

  for (let r = 0; r < L.rows; r++) {
    const yc = L.top + (r + 0.5) * L.rowH;
    for (let b = 0; b < bands.length; b++) {
      const rng = rngFor(seed, r * 7 + b);
      const v = stretch(bands[b].means[r], bands[b].lo, bands[b].hi);
      const half = Math.max(FLOOR, v) * L.maxHalf * BAND_SCALE[b] * (1 + (rng() - 0.5) * 0.12);
      const y = yc + (rng() - 0.5) * 0.7 * L.rowH;
      const gap = unit * (0.002 + rng() * 0.006);
      const tilt = (rng() - 0.5) * 0.5 * L.rowH;
      const level = Math.min(ALPHAS.length - 1, Math.floor(rng() * ALPHAS.length));
      push({ x0: L.axis - half, y0: y + tilt, x1: L.axis - gap, y1: y, row: r }, level);
    }
    if (energy[r] > strayAt) {
      const rng = rngFor(seed, r * 7 + 7);
      // 一條射到紙邊的長線
      const y = yc + (rng() - 0.5) * L.rowH;
      const reach = w * 0.49 * (0.8 + 0.2 * rng());
      const gap = unit * (0.002 + rng() * 0.01);
      push(
        { x0: L.axis - reach, y0: y + (rng() - 0.5) * L.rowH, x1: L.axis - gap, y1: y, row: r },
        1,
      );
      // 半數再掉一條身體外面的短線
      if (rng() < 0.5) {
        const far = L.maxHalf * (1.05 + rng() * 0.35);
        const len = w * (0.04 + rng() * 0.1);
        const ys = yc + (rng() - 0.5) * 1.5 * L.rowH;
        push({ x0: L.axis - far - len, y0: ys, x1: L.axis - far, y1: ys, row: r }, 0);
      }
    }
  }
  return { levels, rowH: L.rowH, top: L.top, axis: L.axis };
}

function drawStrokes(p: Painter, strokes: Stroke[], axis: number, from: number, to: number): void {
  for (const s of strokes) {
    if (s.row < from || s.row > to) continue;
    p.line(s.x0, s.y0, s.x1, s.y1);
    p.line(2 * axis - s.x0, s.y0, 2 * axis - s.x1, s.y1);
  }
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum: s, tempo } = ctx.readings;
  const duration = ctx.readings.duration > 0 ? ctx.readings.duration : 1;
  const L = layout(ctx);
  const unit = Math.min(w, h);
  const blue = theme.noteColors[INK_COLOR] ?? theme.ink;
  const weight = Math.max(1, unit * 0.0012);
  const rowSec = duration / L.rows;
  const printedTo = Math.min(Math.max(0, t), duration);
  const current = Math.min(L.rows - 1, Math.floor(printedTo / rowSec));
  const accentRow = Math.max(0, Math.floor((printedTo - accentWindow(tempo, t)) / rowSec));

  p.background(theme.paper);

  // 黑底：身體後面一片淡藍光床
  if (theme.glow) {
    p.blend('add');
    p.haze(L.axis, (L.top + L.bottom) / 2, Math.max(w, h) * 0.5, blue, 0.12);
    p.blend('normal');
  }

  // 中軸：一條細細的淡藍線
  p.noFill();
  p.stroke(blue, Math.max(0.6, unit * 0.0008), 0.35);
  p.line(L.axis, L.top, L.axis, L.bottom);

  if (s) {
    const G = geoCache(s, `${w}x${h}:${L.rows}:${L.maxHalf}:${ctx.seed}:${duration}`, () =>
      buildGeometry(s, L, w, duration, ctx.seed),
    );

    // 還沒印的列：淡灰，整張紙一開始就看得到形狀
    if (current < L.rows - 1) {
      p.stroke(theme.mute, weight, 0.12);
      for (const level of G.levels) drawStrokes(p, level, G.axis, current + 1, L.rows - 1);
    }

    // 已印的列：藍墨，黑底光相加、紙感墨相乘，疊的地方更亮／更深
    p.blend(theme.glow ? 'add' : 'multiply');
    for (let k = 0; k < G.levels.length; k++) {
      p.stroke(blue, weight, ALPHAS[k]);
      drawStrokes(p, G.levels[k], G.axis, 0, accentRow - 1);
    }
    p.blend('normal');

    // 最近兩拍的列：強調色
    p.stroke(theme.accent, weight, 0.9);
    for (const level of G.levels) drawStrokes(p, level, G.axis, accentRow, current);
  }

  if (t < duration) penCursor(p, ctx, L.axis, L.top + (current + 0.5) * L.rowH);
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings: r } = ctx;
  const printed = r.duration > 0 ? Math.min(1, Math.max(0, t / r.duration)) : 0;
  return [
    { label: 'PRINTED', value: `${Math.round(printed * 100)} %` },
    { label: 'PEN', value: 'Hatch' },
    { label: 'TIME', value: formatTime(t) },
  ];
}

/** Sheet·Hatch：整首歌印成一張，橫向墨線左右鏡射成水中倒影般的直立形體。 */
export const hatchLook: Look = {
  id: 'hatch',
  number: 31,
  name: '水影排線',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
  readouts,
};
