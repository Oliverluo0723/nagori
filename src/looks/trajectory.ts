import type { BassNote, Spectrum } from '../analysis/types';
import { midiName } from './glide';
import type { Painter, Point } from './painter/painter';
import { BANDS7, bandSeries, bassAt, energySeries, meanOver, paramNum, pitchRange } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [{ key: 'window', label: '視窗秒數', min: 4, max: 16, default: 9 }];

/** 每秒取樣數。取樣時間對齊絕對的 1/30 s 格，線不會隨 t 抖。 */
const RATE = 30;
/** 移動平均的半徑（樣本數）：音高 0.3 s、亮度 0.4 s（三角權重），轉彎才圓。 */
const SMOOTH_V = 9;
const SMOOTH_Z = 12;

interface Brightness {
  /** 每幀的頻譜重心（bin 索引 / bins），0..1。 */
  centroid: Float32Array;
  /** 整首歌重心的 5% / 95% 分位數，拿來把深度撐滿。 */
  lo: number;
  hi: number;
}

const brightCache = new WeakMap<Spectrum, Brightness>();

function brightness(s: Spectrum): Brightness {
  const hit = brightCache.get(s);
  if (hit) return hit;
  const centroid = new Float32Array(s.frameCount);
  for (let f = 0; f < s.frameCount; f++) {
    let num = 0;
    let den = 0;
    for (let b = 0; b < s.bins; b++) {
      const v = s.frames[f * s.bins + b];
      num += b * v;
      den += v;
    }
    centroid[f] = den > 0 && s.bins > 1 ? num / den / (s.bins - 1) : 0;
  }
  const sorted = Float32Array.from(centroid).sort();
  const q = (x: number) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))] ?? 0;
  const out = { centroid, lo: q(0.05), hi: q(0.95) };
  brightCache.set(s, out);
  return out;
}

/** t 的亮度，0..1（平滑 0.1 s、以整首歌的範圍正規化）。沒有頻譜回 0.5。 */
export function brightAt(s: Spectrum | undefined, t: number): number {
  if (!s) return 0.5;
  const b = brightness(s);
  const v = meanOver(b.centroid, s.fps, Math.max(0, t - 0.1), t);
  const span = b.hi - b.lo;
  return span > 0 ? Math.max(0, Math.min(1, (v - b.lo) / span)) : 0.5;
}

/** 窗內的 bass 音符起點。 */
export function onsetsIn(bass: BassNote[], from: number, to: number): BassNote[] {
  return bass.filter((n) => n.time > from && n.time <= to);
}

interface Sample {
  time: number;
  /** 0..1：時間、bass 音高、亮度。 */
  u: number;
  v: number;
  z: number;
}

/** 視窗內的取樣：bass 音高與亮度各做一次短的移動平均，線才會像 Oto 一樣圓滑地轉彎。 */
function samples(ctx: LookContext, win: number): Sample[] {
  const { t, readings: r } = ctx;
  const bass = r.bass ?? [];
  const [lo, hi] = pitchRange(bass);
  const first = Math.ceil((t - win) * RATE) - SMOOTH_Z;
  const last = Math.floor(t * RATE);
  const times: number[] = [];
  for (let k = first; k <= last; k++) times.push(k / RATE);
  if (times[times.length - 1] < t) times.push(t);
  const vs = times.map((ts) => {
    const b = bassAt(bass, ts, true) ?? (bass[0] ? { midi: bass[0].midi } : null);
    return b ? (b.midi - lo) / Math.max(1, hi - lo) : 0.5;
  });
  const zs = times.map((ts) => brightAt(r.spectrum, ts));
  const smooth = (a: number[], i: number, r: number) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) {
      const wgt = r + 1 - Math.abs(j - i);
      sum += a[j] * wgt;
      n += wgt;
    }
    return sum / n;
  };
  const out: Sample[] = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i] < t - win) continue;
    out.push({
      time: times[i],
      u: (times[i] - (t - win)) / win,
      v: smooth(vs, i, SMOOTH_V),
      z: smooth(zs, i, SMOOTH_Z),
    });
  }
  return out;
}

/** 軸名字級（相對 min(w, h)）。 */
const LABEL = 0.014;

interface Box {
  x0: number;
  fw: number;
  yTop: number;
  yBot: number;
  dx: number;
  dy: number;
  unit: number;
  stripTop: number;
  stripH: number;
}

/** 線框盒的版面：正面寬 TIME、高 BASS NOTE，深度往右上斜是 BRIGHTNESS。 */
function layout(w: number, h: number): Box {
  const unit = Math.min(w, h);
  // 左邊留給「BASS NOTE」（9 字、等寬字約 0.6 字級、加字距）
  const labelW = LABEL * unit * 0.7 * 9 + unit * 0.02;
  const x0 = Math.max(w * 0.09, labelW);
  const dx = w * 0.22;
  const dy = -Math.min(dx * 0.32, h * 0.08);
  const fw = Math.max(1, w - x0 - dx - w * 0.015);
  const stripH = Math.max(unit * 0.045, h * 0.03);
  const stripTop = h - stripH - h * 0.01;
  const yBot = stripTop - Math.max(unit * 0.012, h * 0.012);
  const yTop = h * 0.02 - dy;
  return { x0, fw, yTop, yBot, dx, dy, unit, stripTop, stripH };
}

function project(b: Box, u: number, v: number, z: number): Point {
  return {
    x: b.x0 + u * b.fw + z * b.dx,
    y: b.yBot - v * (b.yBot - b.yTop) + z * b.dy,
  };
}

function drawBox(p: Painter, ctx: LookContext, b: Box, win: number): void {
  const { theme } = ctx;
  const P = (u: number, v: number, z: number) => project(b, u, v, z);
  const seg = (a: Point, c: Point) => p.line(a.x, a.y, c.x, c.y);
  // 背牆的格線：每秒一條直線、四等分的橫線
  p.stroke(theme.line, b.unit * 0.0012, theme.glow ? 0.9 : 0.8);
  for (let s = 1; s < win; s++) seg(P(s / win, 0, 1), P(s / win, 1, 1));
  for (let k = 1; k < 4; k++) seg(P(0, k / 4, 1), P(1, k / 4, 1));
  // 地板的時間格
  for (let s = 1; s < win; s++) seg(P(s / win, 0, 0), P(s / win, 0, 1));
  // 十二條邊
  p.stroke(theme.mute, b.unit * 0.0014, 0.7);
  for (const z of [0, 1]) {
    seg(P(0, 0, z), P(1, 0, z));
    seg(P(0, 1, z), P(1, 1, z));
    seg(P(0, 0, z), P(0, 1, z));
    seg(P(1, 0, z), P(1, 1, z));
  }
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    seg(P(u, v, 0), P(u, v, 1));
}

/** 盒下的 TIME 色帶：整首歌的能量，一格格對稱排開，現在位置一條 ink 線。 */
function drawStrip(p: Painter, ctx: LookContext, b: Box): void {
  const { theme, t, readings: r } = ctx;
  const left = b.x0 + b.fw * 0.04;
  const right = b.x0 + b.fw + b.dx * 0.85;
  const width = right - left;
  const px = Math.max(2, b.unit * 0.0075);
  const cols = Math.max(1, Math.floor(width / px));
  const half = 3;
  const cy = b.stripTop + b.stripH / 2;
  const ph = b.stripH / (half * 2);
  const color = theme.noteColors[11] ?? theme.accent;
  const s = r.spectrum;
  if (s && r.duration > 0) {
    const energy = energySeries(s);
    const bands = [BANDS7[1], BANDS7[3], BANDS7[5]].map((x) => bandSeries(s, x.lo, x.hi));
    const col = new Float32Array(cols);
    for (let c = 0; c < cols; c++)
      col[c] = meanOver(energy, s.fps, (c / cols) * r.duration, ((c + 1) / cols) * r.duration);
    const sorted = Float32Array.from(col).sort();
    const lo = sorted[Math.floor(cols * 0.05)];
    const hi = sorted[Math.min(cols - 1, Math.floor(cols * 0.97))];
    p.noStroke();
    for (let c = 0; c < cols; c++) {
      const a = (c / cols) * r.duration;
      const z = ((c + 1) / cols) * r.duration;
      const e = hi > lo ? Math.max(0, Math.min(1, (col[c] - lo) / (hi - lo))) : 1;
      const on = Math.ceil(e * half);
      for (let k = 0; k < Math.min(half, on); k++) {
        const alpha = 0.25 + 0.6 * Math.min(1, meanOver(bands[k], s.fps, a, z) * 1.4);
        p.fill(color, alpha * (1 - k * 0.18));
        p.rect(left + c * px, cy - (k + 1) * ph, px * 0.86, ph * 0.9);
        p.rect(left + c * px, cy + k * ph, px * 0.86, ph * 0.9);
      }
    }
  }
  const x = left + width * (r.duration > 0 ? Math.min(1, Math.max(0, t / r.duration)) : 0);
  p.stroke(theme.ink, Math.max(1.5, b.unit * 0.003));
  p.line(x, b.stripTop - b.stripH * 0.08, x, b.stripTop + b.stripH * 1.08);
  p.noStroke();
  p.fill(theme.mute);
  p.text('TIME', left + width * 0.32, b.stripTop - b.unit * 0.004, {
    size: b.unit * 0.014,
    font: 'mono',
    align: 'center',
    tracking: 0.12,
  });
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme, readings: r } = ctx;
  const win = Math.max(1, paramNum(ctx, params, 'window'));
  const b = layout(w, h);
  p.background(theme.paper);
  drawBox(p, ctx, b, win);

  const pts = samples(ctx, win);
  const path = pts.map((s) => project(b, s.u, s.v, s.z));
  const shadow = pts.map((s) => project(b, s.u, 0, s.z));
  const onsets = onsetsIn(r.bass ?? [], t - win, t);
  const at = (time: number) => {
    let best = pts[0];
    for (const s of pts) if (Math.abs(s.time - time) < Math.abs(best.time - time)) best = s;
    return best;
  };

  // 地板上的影子與每個音符的落地線
  p.noFill();
  if (shadow.length > 1) {
    p.stroke(theme.mute, b.unit * 0.0016, 0.55);
    p.polyline(shadow);
  }
  p.stroke(theme.mute, b.unit * 0.001, 0.35);
  for (const n of onsets) {
    const s = at(n.time);
    const a = project(b, s.u, s.v, s.z);
    const c = project(b, s.u, 0, s.z);
    p.line(a.x, a.y, c.x, c.y);
  }

  // 路徑：暗底多一層寬而淡的光，再一條發光的主線
  if (path.length > 1) {
    if (theme.glow) {
      p.stroke(theme.accent, b.unit * 0.014, 0.12);
      p.polyline(path);
      p.glow(theme.accent, b.unit * 0.02);
    }
    p.stroke(theme.accent, b.unit * 0.0042);
    p.polyline(path);
    p.noGlow();
  }

  // 音符起點：越新越大
  p.noStroke();
  for (const n of onsets) {
    const s = at(n.time);
    const q = project(b, s.u, s.v, s.z);
    p.fill(theme.accent, 0.55 + 0.45 * s.u);
    p.circle(q.x, q.y, b.unit * (0.007 + 0.007 * s.u));
  }

  // 現在點：實心點加一圈空心環
  const now = path[path.length - 1];
  if (now) {
    p.fill(theme.accent);
    p.circle(now.x, now.y, b.unit * 0.016);
    p.noFill();
    p.stroke(theme.ink, b.unit * 0.0028);
    p.circle(now.x, now.y, b.unit * 0.04);
    p.noStroke();
  }

  // 軸名
  const style = { size: b.unit * LABEL, font: 'mono' as const, tracking: 0.1 };
  p.fill(theme.mute);
  const mid = project(b, 0, 0.5, 0);
  p.text('BASS NOTE', 0, mid.y, { ...style, align: 'left' });
  const br = project(b, 1, 0, 1);
  p.text('BRIGHTNESS', br.x, br.y + b.unit * 0.008, { ...style, align: 'right' });

  drawStrip(p, ctx, b);
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings: r } = ctx;
  const win = Math.max(1, paramNum(ctx, params, 'window'));
  const b = bassAt(r.bass ?? [], t, true);
  return [
    { label: 'WINDOW', value: `${Math.round(win)} s` },
    { label: 'BASS', value: b ? midiName(b.midi) : '—' },
    { label: 'BRIGHT', value: String(Math.round(brightAt(r.spectrum, t) * 100)) },
    { label: 'POINTS', value: String(onsetsIn(r.bass ?? [], t - win, t).length) },
  ];
}

/** 軌跡：時間 × bass 音高 × 亮度的等角線框盒，一條發光的線走過這首歌。 */
export const trajectoryLook: Look = {
  id: 'trajectory',
  number: 28,
  name: '軌跡',
  listens: ['bass', 'spectrum'],
  params,
  draw,
  readouts,
};
