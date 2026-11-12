import { binValue } from '../analysis/audio/spectrum';
import type { Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { bandSeries, drawLabel, energySeries, formatTime, meanOver, paramNum } from './sheet';
import { geometryCache, labelSize, tickStep } from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [{ key: 'gain', label: '筆幅', min: 0.5, max: 2, default: 1 }];

export const LANES = [
  'HITS',
  'BASS',
  'LEVEL',
  'PUNCH',
  'BRIGHT',
  'WIDTH',
  'NOTES',
  'TENSION',
] as const;
const LANE = Object.fromEntries(LANES.map((n, i) => [n, i])) as Record<
  (typeof LANES)[number],
  number
>;
/** 曲線每秒幾個樣本 */
const SR = 5;

export interface Pens {
  level: Float32Array;
  punch: Float32Array;
  bright: Float32Array;
  /** 頻譜寬度：能量在頻率軸上散得多開（沒有立體聲資料，用頻譜的展幅代替）。 */
  width: Float32Array;
  /** 張力：頻譜在中高頻的鋸齒程度（音與音互相摩擦、噪音多時高）。 */
  tension: Float32Array;
}

const penCache = new WeakMap<Spectrum, Pens>();

/** 把序列依自己的 2%..98% 分位數拉到 0..1。 */
function normalize(a: Float32Array): void {
  const sorted = Float32Array.from(a).sort();
  const lo = sorted[Math.floor((sorted.length - 1) * 0.02)] ?? 0;
  const hi = sorted[Math.floor((sorted.length - 1) * 0.98)] ?? 1;
  for (let i = 0; i < a.length; i++)
    a[i] = Math.max(0, Math.min(1, (a[i] - lo) / Math.max(1e-6, hi - lo)));
}

/** 整首歌每 1/SR 秒一個樣本的五條曲線（快取）。 */
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
  const width = new Float32Array(n);
  const tension = new Float32Array(n);
  const midLo = Math.max(
    1,
    Math.floor((Math.log(200 / s.minHz) / Math.log(s.maxHz / s.minHz)) * s.bins),
  );
  const midHi = Math.min(
    s.bins - 1,
    Math.ceil((Math.log(8000 / s.minHz) / Math.log(s.maxHz / s.minHz)) * s.bins),
  );
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
    // 寬度、張力：取這段時間中間那一幀
    const f = Math.min(s.frameCount - 1, Math.floor(((from + to) / 2) * s.fps));
    if (f >= 0 && level[i] > 0.02) {
      let sw = 0;
      let sx = 0;
      let sxx = 0;
      for (let b = 0; b < s.bins; b++) {
        const v = Math.max(0, binValue(s, f, b) - level[i] * 0.5);
        sw += v;
        sx += v * b;
        sxx += v * b * b;
      }
      const mean = sw > 0 ? sx / sw : 0;
      width[i] = sw > 0 ? Math.sqrt(Math.max(0, sxx / sw - mean * mean)) / s.bins : 0;
      let rough = 0;
      for (let b = midLo; b < midHi; b++)
        rough += Math.abs(binValue(s, f, b + 1) - binValue(s, f, b));
      tension[i] = rough / Math.max(1, midHi - midLo);
    }
  }
  for (let i = 0; i < n; i++) punch[i] /= maxPunch;
  normalize(width);
  normalize(tension);
  const out = { level, punch, bright, width, tension };
  penCache.set(s, out);
  return out;
}

interface Layout {
  left: number;
  right: number;
  top: number;
  laneH: number;
  font: number;
}

function layout(ctx: LookContext): Layout {
  const font = labelSize(ctx);
  const top = font * 2;
  return {
    left: font * 6.6,
    right: ctx.w - font * 1.5,
    top,
    laneH: (ctx.h - top) / LANES.length,
    font,
  };
}

const curveCache = geometryCache<Pens, Point[][]>();

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum, drums, bass, chords, duration } = ctx.readings;
  const gain = paramNum(ctx, params, 'gain');
  const total = duration > 0 ? duration : 1;
  const L = layout(ctx);
  const unit = Math.min(w, h);
  const span = L.right - L.left;
  const amp = L.laneH * 0.4 * gain;
  const xOf = (time: number) => L.left + (time / total) * span;
  const laneY = (i: number) => L.top + (i + 0.5) * L.laneH;
  const printedTo = Math.min(Math.max(0, t), total);
  const hair = Math.max(0.5, unit * 0.0007);
  const pen = Math.max(0.8, unit * 0.0014);

  p.background(theme.paper);

  // 格線：泳道分隔與時間刻度，整張紙一開始就畫好
  const step = tickStep(total, 10);
  p.noFill();
  p.stroke(theme.line, hair);
  for (let i = 1; i < LANES.length; i++) p.line(0, L.top + i * L.laneH, w, L.top + i * L.laneH);
  for (let sec = 0; sec <= total; sec += step) p.line(xOf(sec), L.top, xOf(sec), h);
  p.noStroke();
  p.fill(theme.mute);
  for (let sec = 0; sec <= total; sec += step) {
    p.text(formatTime(sec), xOf(sec), L.top - L.font * 1.5, {
      size: L.font * 0.9,
      font: 'mono',
      align: 'center',
    });
  }
  LANES.forEach((name, i) => {
    p.text(name, 0, laneY(i) - L.font * 0.6, {
      size: L.font,
      font: 'mono',
      align: 'left',
      weight: 700,
      tracking: 0.08,
    });
  });

  // HITS：kick 往上強調色、snare 往下墨色；每一種一條梳子形折線
  {
    const base = laneY(LANE.HITS);
    const kicks: Point[] = [];
    const snares: Point[] = [];
    for (const hit of drums) {
      if (hit.time > printedTo) break;
      const x = xOf(hit.time);
      if (hit.kind === 'kick')
        kicks.push({ x, y: base }, { x, y: base - amp * hit.velocity }, { x, y: base });
      else if (hit.kind === 'snare')
        snares.push({ x, y: base }, { x, y: base + amp * hit.velocity }, { x, y: base });
    }
    p.noFill();
    p.stroke(theme.mute, hair, 0.8);
    p.line(L.left, base, xOf(printedTo), base);
    if (snares.length > 1) {
      p.stroke(theme.ink, pen * 0.8);
      p.polyline(snares);
    }
    if (kicks.length > 1) {
      p.stroke(theme.accent, pen * 0.8);
      p.polyline(kicks);
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
    const yOf = (midi: number) => laneY(LANE.BASS) + amp - ((midi - lo) / range) * 2 * amp;
    const pts: Point[] = [];
    for (const n of bass) {
      if (n.time > printedTo) break;
      pts.push({ x: xOf(n.time), y: yOf(n.midi) });
      pts.push({ x: xOf(Math.min(printedTo, n.time + n.duration)), y: yOf(n.midi) });
    }
    if (pts.length > 1) {
      p.noFill();
      p.stroke(theme.accent, pen);
      p.polyline(pts);
    }
  }

  // LEVEL / PUNCH / BRIGHT / WIDTH / TENSION：曲線（整首的點快取，每幀只切到 t）
  if (spectrum) {
    const curves = pens(spectrum);
    const order: [Float32Array, number, string][] = [
      [curves.level, LANE.LEVEL, theme.ink],
      [curves.punch, LANE.PUNCH, theme.noteColors[4] ?? theme.ink],
      [curves.bright, LANE.BRIGHT, theme.noteColors[9] ?? theme.ink],
      [curves.width, LANE.WIDTH, theme.noteColors[7] ?? theme.ink],
      [curves.tension, LANE.TENSION, theme.noteColors[11] ?? theme.ink],
    ];
    const pts = curveCache(curves, `${w}x${h}:${gain}:${total}`, () =>
      order.map(([data, lane]) => {
        const out: Point[] = [];
        for (let i = 0; i < data.length; i++)
          out.push({ x: xOf(i / SR), y: laneY(lane) + amp - data[i] * 2 * amp });
        return out;
      }),
    );
    const n = Math.min(curves.level.length, Math.floor(printedTo * SR) + 1);
    p.noFill();
    order.forEach(([, , color], k) => {
      if (n > 1) {
        p.stroke(color, pen);
        p.polyline(pts[k].slice(0, n));
      }
    });
  }

  // NOTES：和弦組成音，12 列一列一個音，點陣；根音強調色
  if (chords) {
    p.noStroke();
    const gap = Math.max(2.5, unit * 0.0055);
    const dot = Math.max(1.5, unit * 0.0036);
    const rowH = (2 * amp) / 11;
    for (const c of chords) {
      if (c.time > printedTo) break;
      const x0 = xOf(c.time);
      const x1 = xOf(Math.min(printedTo, c.time + c.duration));
      for (const pc of c.notes) {
        const y = laneY(LANE.NOTES) + amp - pc * rowH;
        p.fill(pc === c.root ? theme.accent : theme.ink, 0.9);
        for (let x = x0; x <= x1; x += gap) p.circle(x, y, dot);
      }
    }
  }

  // 印字頭
  if (t < total) {
    p.noFill();
    p.stroke(theme.accent, pen * 0.8);
    p.line(xOf(printedTo), L.top, xOf(printedTo), h);
  }

  drawLabel(p, ctx);
}

/** 多筆記錄：八支筆在一張圖上寫整首歌：鼓、bass 音高、音量、低頻衝擊、亮度、寬度、和弦音、張力。 */
export const polygraphLook: Look = {
  id: 'polygraph',
  number: 17,
  name: '多筆記錄',
  listens: ['drums', 'bass', 'spectrum', 'chords', 'tempo'],
  params,
  draw,
};
