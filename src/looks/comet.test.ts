import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { BassNote, ChordEvent, DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { cometFrame, cometLook } from './comet';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const bass: BassNote[] = [
  { time: 0, duration: 2, midi: 38, bends: [{ time: 1, semitones: 2 }] },
  { time: 2, duration: 2, midi: 43, bends: [] },
];
const chords: ChordEvent[] = [
  { time: 0, duration: 2, root: 2, name: 'D', notes: [2, 6, 9] },
  { time: 2, duration: 6, root: 7, name: 'G', notes: [7, 11, 2] },
];
const drums: DrumHit[] = [{ time: 2.5, kind: 'kick', velocity: 1 }];
/** 背景星點數 */
const STARS = 140;

const head = (p: RecordingPainter) => opsOf(p, 'circle').slice(-1)[0].args as number[];

test('deterministic, registered as 22; paper never glows, dark glows only the head', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  cometLook.draw(a, makeCtx(3, { bass, chords, drums }));
  cometLook.draw(b, makeCtx(3, { bass, chords, drums }));
  expect(a.ops).toEqual(b.ops);
  expect(looks.comet).toBe(cometLook);
  expect(cometLook.number).toBe(22);
  expect(opsOf(a, 'glow')).toHaveLength(1);
  const paper = new RecordingPainter();
  cometLook.draw(paper, makeCtx(3, { bass, chords, drums }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
});

test('tall box: the head flies near the top, a higher note sits further right', () => {
  const p = new RecordingPainter();
  cometLook.draw(p, makeCtx(3, { bass, chords }));
  const [x3, y3] = head(p);
  expect(y3).toBeCloseTo(cometFrame(1080, 1920).at(0, 0).y);
  expect(y3).toBeLessThan(1920 * 0.25);
  const lower = new RecordingPainter();
  cometLook.draw(lower, makeCtx(1, { bass, chords })); // midi 38 低於 43
  expect(head(lower)[0]).toBeLessThan(x3);
  expect(hasText(p, 'G2')).toBe(true);
});

test('wide box: the head flies to the right and the tail streams left', () => {
  const F = cometFrame(1920, 1080);
  expect(F.at(0, 0.5).x).toBeGreaterThan(F.at(1, 0.5).x);
  const p = new RecordingPainter();
  cometLook.draw(p, makeCtx(3, { bass, chords }, { w: 1920, h: 1080 }));
  expect(head(p)[0]).toBeGreaterThan(1920 * 0.75);
});

test('the tail remembers the chord it flew through and marks the change', () => {
  const p = new RecordingPainter();
  cometLook.draw(p, makeCtx(3, { bass, chords }));
  expect(hasText(p, 'G')).toBe(true);
  const strokes = new Set(opsOf(p, 'stroke').map((o) => o.args[0]));
  expect(strokes.size).toBeGreaterThan(2);
});

test('falls back to the low band without bass; nothing to read draws only the sky', () => {
  const noBass = new RecordingPainter();
  cometLook.draw(noBass, makeCtx(3, { spectrum: flatSpectrum(60, 0.5) }));
  expect(opsOf(noBass, 'circle').length).toBeGreaterThan(STARS);
  const nothing = new RecordingPainter();
  cometLook.draw(nothing, makeCtx(3, {}));
  expect(opsOf(nothing, 'circle')).toHaveLength(STARS);
});

test('readouts: BASS / CHORD / RANGE / TIME', () => {
  expect(cometLook.readouts?.(makeCtx(3, { bass, chords }))).toEqual([
    { label: 'BASS', value: 'G2' },
    { label: 'CHORD', value: 'G' },
    { label: 'RANGE', value: 'D2–G2' },
    { label: 'TIME', value: '0:03' },
  ]);
});
