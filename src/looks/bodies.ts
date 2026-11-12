import { bandEnergy, frameAt } from '../analysis/audio/spectrum';
import type { ChordEvent } from '../analysis/types';
import { noteColor } from './music';
import type { Painter } from './painter/painter';
import { mulberry32 } from './prng';
import type { Look, LookContext } from './types';

const FADE_IN = 0.3;
const LAYERS: [number, number][] = [
  [1.8, 0.12],
  [1.3, 0.25],
  [1.0, 0.6],
];

function current(chords: ChordEvent[], t: number): { chord: ChordEvent; index: number } | null {
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    if (c.time <= t && t < c.time + c.duration) return { chord: c, index: i };
  }
  return null;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const found = current(ctx.readings.chords ?? [], t);

  p.background(theme.paper);

  if (found) {
    const { chord, index } = found;
    const rnd = mulberry32(ctx.seed + index * 7919);
    const fade = Math.min(1, (t - chord.time) / FADE_IN);
    const s = ctx.readings.spectrum;
    const breath = s ? 0.85 + 0.3 * bandEnergy(s, frameAt(s, t), 150, 2500) : 1;
    p.noStroke();
    for (const pc of chord.notes) {
      const cx = w * (0.25 + 0.5 * rnd());
      const cy = h * (0.3 + 0.32 * rnd());
      const base = h * 0.11 * breath * (pc === chord.root ? 1.25 : 1);
      const color = noteColor(theme, pc);
      if (theme.glow) p.glow(color, h * 0.05);
      for (const [scale, alpha] of LAYERS) {
        p.fill(color, alpha * fade);
        p.ellipse(cx, cy, base * scale, base * scale);
      }
      if (theme.glow) p.noGlow();
    }
  }

  p.noStroke();
  p.fill(theme.ink);
  p.text(found?.chord.name ?? '–', w / 2, h * 0.76, {
    size: h * 0.04,
    font: 'sans',
    align: 'center',
    weight: 700,
  });

  if (ctx.label) {
    p.fill(theme.mute);
    p.text(ctx.label, w * 0.03, h * 0.04, { size: h * 0.012, font: 'mono', align: 'left' });
  }
}

/** 和弦發光體：每個組成音一團發光，隨中頻呼吸。 */
export const bodiesLook: Look = {
  id: 'bodies',
  number: 5,
  name: '和弦發光體',
  listens: ['chords', 'spectrum'],
  params: [],
  draw,
};
