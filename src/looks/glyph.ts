import { binValue, frameAt } from '../analysis/audio/spectrum';
import { positionAt, timeOfBar } from '../analysis/tempo';
import { midiName } from './glide';
import type { Painter } from './painter/painter';
import { bandSeries, bassAt, paramNum, rngFor, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'bars', label: '視窗小節數', min: 1, max: 8, default: 2 },
  { key: 'leading', label: '行距', min: 1.2, max: 2.4, default: 1.55 },
  { key: 'gamma', label: '對比', min: 0.6, max: 2.5, default: 1.4 },
];

export const COLS = 72;
/** 由靜到響的字元。 */
export const CHARS = [' ', '·', ':', '-', '=', '+', '*'];
/** 等寬字的字寬約是字高的 0.6。 */
const CHAR_ASPECT = 0.6;
const STEPS = 16;

/** 背後的三團色光：低頻紅、中頻綠、高頻藍（noteColors 的索引）。 */
const LIGHTS = [
  { lo: 30, hi: 250, color: 0, x: 0.28, y: 0.3, phase: 0 },
  { lo: 500, hi: 4000, color: 6, x: 0.72, y: 0.55, phase: 2.1 },
  { lo: 4000, hi: 16000, color: 9, x: 0.45, y: 0.82, phase: 4.2 },
];

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

/** 字格：72 欄撐滿寬，列數依行距撐滿高（最後一列是鼓）。 */
export function gridFor(ctx: LookContext): { cellW: number; rowH: number; rows: number } {
  const cellW = ctx.w / COLS;
  const rowH = cellW * paramNum(ctx, params, 'leading');
  const rows = Math.max(2, Math.floor(ctx.h / rowH) - 1);
  return { cellW, rowH, rows };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const { cellW, rowH, rows } = gridFor(ctx);
  const gamma = paramNum(ctx, params, 'gamma');
  const window = paramNum(ctx, params, 'bars') * barSeconds(ctx);
  const size = Math.min(rowH, cellW / CHAR_ASPECT);
  // 字距撐到格寬，72 個字剛好鋪滿一行
  const style = {
    size,
    font: 'mono' as const,
    align: 'left' as const,
    tracking: cellW / size - CHAR_ASPECT,
  };
  const top = (h - (rows + 1) * rowH) / 2;
  const timeOfCol = (c: number) => t - window + ((c + 0.5) / COLS) * window;
  const unit = Math.min(w, h);

  p.background(theme.paper);

  // 色光：每團跟著自己的頻帶亮暗，位置慢慢漂
  p.blend(theme.glow ? 'add' : 'multiply');
  for (const L of LIGHTS) {
    const e = s ? Math.min(1, smoothAt(bandSeries(s, L.lo, L.hi), s.fps, t, 0.4) * 1.6) : 0.3;
    const x = w * (L.x + 0.08 * Math.sin(t * 0.13 + L.phase));
    const y = h * (L.y + 0.05 * Math.cos(t * 0.11 + L.phase * 1.3));
    const color = theme.noteColors[L.color] ?? theme.accent;
    const r = unit * (0.42 + 0.22 * e) + Math.max(w, h) * 0.08;
    const a = (theme.glow ? 0.26 : 0.2) * (0.45 + 0.55 * e);
    p.haze(x, y, r, color, a);
    p.haze(x, y, r * 0.45, color, a * 0.8);
  }
  p.blend('normal');

  // snare 拉出的半透明直條，像打字機卡紙留下的光
  const drums = ctx.readings.drums;
  p.noStroke();
  for (let i = 0; i < drums.length; i++) {
    const d = drums[i];
    if (d.time > t) break;
    if (d.kind !== 'snare' || d.time < t - window) continue;
    const c = Math.floor(((d.time - (t - window)) / window) * COLS);
    const rng = rngFor(ctx.seed, i);
    const len = rows * (0.12 + 0.3 * rng());
    const r0 = Math.floor(rng() * (rows - len));
    p.fill(theme.ink, 0.07 + 0.05 * d.velocity);
    p.rect(c * cellW, top + r0 * rowH, cellW * 0.9, len * rowH);
  }

  if (s) {
    p.fill(theme.ink, 0.88);
    for (let r = 0; r < rows; r++) {
      // 上面是高頻
      const bin = Math.round(((rows - 1 - r) / Math.max(1, rows - 1)) * (s.bins - 1));
      let line = '';
      for (let c = 0; c < COLS; c++) {
        const time = timeOfCol(c);
        line += time < 0 ? ' ' : charFor(binValue(s, frameAt(s, time), bin), gamma);
      }
      p.text(line, 0, top + r * rowH, style);
    }
  }

  // 最底一列：這段時間裡的鼓，kick X、snare x、hat ·
  const dt = window / COLS;
  let line = '';
  let k = 0;
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
  if (theme.glow) p.haze(w * 0.5, top + rows * rowH, w * 0.5, theme.accent, 0.08);
  p.fill(theme.accent);
  p.text(line, 0, top + rows * rowH, style);
}

function readouts(ctx: LookContext): Readout[] {
  const { rows } = gridFor(ctx);
  const pos = positionAt(ctx.readings.tempo, ctx.t);
  const step = Math.min(STEPS - 1, Math.floor(pos.barPhase * STEPS)) + 1;
  const b = bassAt(ctx.readings.bass ?? [], ctx.t, true);
  return [
    { label: 'GRID', value: `${COLS} × ${rows + 1}` },
    { label: 'STEP', value: `${String(step).padStart(2, '0')} / ${STEPS}` },
    { label: 'BASS', value: b ? midiName(b.midi) : '—' },
  ];
}

/** 字符譜：72 欄的文字頻譜圖，時間向左流，一列一個頻率，字元越重越大聲；背後三團色光跟著低中高頻亮，最底列是鼓。 */
export const glyphLook: Look = {
  id: 'glyph',
  number: 14,
  name: '字符譜',
  listens: ['spectrum', 'drums', 'tempo', 'bass'],
  params,
  draw,
  readouts,
};
