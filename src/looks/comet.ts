import { noteColor } from './music';
import type { Painter } from './painter/painter';
import {
  bandSeries,
  bassAt,
  drawLabel,
  paramNum,
  pitchRange,
  rngFor,
  smoothAt,
  ticksAlive,
} from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'tail', label: '尾巴秒數', min: 1, max: 8, default: 4 },
  { key: 'sparkle', label: '火花量', min: 0, max: 2, default: 1 },
];

const NOW_X = 0.62;
const TOP = 0.2;
const BOTTOM = 0.8;
/** 尾巴的取樣：每秒幾個點 */
const RATE = 24;

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { bass, spectrum, chords } = ctx.readings;
  const tail = paramNum(ctx, params, 'tail');
  const sparkle = paramNum(ctx, params, 'sparkle');
  const nowX = w * NOW_X;
  const pxPerSec = (w * NOW_X) / tail;
  const xOf = (time: number) => nowX - (t - time) * pxPerSec;
  const notes = bass ?? [];
  const [lo, hi] = pitchRange(notes);
  const low = spectrum ? bandSeries(spectrum, 30, 150) : null;

  // 高度：有 bass 音就用音高，沒有就用低頻能量
  const heightAt = (time: number): number | null => {
    if (notes.length) {
      const n = bassAt(notes, time, true);
      return n ? (n.midi - lo) / (hi - lo) : null;
    }
    if (low && spectrum) return smoothAt(low, spectrum.fps, time, 0.1);
    return null;
  };
  const yOf = (u: number) => h * BOTTOM - u * h * (BOTTOM - TOP);

  // 顏色：當下和弦根音，沒有和弦就用 bass 的音名
  let pc = -1;
  for (const c of chords ?? []) {
    if (c.time > t) break;
    if (t < c.time + c.duration) pc = c.root;
  }
  const nowNote = notes.length ? bassAt(notes, t, true) : null;
  if (pc < 0 && nowNote) pc = Math.round(nowNote.midi) % 12;
  const color = pc >= 0 ? noteColor(theme, pc) : theme.accent;

  p.background(theme.paper);

  // 尾巴：一段一段畫，越舊越淡
  const [first, last] = ticksAlive(t, RATE, tail);
  let prev: { x: number; y: number } | null = null;
  p.noFill();
  for (let k = first; k <= last; k++) {
    const time = k / RATE;
    const u = heightAt(time);
    if (u === null) {
      prev = null;
      continue;
    }
    const pt = { x: xOf(time), y: yOf(u) };
    if (prev) {
      const age = (t - time) / tail;
      p.stroke(color, h * 0.003 * (1 - age) + h * 0.0005, 1 - age);
      p.line(prev.x, prev.y, pt.x, pt.y);
    }
    prev = pt;
    // 火花：沿著尾巴散開的小點
    const rng = rngFor(ctx.seed, k);
    const n = Math.floor(sparkle * 2);
    p.noStroke();
    for (let i = 0; i < n; i++) {
      const age = t - time;
      const drift = (rng() - 0.5) * h * 0.06 * Math.min(1, age / tail);
      p.fill(color, (1 - age / tail) * 0.7);
      p.circle(pt.x + (rng() - 0.5) * w * 0.01, pt.y + drift, h * 0.0025);
    }
    p.noFill();
  }

  // 彗星頭
  const u = heightAt(t);
  if (u !== null) {
    p.noStroke();
    if (theme.glow) p.glow(color, h * 0.02);
    p.fill(color, 0.35);
    p.circle(nowX, yOf(u), h * 0.03);
    p.fill(theme.ink);
    p.circle(nowX, yOf(u), h * 0.012);
    if (theme.glow) p.noGlow();
  }

  drawLabel(p, ctx);
}

/** 彗星：bass 音高是彗星的高度，拖著幾秒的尾巴飛，顏色跟著和弦根音換；沒有 bass 讀數就用低頻能量。 */
export const cometLook: Look = {
  id: 'comet',
  number: 22,
  name: '彗星',
  listens: ['bass', 'chords', 'spectrum'],
  params,
  draw,
};
