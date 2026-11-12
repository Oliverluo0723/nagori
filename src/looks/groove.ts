import { positionAt, secondsToTicks, timeOfBar } from '../analysis/tempo';
import type { DrumHit, TempoMap } from '../analysis/types';
import type { Painter } from './painter/painter';
import { paramNum } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Groove：一小節是一圈的鐘。指針跟著小節相位轉，這一小節的 kick / snare / hat
 * 依它在小節裡的位置落在三圈同心圓上（kick 外圈、snare 中圈、hat 內圈），
 * 上一小節的點淡淡留著，中間是小節數。
 */

const params: ParamDef[] = [{ key: 'size', label: '點大小', min: 0.5, max: 2, default: 1 }];

/** 每種鼓落在第幾圈（半徑比例）。 */
export const RING: Record<DrumHit['kind'], number> = { kick: 1, snare: 0.72, hat: 0.45 };
/** 剛打下的點外面那圈光環的秒數。 */
const FRESH_SECONDS = 0.3;
const HAT_COLOR = 9;
const KINDS: DrumHit['kind'][] = ['kick', 'snare', 'hat'];

function colorOf(ctx: LookContext, kind: DrumHit['kind']): string {
  const { theme } = ctx;
  if (kind === 'kick') return theme.accent;
  if (kind === 'snare') return theme.ink;
  return theme.noteColors[HAT_COLOR] ?? theme.mute;
}

/** t 所在拍號的每小節拍數。 */
export function beatsPerBar(tempo: TempoMap, t: number): number {
  const ticks = secondsToTicks(tempo, t);
  let n = 4;
  for (const sig of tempo.timeSignatures) if (sig.ticks <= ticks) n = sig.numerator;
  return Math.max(1, n);
}

/** 小節相位 0..1 → 角度（12 點鐘起、順時針；Painter 的 0 在 3 點鐘）。 */
export function angleOf(phase: number): number {
  return -Math.PI / 2 + phase * Math.PI * 2;
}

/** 某一小節裡、time <= until 的 hit，附帶它在小節裡的相位。 */
export function barHits(
  drums: DrumHit[],
  tempo: TempoMap,
  bar: number,
  until: number,
): { hit: DrumHit; phase: number }[] {
  const start = timeOfBar(tempo, bar);
  const end = timeOfBar(tempo, bar + 1);
  const span = end - start;
  const out: { hit: DrumHit; phase: number }[] = [];
  if (!(span > 0)) return out;
  for (const hit of drums) {
    if (hit.time < start) continue;
    if (hit.time >= end || hit.time > until) break;
    out.push({ hit, phase: (hit.time - start) / span });
  }
  return out;
}

function dotSize(kind: DrumHit['kind'], velocity: number): number {
  const v = Math.max(0, Math.min(1, velocity));
  if (kind === 'kick') return 0.05 + 0.035 * v;
  if (kind === 'snare') return 0.036 + 0.024 * v;
  return 0.026 + 0.016 * v;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { drums, tempo } = ctx.readings;
  const size = paramNum(ctx, params, 'size');
  const unit = Math.min(w, h);
  // 高的框：鐘往上放，下面留給最近幾小節的節奏條
  const tall = h > w * 1.3;
  const R = unit * 0.37;
  const cx = w / 2;
  const cy = tall ? Math.max(R * 1.55, h * 0.36) : h / 2;
  const pos = positionAt(tempo, t);
  const beats = beatsPerBar(tempo, t);
  const at = (phase: number, r: number) => ({
    x: cx + Math.cos(angleOf(phase)) * r,
    y: cy + Math.sin(angleOf(phase)) * r,
  });

  p.background(theme.paper);

  // 三圈軌道
  p.noFill();
  p.stroke(theme.line, unit * 0.0016);
  for (const kind of KINDS) p.circle(cx, cy, R * RING[kind] * 2);

  // 十六分音符刻度（拍點除外）與拍號數字
  const steps = beats * 4;
  p.stroke(theme.mute, unit * 0.0016, 0.7);
  for (let k = 0; k < steps; k++) {
    if (k % 4 === 0) continue;
    const a = at(k / steps, R * 1.1);
    const b = at(k / steps, R * 1.13);
    p.line(a.x, a.y, b.x, b.y);
  }
  for (let b = 0; b < beats; b++) {
    const now = b + 1 === pos.beat;
    const a = at(b / beats, R * 1.12);
    const c = at(b / beats, R * 1.2);
    p.stroke(now ? theme.accent : theme.mute, unit * 0.002);
    p.line(a.x, a.y, c.x, c.y);
  }
  p.noStroke();
  const numSize = Math.max(9, unit * 0.026);
  for (let b = 0; b < beats; b++) {
    const now = b + 1 === pos.beat;
    const c = at(b / beats, R * 1.29);
    p.fill(now ? theme.accent : theme.mute);
    p.text(String(b + 1), c.x, c.y - numSize * 0.5, {
      size: numSize,
      font: 'mono',
      align: 'center',
      weight: 700,
    });
  }

  // 上一小節：淡淡留著，越往小節尾越淡
  const fade = 0.34 * (1 - 0.5 * pos.barPhase);
  for (const { hit, phase } of barHits(drums, tempo, pos.bar - 1, t)) {
    const c = at(phase, R * RING[hit.kind]);
    p.fill(colorOf(ctx, hit.kind), fade);
    p.circle(c.x, c.y, unit * dotSize(hit.kind, hit.velocity) * size);
  }

  // 這一小節：亮的點；剛打下的外面多一圈光環
  const current = barHits(drums, tempo, pos.bar, t);
  for (const { hit, phase } of current) {
    const c = at(phase, R * RING[hit.kind]);
    const d = unit * dotSize(hit.kind, hit.velocity) * size;
    const color = colorOf(ctx, hit.kind);
    const age = t - hit.time;
    if (age < FRESH_SECONDS) {
      const k = age / FRESH_SECONDS;
      p.noFill();
      p.stroke(color, unit * 0.002, 1 - k);
      p.circle(c.x, c.y, d * (1.6 + 0.8 * k));
      p.noStroke();
      if (theme.glow) p.glow(color, unit * 0.03);
    }
    p.fill(color);
    p.circle(c.x, c.y, d);
    if (age < FRESH_SECONDS && theme.glow) p.noGlow();
  }

  // 指針
  const hand0 = at(pos.barPhase, R * 0.22);
  const hand1 = at(pos.barPhase, R * 1.12);
  p.noFill();
  p.stroke(theme.ink, unit * 0.003);
  p.line(hand0.x, hand0.y, hand1.x, hand1.y);

  // 中間的小節數
  p.noStroke();
  p.fill(theme.ink);
  const big = R * 0.3;
  p.text(String(Math.max(0, pos.bar)), cx, cy - big * 0.5, {
    size: big,
    font: 'sans',
    align: 'center',
    weight: 700,
    tracking: -0.04,
  });

  if (tall) drawHistory(p, ctx, pos.bar, cy + R * 1.5, size);

  // 左上圖例
  const ls = Math.max(9, unit * 0.022);
  KINDS.forEach((kind, i) => {
    const y = ls * 0.4 + i * ls * 1.7;
    p.fill(colorOf(ctx, kind));
    p.rect(0, y, ls, ls);
    p.fill(theme.mute);
    p.text(kind.toUpperCase(), ls * 1.8, y, { size: ls, font: 'mono', align: 'left', weight: 700 });
  });
}

/** 鐘下面：最近幾小節一列一條，kick / snare / hat 三條線上的點，最新的在上面。 */
function drawHistory(p: Painter, ctx: LookContext, bar: number, top: number, size: number): void {
  const { w, h, t, theme } = ctx;
  const { drums, tempo } = ctx.readings;
  const unit = Math.min(w, h);
  const avail = h - top;
  const rows = Math.min(8, Math.floor(avail / (unit * 0.075)));
  if (rows < 1) return;
  const rowH = avail / rows;
  const x0 = unit * 0.1;
  const x1 = w;
  const lane: Record<DrumHit['kind'], number> = { kick: 0.28, snare: 0.5, hat: 0.72 };
  const ls = Math.max(8, unit * 0.018);
  for (let r = 0; r < rows; r++) {
    const b = bar - r;
    if (b < 1) break;
    const y = top + r * rowH;
    const alpha = 1 - (r / rows) * 0.75;
    const beats = beatsPerBar(tempo, timeOfBar(tempo, b));
    p.noFill();
    p.stroke(theme.line, unit * 0.0012);
    p.line(x0, y + rowH * 0.5, x1, y + rowH * 0.5);
    for (let k = 0; k <= beats; k++) {
      const x = x0 + ((x1 - x0) * k) / beats;
      p.line(x, y + rowH * 0.18, x, y + rowH * 0.82);
    }
    if (r === 0) {
      const x = x0 + (x1 - x0) * positionAt(tempo, t).barPhase;
      p.stroke(theme.ink, unit * 0.002);
      p.line(x, y + rowH * 0.1, x, y + rowH * 0.9);
    }
    p.noStroke();
    p.fill(r === 0 ? theme.ink : theme.mute, alpha);
    p.text(String(b), 0, y + rowH * 0.5 - ls * 0.5, { size: ls, font: 'mono', align: 'left' });
    for (const { hit, phase } of barHits(drums, tempo, b, t)) {
      p.fill(colorOf(ctx, hit.kind), alpha);
      p.circle(
        x0 + (x1 - x0) * phase,
        y + rowH * lane[hit.kind],
        unit * dotSize(hit.kind, hit.velocity) * size * 0.4,
      );
    }
  }
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings: r } = ctx;
  const pos = positionAt(r.tempo, t);
  let kicks = 0;
  let snares = 0;
  for (const { hit } of barHits(r.drums, r.tempo, pos.bar, t)) {
    if (hit.kind === 'kick') kicks++;
    else if (hit.kind === 'snare') snares++;
  }
  return [
    { label: 'TEMPO', value: `≈${Math.round(pos.bpm)} BPM` },
    { label: 'BAR', value: `${Math.max(0, pos.bar)}.${pos.beat}` },
    { label: 'KICKS', value: String(kicks) },
    { label: 'SNARES', value: String(snares) },
  ];
}

/** 節拍鐘：kick、snare、hat 排在一小節一圈的鐘面上。 */
export const grooveLook: Look = {
  id: 'groove',
  number: 30,
  name: '節拍鐘',
  listens: ['drums', 'tempo'],
  params,
  draw,
  readouts,
};
