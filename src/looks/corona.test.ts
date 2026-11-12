import { expect, test } from 'vitest';
import { makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow } from '../compose/themes';
import { coronaLook } from './corona';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

type Pt = { x: number; y: number };
const W = 1080;
const H = 1920;
const radius = (pt: Pt) => Math.hypot(pt.x - W / 2, pt.y - H / 2);
/** 音量從 0 爬到 1 的頻譜。 */
const ramp = () => spectrumWith(60, (_b, f) => f / 600, { fps: 10 });

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  coronaLook.draw(a, makeCtx(20, { spectrum: ramp() }));
  coronaLook.draw(b, makeCtx(20, { spectrum: ramp() }));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: outer guide and three inner rings, no rays', () => {
  const p = new RecordingPainter();
  coronaLook.draw(p, makeCtx(10, {}));
  expect(opsOf(p, 'circle')).toHaveLength(4);
  expect(opsOf(p, 'shape')).toHaveLength(0);
});

test('rays fill the ring out to the edge of the cell, but only up to t', () => {
  const p = new RecordingPainter();
  coronaLook.draw(p, makeCtx(30, { spectrum: ramp() }));
  const pts = opsOf(p, 'shape').flatMap((o) => o.args[0] as Pt[]);
  expect(pts.length).toBeGreaterThan(100);
  const rs = pts.map(radius);
  expect(Math.max(...rs)).toBeLessThanOrEqual(W * 0.49 + 1e-6);
  // 只印到半圈：12 點鐘順時針到 6 點鐘，全部在右半邊
  for (const pt of pts) expect(pt.x).toBeGreaterThanOrEqual(W / 2 - 1);
  // 正在印的那根是墨色、有筆頭
  expect(opsOf(p, 'stroke').map((o) => o.args[0])).toContain(darkGlow.ink);
});

test('louder makes longer rays', () => {
  const p = new RecordingPainter();
  coronaLook.draw(p, makeCtx(59.9, { spectrum: ramp() }));
  let fill: unknown;
  let main: Pt[] = [];
  for (const o of p.ops) {
    if (o.op === 'fill') fill = o.args[0];
    if (o.op === 'shape' && fill === darkGlow.accent) main = o.args[0] as Pt[];
  }
  // 每根 4 點：內、外、外、內；取早段與晚段的外點
  const early = radius(main[4 * 10 + 1]);
  const late = radius(main[main.length - 4 * 10 + 1]);
  expect(late).toBeGreaterThan(early + W * 0.1);
});

test('registry exposes corona as number 11', () => {
  expect(looks.corona).toBe(coronaLook);
  expect(coronaLook).toMatchObject({ id: 'corona', number: 11 });
});
