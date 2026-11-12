import { positionAt } from '../analysis/tempo';
import type { Readings } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { mulberry32 } from './prng';
import { bandSeries, drawLabel, paramNum } from './sheet';
import { accentWindow, geometryCache, penCursor, seriesAt } from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'spread', label: '散開', min: 0.5, max: 1.5, default: 1 },
  { key: 'jitter', label: '抖動', min: 0, max: 1, default: 0.4 },
];

/** 半徑是「半個格子」的倍數（橫向用半寬、縱向用半高，圖形撐滿整個格子）。 */
const RADIUS = { kick: 0.3, snare: 0.62 };
const VELOCITY_RADIUS = 0.16;
const BASS_RADIUS = 0.12;
const MAX_RADIUS = 0.96;
/** 背景的紙屑點數。 */
const DUST = 110;

interface Pin extends Point {
  time: number;
}

const pinCache = geometryCache<Readings, Pin[]>();

/**
 * 釘的位置（整首歌，快取）：角度 = 小節內位置，半徑 = 鼓件基準 + 力度 + 低頻能量，再加固定種子的小抖動。
 * rng 依 hit 順序取用，跟 t 無關，所以同一根釘每一幀都在同一個地方。
 */
function buildPins(ctx: LookContext, spread: number, jitter: number): Pin[] {
  const { w, h, seed } = ctx;
  const { tempo, drums, spectrum } = ctx.readings;
  const low = spectrum ? bandSeries(spectrum, 30, 150) : null;
  const rng = mulberry32(seed);
  const cx = w / 2;
  const cy = h / 2;
  const pins: Pin[] = [];
  for (const hit of drums) {
    if (hit.kind === 'hat') continue;
    const ja = (rng() - 0.5) * 0.5 * jitter;
    const jr = (rng() - 0.5) * 0.16 * jitter;
    const phase = positionAt(tempo, hit.time).barPhase;
    const angle = phase * Math.PI * 2 - Math.PI / 2 + ja;
    const bass = low && spectrum ? seriesAt(low, spectrum.fps, hit.time) : 0;
    let r = (RADIUS[hit.kind] + VELOCITY_RADIUS * hit.velocity + BASS_RADIUS * bass + jr) * spread;
    r = Math.max(0.04, Math.min(MAX_RADIUS, r));
    pins.push({
      x: cx + Math.cos(angle) * r * (w / 2),
      y: cy + Math.sin(angle) * r * (h / 2),
      time: hit.time,
    });
  }
  return pins;
}

const dustCache = new Map<number, Point[]>();

/** 背景紙屑：0..1 的固定散點（依 seed），畫的時候再乘上格子尺寸。 */
function dust(seed: number): Point[] {
  const hit = dustCache.get(seed);
  if (hit) return hit;
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const out: Point[] = [];
  for (let i = 0; i < DUST; i++) out.push({ x: rng(), y: rng() });
  if (dustCache.size > 16) dustCache.clear();
  dustCache.set(seed, out);
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, duration } = ctx.readings;
  const spread = paramNum(ctx, params, 'spread');
  const jitter = paramNum(ctx, params, 'jitter');
  const unit = Math.min(w, h);
  const total = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const printedTo = Math.min(t, total);

  p.background(theme.paper);

  // 紙屑
  p.noStroke();
  p.fill(theme.mute, 0.35);
  const speck = Math.max(1, unit * 0.0018);
  for (const d of dust(ctx.seed)) p.circle(d.x * w, d.y * h, speck);

  const all = pinCache(ctx.readings, `${w}x${h}:${spread}:${jitter}:${ctx.seed}`, () =>
    buildPins(ctx, spread, jitter),
  );
  let count = 0;
  while (count < all.length && all[count].time <= printedTo) count++;
  const pins = all.slice(0, count);
  const window = accentWindow(tempo, t);
  let splitAt = pins.length;
  while (splitAt > 0 && pins[splitAt - 1].time >= printedTo - window) splitAt--;
  const thread = Math.max(0.6, unit * 0.0009);

  // 絲線：已織的部分用淡強調色，最近兩拍是實的強調色
  p.noFill();
  if (splitAt > 1) {
    p.stroke(theme.accent, thread, theme.glow ? 0.42 : 0.5);
    p.polyline(pins.slice(0, splitAt));
  }
  const recent = pins.slice(Math.max(0, splitAt - 1));
  if (recent.length > 1) {
    if (theme.glow) p.glow(theme.accent, unit * 0.005);
    p.stroke(theme.accent, thread * 1.8);
    p.polyline(recent);
    if (theme.glow) p.noGlow();
  }

  // 釘
  p.noStroke();
  p.fill(theme.mute, 0.9);
  const pin = Math.max(1.5, unit * 0.0042);
  for (const pt of pins) p.circle(pt.x, pt.y, pin);

  if (pins.length > 0 && t < total) {
    const last = pins[pins.length - 1];
    penCursor(p, ctx, last.x, last.y);
  }

  drawLabel(p, ctx);
}

/** 鼓釘絲線：kick / snare 是釘，一條線依時間順序把釘串起來，織出這首歌自己的圖形，撐滿整個格子。 */
export const stringLook: Look = {
  id: 'string',
  number: 9,
  name: '鼓釘絲線',
  listens: ['drums', 'tempo'],
  params,
  draw,
};
