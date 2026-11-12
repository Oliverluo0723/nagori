import { positionAt, timeOfBar } from '../analysis/tempo';
import type { BassNote } from '../analysis/types';
import { noteColor, pcName } from './music';
import type { Painter, Point } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [{ key: 'windowBars', label: '視窗小節數', min: 1, max: 8, default: 2 }];

const NOW_X = 0.62;
const TOP = 0.22;
const BOTTOM = 0.78;

/** 26 → 'D1'（C4 = 60） */
export function midiName(midi: number): string {
  const m = Math.round(midi);
  return `${pcName(m)}${Math.floor(m / 12) - 1}`;
}

function num(ctx: LookContext, key: string): number {
  const v = ctx.params[key];
  if (typeof v === 'number') return v;
  return params.find((p) => p.key === key)?.default ?? 0;
}

function barSeconds(ctx: LookContext): number {
  const { tempo } = ctx.readings;
  const bar = positionAt(tempo, ctx.t).bar;
  const s = timeOfBar(tempo, bar + 1) - timeOfBar(tempo, bar);
  return s > 0 ? s : 2;
}

function pitchRange(bass: BassNote[]): [number, number] {
  if (bass.length === 0) return [24, 48];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const n of bass) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  return [lo - 2, hi + 2];
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const bass = ctx.readings.bass ?? [];
  const [lo, hi] = pitchRange(bass);
  const yOf = (midi: number) => h * BOTTOM - ((midi - lo) / (hi - lo)) * h * (BOTTOM - TOP);
  const pxPerSec = w / (num(ctx, 'windowBars') * barSeconds(ctx));
  const nowX = w * NOW_X;
  const xOf = (time: number) => nowX + (time - t) * pxPerSec;

  p.background(theme.paper);

  // 半音網格，C 線粗一點並標音名
  p.noFill();
  for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
    const isC = m % 12 === 0;
    p.stroke(theme.line, h * (isC ? 0.0015 : 0.0008));
    p.line(0, yOf(m), w, yOf(m));
  }
  p.noStroke();
  p.fill(theme.mute);
  for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
    if (m % 12 !== 0) continue;
    p.text(midiName(m), w * 0.02, yOf(m) - h * 0.014, {
      size: h * 0.011,
      font: 'mono',
      align: 'left',
    });
  }

  // 音與跳線
  let prev: BassNote | null = null;
  for (const n of bass) {
    const x0 = xOf(n.time);
    const x1 = xOf(n.time + n.duration);
    if (x1 >= -w * 0.1 && x0 <= w * 1.1) {
      if (prev) {
        p.noFill();
        p.stroke(theme.mute, h * 0.001);
        p.line(xOf(prev.time + prev.duration), yOf(prev.midi), x0, yOf(n.midi));
      }
      p.noFill();
      p.stroke(noteColor(theme, n.midi % 12), h * 0.004);
      if (n.bends.length === 0) {
        p.line(x0, yOf(n.midi), x1, yOf(n.midi));
      } else {
        const pts: Point[] = [{ x: x0, y: yOf(n.midi) }];
        for (const b of n.bends) pts.push({ x: xOf(b.time), y: yOf(n.midi + b.semitones) });
        const last = n.bends[n.bends.length - 1];
        pts.push({ x: x1, y: yOf(n.midi + last.semitones) });
        p.polyline(pts);
      }
    }
    prev = n;
  }

  // now 線
  p.noFill();
  p.stroke(theme.ink, h * 0.002);
  p.line(nowX, h * TOP - h * 0.02, nowX, h * BOTTOM + h * 0.02);

  // 正在響的音
  const sounding = bass.find((n) => n.time <= t && t < n.time + n.duration);
  if (sounding) {
    let semis = 0;
    for (const b of sounding.bends) if (b.time <= t) semis = b.semitones;
    const y = yOf(sounding.midi + semis);
    p.noStroke();
    if (theme.glow) p.glow(theme.accent, h * 0.015);
    p.fill(theme.accent);
    p.circle(nowX, y, h * 0.02);
    if (theme.glow) p.noGlow();
    p.fill(theme.ink);
    p.text(midiName(sounding.midi), nowX + h * 0.02, y - h * 0.01, {
      size: h * 0.016,
      font: 'mono',
      align: 'left',
    });
  }

  if (ctx.label) {
    p.noStroke();
    p.fill(theme.mute);
    p.text(ctx.label, w * 0.03, h * 0.04, { size: h * 0.012, font: 'mono', align: 'left' });
  }
}

/** Bass 路徑：808 的音高折線，含滑音。 */
export const glideLook: Look = {
  id: 'glide',
  number: 3,
  name: 'Bass 路徑',
  listens: ['bass', 'tempo'],
  params,
  draw,
};
