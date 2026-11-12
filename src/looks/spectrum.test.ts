import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import type { Spectrum } from '../analysis/types';
import { RecordingPainter } from './painter/recording';
import { plotFrame, slopeDbPerOct, spectrumLook, toDb } from './spectrum';

const W = 1080;
const H = 1920;
const F = plotFrame(W, H);
const ACCENT = '#ff4a1c';

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
const ctx = (t: number, s?: Spectrum) => makeCtx(t, { spectrum: s }, { w: W, h: H });
const yOfDb = (db: number) => F.y1 - Math.max(0, Math.min(1, (db + 72) / 72)) * (F.y1 - F.y0);
const barX = (bin: number) => F.x0 + (bin + 0.5) * ((F.x1 - F.x0) / 64);
/** 每個 rect 前面最近一次 fill 的顏色 */
function rectsWithFill(p: RecordingPainter) {
  let fill = '';
  const out: { args: number[]; fill: string }[] = [];
  for (const o of p.ops) {
    if (o.op === 'fill') fill = o.args[0] as string;
    if (o.op === 'noFill') fill = '';
    if (o.op === 'rect') out.push({ args: o.args as number[], fill });
  }
  return out;
}

test('deterministic: same context gives identical ops', () => {
  const s = spectrum([row(10, 1)]);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  spectrumLook.draw(a, ctx(0, s));
  spectrumLook.draw(b, ctx(0, s));
  expect(a.ops).toEqual(b.ops);
});

test('the loudest band is a full-height accent bar at its bin, on a dB scale (0 dB at the top)', () => {
  const p = new RecordingPainter();
  spectrumLook.draw(p, ctx(0, spectrum([row(10, 1)])));
  const body = rectsWithFill(p).find((r) => r.fill === ACCENT && r.args[3] > H * 0.1);
  expect(body).toBeDefined();
  const [x, y, w, h] = body?.args ?? [];
  expect(y).toBeCloseTo(yOfDb(0), 4);
  expect(y + h).toBeCloseTo(F.y1, 4);
  expect(x + w / 2).toBeCloseTo(barX(10), 6);
});

test('bars fill the plot width: one bar per bin across the whole box', () => {
  const p = new RecordingPainter();
  spectrumLook.draw(p, ctx(0, spectrum([new Array(64).fill(0.5)])));
  const bodies = rectsWithFill(p).filter((r) => r.fill !== '' && r.args[3] > H * 0.05);
  expect(bodies).toHaveLength(64);
  expect(bodies[0].args[0]).toBeLessThan(W * 0.02);
  const last = bodies[63].args;
  expect(last[0] + last[2]).toBeGreaterThan(F.x1 - (F.x1 - F.x0) / 64);
});

test('peak marker holds the earlier maximum (holdSeconds default 1 s)', () => {
  const p = new RecordingPainter();
  spectrumLook.draw(p, ctx(0.02, spectrum([row(3, 0.8), row(3, 0.2)])));
  const peaks = rectsWithFill(p).filter((r) => r.fill === ACCENT && r.args[3] < H * 0.01);
  const want = yOfDb(toDb(0.8));
  expect(peaks.some((r) => Math.abs(r.args[1] + r.args[3] - want) < 2)).toBe(true);
});

test('dB ticks −18 / −36 / −54 and Hz labels are drawn even without a spectrum', () => {
  const p = new RecordingPainter();
  spectrumLook.draw(p, ctx(1));
  const texts = opsOf(p, 'text').map((o) => o.args[0]);
  for (const s of ['−18', '−36', '−54', '1k', 'Hz']) expect(texts).toContain(s);
  expect(opsOf(p, 'rect')).toHaveLength(1); // 只有圖框
});

test('slope is the dB-per-octave fit; readouts name the peak band and its level', () => {
  // 每個 bin 都是同一個值 → 斜率 0
  const flat = spectrum([new Array(64).fill(0.5)]);
  expect(slopeDbPerOct(flat, 0)).toBeCloseTo(0, 6);
  const r = spectrumLook.readouts?.(ctx(0, spectrum([row(10, 0.8)])));
  expect(r?.map((c) => c.label)).toEqual(['PEAK BAND', 'LEVEL', 'SLOPE', 'BANDS']);
  expect(r?.[1].value).toBe('-18.0 dB');
  expect(r?.[3].value).toBe('64 · log');
});

test('t past the last frame still draws', () => {
  const p = new RecordingPainter();
  expect(() => spectrumLook.draw(p, ctx(999, spectrum([row(5, 0.5)])))).not.toThrow();
  expect(opsOf(p, 'rect').length).toBeGreaterThan(1);
});
