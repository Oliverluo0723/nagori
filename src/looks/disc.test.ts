import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow } from '../compose/themes';
import { discLook } from './disc';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

type Pt = { x: number; y: number };
const W = 1080;
const H = 1920;
const radius = (pt: Pt) => Math.hypot(pt.x - W / 2, pt.y - H / 2);
const groove = (p: RecordingPainter) => opsOf(p, 'polyline').flatMap((o) => o.args[0] as Pt[]);

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  discLook.draw(a, makeCtx(20, { spectrum: flatSpectrum(60, 0.5) }));
  discLook.draw(b, makeCtx(20, { spectrum: flatSpectrum(60, 0.5) }));
  expect(a.ops).toEqual(b.ops);
});

test('the groove spirals outward and, fully printed, reaches the edge of the cell', () => {
  const p = new RecordingPainter();
  discLook.draw(p, makeCtx(60, {}));
  const pts = groove(p);
  expect(pts.length).toBeGreaterThan(5000);
  // 每 500 點取一次半徑，越來越大
  for (let i = 500; i < pts.length; i += 500)
    expect(radius(pts[i])).toBeGreaterThan(radius(pts[i - 500]));
  expect(radius(pts[pts.length - 1])).toBeGreaterThan(W * 0.46);
});

test('only up to t is printed; unprinted turns are faint rings; the last beats are accent', () => {
  const p = new RecordingPainter();
  discLook.draw(p, makeCtx(20, { spectrum: flatSpectrum(60, 0.5) }));
  const outer = Math.max(...groove(p).map(radius));
  expect(outer).toBeLessThan(W * 0.4);
  // 中心環 + 未印的同心圓 + 筆頭兩個圓
  expect(opsOf(p, 'circle').length).toBeGreaterThan(10);
  const strokes = opsOf(p, 'stroke').map((o) => o.args[0]);
  expect(strokes).toContain(darkGlow.accent);
});

test('loud passages wiggle wider than silence', () => {
  // 前 30 秒靜音、後 30 秒滿
  const spectrum = spectrumWith(60, (_b, f) => (f >= 300 ? 1 : 0), { fps: 10, bins: 16 });
  const p = new RecordingPainter();
  discLook.draw(p, makeCtx(60, { spectrum }));
  const pts = groove(p);
  const wiggle = (from: number) => {
    let sum = 0;
    for (let i = from + 1; i < from + 200; i++)
      sum += Math.abs(radius(pts[i]) - radius(pts[i - 1]));
    return sum;
  };
  expect(wiggle(Math.floor(pts.length * 0.8))).toBeGreaterThan(
    wiggle(Math.floor(pts.length * 0.2)) * 5,
  );
});

test('registry exposes disc as number 12', () => {
  expect(looks.disc).toBe(discLook);
  expect(discLook).toMatchObject({ id: 'disc', number: 12 });
});
