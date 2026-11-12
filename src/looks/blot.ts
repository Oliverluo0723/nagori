import { positionAt, timeOfBar } from '../analysis/tempo';
import type { Painter } from './painter/painter';
import { drawLabel, paramNum } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'rows', label: '一頁小節數', min: 2, max: 8, default: 6 },
  { key: 'size', label: '墨點大小', min: 0.5, max: 2, default: 1 },
];

const STEPS = 16;
const LEFT = 0.08;
const WIDTH = 0.84;
const TOP = 0.14;
const HEIGHT = 0.72;
const SPREAD_SECONDS = 0.6;

/** hit 落在哪一小節、哪一個 16 分格。 */
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
  return step < 0 ? null : { bar, step };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const rows = Math.max(1, Math.round(paramNum(ctx, params, 'rows')));
  const size = paramNum(ctx, params, 'size');
  const cw = (w * WIDTH) / STEPS;
  const rh = (h * HEIGHT) / rows;
  const colX = (s: number) => w * LEFT + (s + 0.5) * cw;
  const rowY = (r: number) => h * TOP + (r + 0.5) * rh;

  const pos = positionAt(ctx.readings.tempo, t);
  const page = Math.floor((pos.bar - 1) / rows);
  const firstBar = page * rows + 1;
  const lastBar = firstBar + rows - 1;

  p.background(theme.paper);

  // 每格一個小點
  p.noStroke();
  p.fill(theme.accent, 0.45);
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < STEPS; s++) p.circle(colX(s), rowY(r), h * 0.003);
  }

  // 墨點：印到 t 為止，落下後慢慢暈開
  for (const hit of ctx.readings.drums) {
    if (hit.time > t) break;
    const q = quantize(ctx, hit.time);
    if (!q || q.bar < firstBar || q.bar > lastBar) continue;
    const x = colX(q.step);
    const y = rowY(q.bar - firstBar);
    const age = t - hit.time;
    const spread = 1 + 0.35 * (1 - Math.exp(-age / SPREAD_SECONDS));
    if (hit.kind === 'kick') {
      const d = h * (0.012 + 0.018 * hit.velocity) * size * spread;
      p.fill(theme.accent, 0.18);
      p.circle(x, y, d * 2.2);
      if (theme.glow) p.glow(theme.accent, h * 0.012);
      p.fill(theme.accent, 0.9);
      p.circle(x, y, d);
      if (theme.glow) p.noGlow();
    } else if (hit.kind === 'snare') {
      const d = h * (0.008 + 0.01 * hit.velocity) * size * spread;
      p.fill(theme.ink, 0.8);
      p.circle(x, y, d);
    } else {
      p.fill(theme.mute, 0.7);
      p.circle(x, y, h * 0.004 * size);
    }
  }

  // 播放位置：空心圈
  const row = pos.bar - firstBar;
  if (row >= 0 && row < rows) {
    const step = Math.min(STEPS - 1, Math.floor(pos.barPhase * STEPS));
    p.noFill();
    p.stroke(theme.accent, h * 0.001);
    p.circle(colX(step), rowY(row), h * 0.012);
  }

  p.noStroke();
  p.fill(theme.mute);
  p.text(`bars ${firstBar}–${lastBar}`, w * 0.97, h * 0.04, {
    size: h * 0.012,
    font: 'mono',
    align: 'right',
  });
  drawLabel(p, ctx);
}

/** 墨點格：16 步一小節一列，每個 hit 落下一滴墨，kick 發光暈開、snare 墨色、hat 小點。 */
export const blotLook: Look = {
  id: 'blot',
  number: 13,
  name: '墨點格',
  listens: ['drums', 'tempo'],
  params,
  draw,
};
