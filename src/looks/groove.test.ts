import { expect, test } from 'vitest';
import { hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { angleOf, barHits, beatsPerBar, grooveLook, RING } from './groove';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

// makeCtx：120 BPM，一小節 2 秒（第 1 小節 0–2 s、第 2 小節 2–4 s）
const hit = (time: number, kind: DrumHit['kind'] = 'kick'): DrumHit => ({
  time,
  kind,
  velocity: 1,
});
const draw = (t: number, drums: DrumHit[], extra = {}) => {
  const p = new RecordingPainter();
  grooveLook.draw(p, makeCtx(t, { drums }, extra));
  return p;
};

test('registry exposes groove: number 30, 節拍鐘, listens to drums and tempo', () => {
  expect(looks.groove).toBe(grooveLook);
  expect(grooveLook).toMatchObject({
    id: 'groove',
    number: 30,
    name: '節拍鐘',
    listens: ['drums', 'tempo'],
  });
});

test('deterministic: same context gives identical ops', () => {
  const drums = [hit(2), hit(2.5, 'snare'), hit(2.75, 'hat')];
  expect(draw(3, drums).ops).toEqual(draw(3, drums).ops);
});

test('a bar is one turn: phase 0 at 12 o’clock, a quarter at 3 o’clock', () => {
  expect(angleOf(0)).toBeCloseTo(-Math.PI / 2);
  expect(angleOf(0.25)).toBeCloseTo(0);
  expect(beatsPerBar(makeCtx(0, {}).readings.tempo, 0)).toBe(4);
});

test('barHits keeps only this bar up to now, with the phase inside the bar', () => {
  const drums = [hit(1), hit(2), hit(3, 'snare'), hit(3.5, 'hat'), hit(5)];
  const tempo = makeCtx(0, {}).readings.tempo;
  const got = barHits(drums, tempo, 2, 3.2);
  expect(got.map((g) => g.hit.time)).toEqual([2, 3]);
  expect(got[1].phase).toBeCloseTo(0.5);
});

test('kick on the outer ring at the top, snare on the middle ring at the bottom', () => {
  const unit = 1080;
  const cx = 1080 / 2;
  const R = unit * 0.37;
  const p = draw(3.01, [hit(2), hit(3, 'snare')], { h: 1080 });
  const circles = opsOf(p, 'circle').map((o) => o.args as number[]);
  const cy = 1080 / 2;
  expect(
    circles.some(([x, y]) => Math.abs(x - cx) < 1 && Math.abs(y - (cy - R * RING.kick)) < 1),
  ).toBe(true);
  expect(
    circles.some(([x, y]) => Math.abs(x - cx) < 1 && Math.abs(y - (cy + R * RING.snare)) < 1),
  ).toBe(true);
});

test('the bar number sits in the middle; the legend names the three kinds', () => {
  const p = draw(3, [hit(2)]);
  expect(hasText(p, '2')).toBe(true);
  for (const k of ['KICK', 'SNARE', 'HAT']) expect(hasText(p, k)).toBe(true);
});

test('previous bar hits are dimmer than this bar', () => {
  const p = draw(2.5, [hit(1), hit(2.25)], { h: 1080 });
  const kickFills = opsOf(p, 'fill').filter((o) => o.args[0] === darkGlow.accent);
  const alphas = kickFills.map((o) => (o.args[1] as number | undefined) ?? 1);
  expect(Math.min(...alphas)).toBeLessThan(0.5);
  expect(Math.max(...alphas)).toBe(1);
});

test('readouts: tempo, bar.beat, kicks and snares so far in this bar', () => {
  const drums = [hit(1), hit(2), hit(2.5, 'snare'), hit(3), hit(3.6, 'snare')];
  expect(grooveLook.readouts?.(makeCtx(3.2, { drums }))).toEqual([
    { label: 'TEMPO', value: '≈120 BPM' },
    { label: 'BAR', value: '2.3' },
    { label: 'KICKS', value: '2' },
    { label: 'SNARES', value: '1' },
  ]);
});

test('paper theme never calls glow', () => {
  const p = draw(2.05, [hit(2)], { theme: paperInk });
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
});
