import { positionAt, timeOfBar } from '../analysis/tempo';
import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [{ key: 'rows', label: '一頁小節數', min: 1, max: 8, default: 4 }];

const STEPS = 16;
const LEFT = 0.08;
const WIDTH = 0.84;
const TOP = 0.14;
const HEIGHT = 0.72;
const ACTIVE_SECONDS = 0.15;

function rowsParam(ctx: LookContext): number {
  const v = ctx.params.rows;
  return typeof v === 'number' ? Math.max(1, Math.round(v)) : 4;
}

/** hit 落在哪一小節、哪一個 16 分格。step 16 進位到下一小節 step 0。 */
function quantize(ctx: LookContext, time: number): { bar: number; step: number } | null {
  const { tempo } = ctx.readings;
  let bar = positionAt(tempo, time).bar;
  const start = timeOfBar(tempo, bar);
  const barSec = timeOfBar(tempo, bar + 1) - start;
  if (!(barSec > 0)) return null;
  let step = Math.round(((time - start) / barSec) * STEPS);
  if (step >= STEPS) {
    step = 0;
    bar += 1;
  }
  if (step < 0) return null;
  return { bar, step };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const rows = rowsParam(ctx);
  const cw = (w * WIDTH) / STEPS;
  const rh = (h * HEIGHT) / rows;
  const colX = (s: number) => w * LEFT + (s + 0.5) * cw;
  const rowY = (r: number) => h * TOP + (r + 0.5) * rh;

  const pos = positionAt(ctx.readings.tempo, t);
  const page = Math.floor((pos.bar - 1) / rows);
  const firstBar = page * rows + 1;
  const lastBar = firstBar + rows - 1;

  p.background(theme.paper);

  // 格線：每列一條細線加每格一個小點
  p.noFill();
  p.stroke(theme.line, h * 0.001);
  for (let r = 0; r < rows; r++) p.line(w * LEFT, rowY(r), w * (LEFT + WIDTH), rowY(r));
  p.noStroke();
  p.fill(theme.line);
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < STEPS; s++) p.circle(colX(s), rowY(r), h * 0.004);
  }

  // hits
  for (const hit of ctx.readings.drums) {
    const q = quantize(ctx, hit.time);
    if (!q || q.bar < firstBar || q.bar > lastBar) continue;
    const x = colX(q.step);
    const y = rowY(q.bar - firstBar);
    const age = t - hit.time;
    const active = age >= 0 && age < ACTIVE_SECONDS;
    const scale = active ? 1.6 : 1;

    if (hit.kind === 'kick') {
      p.noStroke();
      if (active && theme.glow) p.glow(theme.accent, h * 0.015);
      p.fill(theme.accent);
      p.circle(x, y, h * 0.016 * (0.6 + 0.4 * hit.velocity) * scale);
      if (active && theme.glow) p.noGlow();
    } else if (hit.kind === 'snare') {
      const r = h * 0.008 * scale;
      p.noFill();
      p.stroke(theme.ink, h * 0.0015);
      p.line(x - r, y - r, x + r, y + r);
      p.line(x - r, y + r, x + r, y - r);
    } else {
      const len = h * 0.012 * scale;
      const cy = y - h * 0.012;
      p.noFill();
      p.stroke(theme.mute, h * 0.001);
      p.line(x, cy - len / 2, x, cy + len / 2);
    }
  }

  // 播放線
  const row = pos.bar - firstBar;
  if (row >= 0 && row < rows) {
    const x = w * LEFT + pos.barPhase * w * WIDTH;
    p.noFill();
    p.stroke(theme.accent, h * 0.0015);
    p.line(x, rowY(row) - rh / 2, x, rowY(row) + rh / 2);
  }

  // 小標與頁碼
  p.noStroke();
  p.fill(theme.mute);
  if (ctx.label) {
    p.text(ctx.label, w * 0.03, h * 0.04, { size: h * 0.012, font: 'mono', align: 'left' });
  }
  p.text(`bars ${firstBar}–${lastBar}`, w * 0.97, h * 0.04, {
    size: h * 0.012,
    font: 'mono',
    align: 'right',
  });
}

/** 鼓格：16 步一小節一列，kick 圓、snare 叉、hat 短線。 */
export const gridLook: Look = {
  id: 'grid',
  number: 2,
  name: '鼓格',
  listens: ['drums', 'tempo'],
  params,
  draw,
};
