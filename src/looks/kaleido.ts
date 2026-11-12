import type { DrumKind } from '../analysis/types';
import { noteColor } from './music';
import type { Painter } from './painter/painter';
import { drawLabel, paramNum, rngFor, softDot } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'segments', label: '鏡射份數', min: 3, max: 12, default: 6 },
  { key: 'life', label: '壽命秒數', min: 0.5, max: 4, default: 2 },
  { key: 'spin', label: '旋轉速度', min: 0, max: 1, default: 0.15 },
];

const PER_HIT: Record<DrumKind, number> = { kick: 6, snare: 5, hat: 3 };
const SPEED: Record<DrumKind, number> = { kick: 0.32, snare: 0.26, hat: 0.18 };

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const segments = Math.max(2, Math.round(paramNum(ctx, params, 'segments')));
  const life = paramNum(ctx, params, 'life');
  const spin = paramNum(ctx, params, 'spin');
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  const wedge = (Math.PI * 2) / segments;
  const base = t * spin; // 整個萬花筒慢慢轉
  const chords = ctx.readings.chords ?? [];
  let root = -1;
  for (const c of chords) {
    if (c.time > t) break;
    if (t < c.time + c.duration) root = c.root;
  }
  const snareColor = root >= 0 ? noteColor(theme, root) : theme.ink;

  p.background(theme.paper);
  p.noStroke();

  const drums = ctx.readings.drums;
  for (let i = 0; i < drums.length; i++) {
    const hit = drums[i];
    if (hit.time > t) break;
    const age = t - hit.time;
    if (age > life) continue;
    const rng = rngFor(ctx.seed, i);
    const fade = 1 - age / life;
    const color =
      hit.kind === 'kick' ? theme.accent : hit.kind === 'snare' ? snareColor : theme.mute;
    const size =
      unit *
      (hit.kind === 'kick' ? 0.012 : 0.008) *
      (0.5 + 0.5 * hit.velocity) *
      (0.6 + 0.4 * fade);
    const n = PER_HIT[hit.kind];
    for (let j = 0; j < n; j++) {
      // 一顆粒子在一個扇形裡飛，阻力讓它慢下來
      const a0 = rng() * wedge;
      const v = SPEED[hit.kind] * (0.5 + rng()) * (0.5 + 0.5 * hit.velocity);
      const dist = unit * v * (1 - Math.exp(-age * 1.8)) + unit * 0.03;
      const wobble = Math.sin(age * 6 + rng() * 6.28) * unit * 0.01;
      for (let m = 0; m < segments; m++) {
        for (const mirror of [1, -1]) {
          const a = base + m * wedge + mirror * a0;
          softDot(
            p,
            theme,
            cx + Math.cos(a) * dist + Math.cos(a + 1.57) * wobble,
            cy + Math.sin(a) * dist + Math.sin(a + 1.57) * wobble,
            size,
            color,
            fade,
          );
        }
      }
    }
  }

  drawLabel(p, ctx);
}

/** 萬花筒：每個 hit 的粒子做 N 重鏡射，kick 強調色、snare 是當下和弦的根音色、hat 灰；整朵花慢慢轉。 */
export const kaleidoLook: Look = {
  id: 'kaleido',
  number: 21,
  name: '萬花筒',
  listens: ['drums', 'chords'],
  params,
  draw,
};
