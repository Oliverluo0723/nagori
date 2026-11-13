import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { inkLook, pageAt } from './ink';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

// makeCtx：1080×1920、120 BPM（一小節 2 秒）、60 秒；預設 8 小節一頁 = 16 秒
const hit = (time: number, kind: DrumHit['kind'], velocity = 1): DrumHit => ({
  time,
  kind,
  velocity,
});
const draw = (t: number, drums: DrumHit[], extra = {}) => {
  const p = new RecordingPainter();
  inkLook.draw(p, makeCtx(t, { drums }, extra));
  return p;
};

test('registry exposes ink as number 32', () => {
  expect(looks.ink).toBe(inkLook);
  expect(inkLook).toMatchObject({ id: 'ink', number: 32, name: '墨噴' });
});

test('deterministic for a seed; another seed scatters the hits elsewhere', () => {
  const drums = [hit(1, 'kick'), hit(1.5, 'snare'), hit(2, 'hat')];
  const a = draw(3, drums);
  const b = draw(3, drums);
  const c = draw(3, drums, { seed: 9 });
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
});

test('a kick is a spot with a bright core and 40–70 specks; a snare a hairy ring; a hat a speck', () => {
  const kick = draw(2, [hit(1, 'kick')]);
  expect(opsOf(kick, 'haze')).toHaveLength(2);
  const specks = opsOf(kick, 'circle').length;
  expect(specks).toBeGreaterThanOrEqual(40);
  expect(specks).toBeLessThanOrEqual(70);
  const snare = draw(2, [hit(1, 'snare')]);
  const [ring] = opsOf(snare, 'shape');
  const verts = (ring.args[0] as { x: number }[]).length;
  expect(verts).toBeGreaterThanOrEqual(10);
  expect(verts).toBeLessThanOrEqual(13);
  const hairs = opsOf(snare, 'line').length;
  expect(hairs).toBeGreaterThanOrEqual(5);
  expect(hairs).toBeLessThanOrEqual(9);
  expect(opsOf(snare, 'haze')).toHaveLength(0);
  const hat = draw(2, [hit(1, 'hat')]);
  expect(opsOf(hat, 'circle')).toHaveLength(2); // softDot：光暈 + 核心
  expect(opsOf(hat, 'haze')).toHaveLength(0);
});

test('only this page’s hits up to t are drawn; a new page starts empty', () => {
  // 第 1 頁 0–16 秒、第 2 頁 16–32 秒
  const drums = [hit(1, 'kick'), hit(10, 'kick'), hit(20, 'kick')];
  expect(opsOf(draw(5, drums), 'haze')).toHaveLength(2);
  expect(opsOf(draw(15, drums), 'haze')).toHaveLength(4);
  expect(opsOf(draw(17, drums), 'haze')).toHaveLength(0);
  expect(opsOf(draw(25, drums), 'haze')).toHaveLength(2);
  const page = pageAt(makeCtx(25, { drums }));
  expect(page).toMatchObject({ firstBar: 9, lastBar: 16, from: 2, to: 3 });
  // 一頁 4 小節 = 8 秒
  expect(pageAt(makeCtx(25, { drums }, { params: { bars: 4 } }))).toMatchObject({
    firstBar: 13,
    lastBar: 16,
  });
});

test('a spot grows in over a quarter second and stays whole inside the plot', () => {
  const drums = [hit(1, 'kick')];
  const r = (t: number) => opsOf(draw(t, drums), 'haze')[0].args[2] as number;
  expect(r(1.02)).toBeLessThan(r(1.1));
  expect(r(1.1)).toBeLessThan(r(2));
  expect(r(2)).toBe(r(5));
  // 很多 kick 散落，每顆的圓心離邊至少一個半徑
  const many: DrumHit[] = [];
  for (let i = 0; i < 64; i++) many.push(hit(i * 0.25, 'kick', 1));
  for (const o of opsOf(draw(16, many), 'haze')) {
    const [x, y, radius] = o.args as number[];
    expect(x).toBeGreaterThanOrEqual(radius - 1e-6);
    expect(x).toBeLessThanOrEqual(1080 - radius + 1e-6);
    expect(y).toBeGreaterThanOrEqual(radius - 1e-6);
    expect(y).toBeLessThanOrEqual(1920 - radius + 1e-6);
  }
});

test('paper theme multiplies, has no bright core and never glows; empty drums still draw the paper', () => {
  const p = draw(2, [hit(1, 'kick'), hit(1.5, 'snare')], { theme: paperInk });
  expect(opsOf(p, 'glow')).toHaveLength(0);
  expect(opsOf(p, 'haze')).toHaveLength(1);
  expect(opsOf(p, 'blend').some((o) => o.args[0] === 'multiply')).toBe(true);
  expect(opsOf(p, 'blend').some((o) => o.args[0] === 'add')).toBe(false);
  const empty = draw(2, []);
  expect(empty.ops[0]).toEqual({ op: 'background', args: ['#0f0f0f'] });
  expect(opsOf(empty, 'haze')).toHaveLength(0);
  expect(opsOf(empty, 'circle')).toHaveLength(0);
});

test('readouts: SHEET bars a–b and per-kind counts on this page up to t', () => {
  const drums = [hit(1, 'kick'), hit(1.5, 'snare'), hit(2, 'hat'), hit(3, 'kick'), hit(20, 'kick')];
  expect(inkLook.readouts?.(makeCtx(2.5, { drums }))).toEqual([
    { label: 'SHEET', value: 'bars 1–8' },
    { label: 'SPOTS · KICKS', value: '1' },
    { label: 'RINGS · SNARES', value: '1' },
    { label: 'SPECKS · HATS', value: '1' },
  ]);
  expect(inkLook.readouts?.(makeCtx(21, { drums }))?.[0]).toEqual({
    label: 'SHEET',
    value: 'bars 9–16',
  });
});
