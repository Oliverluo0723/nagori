import type { DrumHit } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { drawLabel, formatTime, paramNum } from './sheet';
import {
  accentWindow,
  drumEnvelope,
  envAt,
  geometryCache,
  labelSize,
  penCursor,
  wiggle,
} from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'density', label: '列密度', min: 0.5, max: 2, default: 1 },
  { key: 'gain', label: '振幅', min: 0.3, max: 2, default: 1 },
];

/** 列距（短邊倍數）：Oto 方形海報 10 列。 */
const ROW_PITCH = 0.085;
/** 波形取樣間距（短邊倍數）：一上一下兩點是一個週期，密到像真的音訊波形。 */
const STEP = 0.0028;
/** 安靜時的底噪（列高倍數），讓沒鼓的地方是一條細細抖動的線。 */
const FLOOR = 0.012;

interface Layout {
  left: number;
  right: number;
  top: number;
  rows: number;
  rowGap: number;
  font: number;
  step: number;
}

function layout(ctx: LookContext): Layout {
  const unit = Math.min(ctx.w, ctx.h);
  const font = labelSize(ctx);
  const density = paramNum(ctx, params, 'density');
  const rows = Math.max(2, Math.min(60, Math.round((ctx.h / (unit * ROW_PITCH)) * density)));
  return {
    left: font * 3.6,
    right: ctx.w,
    top: 0,
    rows,
    rowGap: ctx.h / rows,
    font,
    step: Math.max(1.5, unit * STEP),
  };
}

/** 一列的波形點：時間 from..to 對應 left..right，振幅是鼓包絡。 */
function rowPoints(
  env: Float32Array,
  L: Layout,
  r: number,
  from: number,
  to: number,
  limit: number,
  gain: number,
): Point[] {
  const span = L.right - L.left;
  const n = Math.max(2, Math.floor(span / L.step));
  const base = L.top + (r + 0.5) * L.rowGap;
  const amp = L.rowGap * 0.48;
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const time = from + ((to - from) * i) / n;
    if (time > limit) break;
    const e = Math.min(1, Math.sqrt(envAt(env, time)) * gain);
    const a = (FLOOR + (1 - FLOOR) * e) * amp;
    pts.push({ x: L.left + (span * i) / n, y: base + wiggle(r * 100003 + i) * a });
  }
  return pts;
}

const rowCache = geometryCache<DrumHit[], Point[][]>();

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, drums, duration } = ctx.readings;
  const total = duration > 0 ? duration : 1;
  const gain = paramNum(ctx, params, 'gain');
  const L = layout(ctx);
  const rowSec = total / L.rows;
  const unit = Math.min(w, h);
  const printedTo = Math.min(Math.max(0, t), total);
  const current = Math.min(L.rows - 1, Math.floor(printedTo / rowSec));
  const rowY = (r: number) => L.top + (r + 0.5) * L.rowGap;
  const weight = Math.max(0.8, unit * 0.0014);
  const env = drumEnvelope(drums, total);

  p.background(theme.paper);

  // 還沒印的列：淡基線
  p.noFill();
  p.stroke(theme.line, Math.max(0.6, unit * 0.0008));
  for (let r = current + 1; r < L.rows; r++) p.line(L.left, rowY(r), L.right, rowY(r));

  // 列的時間標籤
  p.noStroke();
  p.fill(theme.mute);
  for (let r = 0; r < L.rows; r++) {
    p.text(formatTime(r * rowSec), 0, rowY(r) - L.font * 0.6, {
      size: L.font,
      font: 'mono',
      align: 'left',
    });
  }

  // 印完的列：整列快取
  const done = rowCache(drums, `${w}x${h}:${L.rows}:${gain}:${total}`, () => {
    const out: Point[][] = [];
    for (let r = 0; r < L.rows; r++)
      out.push(rowPoints(env, L, r, r * rowSec, (r + 1) * rowSec, Number.POSITIVE_INFINITY, gain));
    return out;
  });
  p.noFill();
  p.stroke(theme.ink, weight);
  for (let r = 0; r < current; r++) p.polyline(done[r]);

  // 正在印的列：最近兩拍用強調色，筆頭在最前端，一條直的寫入線
  const full = done[current];
  const start = current * rowSec;
  const xOf = (time: number) => L.left + ((time - start) / rowSec) * (L.right - L.left);
  const headX = xOf(printedTo);
  const accentX = xOf(Math.max(start, printedTo - accentWindow(tempo, t)));
  const ink: Point[] = [];
  const accent: Point[] = [];
  for (const pt of full) {
    if (pt.x > headX) break;
    if (pt.x < accentX) ink.push(pt);
    else {
      if (accent.length === 0 && ink.length > 0) accent.push(ink[ink.length - 1]);
      accent.push(pt);
    }
  }
  if (ink.length > 1) p.polyline(ink);
  if (accent.length > 1) {
    if (theme.glow) p.glow(theme.accent, unit * 0.005);
    p.stroke(theme.accent, weight * 1.1);
    p.polyline(accent);
    if (theme.glow) p.noGlow();
  }
  if (t < total) {
    p.stroke(theme.mute, Math.max(0.6, unit * 0.0008), 0.6);
    p.line(headX, 0, headX, h);
    penCursor(p, ctx, headX, rowY(current));
  }

  drawLabel(p, ctx);
}

/** 地震鼓紋：整首歌切成十幾列，每列是一段鼓的密集波形（kick 大、snare 中、hat 小），由上往下印。 */
export const drumLook: Look = {
  id: 'drum',
  number: 8,
  name: '地震鼓紋',
  listens: ['drums', 'tempo'],
  params,
  draw,
};
