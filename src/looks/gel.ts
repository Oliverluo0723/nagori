import type { Painter } from './painter/painter';
import { BANDS7, bandSeries, barTimes, drawLabel, meanOver, paramNum } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'perBar', label: '每小節條數', min: 1, max: 4, default: 2 },
  { key: 'threshold', label: '門檻', min: 0, max: 0.7, default: 0.3 },
];

const LEFT = 0.05;
const RIGHT = 0.95;
const TOP = 0.12;
const BOTTOM = 0.92;
const LANE_GAP = 0.28;

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum, drums, tempo, duration } = ctx.readings;
  const perBar = Math.max(1, Math.round(paramNum(ctx, params, 'perBar')));
  const threshold = paramNum(ctx, params, 'threshold');
  const total = duration > 0 ? duration : 1;
  const lanes = BANDS7.length;
  const pitch = (w * (RIGHT - LEFT)) / lanes;
  const laneW = pitch * (1 - LANE_GAP);
  const laneX = (i: number) => w * LEFT + i * pitch + (pitch - laneW) / 2;
  const plotH = h * (BOTTOM - TOP);
  const yOf = (time: number) => h * TOP + (time / total) * plotH;
  const printedTo = Math.min(t, total);

  p.background(theme.paper);

  // 泳道底
  p.noStroke();
  p.fill(theme.line, 0.5);
  for (let i = 0; i < lanes; i++) p.rect(laneX(i), h * TOP, laneW, plotH);

  if (spectrum) {
    const times = barTimes(tempo, printedTo, perBar);
    for (let i = 0; i < lanes; i++) {
      const band = BANDS7[i];
      const series = bandSeries(spectrum, band.lo, band.hi);
      const color = theme.noteColors[band.color] ?? theme.ink;
      for (let j = 0; j < times.length; j++) {
        const from = times[j];
        const to = j + 1 < times.length ? times[j + 1] : printedTo;
        const raw = Math.min(1, meanOver(series, spectrum.fps, from, Math.max(from, to)));
        if (raw < threshold) continue;
        // 門檻以上的部分才算寬度與深淺
        const e = (raw - threshold) / Math.max(1e-6, 1 - threshold);
        const y0 = yOf(from);
        const y1 = yOf(to);
        const bh = Math.max(1, (y1 - y0) * 0.55);
        const bw = laneW * (0.25 + 0.75 * e);
        p.fill(color, 0.45 + 0.55 * e);
        p.rect(laneX(i) + (laneW - bw) / 2, y0 + (y1 - y0 - bh) / 2, bw, bh);
      }
    }
  }

  // 第一條泳道上的黑點：kick，左右位置是力度
  p.fill(theme.ink, 0.9);
  for (const hit of drums) {
    if (hit.time > t) break;
    if (hit.kind !== 'kick') continue;
    p.circle(laneX(0) + laneW * (0.25 + 0.5 * hit.velocity), yOf(hit.time), h * 0.003);
  }

  // 印字頭
  p.noFill();
  p.stroke(theme.accent, h * 0.0008);
  p.line(w * LEFT, yOf(printedTo), w * RIGHT, yOf(printedTo));

  drawLabel(p, ctx);
}

/** 膠體電泳：七條頻帶七條泳道，時間由上往下，每半小節一條色帶，寬度與深淺是能量；第一道的黑點是 kick。 */
export const gelLook: Look = {
  id: 'gel',
  number: 18,
  name: '膠體電泳',
  listens: ['spectrum', 'drums', 'tempo'],
  params,
  draw,
};
