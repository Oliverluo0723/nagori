import { positionAt } from '../analysis/tempo';
import type { Painter } from './painter/painter';
import { mulberry32 } from './prng';
import { bandSeries, drawLabel, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'spread', label: '散開', min: 0.5, max: 1.5, default: 1 },
  { key: 'jitter', label: '抖動', min: 0, max: 1, default: 0.4 },
];

/** 半徑是短邊的倍數。 */
const RADIUS = { kick: 0.16, snare: 0.3 };
const VELOCITY_RADIUS = 0.08;
const BASS_RADIUS = 0.06;
const MAX_RADIUS = 0.46;

interface Pin {
  x: number;
  y: number;
  time: number;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, drums, spectrum } = ctx.readings;
  const spread = paramNum(ctx, params, 'spread');
  const jitter = paramNum(ctx, params, 'jitter');
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  const low = spectrum ? bandSeries(spectrum, 30, 150) : null;
  const rng = mulberry32(ctx.seed);
  const beat = printedBeat(tempo, t);

  p.background(theme.paper);

  // 釘的位置：角度 = 小節內位置，半徑 = 鼓件基準 + 力度 + 低頻能量，再加固定種子的小抖動。
  // rng 依 hit 順序取用，跟 t 無關，所以同一根釘每一幀都在同一個地方。
  const pins: Pin[] = [];
  for (const hit of drums) {
    if (hit.kind === 'hat') continue;
    const ja = (rng() - 0.5) * 0.5 * jitter;
    const jr = (rng() - 0.5) * 0.08 * jitter;
    if (hit.time > t) continue;
    const phase = positionAt(tempo, hit.time).barPhase;
    const angle = phase * Math.PI * 2 - Math.PI / 2 + ja;
    const bass =
      low && spectrum ? low[Math.min(low.length - 1, Math.floor(hit.time * spectrum.fps))] : 0;
    let r = (RADIUS[hit.kind] + VELOCITY_RADIUS * hit.velocity + BASS_RADIUS * bass + jr) * spread;
    r = Math.max(0.02, Math.min(MAX_RADIUS, r)) * unit;
    pins.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, time: hit.time });
  }

  // 絲線
  const splitAt = pins.findIndex((pin) => pin.time >= t - beat);
  const ink = splitAt < 0 ? pins : pins.slice(0, splitAt + 1);
  const accent = splitAt < 0 ? [] : pins.slice(Math.max(0, splitAt));
  p.noFill();
  if (ink.length > 1) {
    p.stroke(theme.ink, h * 0.0007, 0.75);
    p.polyline(ink.map(({ x, y }) => ({ x, y })));
  }
  if (accent.length > 1) {
    if (theme.glow) p.glow(theme.accent, h * 0.005);
    p.stroke(theme.accent, h * 0.001);
    p.polyline(accent.map(({ x, y }) => ({ x, y })));
    if (theme.glow) p.noGlow();
  }

  // 釘
  p.noStroke();
  for (let i = 0; i < pins.length; i++) {
    const current = i === pins.length - 1 && pins[i].time >= t - beat;
    p.fill(current ? theme.accent : theme.mute);
    p.circle(pins[i].x, pins[i].y, h * (current ? 0.006 : 0.003));
  }

  drawLabel(p, ctx);
}

/** 鼓釘絲線：kick / snare 是釘，一條線依時間順序把釘串起來，織出這首歌自己的圖形。 */
export const stringLook: Look = {
  id: 'string',
  number: 9,
  name: '鼓釘絲線',
  listens: ['drums', 'tempo'],
  params,
  draw,
};
