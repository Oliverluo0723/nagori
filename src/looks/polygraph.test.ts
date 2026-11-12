import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { BassNote, ChordEvent, DrumHit } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { LANES, pens, polygraphLook } from './polygraph';
import { looks } from './registry';

const drums: DrumHit[] = [
  { time: 1, kind: 'kick', velocity: 1 },
  { time: 2, kind: 'snare', velocity: 1 },
  { time: 3, kind: 'hat', velocity: 1 },
  { time: 50, kind: 'kick', velocity: 1 },
];
const bass: BassNote[] = [
  { time: 0, duration: 2, midi: 38, bends: [] },
  { time: 2, duration: 2, midi: 43, bends: [] },
  { time: 50, duration: 2, midi: 38, bends: [] },
];
const chords: ChordEvent[] = [
  { time: 0, duration: 4, root: 2, name: 'D', notes: [2, 6, 9] },
  { time: 50, duration: 4, root: 7, name: 'G', notes: [7, 11, 2] },
];

test('deterministic', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  polygraphLook.draw(a, makeCtx(10, { spectrum: s, drums, bass, chords }));
  polygraphLook.draw(b, makeCtx(10, { spectrum: s, drums, bass, chords }));
  expect(a.ops).toEqual(b.ops);
});

test('lane names, time ticks and the print head; empty readings do not throw', () => {
  const p = new RecordingPainter();
  polygraphLook.draw(p, makeCtx(10, {}, { label: '17 POLYGRAPH' }));
  for (const name of LANES) expect(hasText(p, name)).toBe(true);
  expect(hasText(p, '0:00')).toBe(true);
  expect(hasText(p, '0:30')).toBe(true);
  expect(hasText(p, '17 POLYGRAPH')).toBe(true);
  expect(opsOf(p, 'polyline')).toHaveLength(0);
});

test('only data up to t is printed: 2 hit ticks, bass stairs, one chord, 3 curves', () => {
  const p = new RecordingPainter();
  polygraphLook.draw(p, makeCtx(10, { spectrum: flatSpectrum(60, 0.5), drums, bass, chords }));
  // 刻度線 3 條（0:00 0:30 1:00）+ kick + snare + 印字頭；hat 不畫，50 秒的 kick 還沒到
  expect(opsOf(p, 'line')).toHaveLength(3 + 2 + 1);
  // bass 階梯 1 條 + level/punch/bright 3 條
  expect(opsOf(p, 'polyline')).toHaveLength(4);
  // 一個和弦三個音
  expect(opsOf(p, 'rect')).toHaveLength(3);
  const fills = p.ops.filter((o) => o.op === 'fill').map((o) => o.args[0]);
  expect(fills).toContain(darkGlow.accent);
});

test('pens: level follows energy, punch marks the low-band rise, bright is the high share', () => {
  // 前 2 秒靜音、後面低頻滿
  const s = spectrumWith(10, (bin, frame) => (frame >= 20 && bin < 4 ? 1 : 0), {
    fps: 10,
    bins: 16,
  });
  const { level, punch, bright } = pens(s);
  expect(level.length).toBe(50);
  expect(level[0]).toBe(0);
  expect(level[20]).toBeCloseTo(0.25);
  const peak = Array.from(punch).indexOf(1);
  expect(peak).toBe(10);
  expect(bright[20]).toBe(0);
});

test('registry exposes polygraph as number 17', () => {
  expect(looks.polygraph).toBe(polygraphLook);
  expect(polygraphLook).toMatchObject({ id: 'polygraph', number: 17 });
});
