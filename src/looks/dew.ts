import type { Painter } from './painter/painter';
import { BANDS7, bandSeries, barTimes, drawLabel, meanOver, paramNum, rngFor } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'threads', label: '每頻帶絲線數', min: 1, max: 4, default: 2 },
  { key: 'threshold', label: '門檻', min: 0, max: 0.7, default: 0.3 },
  { key: 'fall', label: '下滑秒數', min: 1, max: 6, default: 3 },
];

const TOP = 0.1;
const BOTTOM = 0.92;
const LEFT = 0.08;
const RIGHT = 0.92;

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum, tempo } = ctx.readings;
  const perBand = Math.max(1, Math.round(paramNum(ctx, params, 'threads')));
  const threshold = paramNum(ctx, params, 'threshold');
  const fall = paramNum(ctx, params, 'fall');
  const threads = BANDS7.length * perBand;
  const xOf = (i: number) => w * LEFT + ((i + 0.5) / threads) * w * (RIGHT - LEFT);
  const top = h * TOP;
  const span = h * (BOTTOM - TOP);

  p.background(theme.paper);

  // 絲線
  p.noFill();
  p.stroke(theme.line, h * 0.0006);
  for (let i = 0; i < threads; i++) p.line(xOf(i), top, xOf(i), top + span);

  if (spectrum) {
    // 每一拍，每條絲線有機會出一滴露珠（機會 = 那一拍的頻帶能量）
    const beats = barTimes(tempo, t, 4);
    const firstAlive = beats.findIndex((b) => b > t - fall);
    p.noStroke();
    for (let b = 0; b < BANDS7.length; b++) {
      const band = BANDS7[b];
      const series = bandSeries(spectrum, band.lo, band.hi);
      const color = theme.noteColors[band.color] ?? theme.ink;
      for (let k = firstAlive < 0 ? beats.length : firstAlive; k < beats.length; k++) {
        const from = beats[k];
        const to = k + 1 < beats.length ? beats[k + 1] : t;
        const raw = meanOver(series, spectrum.fps, from, Math.max(from, to));
        if (raw < threshold) continue;
        const e = (raw - threshold) / Math.max(1e-6, 1 - threshold);
        const rng = rngFor(ctx.seed + b * 101, k);
        for (let j = 0; j < perBand; j++) {
          if (rng() > 0.35 + 0.65 * e) continue;
          const age = t - from - rng() * (to - from); // 每滴延遲一點，不要整排同高
          if (age < 0) continue;
          const u = Math.min(1, age / fall);
          const y = top + span * (u * u); // 越掉越快
          const x = xOf(b * perBand + j);
          const size = h * (0.004 + 0.008 * e);
          // 尾巴
          p.fill(color, 0.25 * (1 - u));
          p.rect(
            x - size * 0.15,
            Math.max(top, y - size * 6),
            size * 0.3,
            Math.min(size * 6, y - top),
          );
          // 露珠
          if (theme.glow) p.glow(color, size * 1.5);
          p.fill(color, 0.9 * (1 - u * 0.6));
          p.circle(x, y, size);
          if (theme.glow) p.noGlow();
        }
      }
    }
  }

  drawLabel(p, ctx);
}

/** 露珠：七個頻帶各幾條絲線，每一拍能量夠就出一滴露珠，沿線加速往下滑，顏色是頻帶。 */
export const dewLook: Look = {
  id: 'dew',
  number: 20,
  name: '露珠',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};
