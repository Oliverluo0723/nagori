import type { DrumKind } from '../analysis/types';
import type { Painter } from './painter/painter';
import { bandSeries, drawLabel, paramNum, rngFor, smoothAt, softDot, ticksAlive } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'density', label: '火花密度', min: 0.3, max: 2, default: 1 },
  { key: 'life', label: '壽命秒數', min: 0.6, max: 3, default: 1.5 },
];

/** 連續發射：每秒幾個 tick */
const RATE = 30;
const GRAVITY = 1.1; // 畫布高度 / 秒²
const FLOOR = 0.78;
const SPARKS: Record<DrumKind, number> = { kick: 36, snare: 22, hat: 8 };

interface Spark {
  x: number;
  y: number;
  size: number;
  color: string;
  alpha: number;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const density = paramNum(ctx, params, 'density');
  const life = paramNum(ctx, params, 'life');
  const floorY = h * FLOOR;
  const sparks: Spark[] = [];
  const lowColor = theme.noteColors[9] ?? theme.ink;
  const highColor = theme.noteColors[8] ?? theme.ink;

  // 一顆火花：從 (x0, y0) 以 (vx, vy) 出發，重力往下，落到地板就消失
  const emit = (
    x0: number,
    y0: number,
    vx: number,
    vy: number,
    age: number,
    color: string,
    size: number,
  ) => {
    const x = x0 + vx * age * w;
    const y = y0 + (vy * age + 0.5 * GRAVITY * age * age) * h;
    if (y > floorY || age > life) return;
    const alpha = Math.min(1, 1.6 * (1 - age / life));
    sparks.push({ x, y, size, color, alpha });
  };

  // 連續噴：左右兩側噴低頻、中間噴高頻
  if (s) {
    const low = bandSeries(s, 30, 150);
    const high = bandSeries(s, 4000, 16000);
    const [first, last] = ticksAlive(t, RATE, life);
    for (let k = first; k <= last; k++) {
      const tk = k / RATE;
      const age = t - tk;
      const rng = rngFor(ctx.seed, k);
      const e1 = smoothAt(low, s.fps, tk, 0.05);
      const e2 = smoothAt(high, s.fps, tk, 0.05);
      const nLow = Math.floor(e1 * 16 * density);
      const nHigh = Math.floor(e2 * 12 * density);
      for (let i = 0; i < nLow; i++) {
        const side = rng() < 0.5 ? -1 : 1;
        const x0 = w * (0.5 + side * 0.38);
        emit(
          x0,
          floorY,
          -side * (0.05 + 0.12 * rng()),
          -(0.55 + 0.5 * rng()),
          age,
          lowColor,
          h * 0.0035,
        );
      }
      for (let i = 0; i < nHigh; i++) {
        emit(
          w * (0.5 + (rng() - 0.5) * 0.16),
          floorY,
          (rng() - 0.5) * 0.1,
          -(0.7 + 0.5 * rng()),
          age,
          highColor,
          h * 0.003,
        );
      }
    }
  }

  // 每個 hit 噴一把
  for (let i = 0; i < ctx.readings.drums.length; i++) {
    const hit = ctx.readings.drums[i];
    if (hit.time > t) break;
    const age = t - hit.time;
    if (age > life) continue;
    const rng = rngFor(ctx.seed ^ 0x5bd1e995, i);
    const n = Math.floor(SPARKS[hit.kind] * density * (0.5 + 0.5 * hit.velocity));
    const x0 = hit.kind === 'kick' ? w * (0.5 + (rng() < 0.5 ? -0.38 : 0.38)) : w * 0.5;
    for (let j = 0; j < n; j++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * (hit.kind === 'hat' ? 1.6 : 0.9);
      const v = (hit.kind === 'kick' ? 0.9 : 0.7) * (0.6 + 0.6 * rng()) * hit.velocity;
      emit(x0, floorY, Math.cos(a) * v * 0.6, Math.sin(a) * v, age, theme.accent, h * 0.004);
    }
  }

  p.background(theme.paper);

  // 地板：一圈淡淡的橢圓
  p.noFill();
  p.stroke(theme.line, h * 0.001);
  p.ellipse(w / 2, floorY, w * 0.84, h * 0.04);

  p.noStroke();
  for (const sp of sparks) softDot(p, theme, sp.x, sp.y, sp.size, sp.color, sp.alpha);

  drawLabel(p, ctx);
}

/** 噴泉：兩側噴低頻、中間噴高頻的火花，每個 hit 再噴一把；火花的位置是年齡的函式，沒有狀態。 */
export const fountainLook: Look = {
  id: 'fountain',
  number: 19,
  name: '噴泉',
  listens: ['spectrum', 'drums'],
  params,
  draw,
};
