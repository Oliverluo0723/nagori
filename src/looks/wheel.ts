import type { ChordEvent } from '../analysis/types';
import { FIFTHS, fifthsIndex, pcName } from './music';
import type { Painter } from './painter/painter';
import type { Look, LookContext } from './types';

const SECTOR = Math.PI / 6;
const START = -Math.PI / 2; // 12 點鐘
const FADE_IN = 0.25;

function sectorAngles(pc: number): [number, number] {
  const i = fifthsIndex(pc);
  return [START + i * SECTOR, START + (i + 1) * SECTOR];
}

function currentChord(chords: ChordEvent[], t: number): { now?: ChordEvent; next?: ChordEvent } {
  let now: ChordEvent | undefined;
  let next: ChordEvent | undefined;
  for (const c of chords) {
    if (c.time <= t && t < c.time + c.duration) now = c;
    else if (c.time > t && (!next || c.time < next.time)) next = c;
  }
  return { now, next };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const cx = w / 2;
  const cy = h * 0.45;
  const R = h * 0.17;
  const rIn = R * 0.62;
  const chords = ctx.readings.chords ?? [];
  const { now, next } = currentChord(chords, t);

  p.background(theme.paper);

  // 底：12 個扇面輪廓
  p.noFill();
  p.stroke(theme.line, h * 0.001);
  for (const pc of FIFTHS) {
    const [a, b] = sectorAngles(pc);
    p.wedge(cx, cy, rIn, R, a, b);
  }

  // 目前和弦
  if (now) {
    const age = t - now.time;
    const fade = Math.min(1, age / FADE_IN);
    p.noStroke();
    for (const pc of now.notes) {
      if (pc === now.root) continue;
      const [a, b] = sectorAngles(pc);
      p.fill(theme.ink, 0.35 * fade);
      p.wedge(cx, cy, rIn, R, a, b);
    }
    const [a, b] = sectorAngles(now.root);
    p.fill(theme.accent, fade);
    p.wedge(cx, cy, rIn, R, a, b);
  }

  // 下一個和弦的根音：強調色外框
  if (next) {
    const [a, b] = sectorAngles(next.root);
    p.noFill();
    p.stroke(theme.accent, h * 0.002, 0.6);
    p.wedge(cx, cy, rIn, R, a, b);
  }

  // 中心：調性
  p.noStroke();
  p.fill(theme.ink);
  const key = ctx.readings.key;
  p.text(key ? pcName(key.tonic) : '–', cx, cy - h * 0.03, {
    size: h * 0.05,
    font: 'sans',
    align: 'center',
    weight: 700,
  });
  if (key) {
    p.fill(theme.mute);
    p.text(key.mode, cx, cy + h * 0.025, { size: h * 0.014, font: 'mono', align: 'center' });
  }

  // 扇面外側音名
  p.fill(theme.mute);
  for (const pc of FIFTHS) {
    const [a, b] = sectorAngles(pc);
    const mid = (a + b) / 2;
    const r = R * 1.14;
    p.text(pcName(pc), cx + Math.cos(mid) * r, cy + Math.sin(mid) * r - h * 0.006, {
      size: h * 0.012,
      font: 'mono',
      align: 'center',
    });
  }

  // 讀數列
  p.text(`CHORD ${now?.name ?? '–'}   NEXT ${next?.name ?? '–'}`, w * 0.03, h * 0.86, {
    size: h * 0.012,
    font: 'mono',
    align: 'left',
  });

  if (ctx.label) {
    p.text(ctx.label, w * 0.03, h * 0.04, { size: h * 0.012, font: 'mono', align: 'left' });
  }
}

/** 和弦輪：五度圈，現在的和弦亮起，下一個預告。 */
export const wheelLook: Look = {
  id: 'wheel',
  number: 1,
  name: '和弦輪',
  listens: ['chords', 'key'],
  params: [],
  draw,
};
