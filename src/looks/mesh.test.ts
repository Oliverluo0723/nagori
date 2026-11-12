import { expect, test } from 'vitest';
import { binHz } from '../analysis/audio/spectrum';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { Readings, Spectrum } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { meshLook } from './mesh';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import type { LookContext } from './types';

const tempo = tempoMapFromBpm(120); // 一拍 0.5 秒
const BINS = 64;

function spectrumWith(seconds: number, fill: (bin: number) => number, fps = 10): Spectrum {
  const frameCount = seconds * fps;
  const frames = new Float32Array(frameCount * BINS);
  for (let f = 0; f < frameCount; f++)
    for (let b = 0; b < BINS; b++) frames[f * BINS + b] = fill(b);
  return { fps, bins: BINS, minHz: 30, maxHz: 16000, frames, frameCount };
}
const ctx = (t: number, s?: Spectrum, theme = darkGlow): LookContext => ({
  t,
  w: 1080,
  h: 1920,
  readings: { duration: 20, tempo, drums: [], roles: [], spectrum: s } as Readings,
  theme,
  params: {},
  seed: 1,
  label: '10 MESH',
});
type Pt = { x: number; y: number };
const polylines = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'polyline');

test('deterministic', () => {
  const s = spectrumWith(20, () => 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  meshLook.draw(a, ctx(4, s));
  meshLook.draw(b, ctx(4, s));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: six lane baselines and label, no polylines', () => {
  const p = new RecordingPainter();
  meshLook.draw(p, ctx(4, undefined, paperInk));
  expect(p.ops.filter((o) => o.op === 'line')).toHaveLength(6);
  expect(polylines(p)).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '10 MESH')).toBe(true);
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
});

test('only the lane whose band has energy opens up; others stay flat', () => {
  const s = spectrumWith(20, (b) => {
    const hz = binHz(
      { fps: 10, bins: BINS, minHz: 30, maxHz: 16000, frames: new Float32Array(), frameCount: 0 },
      b,
    );
    return hz >= 200 && hz <= 500 ? 1 : 0;
  });
  const p = new RecordingPainter();
  meshLook.draw(p, ctx(4, s));
  // 六條泳道各有上下兩條包絡線 = 12 條
  const env = polylines(p);
  expect(env).toHaveLength(12);
  let open = 0;
  for (let lane = 0; lane < 6; lane++) {
    const top = env[lane * 2].args[0] as Pt[];
    const bottom = env[lane * 2 + 1].args[0] as Pt[];
    const gap = Math.max(...top.map((q, i) => bottom[i].y - q.y));
    if (gap > 1) open++;
  }
  expect(open).toBe(1);
});

test('samples stop at t: one point per beat printed so far', () => {
  const s = spectrumWith(20, () => 0.5);
  const p = new RecordingPainter();
  meshLook.draw(p, ctx(4, s));
  const top = polylines(p)[0].args[0] as Pt[];
  // 0.5 秒一拍，t = 4 → 拍 0 … 3.5 共 8 個樣本
  expect(top).toHaveLength(8);
  const colors = p.ops.filter((o) => o.op === 'stroke').map((o) => o.args[0]);
  expect(colors).toContain(darkGlow.accent);
});

test('registry exposes mesh as number 10', () => {
  expect(looks.mesh).toBe(meshLook);
  expect(meshLook).toMatchObject({ id: 'mesh', number: 10, listens: ['spectrum', 'tempo'] });
});
