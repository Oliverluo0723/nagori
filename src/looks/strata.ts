import type { Painter } from './painter/painter';
import { mulberry32 } from './prng';
import { BANDS7, bandSeries, drawLabel, paramNum, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'size', label: '大小', min: 0.5, max: 2, default: 1 },
  { key: 'smooth', label: '平滑秒數', min: 0.03, max: 0.6, default: 0.15 },
];

const BURST_SECONDS = 0.4;
const BURST_RAYS = 24;

interface Spot {
  x: number;
  y: number;
}

/** 七個地層的位置：由左到右排，固定種子的小抖動，跟 t 無關。 */
export function spots(seed: number, w: number, h: number): Spot[] {
  const rng = mulberry32(seed);
  return BANDS7.map((_, i) => ({
    x: w * (0.12 + (0.76 * (i + 0.5)) / BANDS7.length + (rng() - 0.5) * 0.06),
    y: h * (0.34 + 0.3 * rng()),
  }));
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const size = paramNum(ctx, params, 'size');
  const smooth = paramNum(ctx, params, 'smooth');
  const unit = Math.min(w, h);
  const base = unit * 0.11 * size;
  const places = spots(ctx.seed, w, h);
  const energy = BANDS7.map((b) => (s ? smoothAt(bandSeries(s, b.lo, b.hi), s.fps, t, smooth) : 0));

  p.background(theme.paper);

  // 連接各層的路徑
  p.noFill();
  p.stroke(theme.accent, h * 0.0008, 0.8);
  p.polyline(places);

  for (let i = 0; i < BANDS7.length; i++) {
    const { x, y } = places[i];
    const color = theme.noteColors[BANDS7[i].color] ?? theme.ink;
    const e = Math.min(1, energy[i]);
    const bw = base * (0.5 + e);
    const bh = bw * 0.62;
    // 外圈
    p.noFill();
    p.stroke(theme.line, h * 0.0006);
    p.ellipse(x, y, bw * 1.6, bh * 1.6);
    // 本體
    p.noStroke();
    if (theme.glow) p.glow(color, bw * 0.5);
    p.fill(color, 0.85);
    p.ellipse(x, y, bw, bh);
    if (theme.glow) p.noGlow();
    p.fill(theme.mute);
    p.text(BANDS7[i].name, x, y + bh * 0.9, { size: h * 0.0085, font: 'mono', align: 'center' });
  }

  // hits·sub：最近一個 kick 在 sub 那層炸開
  let last: number | null = null;
  for (const hit of ctx.readings.drums) {
    if (hit.time > t) break;
    if (hit.kind === 'kick') last = hit.time;
  }
  if (last !== null && t - last < BURST_SECONDS) {
    const age = (t - last) / BURST_SECONDS;
    const { x, y } = places[0];
    const rng = mulberry32(ctx.seed ^ Math.floor(last * 1000));
    p.noFill();
    p.stroke(theme.ink, h * 0.0006, 1 - age);
    for (let k = 0; k < BURST_RAYS; k++) {
      const a = (k / BURST_RAYS) * Math.PI * 2 + rng() * 0.2;
      const r0 = base * 0.3;
      const r1 = r0 + base * (0.5 + 0.8 * rng()) * (0.3 + 0.7 * age);
      p.line(
        x + Math.cos(a) * r0,
        y + Math.sin(a) * r0,
        x + Math.cos(a) * r1,
        y + Math.sin(a) * r1,
      );
    }
  }

  drawLabel(p, ctx);
}

/** 地層：七個頻帶各一團發光體，大小隨能量呼吸，一條路徑把它們串起來；kick 在 sub 那層炸開。 */
export const strataLook: Look = {
  id: 'strata',
  number: 16,
  name: '地層',
  listens: ['spectrum', 'drums'],
  params,
  draw,
};
