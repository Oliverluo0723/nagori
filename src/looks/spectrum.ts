import { binHz, binValue, frameAt, peakHold } from '../analysis/audio/spectrum';
import type { Spectrum } from '../analysis/types';
import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'holdSeconds', label: 'peak 保持秒數', min: 0.2, max: 3, default: 1 },
  { key: 'barsShown', label: '柱數', min: 16, max: 64, default: 64 },
];

/** 分析時 0..1 = −90..0 dBFS；圖上顯示 −72..0 dB，跟 Oto 的刻度一樣 */
const DB_FLOOR = -72;
const DB_TICKS = [-18, -36, -54];
const HZ_TICKS: [number, string][] = [
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
];

export function toDb(v: number): number {
  return v * 90 - 90;
}

function num(ctx: LookContext, key: string): number {
  const v = ctx.params[key];
  if (typeof v === 'number') return v;
  return params.find((p) => p.key === key)?.default ?? 0;
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${hz.toFixed(1)} Hz`;
}

/** 這一幀最響的 bin。 */
export function loudestBin(s: Spectrum, frame: number): number {
  let best = 0;
  for (let b = 1; b < s.bins; b++) if (binValue(s, frame, b) > binValue(s, frame, best)) best = b;
  return best;
}

/** dB 對 log2(Hz) 的最小平方斜率 = 每八度幾 dB；只算有聲音（高於底）的 bin。 */
export function slopeDbPerOct(s: Spectrum, frame: number): number | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let b = 0; b < s.bins; b++) {
    const v = binValue(s, frame, b);
    if (v <= 0) continue;
    const x = Math.log2(binHz(s, b));
    const y = toDb(v);
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (n < 3 || den === 0) return null;
  return (n * sxy - sx * sy) / den;
}

/** 圖框：底部留一列給 Hz 刻度、右邊留一欄給 dB 刻度。 */
export function plotFrame(w: number, h: number) {
  const u = Math.min(w, h) / 1000;
  const small = Math.max(18 * u, 14);
  return { u, small, x0: 0, x1: w - small * 3.2, y0: 1, y1: h - small * 2.4 };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const F = plotFrame(w, h);
  const { u, small } = F;
  const hair = Math.max(1, 1.2 * u);
  const yOfDb = (db: number) =>
    F.y1 - Math.max(0, Math.min(1, (db - DB_FLOOR) / -DB_FLOOR)) * (F.y1 - F.y0);
  const minHz = s?.minHz ?? 30;
  const maxHz = s?.maxHz ?? 16000;
  const xOfHz = (hz: number) =>
    F.x0 + (Math.log(hz / minHz) / Math.log(maxHz / minHz)) * (F.x1 - F.x0);

  p.background(theme.paper);

  // 格線：dB 橫線、Hz 直線
  p.noFill();
  for (const db of DB_TICKS) {
    p.stroke(theme.line, hair, 0.9);
    p.line(F.x0, yOfDb(db), F.x1, yOfDb(db));
  }
  for (const [hz] of HZ_TICKS) {
    if (hz < minHz || hz > maxHz) continue;
    p.stroke(theme.line, hair, 0.55);
    p.line(xOfHz(hz), F.y0, xOfHz(hz), F.y1);
  }

  if (s) {
    const n = Math.max(1, Math.min(s.bins, Math.round(num(ctx, 'barsShown'))));
    const frame = frameAt(s, t);
    const holdFrames = Math.round(num(ctx, 'holdSeconds') * s.fps);
    const pitch = (F.x1 - F.x0) / n;
    const bodyW = pitch * 0.66;
    const loud = loudestBin(s, frame);
    let loudX = -1;
    let loudTop = F.y1;

    // 主峰底下一團暖色光
    p.noStroke();
    for (let i = 0; i < n; i++) {
      const bin = Math.floor((i * s.bins) / n);
      if (bin !== loud) continue;
      loudX = F.x0 + (i + 0.5) * pitch;
      loudTop = yOfDb(toDb(binValue(s, frame, bin)));
    }
    if (loudX >= 0 && theme.glow) p.haze(loudX, loudTop, (F.x1 - F.x0) * 0.35, theme.accent, 0.16);

    for (let i = 0; i < n; i++) {
      // 等距抽樣：n < bins 時跳著取
      const bin = Math.floor((i * s.bins) / n);
      const v = binValue(s, frame, bin);
      const x = F.x0 + (i + 0.5) * pitch;
      const top = yOfDb(toDb(v));
      if (top < F.y1) {
        p.fill(bin === loud ? theme.accent : theme.ink, bin === loud ? 1 : 0.92);
        p.rect(x - bodyW / 2, top, bodyW, F.y1 - top);
      }
      const peak = peakHold(s, frame, bin, holdFrames);
      const py = yOfDb(toDb(peak));
      if (py < F.y1) {
        p.fill(theme.accent);
        p.rect(x - bodyW / 2, py - Math.max(2, 4 * u) - hair, bodyW, Math.max(2, 4 * u));
      }
    }
  }

  // 圖框與底線
  p.noFill();
  p.stroke(theme.mute, hair, 0.7);
  p.rect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);

  // 刻度字
  p.noStroke();
  p.fill(theme.mute);
  for (const db of DB_TICKS) {
    p.text(`−${-db}`, w, yOfDb(db) - small * 0.55, { size: small, font: 'mono', align: 'right' });
  }
  for (const [hz, label] of HZ_TICKS) {
    if (hz < minHz || hz > maxHz) continue;
    p.text(label, xOfHz(hz), F.y1 + small * 0.7, { size: small, font: 'mono', align: 'center' });
  }
  p.text('Hz', w, F.y1 + small * 0.7, { size: small, font: 'mono', align: 'right' });
}

function readouts(ctx: LookContext): Readout[] {
  const s = ctx.readings.spectrum;
  if (!s) {
    return [
      { label: 'PEAK BAND', value: '—' },
      { label: 'LEVEL', value: '—' },
    ];
  }
  const frame = frameAt(s, ctx.t);
  const loud = loudestBin(s, frame);
  const slope = slopeDbPerOct(s, frame);
  return [
    { label: 'PEAK BAND', value: formatHz(binHz(s, loud)) },
    { label: 'LEVEL', value: `${toDb(binValue(s, frame, loud)).toFixed(1)} dB` },
    { label: 'SLOPE', value: slope === null ? '—' : `${slope.toFixed(1)} dB/oct` },
    { label: 'BANDS', value: `${s.bins} · log` },
  ];
}

/** 頻譜柱：對數頻率的梳狀柱，加 peak hold。 */
export const spectrumLook: Look = {
  id: 'spectrum',
  number: 4,
  name: '頻譜柱',
  listens: ['spectrum'],
  params,
  draw,
  readouts,
};
