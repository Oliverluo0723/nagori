import { binValue, frameAt, peakHold } from '../analysis/audio/spectrum';
import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'holdSeconds', label: 'peak 保持秒數', min: 0.2, max: 3, default: 1 },
  { key: 'barsShown', label: '柱數', min: 16, max: 64, default: 64 },
];

const LEFT = 0.06;
const RIGHT = 0.94;
const BASE_Y = 0.72;
const HEIGHT = 0.44;
const TICKS: [number, string][] = [
  [50, '50'],
  [100, '100'],
  [500, '500'],
  [1000, '1k'],
  [5000, '5k'],
  [10000, '10k'],
];

function num(ctx: LookContext, key: string): number {
  const v = ctx.params[key];
  if (typeof v === 'number') return v;
  return params.find((p) => p.key === key)?.default ?? 0;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const y0 = h * BASE_Y;
  const span = w * (RIGHT - LEFT);
  const minHz = s?.minHz ?? 30;
  const maxHz = s?.maxHz ?? 16000;
  const xOfHz = (hz: number) => w * LEFT + (Math.log(hz / minHz) / Math.log(maxHz / minHz)) * span;

  p.background(theme.paper);

  if (s) {
    const n = Math.max(1, Math.min(s.bins, Math.round(num(ctx, 'barsShown'))));
    const frame = frameAt(s, t);
    const holdFrames = Math.round(num(ctx, 'holdSeconds') * s.fps);
    const bw = span / n;
    p.noStroke();
    for (let i = 0; i < n; i++) {
      // 等距抽樣：n < bins 時跳著取
      const bin = Math.floor((i * s.bins) / n);
      const v = binValue(s, frame, bin);
      const x = w * LEFT + (i + 0.5) * bw;
      const bodyW = bw * 0.6;
      if (v > 0) {
        p.fill(theme.ink);
        p.rect(x - bodyW / 2, y0 - v * h * HEIGHT, bodyW, v * h * HEIGHT);
      }
      const peak = peakHold(s, frame, bin, holdFrames);
      if (peak > 0) {
        p.fill(theme.accent);
        p.rect(x - bodyW / 2, y0 - peak * h * HEIGHT - h * 0.003, bodyW, h * 0.003);
      }
    }
  }

  // 基線
  p.noFill();
  p.stroke(theme.line, h * 0.0015);
  p.line(w * LEFT, y0, w * RIGHT, y0);

  // 刻度
  p.noStroke();
  p.fill(theme.mute);
  for (const [hz, label] of TICKS) {
    if (hz < minHz || hz > maxHz) continue;
    p.text(label, xOfHz(hz), y0 + h * 0.03, { size: h * 0.011, font: 'mono', align: 'center' });
  }
  p.text('Hz', w * RIGHT, y0 + h * 0.03, { size: h * 0.011, font: 'mono', align: 'right' });

  if (ctx.label) {
    p.text(ctx.label, w * 0.03, h * 0.04, { size: h * 0.012, font: 'mono', align: 'left' });
  }
}

/** 頻譜柱：對數頻率柱狀加 peak hold。 */
export const spectrumLook: Look = {
  id: 'spectrum',
  number: 4,
  name: '頻譜柱',
  listens: ['spectrum'],
  params,
  draw,
};
