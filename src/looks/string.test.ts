import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { stringLook } from './string';

type Pt = { x: number; y: number };
const DUST = 110;

const groove: DrumHit[] = [
  { time: 0, kind: 'kick', velocity: 1 },
  { time: 0.25, kind: 'hat', velocity: 0.5 },
  { time: 0.5, kind: 'snare', velocity: 0.9 },
  { time: 1, kind: 'kick', velocity: 1 },
];

test('deterministic for the same seed, different for another seed', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  const c = new RecordingPainter();
  stringLook.draw(a, makeCtx(2, { drums: groove }));
  stringLook.draw(b, makeCtx(2, { drums: groove }));
  stringLook.draw(c, makeCtx(2, { drums: groove }, { seed: 2 }));
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
});

test('hats are not pins; kicks and snares are; the thread joins them in time order', () => {
  const p = new RecordingPainter();
  stringLook.draw(p, makeCtx(2, { drums: groove }));
  // 紙屑 + 3 根釘 + 筆頭兩個圓
  expect(opsOf(p, 'circle')).toHaveLength(DUST + 3 + 2);
  const threads = opsOf(p, 'polyline').map((o) => o.args[0] as Pt[]);
  const pins = opsOf(p, 'circle').slice(DUST, DUST + 3);
  const all = threads.flat();
  expect(all[0]).toMatchObject({ x: pins[0].args[0], y: pins[0].args[1] });
  // 最近兩拍（1 秒）的那段用強調色
  expect(opsOf(p, 'stroke').map((o) => o.args[0])).toContain(darkGlow.accent);
});

test('hits after t are not drawn; empty drums only draws the dust', () => {
  const p = new RecordingPainter();
  stringLook.draw(p, makeCtx(0.6, { drums: groove }));
  expect(opsOf(p, 'circle')).toHaveLength(DUST + 2 + 2);
  const empty = new RecordingPainter();
  stringLook.draw(empty, makeCtx(5, { drums: [] }));
  expect(opsOf(empty, 'circle')).toHaveLength(DUST);
  expect(opsOf(empty, 'polyline')).toHaveLength(0);
});

test('the figure spreads to fill a tall cell and a wide cell alike', () => {
  const hits: DrumHit[] = [];
  for (let i = 0; i < 64; i++)
    hits.push({ time: i * 0.25, kind: i % 2 ? 'snare' : 'kick', velocity: 1 });
  for (const [w, h] of [
    [1080, 1920],
    [960, 480],
  ]) {
    const p = new RecordingPainter();
    stringLook.draw(p, makeCtx(20, { drums: hits }, { w, h }));
    const pins = opsOf(p, 'circle').slice(DUST);
    const xs = pins.map((o) => o.args[0] as number);
    const ys = pins.map((o) => o.args[1] as number);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
    for (const x of xs) expect(x).toBeLessThanOrEqual(w);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(0);
    for (const y of ys) expect(y).toBeLessThanOrEqual(h);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(h * 0.5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(w * 0.5);
  }
});

test('registry exposes string as number 9', () => {
  expect(looks.string).toBe(stringLook);
  expect(stringLook).toMatchObject({ id: 'string', number: 9 });
});
