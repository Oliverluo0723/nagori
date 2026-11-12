import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { ChordEvent, DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { BODY_BANDS, bodiesLook, orbits, PIECES, tearAt } from './bodies';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const Bm: ChordEvent = { time: 0, duration: 4, root: 11, name: 'Bm', notes: [2, 6, 11] };
const kick = (time: number): DrumHit => ({ time, kind: 'kick', velocity: 1 });
const draw = (t: number, readings = {}, extra = {}) => {
  const p = new RecordingPainter();
  bodiesLook.draw(p, makeCtx(t, readings, extra));
  return p;
};

test('registry exposes bodies by id, number 5', () => {
  expect(looks.bodies).toBe(bodiesLook);
  expect(bodiesLook).toMatchObject({ id: 'bodies', number: 5 });
});

test('deterministic: same context gives identical ops', () => {
  const r = { chords: [Bm], drums: [kick(0.9)], spectrum: flatSpectrum(60, 0.4) };
  expect(draw(1, r).ops).toEqual(draw(1, r).ops);
});

test('six orbits with four tick marks each; the six bodies are built from shapes', () => {
  const p = draw(1, { chords: [Bm] });
  expect(opsOf(p, 'circle')).toHaveLength(BODY_BANDS.length);
  expect(opsOf(p, 'line')).toHaveLength(BODY_BANDS.length * 4);
  expect(opsOf(p, 'shape').length).toBeGreaterThanOrEqual(BODY_BANDS.length * PIECES);
  expect(opsOf(p, 'haze')).toHaveLength(BODY_BANDS.length);
});

test('tall boxes stack the orbits 2×3, wide boxes 3×2', () => {
  const tall = orbits(1, 984, 1600);
  expect(new Set(tall.map((o) => Math.round(o.y / 400))).size).toBe(3);
  const wide = orbits(1, 1600, 900);
  expect(wide.filter((o) => o.y < 450)).toHaveLength(3);
});

test('a kick tears the bodies: torn decays after the kick, and the lobes move apart', () => {
  expect(tearAt([kick(1)], 1).amount).toBeCloseTo(1);
  expect(tearAt([kick(1)], 1.5).amount).toBeLessThan(0.3);
  expect(tearAt([], 1).amount).toBe(0);
  const torn = draw(1, { drums: [kick(1)] });
  const calm = draw(1, { drums: [] });
  expect(torn.ops).not.toEqual(calm.ops);
  expect(bodiesLook.readouts?.(makeCtx(1, { drums: [kick(1)] }))[1]).toEqual({
    label: 'TORN',
    value: '100 %',
  });
});

test('the lower half of each gradient takes the chord tone colours', () => {
  const p = draw(1, { chords: [Bm] });
  const fills = new Set(opsOf(p, 'fill').map((o) => o.args[0]));
  // B 的顏色（Bm 的第三個音）是某個身體漸層最底下那條
  expect(fills.has(darkGlow.noteColors[11])).toBe(true);
  expect(bodiesLook.readouts?.(makeCtx(1, { chords: [Bm] }))[2]).toEqual({
    label: 'CHORD',
    value: 'Bm',
  });
});

test('paper theme never calls glow; no chords and no spectrum still draws six bodies', () => {
  const p = draw(1, {}, { theme: paperInk });
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
  expect(opsOf(p, 'shape').length).toBeGreaterThanOrEqual(BODY_BANDS.length * PIECES);
});
