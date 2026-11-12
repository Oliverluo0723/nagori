import type { Spectrum } from '../analysis/types';
import type { Painter } from './painter/painter';
import { bandSeries, drawLabel, energySeries, formatTime, meanOver, paramNum } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [{ key: 'gain', label: '筆幅', min: 0.5, max: 2, default: 1 }];

export const LANES = ['HITS', 'BASS', 'LEVEL', 'PUNCH', 'BRIGHT', 'NOTES'] as const;
const LABEL_X = 0.04;
const LEFT = 0.15;
const RIGHT = 0.95;
const TOP = 0.12;
const BOTTOM = 0.9;
/** 曲線每秒幾個樣本 */
const SR = 5;
const TICK_SECONDS = 30;

interface Pens {
  level: Float32Array;
  punch: Float32Array;
  bright: Float32Array;
}

const penCache = new WeakMap<Spectrum, Pens>();

/** 整首歌每 1/SR 秒一個樣本的三條曲線（快取）。 */
export function pens(s: Spectrum): Pens {
  const hit = penCache.get(s);
  if (hit) return hit;
  const n = Math.max(1, Math.ceil(s.frameCount / s.fps) * SR);
  const energy = energySeries(s);
  const low = bandSeries(s, 30, 150);
  const high = bandSeries(s, 4000, 16000);
  const level = new Float32Array(n);
  const punch = new Float32Array(n);
  const bright = new Float32Array(n);
  let prevLow = 0;
  let maxPunch = 1e-6;
  for (let i = 0; i < n; i++) {
    const from = i / SR;
    const to = (i + 1) / SR;
    level[i] = meanOver(energy, s.fps, from, to);
    const lowNow = meanOver(low, s.fps, from, to);
    punch[i] = Math.max(0, lowNow - prevLow);
    maxPunch = Math.max(maxPunch, punch[i]);
    prevLow = lowNow;
    const hi = meanOver(high, s.fps, from, to);
    bright[i] = level[i] > 0.02 ? Math.min(1, hi / level[i]) : 0;
  }
  for (let i = 0; i < n; i++) punch[i] /= maxPunch;
  const out = { level, punch, bright };
  penCache.set(s, out);
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum, drums, bass, chords, duration } = ctx.readings;
  const gain = paramNum(ctx, params, 'gain');
  const total = duration > 0 ? duration : 1;
  const left = w * LEFT;
  const span = w * (RIGHT - LEFT);
  const laneH = (h * (BOTTOM - TOP)) / LANES.length;
  const amp = laneH * 0.4 * gain;
  const xOf = (time: number) => left + (time / total) * span;
  const laneY = (i: number) => h * TOP + (i + 0.5) * laneH;
  const printedTo = Math.min(t, total);

  p.background(theme.paper);

  // 時間刻度
  p.noFill();
  p.stroke(theme.line, h * 0.0006);
  for (let sec = 0; sec <= total; sec += TICK_SECONDS)
    p.line(xOf(sec), h * TOP, xOf(sec), h * BOTTOM);
  p.noStroke();
  p.fill(theme.mute);
  for (let sec = 0; sec <= total; sec += TICK_SECONDS) {
    p.text(formatTime(sec), xOf(sec), h * TOP - h * 0.02, {
      size: h * 0.009,
      font: 'mono',
      align: 'left',
    });
  }
  // 泳道名稱
  LANES.forEach((name, i) => {
    p.text(name, w * LABEL_X, laneY(i), { size: h * 0.01, font: 'mono', align: 'left' });
  });

  // HITS：kick 往上強調色、snare 往下墨色
  {
    const base = laneY(0);
    p.noFill();
    for (const hit of drums) {
      if (hit.time > t) break;
      if (hit.kind === 'kick') {
        p.stroke(theme.accent, h * 0.0007);
        p.line(xOf(hit.time), base, xOf(hit.time), base - amp * hit.velocity);
      } else if (hit.kind === 'snare') {
        p.stroke(theme.ink, h * 0.0007);
        p.line(xOf(hit.time), base, xOf(hit.time), base + amp * 0.7 * hit.velocity);
      }
    }
  }

  // BASS：音高階梯
  if (bass?.length) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const n of bass) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    const range = Math.max(1, hi - lo);
    const yOf = (midi: number) => laneY(1) + amp - ((midi - lo) / range) * 2 * amp;
    const pts: { x: number; y: number }[] = [];
    for (const n of bass) {
      if (n.time > t) break;
      pts.push({ x: xOf(n.time), y: yOf(n.midi) });
      pts.push({ x: xOf(Math.min(t, n.time + n.duration)), y: yOf(n.midi) });
    }
    if (pts.length > 1) {
      p.noFill();
      p.stroke(theme.accent, h * 0.0008);
      p.polyline(pts);
    }
  }

  // LEVEL / PUNCH / BRIGHT：曲線
  if (spectrum) {
    const curves = pens(spectrum);
    const series: [Float32Array, number, string][] = [
      [curves.level, 2, theme.ink],
      [curves.punch, 3, theme.noteColors[3] ?? theme.ink],
      [curves.bright, 4, theme.noteColors[9] ?? theme.ink],
    ];
    const n = Math.min(curves.level.length, Math.floor(printedTo * SR) + 1);
    p.noFill();
    for (const [data, lane, color] of series) {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++)
        pts.push({ x: xOf(i / SR), y: laneY(lane) + amp - data[i] * 2 * amp });
      if (pts.length > 1) {
        p.stroke(color, h * 0.0008);
        p.polyline(pts);
      }
    }
  }

  // NOTES：和弦組成音，12 列，根音強調色
  if (chords) {
    p.noStroke();
    for (const c of chords) {
      if (c.time > t) break;
      const x0 = xOf(c.time);
      const x1 = xOf(Math.min(printedTo, c.time + c.duration));
      for (const pc of c.notes) {
        const y = laneY(5) + amp - (pc / 11) * 2 * amp;
        p.fill(pc === c.root ? theme.accent : theme.ink, 0.85);
        p.rect(x0, y - laneH * 0.03, Math.max(1, x1 - x0), laneH * 0.06);
      }
    }
  }

  // 印字頭
  p.noFill();
  p.stroke(theme.accent, h * 0.0008, 0.6);
  p.line(xOf(printedTo), h * TOP, xOf(printedTo), h * BOTTOM);

  drawLabel(p, ctx);
}

/** 多筆記錄：六支筆在一張圖上寫整首歌，鼓、bass 音高、音量、低頻衝擊、亮度、和弦音。 */
export const polygraphLook: Look = {
  id: 'polygraph',
  number: 17,
  name: '多筆記錄',
  listens: ['drums', 'bass', 'spectrum', 'chords', 'tempo'],
  params,
  draw,
};
