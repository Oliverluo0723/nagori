import { positionAt } from '../analysis/tempo';
import type { DrumKind } from '../analysis/types';
import { noteColor } from './music';
import type { Painter, Point } from './painter/painter';
import { paramNum, rngFor, softDot } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'segments', label: '鏡射份數', min: 3, max: 12, default: 6 },
  { key: 'life', label: '壽命秒數', min: 0.5, max: 4, default: 2.4 },
  { key: 'spin', label: '旋轉速度', min: 0, max: 1, default: 0.15 },
];

const PER_HIT: Record<DrumKind, number> = { kick: 6, snare: 4, hat: 3 };
/** 飛多遠（以中心到角落的距離為 1） */
const REACH: Record<DrumKind, number> = { kick: 0.95, snare: 0.7, hat: 0.45 };
/** 往外擴的拍子環活幾拍 */
const RING_BEATS = 6;

function chordAt(ctx: LookContext): { root: number; name: string } | null {
  for (const c of ctx.readings.chords ?? []) {
    if (c.time > ctx.t) break;
    if (ctx.t < c.time + c.duration) return { root: c.root, name: c.name };
  }
  return null;
}

/** 最近一個 kick 的餘震 0..1（0.5 秒內衰減）。 */
function kickPulse(ctx: LookContext): number {
  let pulse = 0;
  for (const hit of ctx.readings.drums) {
    if (hit.time > ctx.t) break;
    if (hit.kind === 'kick') pulse = Math.max(0, 1 - (ctx.t - hit.time) / 0.5) * hit.velocity;
  }
  return pulse;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const segments = Math.max(2, Math.round(paramNum(ctx, params, 'segments')));
  const life = paramNum(ctx, params, 'life');
  const spin = paramNum(ctx, params, 'spin');
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  // 花一路開到格子的四角，長格子也鋪滿
  const reach = Math.hypot(w, h) / 2;
  const wedge = (Math.PI * 2) / segments;
  const base = t * spin - Math.PI / 2; // 第一根輻條朝上，整朵慢慢轉
  const chord = chordAt(ctx);
  const tint = chord ? noteColor(theme, chord.root) : theme.accent;
  const snareColor = chord ? tint : theme.ink;
  const pulse = kickPulse(ctx);
  const hair = Math.max(1, unit * 0.0012);

  p.background(theme.paper);

  // 色光：中心一團和弦色，每片花瓣方向一團強調色，kick 時亮一下
  p.blend(theme.glow ? 'add' : 'multiply');
  const glowA = theme.glow ? 1 : 0.55;
  p.haze(cx, cy, unit * (0.55 + 0.1 * pulse), tint, (0.22 + 0.18 * pulse) * glowA);
  for (let m = 0; m < segments; m++) {
    const a = base + m * wedge + wedge / 2;
    const r = reach * 0.42;
    p.haze(
      cx + Math.cos(a) * r,
      cy + Math.sin(a) * r,
      unit * 0.32,
      m % 2 ? tint : theme.accent,
      (0.09 + 0.08 * pulse) * glowA,
    );
  }
  p.haze(cx, cy, reach, tint, 0.06 * glowA);
  p.blend('normal');

  // 鏡面：每根輻條一條細線
  p.noFill();
  p.stroke(theme.ink, hair, theme.glow ? 0.14 : 0.18);
  for (let m = 0; m < segments * 2; m++) {
    const a = base + (m * wedge) / 2;
    p.line(cx, cy, cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
  }

  // 拍子環：每拍從中心放出一圈，往外擴到角落、越外越淡；第一根輻條上標拍號
  const pos = positionAt(ctx.readings.tempo, t);
  const fs = Math.max(8, unit * 0.016);
  for (let k = 0; k < RING_BEATS; k++) {
    const age = (pos.beatPhase + k) / RING_BEATS;
    const r = reach * (0.06 + 0.94 * age);
    const beatNo = ((((pos.beat - 1 - k) % 4) + 4) % 4) + 1;
    const fade = 1 - age;
    p.noFill();
    p.stroke(beatNo === 1 ? theme.accent : theme.ink, hair * (beatNo === 1 ? 1.6 : 1), fade * 0.4);
    p.circle(cx, cy, r * 2);
    p.noStroke();
    p.fill(theme.mute, fade);
    p.text(String(beatNo), cx + Math.cos(base) * r + fs * 0.5, cy + Math.sin(base) * r, {
      size: fs,
      font: 'mono',
      align: 'left',
    });
  }

  // 粒子：每個 hit 在一片扇形裡飛，鏡射到每一片；kick 拖一小段尾巴
  p.noStroke();
  const drums = ctx.readings.drums;
  for (let i = 0; i < drums.length; i++) {
    const hit = drums[i];
    if (hit.time > t) break;
    const age = t - hit.time;
    if (age > life) continue;
    const rng = rngFor(ctx.seed, i);
    const fade = 1 - age / life;
    const kick = hit.kind === 'kick';
    const color = kick ? theme.accent : hit.kind === 'snare' ? snareColor : theme.mute;
    const size = unit * (kick ? 0.013 : 0.009) * (0.5 + 0.5 * hit.velocity) * (0.6 + 0.4 * fade);
    const n = PER_HIT[hit.kind];
    const ease = (x: number) => 1 - Math.exp(-x * 1.6);
    for (let j = 0; j < n; j++) {
      const a0 = rng() * wedge;
      const v = REACH[hit.kind] * (0.35 + 0.65 * rng()) * (0.6 + 0.4 * hit.velocity);
      const curl = (rng() - 0.5) * 0.6;
      const at = (s: number): [number, number] => {
        const dist = reach * v * ease(s) + unit * 0.03;
        return [dist, curl * ease(s)];
      };
      const [dist, bend] = at(age);
      const [tailDist, tailBend] = kick ? at(Math.max(0, age - 0.12)) : [dist, bend];
      for (let m = 0; m < segments; m++) {
        for (const mirror of [1, -1]) {
          const a = base + m * wedge + mirror * (a0 + bend);
          const x = cx + Math.cos(a) * dist;
          const y = cy + Math.sin(a) * dist;
          if (kick && dist - tailDist > 1) {
            const ta = base + m * wedge + mirror * (a0 + tailBend);
            p.stroke(color, size * 0.35, fade * 0.5);
            p.line(cx + Math.cos(ta) * tailDist, cy + Math.sin(ta) * tailDist, x, y);
            p.noStroke();
          }
          softDot(p, theme, x, y, size, color, fade);
        }
      }
    }
  }

  // 中心的花心：2 × 份數個尖角的星形，kick 時撐開
  const star: Point[] = [];
  const core = unit * (0.045 + 0.035 * pulse);
  for (let k = 0; k < segments * 2; k++) {
    const a = base + (k * wedge) / 2;
    const r = k % 2 ? core * 0.45 : core;
    star.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  p.fill(tint, 0.85);
  p.stroke(theme.ink, hair, 0.5);
  p.shape(star);
  p.noStroke();

  // 註記：和弦名在花心旁，鏡射份數寫在第一根輻條的外端
  p.fill(theme.ink, 0.8);
  if (chord) {
    p.text(chord.name, cx + core * 1.3, cy + core * 0.9, {
      size: fs * 1.3,
      font: 'sans',
      align: 'left',
    });
  }
  p.fill(theme.mute);
  const label = `× ${segments} mirror`;
  const lr = Math.min(w, h) * 0.46;
  p.text(label, cx + Math.cos(base + wedge / 2) * lr, cy + Math.sin(base + wedge / 2) * lr, {
    size: fs,
    font: 'mono',
    align: 'center',
  });
}

function readouts(ctx: LookContext): Readout[] {
  const segments = Math.max(2, Math.round(paramNum(ctx, params, 'segments')));
  const life = paramNum(ctx, params, 'life');
  let alive = 0;
  for (const hit of ctx.readings.drums) {
    if (hit.time > ctx.t) break;
    if (ctx.t - hit.time <= life) alive += PER_HIT[hit.kind];
  }
  const pos = positionAt(ctx.readings.tempo, ctx.t);
  return [
    { label: 'MIRRORS', value: `${segments} × 2` },
    { label: 'CHORD', value: chordAt(ctx)?.name ?? '—' },
    { label: 'PETALS', value: String(alive * segments * 2) },
    { label: 'BEAT', value: `${pos.bar}.${pos.beat}` },
  ];
}

/** 萬花筒：每個 hit 的粒子做 N 重鏡射，一路開到格子四角；每拍放出一圈環，kick 強調色、snare 是當下和弦的根音色、hat 灰；整朵花慢慢轉。 */
export const kaleidoLook: Look = {
  id: 'kaleido',
  number: 21,
  name: '萬花筒',
  listens: ['drums', 'chords'],
  params,
  draw,
  readouts,
};
