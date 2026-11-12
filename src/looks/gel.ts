import type { Spectrum, TempoMap } from '../analysis/types';
import type { Painter } from './painter/painter';
import { BANDS7, bandSeries, barTimes, drawLabel, paramNum } from './sheet';
import { geometryCache, penCursor, windowMean } from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'perBar', label: '每小節條數', min: 1, max: 4, default: 1 },
  { key: 'threshold', label: '門檻', min: 0, max: 0.9, default: 0.5 },
];

const LANE_GAP = 0.2;

interface Bands {
  times: number[];
  /** [lane][j]：第 j 段在該泳道拉開後的強度 0..1（以該泳道自己的 15%..97% 分位數）。 */
  level: Float32Array[];
}

const bandsCache = geometryCache<Spectrum, Bands>();

function buildBands(s: Spectrum, tempo: TempoMap, total: number, perBar: number): Bands {
  const times = barTimes(tempo, total, perBar);
  const level = BANDS7.map((band) => {
    const series = bandSeries(s, band.lo, band.hi);
    const raw = new Float32Array(times.length);
    for (let j = 0; j < times.length; j++) {
      const to = j + 1 < times.length ? times[j + 1] : total;
      raw[j] = windowMean(s, series, times[j], to);
    }
    const sorted = Float32Array.from(raw).sort();
    const lo = sorted[Math.floor((sorted.length - 1) * 0.15)] ?? 0;
    const hi = sorted[Math.floor((sorted.length - 1) * 0.97)] ?? 1;
    const out = new Float32Array(times.length);
    for (let j = 0; j < times.length; j++)
      out[j] = Math.max(0, Math.min(1, (raw[j] - lo) / Math.max(1e-6, hi - lo)));
    return out;
  });
  return { times, level };
}

/** 確定性的 0..1 雜湊（kick 黑點的左右位置）。 */
function hash01(i: number): number {
  let x = Math.imul(i + 7, 0x9e3779b1) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum, drums, tempo, duration } = ctx.readings;
  const perBar = Math.max(1, Math.round(paramNum(ctx, params, 'perBar')));
  const threshold = paramNum(ctx, params, 'threshold');
  const total = duration > 0 ? duration : 1;
  const unit = Math.min(w, h);
  const lanes = BANDS7.length;
  const pitch = w / (lanes - LANE_GAP);
  const laneW = pitch * (1 - LANE_GAP);
  const laneX = (i: number) => i * pitch;
  const yOf = (time: number) => (time / total) * h;
  const printedTo = Math.min(Math.max(0, t), total);

  p.background(theme.paper);

  // 泳道底：整條灰色凝膠，從上到下
  p.noStroke();
  p.fill(theme.line, theme.glow ? 0.55 : 0.6);
  for (let i = 0; i < lanes; i++) p.rect(laneX(i), 0, laneW, h);

  if (spectrum) {
    const bands = bandsCache(spectrum, `${perBar}:${total}`, () =>
      buildBands(spectrum, tempo, total, perBar),
    );
    const { times, level } = bands;
    for (let i = 0; i < lanes; i++) {
      const color = theme.noteColors[BANDS7[i].color] ?? theme.ink;
      for (let j = 0; j < times.length; j++) {
        const from = times[j];
        if (from >= printedTo) break;
        const to = j + 1 < times.length ? times[j + 1] : total;
        const e = level[i][j];
        if (e < threshold) continue;
        const k = (e - threshold) / Math.max(1e-6, 1 - threshold);
        const slot = yOf(to) - yOf(from);
        const bh = Math.max(1.5, slot * (0.42 + 0.22 * k));
        const bw = laneW * (0.66 + 0.18 * k);
        const x = laneX(i) + (laneW - bw) / 2;
        const y = yOf(from) + (slot - bh) / 2;
        const recent = to > printedTo;
        // 色帶：外面一圈淡的暈開，裡面實的
        p.fill(recent ? theme.accent : color, 0.28 + 0.2 * k);
        p.rect(x - bh * 0.25, y - bh * 0.2, bw + bh * 0.5, bh * 1.4);
        p.fill(recent ? theme.accent : color, 0.6 + 0.4 * k);
        p.rect(x, y, bw, bh);
        // 最濃的帶子中間有一條深色的核
        if (k > 0.6) {
          p.fill(theme.glow ? theme.paper : theme.ink, 0.35 * k);
          p.rect(x + bw * 0.16, y + bh * 0.38, bw * 0.68, Math.max(1, bh * 0.24));
        }
      }
    }
  }

  // 第一條泳道上的黑點：kick，左右位置確定性地散開，大小是力度
  p.fill(theme.glow ? theme.ink : theme.ink, 0.9);
  const dot = Math.max(2, unit * 0.0045);
  let k = 0;
  for (const hit of drums) {
    if (hit.time > printedTo) break;
    if (hit.kind !== 'kick') continue;
    k++;
    const x = laneX(0) + laneW * (0.2 + 0.6 * hash01(k));
    p.circle(x, yOf(hit.time), dot * (0.7 + 0.5 * hit.velocity));
  }

  // 印字頭
  if (t < total) {
    const y = yOf(printedTo);
    p.noFill();
    p.stroke(theme.accent, Math.max(0.8, unit * 0.0012), 0.8);
    p.line(0, y, w, y);
    penCursor(p, ctx, w - laneW * 0.5, y);
  }

  drawLabel(p, ctx);
}

/** 膠體電泳：七條頻帶七條泳道從上印到下，每小節一條色帶（超過門檻才印），深淺是能量；第一道的黑點是 kick。 */
export const gelLook: Look = {
  id: 'gel',
  number: 18,
  name: '膠體電泳',
  listens: ['spectrum', 'drums', 'tempo'],
  params,
  draw,
};
