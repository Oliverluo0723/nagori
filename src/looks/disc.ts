import type { Readings } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { drawLabel, energySeries, paramNum } from './sheet';
import {
  accentWindow,
  drumEnvelope,
  envAt,
  geometryCache,
  penCursor,
  quantile,
  seriesAt,
  stretch,
  wiggle,
} from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'turns', label: '圈數', min: 8, max: 40, default: 24 },
  { key: 'gain', label: '抖動', min: 0.5, max: 2, default: 1 },
];

const R_MIN = 0.1; // 短邊倍數
const R_MAX = 0.49;
const STEP = 0.0032; // 取樣弧長（短邊倍數）

interface Groove {
  pts: Point[];
  /** 第 i 個點的時間（秒）。 */
  times: Float32Array;
}

const grooveCache = geometryCache<Readings, Groove>();

/**
 * 整條溝槽（整首歌）的點：r(θ) = rMin + kθ，時間與弧長成正比。
 * 溝槽一上一下的抖動振幅 = 整首歌拉開後的音量 ×（鼓包絡帶來的起伏），安靜的地方是一條平滑的線。
 */
function buildGroove(ctx: LookContext, turns: number, gain: number): Groove {
  const { w, h } = ctx;
  const { spectrum, drums, duration } = ctx.readings;
  const total = duration > 0 ? duration : 1;
  const unit = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const rMin = unit * R_MIN;
  const rMax = unit * R_MAX;
  const thetaMax = Math.PI * 2 * turns;
  const k = (rMax - rMin) / thetaMax;
  const length = rMin * thetaMax + (k * thetaMax * thetaMax) / 2;
  const thetaOf = (s: number) => (-rMin + Math.sqrt(rMin * rMin + 2 * k * s)) / k;
  const pitch = (rMax - rMin) / turns;
  const amp = pitch * 0.5;
  const step = Math.max(1.5, unit * STEP);
  const n = Math.max(2, Math.floor(length / step));
  const energy = spectrum ? energySeries(spectrum) : null;
  const lo = energy ? quantile(energy, 0.1) : 0;
  const hi = energy ? quantile(energy, 0.98) : 1;
  const env = drumEnvelope(drums, total);
  const pts: Point[] = new Array(n + 1);
  const times = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const s = (length * i) / n;
    const theta = thetaOf(s);
    // 從 12 點鐘方向開始、順時針
    const a = theta - Math.PI / 2;
    const time = (total * i) / n;
    const level = energy && spectrum ? stretch(seriesAt(energy, spectrum.fps, time), lo, hi) : 0;
    const drum = Math.min(1, envAt(env, time));
    const e = Math.min(1, level ** 0.9 * (0.55 + 0.6 * Math.sqrt(drum)) * gain);
    const r = rMin + k * theta + wiggle(i) * (0.04 + 0.96 * e) * amp;
    pts[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    times[i] = time;
  }
  return { pts, times };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, duration } = ctx.readings;
  const turns = Math.max(1, Math.round(paramNum(ctx, params, 'turns')));
  const gain = paramNum(ctx, params, 'gain');
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  const rMin = unit * R_MIN;
  const rMax = unit * R_MAX;
  const total = duration > 0 ? duration : 1;
  const printedTo = Math.min(Math.max(0, t), total);
  const weight = Math.max(0.7, unit * 0.0012);

  p.background(theme.paper);

  // 中心標記
  p.noFill();
  p.stroke(theme.mute, Math.max(0.6, unit * 0.0009), 0.7);
  p.circle(cx, cy, rMin * 0.7);
  p.line(cx - rMin * 0.14, cy, cx + rMin * 0.14, cy);
  p.line(cx, cy - rMin * 0.14, cx, cy + rMin * 0.14);

  const g = grooveCache(ctx.readings, `${w}x${h}:${turns}:${gain}`, () =>
    buildGroove(ctx, turns, gain),
  );
  const n = g.pts.length - 1;
  const head = Math.min(n, Math.floor((printedTo / total) * n));
  const accentFrom = Math.max(0, Math.floor(((printedTo - accentWindow(tempo, t)) / total) * n));

  // 還沒印到的圈：淡淡的同心圓，唱片一開始就是整張
  const done = printedTo / total;
  p.noFill();
  p.stroke(theme.line, Math.max(0.6, unit * 0.0008), 0.8);
  for (let i = Math.ceil(done * turns); i <= turns; i++) {
    const r = rMin + ((rMax - rMin) * i) / turns;
    p.circle(cx, cy, r * 2);
  }

  p.stroke(theme.ink, weight);
  if (accentFrom > 1) p.polyline(g.pts.slice(0, accentFrom + 1));
  if (head > accentFrom) {
    if (theme.glow) p.glow(theme.accent, unit * 0.004);
    p.stroke(theme.accent, weight * 1.2);
    p.polyline(g.pts.slice(accentFrom, head + 1));
    if (theme.glow) p.noGlow();
  }

  if (t < total) {
    // 筆頭與一條往外的淡徑向線
    const pt = g.pts[head];
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    p.stroke(theme.mute, Math.max(0.6, unit * 0.0008), 0.6);
    p.line(
      pt.x,
      pt.y,
      cx + (dx / len) * (rMax + unit * 0.02),
      cy + (dy / len) * (rMax + unit * 0.02),
    );
    penCursor(p, ctx, pt.x, pt.y);
  }

  drawLabel(p, ctx);
}

/** 唱片溝槽：一條從中心往外的螺旋，時間對應弧長，溝槽的抖動是那一刻的音量與鼓。 */
export const discLook: Look = {
  id: 'disc',
  number: 12,
  name: '唱片溝槽',
  listens: ['spectrum', 'drums', 'tempo'],
  params,
  draw,
};
