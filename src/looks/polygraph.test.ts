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

test('eight lane names, time ticks and the print head; empty readings do not throw', () => {
  const p = new RecordingPainter();
  polygraphLook.draw(p, makeCtx(10, {}, { label: '17 POLYGRAPH' }));
  expect(LANES).toHaveLength(8);
  for (const name of LANES) expect(hasText(p, name)).toBe(true);
  expect(hasText(p, 'WIDTH')).toBe(true);
  expect(hasText(p, 'TENSION')).toBe(true);
  expect(hasText(p, '0:00')).toBe(true);
  expect(hasText(p, '0:10')).toBe(true);
  expect(hasText(p, '17 POLYGRAPH')).toBe(true);
  expect(opsOf(p, 'polyline')).toHaveLength(0);
});

test('only data up to t is printed: hit combs, bass stairs, five curves, one chord as dots', () => {
  const p = new RecordingPainter();
  polygraphLook.draw(p, makeCtx(10, { spectrum: flatSpectrum(60, 0.5), drums, bass, chords }));
  // kick 梳 + snare 梳 + bass 階梯 + level/punch/bright/width/tension
  const lines = opsOf(p, 'polyline');
  expect(lines).toHaveLength(2 + 1 + 5);
  // kick、snare 梳子各只有 1 齒（50 秒那顆 kick 還沒到）：基線、齒尖、基線
  expect(lines.filter((l) => (l.args[0] as unknown[]).length === 3)).toHaveLength(2);
  // 曲線只到 t：x 不超過印字頭
  const head = opsOf(p, 'line').at(-1)?.args[0] as number;
  for (const l of lines)
    for (const pt of l.args[0] as { x: number }[]) expect(pt.x).toBeLessThanOrEqual(head + 1e-6);
  // 一個和弦三個音，每個音一排點，根音是強調色
  expect(opsOf(p, 'circle').length).toBeGreaterThan(3);
  const fills = p.ops.filter((o) => o.op === 'fill').map((o) => o.args[0]);
  expect(fills).toContain(darkGlow.accent);
});

test('lanes fill the cell from top to bottom', () => {
  const p = new RecordingPainter();
  polygraphLook.draw(p, makeCtx(60, { spectrum: flatSpectrum(60, 0.5), drums, bass, chords }));
  const ys = opsOf(p, 'line')
    .filter((l) => l.args[1] === l.args[3])
    .map((l) => l.args[1] as number);
  // 7 條泳道分隔線，最後一條在 7/8 高附近
  expect(Math.max(...ys)).toBeGreaterThan(1920 * 0.8);
});

test('pens: level follows energy, punch marks the low-band rise, bright is the high share', () => {
  // 前 2 秒靜音、後面低頻滿
  const s = spectrumWith(10, (bin, frame) => (frame >= 20 && bin < 4 ? 1 : 0), {
    fps: 10,
    bins: 16,
  });
  const { level, punch, bright, width, tension } = pens(s);
  expect(level.length).toBe(50);
  expect(width.length).toBe(50);
  expect(tension.length).toBe(50);
  for (const v of [...width, ...tension]) expect(v).toBeGreaterThanOrEqual(0);
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
