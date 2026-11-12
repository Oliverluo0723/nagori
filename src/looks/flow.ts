import type { Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { mulberry32 } from './prng';
import { bandSeries, drawLabel, paramNum, smoothAt } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'lines', label: '流線數', min: 300, max: 3000, default: 1500 },
  { key: 'steps', label: '流線長度', min: 8, max: 60, default: 24 },
  { key: 'drift', label: '漂移強度', min: 0, max: 1, default: 0.5 },
];

/** 漩渦源個數：40 Hz–14 kHz 對數切 11 段，一段一個 */
const SOURCES = 11;
const LO_HZ = 40;
const HI_HZ = 14000;

interface Source {
  x: number;
  y: number;
  spin: number;
}

/** 十一個漩渦源的位置（0..1）與方向：固定種子，跟 t 無關；彼此拉開一點距離。 */
export function sources(seed: number): Source[] {
  const rng = mulberry32(seed);
  const out: Source[] = [];
  for (let i = 0; i < SOURCES; i++) {
    let best = { x: 0.5, y: 0.5 };
    let bestGap = -1;
    // 試幾個候選點，取離已有源最遠的那個
    for (let k = 0; k < 8; k++) {
      const c = { x: 0.1 + 0.8 * rng(), y: 0.08 + 0.84 * rng() };
      let gap = Number.POSITIVE_INFINITY;
      for (const o of out) gap = Math.min(gap, Math.hypot(c.x - o.x, c.y - o.y));
      if (gap > bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    out.push({ ...best, spin: rng() < 0.5 ? -1 : 1 });
  }
  return out;
}

function bandOf(i: number): [number, number] {
  return [LO_HZ * (HI_HZ / LO_HZ) ** (i / SOURCES), LO_HZ * (HI_HZ / LO_HZ) ** ((i + 1) / SOURCES)];
}

const levelCache = new WeakMap<Spectrum, number[]>();

/** 每個頻帶整首歌的平均與第 95 百分位：平均決定漩渦的長期強度，百分位拿來正規化當下能量。 */
function levels(s: Spectrum): number[] {
  const hit = levelCache.get(s);
  if (hit) return hit;
  const out: number[] = [];
  for (let i = 0; i < SOURCES; i++) {
    const [lo, hi] = bandOf(i);
    const sorted = Float32Array.from(bandSeries(s, lo, hi)).sort();
    out.push(Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)] ?? 0));
  }
  levelCache.set(s, out);
  return out;
}

/** 每個源當下的正規化能量（0..1）。 */
function energies(ctx: LookContext): number[] {
  const s = ctx.readings.spectrum;
  if (!s) return new Array(SOURCES).fill(0.4);
  const lv = levels(s);
  return lv.map((l, i) => {
    const [lo, hi] = bandOf(i);
    return Math.min(1, smoothAt(bandSeries(s, lo, hi), s.fps, ctx.t, 0.15) / l);
  });
}

/** 全場漂移的方向（度）：固定種子。 */
function driftDeg(seed: number): number {
  return Math.round(mulberry32(seed ^ 0x6a09e667)() * 360);
}

interface Geometry {
  /** 每條流線的點（px） */
  lines: Point[][];
  /** 每條流線最靠近哪個源（亮度跟著那個源的能量） */
  owner: number[];
}

const geoCache = new Map<string, Geometry>();

/**
 * 流線幾何：場只跟源的位置、方向與固定強度有關，所以整首歌算一次就好（依尺寸與參數快取）。
 * 每幀只換源的大小與流線的亮度。
 */
function geometry(ctx: LookContext): Geometry {
  const { w, h } = ctx;
  // 流線數是以整張直式 plot（約 984×1600）為準；小格子按面積的平方根減量，不然會密成一片白
  const area = Math.min(1, Math.sqrt((w * h) / (984 * 1600)));
  const n = Math.max(1, Math.round(paramNum(ctx, params, 'lines') * Math.max(0.25, area)));
  const steps = Math.max(2, Math.round(paramNum(ctx, params, 'steps')));
  const drift = paramNum(ctx, params, 'drift');
  const key = `${ctx.seed}|${w}|${h}|${n}|${steps}|${drift}`;
  const hit = geoCache.get(key);
  if (hit) return hit;

  const unit = Math.min(w, h);
  const src = sources(ctx.seed).map((s) => ({ x: s.x * w, y: s.y * h, spin: s.spin }));
  const a = (driftDeg(ctx.seed) * Math.PI) / 180;
  const dvx = Math.cos(a) * drift * 0.9;
  const dvy = Math.sin(a) * drift * 0.9;
  const core = (unit * 0.06) ** 2;
  // 場：每個源一個漩渦（強度隨距離 1/d 衰減），加上一個整體漂移
  const field = (x: number, y: number): [number, number] => {
    let vx = dvx;
    let vy = dvy;
    for (const s of src) {
      const dx = x - s.x;
      const dy = y - s.y;
      const d2 = dx * dx + dy * dy + core;
      const k = (s.spin * unit * 0.22) / d2;
      vx += -dy * k;
      vy += dx * k;
    }
    const len = Math.hypot(vx, vy) || 1;
    return [vx / len, vy / len];
  };

  const rng = mulberry32(ctx.seed ^ 0x2545f491);
  const stepLen = unit * 0.006;
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const lines: Point[][] = [];
  const owner: number[] = [];
  const trace = (x0: number, y0: number, dir: number): Point[] => {
    const pts: Point[] = [];
    let x = x0;
    let y = y0;
    for (let k = 0; k < steps; k++) {
      // 兩段 Runge–Kutta 讓彎的地方比較圓
      const [ax, ay] = field(x, y);
      const [bx, by] = field(x + ax * stepLen * 0.5 * dir, y + ay * stepLen * 0.5 * dir);
      x += bx * stepLen * dir;
      y += by * stepLen * dir;
      if (x < 0 || x > w || y < 0 || y > h) break;
      pts.push({ x, y });
    }
    return pts;
  };
  // 起點：格子加抖動，整個框都鋪滿；從起點往前、往後各走 steps 步
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = ((c + rng()) / cols) * w;
      const y0 = ((r + rng()) / rows) * h;
      const back = trace(x0, y0, -1).reverse();
      const fwd = trace(x0, y0, 1);
      const pts = back.concat([{ x: x0, y: y0 }], fwd);
      if (pts.length < 3) continue;
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < src.length; i++) {
        const d = Math.hypot(x0 - src[i].x, y0 - src[i].y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      lines.push(pts);
      owner.push(best);
    }
  }
  const geo = { lines, owner };
  if (geoCache.size > 8) geoCache.clear();
  geoCache.set(key, geo);
  return geo;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, theme } = ctx;
  const unit = Math.min(w, h);
  const src = sources(ctx.seed);
  const energy = energies(ctx);
  const geo = geometry(ctx);

  p.background(theme.paper);
  p.noFill();

  // 流線：極細，依所屬源分組，一組一種亮度（跟著那個源的當下能量）
  const weight = Math.max(0.6, unit * 0.0007);
  for (let g = 0; g < SOURCES; g++) {
    p.stroke(theme.ink, weight, (theme.glow ? 0.16 : 0.2) + 0.3 * energy[g]);
    for (let i = 0; i < geo.lines.length; i++) if (geo.owner[i] === g) p.polyline(geo.lines[i]);
  }

  // 源：空心白圈，蓋住底下的流線；大小是能量
  for (let i = 0; i < SOURCES; i++) {
    const r = unit * (0.022 + 0.04 * energy[i]);
    p.fill(theme.paper);
    p.stroke(theme.ink, Math.max(1.5, unit * 0.0045), 0.92);
    p.circle(src[i].x * w, src[i].y * h, r * 2);
  }
  p.noStroke();

  drawLabel(p, ctx);
}

function readouts(ctx: LookContext): Readout[] {
  const e = energies(ctx);
  let best = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[best]) best = i;
  const swirl = e.reduce((a, b) => a + b, 0) / e.length;
  return [
    { label: 'SOURCES', value: String(SOURCES) },
    { label: 'STRONGEST', value: `band ${best + 1}` },
    { label: 'SWIRL', value: `${Math.round(swirl * 100)} %` },
    { label: 'DRIFT', value: `${driftDeg(ctx.seed)}°` },
  ];
}

/** 流場：十一個頻帶是十一個漩渦源，幾千條細流線鋪滿整面；源的白圈大小與附近流線的亮度跟著頻帶能量。 */
export const flowLook: Look = {
  id: 'flow',
  number: 24,
  name: '流場',
  listens: ['spectrum'],
  params,
  draw,
  readouts,
};
