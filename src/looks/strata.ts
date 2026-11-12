import type { Spectrum } from '../analysis/types';
import { midiName } from './glide';
import type { Painter, Point } from './painter/painter';
import { mulberry32 } from './prng';
import { BANDS7, bandSeries, bassAt, paramNum, rngFor, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'size', label: '大小', min: 0.5, max: 2, default: 1 },
  { key: 'smooth', label: '平滑秒數', min: 0.03, max: 0.6, default: 0.15 },
];

/** 火花留在腳下的秒數 */
const BURST_SECONDS = 1.6;
const SPARKS_PER_KICK = 46;
const CLOUD_SPARKS = 70;
/** 圓盤的透視壓扁比例 */
const SQUASH = 0.42;
/** 線上的順序：高頻在頭、sub 在腳（sub 不畫圓盤，畫成 kick 炸開的火花雲）。 */
const ORDER = [6, 5, 4, 3, 2, 1, 0];
/** 每個位置往側邊偏多少（-1..1），讓線一路蜿蜒。 */
const SWAY = [-0.62, -0.18, 0.1, -0.05, 0.42, -0.35, 0.5];

interface Spot {
  x: number;
  y: number;
}

/** 七個位置：沿長邊從頭排到腳，往短邊左右蜿蜒；固定種子的小抖動，跟 t 無關。索引照 ORDER。 */
export function spots(seed: number, w: number, h: number): Spot[] {
  const rng = mulberry32(seed);
  const tall = h >= w;
  const long = tall ? h : w;
  const short = tall ? w : h;
  return ORDER.map((_, i) => {
    const along = long * (0.1 + (0.8 * i) / (ORDER.length - 1) + (rng() - 0.5) * 0.04);
    const across = short * (0.5 + 0.36 * SWAY[i] + (rng() - 0.5) * 0.08);
    return tall ? { x: across, y: along } : { x: along, y: across };
  });
}

const meanCache = new WeakMap<Float32Array, number>();
function songMean(series: Float32Array): number {
  const hit = meanCache.get(series);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (const v of series) sum += v;
  const m = series.length ? sum / series.length : 0;
  meanCache.set(series, m);
  return m;
}

/** 頻帶「比平常響多少」，0..1：拿整首的平均當基準，高頻才不會永遠是小點。 */
function level(s: Spectrum | undefined, band: number, t: number, smooth: number): number {
  if (!s) return 0;
  const b = BANDS7[band];
  const series = bandSeries(s, b.lo, b.hi);
  const mean = songMean(series);
  if (!(mean > 0)) return 0;
  return Math.min(1, smoothAt(series, s.fps, t, smooth) / (mean * 2.2));
}

/** 原始能量最大的頻帶（讀數用，跟 Oto 一樣多半是 bass 或 mids）。 */
function loudestAt(s: Spectrum, t: number, smooth: number): number {
  let best = 1;
  let bestV = -1;
  for (let i = 0; i < BANDS7.length; i++) {
    const v = smoothAt(bandSeries(s, BANDS7[i].lo, BANDS7[i].hi), s.fps, t, smooth);
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

const turnsCache = new WeakMap<Spectrum, number[]>();
/** 最響的頻帶換手的時刻（每 0.25 秒看一次、0.5 秒平滑），整首算一次。 */
function turnTimes(s: Spectrum): number[] {
  const hit = turnsCache.get(s);
  if (hit) return hit;
  const out: number[] = [];
  const dur = s.frameCount / s.fps;
  let prev = -1;
  for (let time = 0; time < dur; time += 0.25) {
    const b = loudestAt(s, time, 0.5);
    if (prev >= 0 && b !== prev) out.push(time);
    prev = b;
  }
  turnsCache.set(s, out);
  return out;
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** 均勻 Catmull-Rom：穿過每個點的平滑曲線。 */
function spline(points: Point[], per: number): Point[] {
  const out: Point[] = [];
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const u = k / per;
      const u2 = u * u;
      const u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** 橢圓上的一段弧（角度弧度）。 */
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  n = 40,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

function disc(
  p: Painter,
  ctx: LookContext,
  band: number,
  x: number,
  y: number,
  d: number,
  e: number,
  trend: number,
  stroke: number,
): void {
  const { theme } = ctx;
  const b = BANDS7[band];
  const color = theme.noteColors[b.color] ?? theme.ink;
  const core = theme.noteColors[(b.color + 6) % 12] ?? theme.accent;
  const rx = d / 2;
  const ry = rx * SQUASH;
  const rng = rngFor(ctx.seed, 100 + band);
  const tilt = rng() * Math.PI * 2;

  // 外圈：兩段沒接起來的細弧，圓心略偏，像手描的軌道
  p.noFill();
  p.stroke(theme.ink, stroke, theme.glow ? 0.45 : 0.55);
  p.polyline(arc(x - rx * 0.05, y + ry * 0.08, rx * 1.42, ry * 1.55, tilt, tilt + Math.PI * 1.15));
  p.polyline(
    arc(
      x - rx * 0.05,
      y + ry * 0.08,
      rx * 1.42,
      ry * 1.55,
      tilt + Math.PI * 1.3,
      tilt + Math.PI * 1.85,
    ),
  );

  // 光暈（黑底才有，用便宜的 haze 不用 shadowBlur）
  if (theme.glow) {
    p.blend('add');
    p.haze(x, y, rx * 1.25, color, 0.22 + 0.2 * e);
    p.blend('normal');
  }

  // 本體：一層層同心環，像唱片的紋
  p.noStroke();
  p.fill(color, 0.9);
  p.ellipse(x, y, rx * 2, ry * 2);
  for (let k = 1; k <= 5; k++) {
    const s = 1 - k * 0.15;
    p.fill(k % 2 ? theme.paper : theme.ink, theme.glow ? 0.06 : 0.07);
    p.ellipse(x, y, rx * 2 * s, ry * 2 * s);
  }
  p.noFill();
  p.stroke(theme.paper, stroke * 0.7, 0.18);
  for (let k = 1; k <= 3; k++) p.ellipse(x, y, rx * 2 * (1 - k * 0.22), ry * 2 * (1 - k * 0.22));

  // 虛線內圈
  p.stroke(theme.ink, stroke * 0.8, theme.glow ? 0.55 : 0.45);
  const dashes = 30;
  for (let k = 0; k < dashes; k += 1) {
    const a0 = (k / dashes) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / dashes / 2;
    p.line(
      x + Math.cos(a0) * rx * 0.8,
      y + Math.sin(a0) * ry * 0.8,
      x + Math.cos(a1) * rx * 0.8,
      y + Math.sin(a1) * ry * 0.8,
    );
  }

  // 核：對比色的一團，加一個小小的 C 字弧
  p.noStroke();
  p.haze(x, y, ry * 0.75, core, 0.85);
  p.fill(core, 0.9);
  p.ellipse(x, y, rx * 0.16, ry * 0.2);
  p.noFill();
  p.stroke(theme.ink, stroke * 0.9, 0.8);
  p.polyline(arc(x, y, rx * 0.12, ry * 0.3, 0.5, Math.PI * 2 - 0.5, 16));

  // 名字寫在盤面上，旁邊註頻率與音量
  const fs = Math.max(9, rx * 0.17);
  p.noStroke();
  p.fill(theme.ink, 0.85);
  p.text(b.name, x, y + ry * 0.38, { size: fs, font: 'sans', align: 'center' });
  p.fill(theme.mute);
  p.text(
    `${formatHz(b.lo)}–${formatHz(b.hi)} Hz · ${Math.round(e * 99)}`,
    x + rx * 1.02,
    y + ry * 1.25,
    { size: fs * 0.95, font: 'sans', align: 'left' },
  );

  // 漲落的小箭頭：在變響往上、在變小往下
  if (Math.abs(trend) > 0.06) {
    const ax = x - rx * 0.62;
    const ay = y - ry * 0.1;
    const len = ry * 0.9 * Math.sign(-trend);
    p.noFill();
    p.stroke(theme.ink, stroke, 0.7);
    p.line(ax, ay - len / 2, ax, ay + len / 2);
    const head = Math.abs(len) * 0.25;
    const dir = Math.sign(len);
    p.line(ax, ay + len / 2, ax - head * 0.6, ay + len / 2 - dir * head);
    p.line(ax, ay + len / 2, ax + head * 0.6, ay + len / 2 - dir * head);
  }
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const s = ctx.readings.spectrum;
  const size = paramNum(ctx, params, 'size');
  const smooth = paramNum(ctx, params, 'smooth');
  const unit = Math.min(w, h);
  // 圓盤大小跟著短邊，但在扁長的格子裡也不能比盤距大太多（不然疊成一團）
  const spacing = (Math.max(w, h) * 0.8) / (ORDER.length - 1);
  const scale = Math.min(unit, spacing * 4.2);
  const stroke = Math.max(1, unit * 0.0016);
  const base = spots(ctx.seed, w, h);
  // 圓盤在水上慢慢漂
  const places = base.map((q, i) => ({
    x: q.x + Math.sin(t * 0.5 + i * 1.7) * unit * 0.012,
    y: q.y + Math.cos(t * 0.43 + i * 2.3) * unit * 0.01,
  }));
  const levels = ORDER.map((band) => level(s, band, t, smooth));
  const before = ORDER.map((band) => level(s, band, t - 0.5, smooth));

  p.background(theme.paper);

  // 線：從畫面外進來，穿過每個圓盤，在腳下的火花雲收尾
  const first = places[0];
  const second = places[1];
  const lead = { x: first.x - (second.x - first.x) * 0.9, y: first.y - (second.y - first.y) * 0.9 };
  // 兩個圓盤之間加一個往側邊甩的控制點，線才會繞出 Oto 那種大彎
  const knots: Point[] = [lead, places[0]];
  for (let i = 1; i < places.length; i++) {
    const a = places[i - 1];
    const b = places[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const swing =
      (i % 2 ? 1 : -1) * Math.min(len * 0.45, unit * 0.16) * (0.6 + 0.4 * Math.sin(t * 0.3 + i));
    knots.push({
      x: (a.x + b.x) / 2 - (dy / len) * swing,
      y: (a.y + b.y) / 2 + (dx / len) * swing,
    });
    knots.push(b);
  }
  const curve = spline(knots, 14);
  p.noFill();
  p.stroke(theme.accent, stroke * 1.6, 0.85);
  p.polyline(curve);

  for (let i = 0; i < ORDER.length - 1; i++) {
    const band = ORDER[i];
    const e = levels[i];
    const d = scale * (0.15 + 0.27 * e) * size;
    disc(p, ctx, band, places[i].x, places[i].y, d, e, levels[i] - before[i], stroke);
  }

  // 腳下：sub 那層是一團火花雲，最近幾個 kick 從中心炸出細線，尾端一顆點
  const foot = places[ORDER.length - 1];
  const sub = levels[ORDER.length - 1];
  const R = scale * 0.2 * size;
  let heat = 0;
  const drums = ctx.readings.drums;
  const burst: { i: number; age: number; v: number }[] = [];
  for (let i = 0; i < drums.length; i++) {
    const hit = drums[i];
    if (hit.time > t) break;
    if (hit.kind !== 'kick' || t - hit.time > BURST_SECONDS) continue;
    const age = (t - hit.time) / BURST_SECONDS;
    burst.push({ i, age, v: hit.velocity });
    heat = Math.max(heat, (1 - age) * hit.velocity);
  }
  const warm = theme.noteColors[2] ?? theme.accent;
  if (theme.glow) p.blend('add');
  p.haze(foot.x, foot.y, R * (1.3 + 0.5 * heat), warm, (theme.glow ? 0.18 : 0.12) + 0.25 * heat);
  p.haze(foot.x, foot.y, R * 0.45, theme.glow ? theme.ink : warm, 0.25 + 0.5 * Math.max(heat, sub));
  if (theme.glow) p.blend('normal');
  p.noFill();
  p.stroke(theme.ink, stroke, 0.7);
  p.ellipse(foot.x, foot.y, R * 2.3, R * 2.3 * SQUASH * 1.25);

  // 平常就有一團細火花，長短跟著 sub 的能量
  const cloud = rngFor(ctx.seed, 4999);
  const still = 0.35 + 0.65 * Math.max(sub, heat * 0.6);
  for (let k = 0; k < CLOUD_SPARKS; k++) {
    const a = cloud() * Math.PI * 2;
    const len = R * (0.15 + 0.7 * cloud() ** 1.6) * still * (0.9 + 0.1 * Math.sin(t * 3 + k));
    const ex = foot.x + Math.cos(a) * len;
    const ey = foot.y + Math.sin(a) * len * SQUASH * 1.3;
    p.stroke(theme.ink, stroke * 0.5, 0.3);
    p.line(foot.x, foot.y, ex, ey);
    p.noStroke();
    p.fill(theme.ink, 0.75);
    p.circle(ex, ey, stroke * 2.2);
  }

  for (const { i, age, v } of burst) {
    const rng = rngFor(ctx.seed, 5000 + i);
    const n = Math.round(SPARKS_PER_KICK * (0.5 + 0.5 * v));
    const grow = 1 - (1 - Math.min(1, age * 4)) ** 2;
    const alpha = (1 - age) * 0.9;
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const len = R * (0.25 + 0.85 * rng() ** 0.7) * grow;
      const ex = foot.x + Math.cos(a) * len;
      const ey = foot.y + Math.sin(a) * len * SQUASH * 1.3;
      p.stroke(theme.ink, stroke * 0.6, alpha * 0.55);
      p.line(foot.x, foot.y, ex, ey);
      p.noStroke();
      p.fill(theme.ink, alpha);
      p.circle(ex, ey, stroke * 2.6);
    }
  }
  p.noStroke();
  p.fill(theme.mute);
  p.text('hits · sub', foot.x + R * 0.55, foot.y + R * SQUASH * 0.75, {
    size: Math.max(9, unit * 0.017),
    font: 'sans',
    align: 'left',
  });
}

function readouts(ctx: LookContext): Readout[] {
  const s = ctx.readings.spectrum;
  const smooth = paramNum(ctx, params, 'smooth');
  const b = bassAt(ctx.readings.bass ?? [], ctx.t, true);
  let turns = 0;
  if (s) for (const time of turnTimes(s)) if (time <= ctx.t) turns++;
  return [
    { label: 'LOUDEST', value: s ? BANDS7[loudestAt(s, ctx.t, smooth)].name : '—' },
    { label: 'BASS', value: b ? midiName(b.midi) : '—' },
    { label: 'TURNS', value: String(turns) },
  ];
}

/** 地層：六個頻帶是浮在一條紅線上的圓盤（同心紋、虛線內圈、手寫註記），大小隨能量呼吸；kick 在腳下的 sub 炸成火花雲。 */
export const strataLook: Look = {
  id: 'strata',
  number: 16,
  name: '地層',
  listens: ['spectrum', 'drums', 'bass'],
  params,
  draw,
  readouts,
};
