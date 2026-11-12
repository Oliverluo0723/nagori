import { binValue, frameAt } from '../analysis/audio/spectrum';
import { positionAt, timeOfBar } from '../analysis/tempo';
import type { Painter } from './painter/painter';
import { drawLabel, paramNum } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'bars', label: '視窗小節數', min: 1, max: 8, default: 2 },
  { key: 'rows', label: '列數', min: 12, max: 48, default: 36 },
  { key: 'gamma', label: '對比', min: 0.6, max: 2.5, default: 1.4 },
];

export const COLS = 72;
/** 由靜到響的字元。 */
export const CHARS = [' ', '·', ':', '-', '=', '+', '*'];
const LEFT = 0.05;
const WIDTH = 0.9;
const TOP = 0.12;
const HEIGHT = 0.76;
/** 等寬字的字寬約是字高的 0.6。 */
const CHAR_ASPECT = 0.6;

function barSeconds(ctx: LookContext): number {
  const { tempo } = ctx.readings;
  const bar = positionAt(tempo, ctx.t).bar;
  const s = timeOfBar(tempo, bar + 1) - timeOfBar(tempo, bar);
  return s > 0 ? s : 2;
}

export function charFor(v: number, gamma: number): string {
  const level = Math.min(CHARS.length - 1, Math.floor(Math.max(0, v) ** gamma * CHARS.length));
  return CHARS[level];
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const rows = Math.max(1, Math.round(paramNum(ctx, params, 'rows')));
  const gamma = paramNum(ctx, params, 'gamma');
  const window = paramNum(ctx, params, 'bars') * barSeconds(ctx);
  const left = w * LEFT;
  const cellW = (w * WIDTH) / COLS;
  const rowH = (h * HEIGHT) / (rows + 1);
  const size = Math.min(rowH, cellW / CHAR_ASPECT);
  const style = { size, font: 'mono' as const, align: 'left' as const };
  const timeOfCol = (c: number) => t - window + ((c + 0.5) / COLS) * window;

  p.background(theme.paper);
  p.noStroke();

  if (s) {
    p.fill(theme.ink);
    for (let r = 0; r < rows; r++) {
      // 上面是高頻
      const bin = Math.round(((rows - 1 - r) / Math.max(1, rows - 1)) * (s.bins - 1));
      let line = '';
      for (let c = 0; c < COLS; c++) {
        const time = timeOfCol(c);
        line += time < 0 ? ' ' : charFor(binValue(s, frameAt(s, time), bin), gamma);
      }
      p.text(line, left, h * TOP + r * rowH, style);
    }
  }

  // 最底一列：這段時間裡的鼓，kick X、snare x、hat ·
  const dt = window / COLS;
  let line = '';
  let k = 0;
  const drums = ctx.readings.drums;
  for (let c = 0; c < COLS; c++) {
    const from = timeOfCol(c) - dt / 2;
    const to = from + dt;
    while (k < drums.length && drums[k].time < from) k++;
    let ch = from < 0 ? ' ' : '0';
    for (let i = k; i < drums.length && drums[i].time < to; i++) {
      const kind = drums[i].kind;
      if (kind === 'kick') {
        ch = 'X';
        break;
      }
      if (kind === 'snare') ch = 'x';
      else if (ch === '0') ch = '·';
    }
    line += ch;
  }
  p.fill(theme.accent);
  p.text(line, left, h * TOP + rows * rowH, style);

  drawLabel(p, ctx);
}

/** 字符譜：72 格寬的文字頻譜圖，時間向左流，一列一個頻率，字元越重越大聲；最底列是鼓。 */
export const glyphLook: Look = {
  id: 'glyph',
  number: 14,
  name: '字符譜',
  listens: ['spectrum', 'drums', 'tempo'],
  params,
  draw,
};
