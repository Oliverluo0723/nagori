import { binValue, frameAt } from '../analysis/audio/spectrum';
import type { Painter } from './painter/painter';
import { drawLabel, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'lines', label: '掃描線數', min: 8, max: 40, default: 24 },
  { key: 'dots', label: '每線點數', min: 16, max: 64, default: 48 },
  { key: 'threshold', label: '門檻', min: 0, max: 0.7, default: 0.4 },
];

const BOTTOM = 0.84;
const TOP = 0.2;
const WIDTH = 0.9;
/** 最遠那條線縮到多窄 */
const FAR_SCALE = 0.42;
/** 相鄰兩條掃描線差幾拍 */
const BEATS_PER_LINE = 0.5;

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const lines = Math.max(2, Math.round(paramNum(ctx, params, 'lines')));
  const dots = Math.max(2, Math.round(paramNum(ctx, params, 'dots')));
  const threshold = paramNum(ctx, params, 'threshold');
  const beat = printedBeat(ctx.readings.tempo, t);
  const cx = w / 2;

  p.background(theme.paper);

  if (s) {
    p.noStroke();
    for (let i = 0; i < lines; i++) {
      const time = t - i * BEATS_PER_LINE * beat;
      if (time < 0) break;
      const f = i / (lines - 1); // 0 最近、1 最遠
      const depth = 1 - (1 - f) ** 1.5; // 近的線間距大，遠的擠在一起
      const y = h * BOTTOM - depth * h * (BOTTOM - TOP);
      const scale = 1 - (1 - FAR_SCALE) * f;
      const span = w * WIDTH * scale;
      const frame = frameAt(s, time);
      const dotSize = h * 0.0065 * (1 - 0.55 * f);
      for (let j = 0; j < dots; j++) {
        const bin = Math.floor((j * s.bins) / dots);
        const raw = binValue(s, frame, bin);
        if (raw < threshold) continue;
        // 門檻以上的部分才算，不然母帶很響的歌每個點都一樣大
        const v = (raw - threshold) / Math.max(1e-6, 1 - threshold);
        const u = j / (dots - 1);
        const color = u < 0.33 ? theme.ink : u < 0.66 ? theme.noteColors[6] : theme.noteColors[9];
        p.fill(color, (0.35 + 0.65 * v) * (1 - 0.5 * f));
        p.circle(cx + (u - 0.5) * span, y, dotSize * (0.6 + 0.8 * v));
      }
    }
  }

  drawLabel(p, ctx);
}

/** 雷達掃描：每半拍一條掃描線，近的在下、遠的往上縮小；一條線是一幀頻譜，低頻墨色、中頻綠、高頻藍。 */
export const lidarLook: Look = {
  id: 'lidar',
  number: 15,
  name: '雷達掃描',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};
