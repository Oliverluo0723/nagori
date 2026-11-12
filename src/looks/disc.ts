import type { Painter } from './painter/painter';
import { drawLabel, energySeries, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'turns', label: '圈數', min: 6, max: 30, default: 14 },
  { key: 'gain', label: '抖動', min: 0.5, max: 4, default: 2.5 },
];

const R_MIN = 0.06;
const R_MAX = 0.42;
const STEP = 0.002; // 取樣弧長（短邊倍數）
const WAVELENGTH = 0.008; // 溝槽抖動波長（短邊倍數）

interface Pt {
  x: number;
  y: number;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, spectrum, duration } = ctx.readings;
  const turns = Math.max(1, paramNum(ctx, params, 'turns'));
  const gain = paramNum(ctx, params, 'gain');
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  const rMin = unit * R_MIN;
  const rMax = unit * R_MAX;
  const total = duration > 0 ? duration : 1;

  p.background(theme.paper);

  // 中心十字
  p.noFill();
  p.stroke(theme.line, h * 0.0008);
  p.circle(cx, cy, rMin * 0.8);
  p.line(cx - rMin * 0.2, cy, cx + rMin * 0.2, cy);
  p.line(cx, cy - rMin * 0.2, cx, cy + rMin * 0.2);

  if (spectrum) {
    // 螺旋 r(θ) = rMin + kθ；弧長 s(θ) ≈ rMin θ + kθ²/2；時間與弧長成正比。
    const thetaMax = Math.PI * 2 * turns;
    const k = (rMax - rMin) / thetaMax;
    const totalLength = rMin * thetaMax + (k * thetaMax * thetaMax) / 2;
    const thetaOf = (s: number) => (-rMin + Math.sqrt(rMin * rMin + 2 * k * s)) / k;
    const energy = energySeries(spectrum);
    const amp = ((rMax - rMin) / turns) * 0.45;
    const step = unit * STEP;
    const wavelength = unit * WAVELENGTH;
    const printedTo = Math.min(t, total);
    const sEnd = (printedTo / total) * totalLength;
    const sAccent = (Math.max(0, printedTo - printedBeat(tempo, t)) / total) * totalLength;

    const ink: Pt[] = [];
    const accent: Pt[] = [];
    for (let s = 0; s <= sEnd; s += step) {
      const theta = thetaOf(s);
      const r = rMin + k * theta;
      const time = (s / totalLength) * total;
      const frame = Math.min(energy.length - 1, Math.floor(time * spectrum.fps));
      const e = Math.min(1, (energy[frame] ?? 0) * gain);
      const offset = e * amp * Math.sin((2 * Math.PI * s) / wavelength);
      const pt = { x: cx + Math.cos(theta) * (r + offset), y: cy + Math.sin(theta) * (r + offset) };
      if (s < sAccent) ink.push(pt);
      else {
        if (accent.length === 0 && ink.length > 0) accent.push(ink[ink.length - 1]);
        accent.push(pt);
      }
    }
    p.noFill();
    if (ink.length > 1) {
      p.stroke(theme.ink, h * 0.0007);
      p.polyline(ink);
    }
    if (accent.length > 1) {
      if (theme.glow) p.glow(theme.accent, h * 0.004);
      p.stroke(theme.accent, h * 0.0009);
      p.polyline(accent);
      if (theme.glow) p.noGlow();
    }
  }

  drawLabel(p, ctx);
}

/** 唱片溝槽：從中心往外的螺旋，時間對應弧長，溝槽的抖動是那一刻的能量。 */
export const discLook: Look = {
  id: 'disc',
  number: 12,
  name: '唱片溝槽',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};
