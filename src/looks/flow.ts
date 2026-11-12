import type { Painter } from './painter/painter';
import { mulberry32 } from './prng';
import { BANDS7, bandSeries, drawLabel, paramNum, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'lines', label: '流線數', min: 40, max: 240, default: 120 },
  { key: 'steps', label: '流線長度', min: 10, max: 80, default: 40 },
  { key: 'drift', label: '漂移速度', min: 0, max: 1, default: 0.2 },
];

interface Source {
  x: number;
  y: number;
  spin: number;
}

/** 七個漩渦源的位置與方向：固定種子，跟 t 無關。 */
export function sources(seed: number): Source[] {
  const rng = mulberry32(seed);
  return BANDS7.map(() => ({
    x: 0.15 + 0.7 * rng(),
    y: 0.15 + 0.7 * rng(),
    spin: rng() < 0.5 ? -1 : 1,
  }));
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const lines = Math.max(1, Math.round(paramNum(ctx, params, 'lines')));
  const steps = Math.max(2, Math.round(paramNum(ctx, params, 'steps')));
  const drift = paramNum(ctx, params, 'drift');
  const src = sources(ctx.seed);
  const energy = BANDS7.map((b) => (s ? smoothAt(bandSeries(s, b.lo, b.hi), s.fps, t, 0.12) : 0.3));
  const unit = Math.min(w, h);

  // 場：每個源一個漩渦，強度是頻帶能量；加一點整體的漂移
  const field = (x: number, y: number): [number, number] => {
    let vx = 0.15;
    let vy = 0;
    for (let i = 0; i < src.length; i++) {
      const dx = x - src[i].x;
      const dy = y - src[i].y;
      const d2 = dx * dx + dy * dy + 0.01;
      const k = (src[i].spin * (0.02 + 0.08 * energy[i])) / d2;
      vx += -dy * k;
      vy += dx * k;
    }
    const len = Math.hypot(vx, vy) || 1;
    return [vx / len, vy / len];
  };

  p.background(theme.paper);
  p.noFill();

  // 流線：起點固定種子、隨 t 慢慢漂，每條走 steps 步
  const rng = mulberry32(ctx.seed ^ 0x2545f491);
  const stepLen = 0.008;
  for (let i = 0; i < lines; i++) {
    let x = (rng() + t * drift * 0.05) % 1;
    let y = rng();
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k < steps; k++) {
      pts.push({ x: x * w, y: y * h });
      const [vx, vy] = field(x, y);
      x += vx * stepLen;
      y += vy * stepLen * (w / h);
      if (x < 0 || x > 1 || y < 0 || y > 1) break;
    }
    if (pts.length > 1) {
      p.stroke(theme.ink, h * 0.0005, 0.5);
      p.polyline(pts);
    }
  }

  // 源：一圈圈，大小是能量
  for (let i = 0; i < src.length; i++) {
    const r = unit * (0.02 + 0.06 * Math.min(1, energy[i]));
    const color = theme.noteColors[BANDS7[i].color] ?? theme.ink;
    p.stroke(theme.ink, h * 0.0015);
    p.circle(src[i].x * w, src[i].y * h, r * 2);
    p.noStroke();
    if (theme.glow) p.glow(color, r);
    p.fill(color, 0.5);
    p.circle(src[i].x * w, src[i].y * h, r * 1.2);
    if (theme.glow) p.noGlow();
    p.noFill();
  }

  drawLabel(p, ctx);
}

/** 流場：七個頻帶是七個漩渦源，一整面流線被它們攪動，能量越大漩渦越強。 */
export const flowLook: Look = {
  id: 'flow',
  number: 24,
  name: '流場',
  listens: ['spectrum'],
  params,
  draw,
};
