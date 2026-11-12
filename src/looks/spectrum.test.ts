import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { Readings, Spectrum } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { spectrumLook } from './spectrum';
import type { LookContext } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const W = 1080;
const H = 1920;

function spectrum(frames: number[][]): Spectrum {
  const bins = 64;
  const data = new Float32Array(frames.length * bins);
  frames.forEach((row, f) => {
    row.forEach((v, b) => {
      data[f * bins + b] = v;
    });
  });
  return { fps: 50, bins, minHz: 30, maxHz: 16000, frames: data, frameCount: frames.length };
}
const row = (bin: number, v: number) => {
  const r = new Array(64).fill(0);
  r[bin] = v;
  return r;
};
const ctx = (t: number, s?: Spectrum, params: Record<string, number> = {}): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 60, tempo, drums: [], roles: [], spectrum: s } as Readings,
  theme: darkGlow,
  params,
  seed: 1,
  label: '04 SPECTRUM',
});
const rects = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'rect');
const barX = (bin: number) => W * 0.06 + (bin + 0.5) * ((W * 0.88) / 64);

test('deterministic: same context gives identical ops', () => {
  const s = spectrum([row(10, 1)]);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  spectrumLook.draw(a, ctx(0, s));
  spectrumLook.draw(b, ctx(0, s));
  expect(a.ops).toEqual(b.ops);
});

test('one hot bin draws a full-height bar at that bin', () => {
  const p = new RecordingPainter();
  spectrumLook.draw(p, ctx(0, spectrum([row(10, 1)])));
  const bars = rects(p).filter((o) => (o.args[3] as number) > H * 0.1);
  expect(bars).toHaveLength(1);
  const [x, y, w, h] = bars[0].args as number[];
  expect(h).toBeCloseTo(H * 0.44, 6);
  expect(y).toBeCloseTo(H * 0.72 - H * 0.44, 6);
  expect(x + w / 2).toBeCloseTo(barX(10), 6);
});

test('peak marker holds the earlier maximum (holdSeconds default 1 s)', () => {
  const p = new RecordingPainter();
  const s = spectrum([row(3, 0.8), row(3, 0.2)]);
  spectrumLook.draw(p, ctx(0.02, s)); // 第二幀
  const peak = rects(p).find(
    (o) => (o.args[3] as number) < H * 0.01 && (o.args[1] as number) < H * 0.72 - H * 0.44 * 0.5,
  );
  expect(peak).toBeDefined();
  expect(peak?.args[1]).toBeCloseTo(H * 0.72 - 0.8 * H * 0.44 - H * 0.003, 2); // float32
});

test('without a spectrum: baseline and Hz labels, no bars', () => {
  const p = new RecordingPainter();
  spectrumLook.draw(p, ctx(1));
  expect(rects(p)).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'line')).toBe(true);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '1k')).toBe(true);
});

test('t past the last frame still draws (review focus 3)', () => {
  const p = new RecordingPainter();
  expect(() => spectrumLook.draw(p, ctx(999, spectrum([row(5, 0.5)])))).not.toThrow();
  expect(rects(p).length).toBeGreaterThan(0);
});
