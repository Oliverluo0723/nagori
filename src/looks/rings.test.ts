import { expect, test } from 'vitest';
import { hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { ringRadius, ringsLayout, ringsLook } from './rings';

// makeCtx：120 BPM（一小節 2 秒）、60 秒 = 30 小節
const kick = (time: number, velocity = 1): DrumHit => ({ time, kind: 'kick', velocity });
const draw = (t: number, drums: DrumHit[], extra = {}) => {
  const p = new RecordingPainter();
  ringsLook.draw(p, makeCtx(t, { drums }, extra));
  return p;
};
/** 落在鼓點上的圈（排除每小節的圓心珠子與現在那一下的核心）用 stroke + circle 數。 */
const ringCount = (p: RecordingPainter) => opsOf(p, 'circle').length;

test('registry exposes rings by id, number 6', () => {
  expect(looks.rings).toBe(ringsLook);
  expect(ringsLook).toMatchObject({ id: 'rings', number: 6 });
});

test('deterministic: same context gives identical ops', () => {
  const hits = [kick(1), { time: 1.5, kind: 'snare', velocity: 0.7 } as DrumHit, kick(3)];
  expect(draw(3.2, hits).ops).toEqual(draw(3.2, hits).ops);
});

test('prints the whole song: every hit up to t stays, future hits are not drawn', () => {
  const hits = [kick(1), kick(5), kick(20), kick(50)];
  const early = ringCount(draw(6, hits));
  const late = ringCount(draw(55, hits));
  // 晚的那幀多了兩個圈（20 s、50 s），各自也多一顆小節圓心
  expect(late).toBeGreaterThan(early);
  const none = draw(0.5, hits);
  expect(ringCount(none)).toBe(0);
});

test('a tall box folds the song into several rows that fill the width', () => {
  const L = ringsLayout(984, 1600, 115);
  expect(L.rows).toBeGreaterThanOrEqual(5);
  expect(L.rows).toBeLessThanOrEqual(7);
  expect(L.barsPerRow * L.rows).toBeGreaterThanOrEqual(115);
  expect(L.x0).toBeLessThan(984 * 0.15);
  expect(L.x1).toBeGreaterThan(984 * 0.85);
  // 寬框行數少
  expect(ringsLayout(1600, 400, 115).rows).toBeLessThan(L.rows);
  // 手動行數
  expect(ringsLayout(984, 1600, 115, 3).rows).toBe(3);
});

test('kick rings are bigger than snare, snare bigger than hat; velocity grows them', () => {
  expect(ringRadius('kick', 1)).toBeGreaterThan(ringRadius('snare', 1));
  expect(ringRadius('snare', 1)).toBeGreaterThan(ringRadius('hat', 1));
  expect(ringRadius('kick', 1)).toBeGreaterThan(ringRadius('kick', 0.2));
});

test('the hit just dropped gets an accent pulse ring that fades', () => {
  const fresh = draw(1.05, [kick(1)]);
  expect(opsOf(fresh, 'stroke').some((o) => o.args[0] === '#ff4a1c')).toBe(true);
  const old = draw(3, [kick(1)]);
  expect(opsOf(old, 'stroke').some((o) => o.args[0] === '#ff4a1c')).toBe(false);
});

test('paper theme never calls glow and multiplies ink; empty drums still draw axes and times', () => {
  const p = draw(3, [kick(1)], { theme: paperInk });
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
  expect(opsOf(p, 'blend').some((o) => o.args[0] === 'multiply')).toBe(true);
  const empty = draw(3, []);
  expect(opsOf(empty, 'line').length).toBeGreaterThan(0);
  expect(hasText(empty, '0:00')).toBe(true);
  expect(ringCount(empty)).toBe(0);
});

test('readouts are PRINTED / PEN / TIME like the Oto sheet', () => {
  const r = ringsLook.readouts?.(makeCtx(30, { duration: 60 }));
  expect(r).toEqual([
    { label: 'PRINTED', value: '50 %' },
    { label: 'PEN', value: 'Rings' },
    { label: 'TIME', value: '0:30' },
  ]);
});
