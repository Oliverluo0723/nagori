import { binValue } from '../analysis/audio/spectrum';
import type { Spectrum } from '../analysis/types';
import type { Painter } from './painter/painter';
import { drawLabel, formatTime, paramNum } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'rows', label: '列數', min: 6, max: 48, default: 24 },
  { key: 'amplitude', label: '山高', min: 0.5, max: 4, default: 2 },
];

const LEFT = 0.12;
const RIGHT = 0.94;
const TOP = 0.12;
const BOTTOM = 0.86;
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

/** 整列平均頻譜（bins 個值）的快取：同一個 spectrum、同列數、同列索引永遠一樣。 */
const rowCache = new WeakMap<Spectrum, Map<string, Float32Array>>();

function rowAverage(s: Spectrum, from: number, to: number): Float32Array {
  const out = new Float32Array(s.bins);
  const a = Math.max(0, Math.floor(from * s.fps));
  const b = Math.min(s.frameCount - 1, Math.ceil(to * s.fps) - 1);
  if (b < a) return out;
  for (let f = a; f <= b; f++) {
    for (let bin = 0; bin < s.bins; bin++) out[bin] += binValue(s, f, bin);
  }
  const n = b - a + 1;
  for (let bin = 0; bin < s.bins; bin++) out[bin] /= n;
  return out;
}

function finishedRow(s: Spectrum, rows: number, r: number, rowSec: number): Float32Array {
  let perSpectrum = rowCache.get(s);
  if (!perSpectrum) {
    perSpectrum = new Map();
    rowCache.set(s, perSpectrum);
  }
  const key = `${rows}:${r}`;
  const hit = perSpectrum.get(key);
  if (hit) return hit;
  const avg = rowAverage(s, r * rowSec, (r + 1) * rowSec);
  perSpectrum.set(key, avg);
  return avg;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const rows = Math.max(1, Math.round(paramNum(ctx, params, 'rows')));
  const amplitude = paramNum(ctx, params, 'amplitude');
  const duration = ctx.readings.duration > 0 ? ctx.readings.duration : 1;
  const rowSec = duration / rows;
  const left = w * LEFT;
  const span = w * (RIGHT - LEFT);
  const rowGap = (h * (BOTTOM - TOP)) / rows;
  const baseY = (r: number) => h * TOP + (r + 1) * rowGap;
  const minHz = s?.minHz ?? 30;
  const maxHz = s?.maxHz ?? 16000;
  const xOfHz = (hz: number) => left + (Math.log(hz / minHz) / Math.log(maxHz / minHz)) * span;

  p.background(theme.paper);

  if (s) {
    const current = Math.min(rows - 1, Math.floor(t / rowSec));
    p.noFill();
    for (let r = 0; r <= current && r * rowSec <= t; r++) {
      const isCurrent = r === current;
      const values = isCurrent
        ? rowAverage(s, r * rowSec, Math.min(t, (r + 1) * rowSec))
        : finishedRow(s, rows, r, rowSec);
      const pts: { x: number; y: number }[] = [];
      for (let bin = 0; bin < s.bins; bin++) {
        pts.push({
          x: left + ((bin + 0.5) / s.bins) * span,
          y: baseY(r) - values[bin] * rowGap * amplitude,
        });
      }
      if (isCurrent && theme.glow) p.glow(theme.accent, h * 0.006);
      p.stroke(isCurrent ? theme.accent : theme.ink, h * 0.0012);
      p.polyline(pts);
      if (isCurrent && theme.glow) p.noGlow();

      // 列的時間標籤
      p.noStroke();
      p.fill(theme.mute);
      p.text(formatTime(r * rowSec), left - w * 0.02, baseY(r), {
        size: h * 0.01,
        font: 'mono',
        align: 'right',
      });
    }
  }

  // Hz 刻度
  const axisY = h * BOTTOM + h * 0.02;
  p.noFill();
  p.stroke(theme.line, h * 0.001);
  p.line(left, axisY, left + span, axisY);
  p.noStroke();
  p.fill(theme.mute);
  for (const [hz, label] of TICKS) {
    if (hz < minHz || hz > maxHz) continue;
    p.text(label, xOfHz(hz), axisY + h * 0.02, { size: h * 0.01, font: 'mono', align: 'center' });
  }

  drawLabel(p, ctx);
}

/** 頻譜山脊：歌切成 N 列，每列一條該段平均頻譜的折線，播到哪印到哪。 */
export const ridgeLook: Look = {
  id: 'ridge',
  number: 7,
  name: '頻譜山脊',
  listens: ['spectrum'],
  params,
  draw,
};
