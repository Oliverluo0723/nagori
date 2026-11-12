import { binValue } from '../analysis/audio/spectrum';
import type { Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { drawLabel, formatTime, paramNum } from './sheet';
import { geometryCache, labelSize, penCursor } from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'density', label: '密度', min: 0.5, max: 2, default: 1 },
  { key: 'amplitude', label: '山高', min: 0.5, max: 3, default: 1 },
];

/** 列距（短邊倍數）：Oto 方形海報大約 60 列。 */
const ROW_PITCH = 0.0135;
/** 最高的峰可以疊上去幾列。 */
const PEAK_ROWS = 3.6;
const TICKS: [number, string][] = [
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
];

interface Layout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  rows: number;
  rowGap: number;
  font: number;
}

function layout(ctx: LookContext): Layout {
  const { w, h } = ctx;
  const unit = Math.min(w, h);
  const font = labelSize(ctx);
  const density = paramNum(ctx, params, 'density');
  const left = font * 3.6;
  const right = w;
  const bottom = h - font * 2.6;
  // 第一列的峰會往上疊，頂端留 PEAK_ROWS 列的高度
  const usable = bottom - font * 0.5;
  const rows = Math.max(8, Math.min(220, Math.round((usable / (unit * ROW_PITCH)) * density)));
  const rowGap = usable / (rows + PEAK_ROWS * 0.6);
  const top = bottom - rows * rowGap;
  return { left, right, top, bottom, rows, rowGap, font };
}

/** 一段時間的平均頻譜（bins 個值）。 */
function rowAverage(s: Spectrum, from: number, to: number): Float32Array {
  const out = new Float32Array(s.bins);
  const a = Math.max(0, Math.floor(from * s.fps));
  const b = Math.min(s.frameCount - 1, Math.max(a, Math.ceil(to * s.fps) - 1));
  if (b < a) return out;
  for (let f = a; f <= b; f++) {
    for (let bin = 0; bin < s.bins; bin++) out[bin] += binValue(s, f, bin);
  }
  const n = b - a + 1;
  for (let bin = 0; bin < s.bins; bin++) out[bin] /= n;
  return out;
}

interface Rows {
  values: Float32Array[];
  /** 每個 bin 整首歌的 8% 分位數（山腳）與 99.5% 分位數（山頂）。 */
  lo: Float32Array;
  hi: Float32Array;
}

const rowsCache = geometryCache<Spectrum, Rows>();

/**
 * 整首歌每列的平均頻譜，加上每個 bin 自己的山腳與山頂。
 * 每個 bin 各自拉開：低頻本來就大聲、高頻本來就小聲，只看「比平常多出多少」，起伏才會像 Oto 那樣明顯。
 */
function allRows(s: Spectrum, rows: number, rowSec: number): Rows {
  return rowsCache(s, `${rows}:${rowSec}`, () => {
    const values: Float32Array[] = [];
    for (let r = 0; r < rows; r++) values.push(rowAverage(s, r * rowSec, (r + 1) * rowSec));
    const lo = new Float32Array(s.bins);
    const hi = new Float32Array(s.bins);
    const col = new Float32Array(rows);
    for (let bin = 0; bin < s.bins; bin++) {
      for (let r = 0; r < rows; r++) col[r] = values[r][bin];
      col.sort();
      lo[bin] = col[Math.floor((rows - 1) * 0.08)];
      hi[bin] = col[Math.floor((rows - 1) * 0.995)];
    }
    // 相鄰 bin 的山頂取平滑，避免某個 bin 範圍太窄被放大成雜訊
    const hiSmooth = new Float32Array(s.bins);
    for (let bin = 0; bin < s.bins; bin++) {
      let m = 0;
      for (let k = -2; k <= 2; k++) m = Math.max(m, hi[Math.max(0, Math.min(s.bins - 1, bin + k))]);
      hiSmooth[bin] = Math.max(m, lo[bin] + 0.08);
    }
    return { values, lo, hi: hiSmooth };
  });
}

const lineCache = geometryCache<Rows, Point[][]>();

function ridgePoints(
  values: Float32Array,
  base: number,
  L: Layout,
  rows: Rows,
  amp: number,
): Point[] {
  const span = L.right - L.left;
  const bins = values.length;
  const pts: Point[] = [{ x: L.left, y: base }];
  for (let bin = 0; bin < bins; bin++) {
    const range = rows.hi[bin] - rows.lo[bin];
    const v = Math.max(0, Math.min(1.15, (values[bin] - rows.lo[bin]) / range));
    pts.push({
      x: L.left + ((bin + 0.5) / bins) * span,
      y: base - v ** 1.35 * L.rowGap * PEAK_ROWS * amp,
    });
  }
  pts.push({ x: L.right, y: base });
  return pts;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const L = layout(ctx);
  const amp = paramNum(ctx, params, 'amplitude');
  const duration = ctx.readings.duration > 0 ? ctx.readings.duration : 1;
  const rowSec = duration / L.rows;
  const span = L.right - L.left;
  const baseY = (r: number) => L.top + (r + 1) * L.rowGap;
  const minHz = s?.minHz ?? 30;
  const maxHz = s?.maxHz ?? 16000;
  const xOfHz = (hz: number) => L.left + (Math.log(hz / minHz) / Math.log(maxHz / minHz)) * span;
  const printedTo = Math.min(Math.max(0, t), duration);
  const current = Math.min(L.rows - 1, Math.floor(printedTo / rowSec));
  const unit = Math.min(ctx.w, ctx.h);
  const weight = Math.max(0.8, unit * 0.0016);

  p.background(theme.paper);

  // 還沒印的列：淡淡的基線，整張紙一開始就是滿的
  p.noFill();
  p.stroke(theme.line, Math.max(0.6, unit * 0.0008), 0.9);
  for (let r = current + 1; r < L.rows; r++) p.line(L.left, baseY(r), L.right, baseY(r));

  // 列的時間標籤：每隔幾列一個，標籤之間至少兩個字高
  const every = Math.max(1, Math.ceil((L.font * 2.6) / L.rowGap));
  p.noStroke();
  p.fill(theme.mute);
  for (let r = 0; r < L.rows; r += every) {
    p.text(formatTime(r * rowSec), 0, baseY(r) - L.font * 0.6, {
      size: L.font,
      font: 'mono',
      align: 'left',
    });
  }

  if (s) {
    const rows = allRows(s, L.rows, rowSec);
    const lines = lineCache(rows, `${w}x${ctx.h}:${amp}:${L.rows}`, () =>
      rows.values.map((v, r) => ridgePoints(v, baseY(r), L, rows, amp)),
    );
    p.noFill();
    p.stroke(theme.ink, weight);
    for (let r = 0; r < current; r++) p.polyline(lines[r]);

    // 正在印的那一列：到 t 為止的平均，強調色；筆頭依列內進度左右走
    const live = rowAverage(s, current * rowSec, Math.max(current * rowSec + 1 / s.fps, printedTo));
    const pts = ridgePoints(live, baseY(current), L, rows, amp);
    if (theme.glow) p.glow(theme.accent, unit * 0.006);
    p.stroke(theme.accent, weight * 1.2);
    p.polyline(pts);
    if (theme.glow) p.noGlow();
    const frac = Math.max(0, Math.min(1, (printedTo - current * rowSec) / rowSec));
    const k = Math.min(pts.length - 2, Math.max(1, Math.round(frac * (pts.length - 3)) + 1));
    penCursor(p, ctx, pts[k].x, pts[k].y);
  }

  // Hz 刻度
  const axisY = L.bottom + L.font * 0.6;
  p.noFill();
  p.stroke(theme.line, Math.max(0.6, unit * 0.0008));
  p.line(L.left, axisY, L.right, axisY);
  p.noStroke();
  p.fill(theme.mute);
  for (const [hz, label] of TICKS) {
    if (hz < minHz || hz > maxHz) continue;
    p.text(label, xOfHz(hz), axisY + L.font * 0.6, {
      size: L.font,
      font: 'mono',
      align: 'center',
    });
  }

  drawLabel(p, ctx);
}

/** 頻譜山脊：整首歌切成幾十列，每列一條該段平均頻譜的折線，由上往下印；未印的列是淡基線。 */
export const ridgeLook: Look = {
  id: 'ridge',
  number: 7,
  name: '頻譜山脊',
  listens: ['spectrum'],
  params,
  draw,
};
