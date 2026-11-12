import { expect, test } from 'vitest';
import { makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
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

test('the whole figure is faintly on the paper before it is printed', () => {
  const p = new RecordingPainter();
  stringLook.draw(p, makeCtx(0.6, { drums: groove }));
  // 紙屑 + 1 根還沒織到的淡釘 + 2 根已織的釘 + 筆頭
  expect(opsOf(p, 'circle')).toHaveLength(DUST + 1 + 2 + 2);
  // 第一條線是淡的整張圖：從最後一根已織的釘接到還沒織到的釘
  const faint = opsOf(p, 'stroke')[0];
  expect(faint.args[2]).toBeLessThan(0.2);
  const first = opsOf(p, 'polyline')[0].args[0] as Pt[];
  expect(first).toHaveLength(2);
  // 筆頭在兩根釘之間（不是停在釘上）
  const pen = opsOf(p, 'circle').at(-1);
  const [a, b] = first;
  expect(pen?.args[0]).not.toBe(a.x);
  expect(Math.min(a.x, b.x) <= (pen?.args[0] as number)).toBe(true);
  expect((pen?.args[0] as number) <= Math.max(a.x, b.x)).toBe(true);
});

test('empty drums only draws the dust', () => {
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

test('a repeated section returns to the same region of the sheet', () => {
  // A(亮) B(暗) A(亮) 各 20 秒；kick 每 0.5 秒
  const dark = (bin: number) => (bin < 6 ? 0.8 : 0.05);
  const bright = (bin: number) => (bin < 6 ? 0.2 : 0.7);
  const s = spectrumWith(60, (bin, f) => (f >= 200 && f < 400 ? dark(bin) : bright(bin)));
  const hits: DrumHit[] = [];
  for (let i = 0; i < 120; i++) hits.push({ time: i * 0.5, kind: 'kick', velocity: 1 });
  const p = new RecordingPainter();
  stringLook.draw(p, makeCtx(60, { drums: hits, spectrum: s, duration: 60 }));
  const pins = opsOf(p, 'circle')
    .slice(DUST, DUST + 120)
    .map((o) => ({ x: o.args[0] as number, y: o.args[1] as number }));
  // 各段中間 10 秒（避開段落視窗跨界）的重心
  const mean = (from: number, to: number) => {
    const part = pins.slice(from * 2, to * 2);
    return {
      x: part.reduce((a, q) => a + q.x, 0) / part.length,
      y: part.reduce((a, q) => a + q.y, 0) / part.length,
    };
  };
  const a1 = mean(5, 15);
  const b = mean(25, 35);
  const a2 = mean(45, 55);
  const d = (u: Pt, v: Pt) => Math.hypot(u.x - v.x, u.y - v.y);
  expect(d(a1, a2)).toBeLessThan(d(a1, b) * 0.35);
});

test('registry exposes string as number 9', () => {
  expect(looks.string).toBe(stringLook);
  expect(stringLook).toMatchObject({ id: 'string', number: 9 });
});
