import { expect, test } from 'vitest';
import { hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { blotLook } from './blot';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const hits: DrumHit[] = [
  { time: 0, kind: 'kick', velocity: 1 },
  { time: 0.5, kind: 'hat', velocity: 0.5 },
  { time: 1, kind: 'snare', velocity: 0.8 },
  { time: 30, kind: 'kick', velocity: 1 },
];
const GRID_DOTS = 16 * 6;

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  blotLook.draw(a, makeCtx(1.2, { drums: hits }));
  blotLook.draw(b, makeCtx(1.2, { drums: hits }));
  expect(a.ops).toEqual(b.ops);
});

test('grid dots, printed hits only, playhead ring', () => {
  const p = new RecordingPainter();
  blotLook.draw(p, makeCtx(1.2, { drums: hits }, { label: '13 BLOT' }));
  // 96 格點 + kick 兩圈 + hat + snare + 播放圈；30 秒的 kick 還沒印
  expect(opsOf(p, 'circle')).toHaveLength(GRID_DOTS + 2 + 1 + 1 + 1);
  expect(hasText(p, '13 BLOT')).toBe(true);
  expect(hasText(p, 'bars 1–6')).toBe(true);
  expect(opsOf(p, 'glow').length).toBeGreaterThan(0);
});

test('a blot keeps spreading after it lands', () => {
  const size = (t: number) => {
    const p = new RecordingPainter();
    blotLook.draw(p, makeCtx(t, { drums: [{ time: 0, kind: 'kick', velocity: 1 }] }));
    const kick = opsOf(p, 'circle')[GRID_DOTS + 1];
    return kick.args[2] as number;
  };
  expect(size(0.5)).toBeGreaterThan(size(0.01));
  expect(size(5)).toBeGreaterThan(size(0.5));
});

test('paper theme never glows; later page shows its own bars', () => {
  const p = new RecordingPainter();
  blotLook.draw(p, makeCtx(13, { drums: hits }, { theme: paperInk }));
  expect(opsOf(p, 'glow')).toHaveLength(0);
  expect(hasText(p, 'bars 7–12')).toBe(true);
  expect(opsOf(p, 'circle')).toHaveLength(GRID_DOTS + 1);
});

test('registry exposes blot as number 13', () => {
  expect(looks.blot).toBe(blotLook);
  expect(blotLook).toMatchObject({ id: 'blot', number: 13, listens: ['drums', 'tempo'] });
  expect(darkGlow.glow).toBe(true);
});
