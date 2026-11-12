import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { blotLook, rowsFor } from './blot';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const hits: DrumHit[] = [
  { time: 0, kind: 'kick', velocity: 1 },
  { time: 0.5, kind: 'hat', velocity: 0.5 },
  { time: 1, kind: 'snare', velocity: 0.8 },
  { time: 30, kind: 'kick', velocity: 1 },
];

test('deterministic; never glows on either theme', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  blotLook.draw(a, makeCtx(1.2, { drums: hits }));
  blotLook.draw(b, makeCtx(1.2, { drums: hits }));
  expect(a.ops).toEqual(b.ops);
  expect(opsOf(a, 'glow')).toHaveLength(0);
  const paper = new RecordingPainter();
  blotLook.draw(paper, makeCtx(1.2, { drums: hits }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
});

test('a tall sheet prints more bars per page than a square one', () => {
  const tall = makeCtx(0, {});
  const square = makeCtx(0, {}, { w: 1000, h: 790 });
  expect(rowsFor(square)).toBe(6);
  expect(rowsFor(tall)).toBeGreaterThan(10);
  expect(rowsFor(makeCtx(0, {}, { w: 540, h: 480 }))).toBeGreaterThanOrEqual(6);
});

test('readouts: sheet bars, step and the blots printed so far', () => {
  const ctx = makeCtx(1.2, { drums: hits });
  const rows = rowsFor(ctx);
  expect(blotLook.readouts?.(ctx)).toEqual([
    { label: 'SHEET', value: `bars 1–${rows}` },
    // 120 BPM：一小節 2 秒，1.2 秒是第 10 個 16 分格
    { label: 'STEP', value: '10 / 16' },
    { label: 'BLOTS', value: '3' },
  ]);
  const later = makeCtx(rows * 2 + 1, { drums: hits });
  expect(blotLook.readouts?.(later)[0].value).toBe(`bars ${rows + 1}–${rows * 2}`);
});

test('empty page: only the grid dots and the playhead ring; hits add a haze cloud', () => {
  const ctx = makeCtx(0.1, {});
  const rows = rowsFor(ctx);
  const empty = new RecordingPainter();
  blotLook.draw(empty, ctx);
  expect(opsOf(empty, 'circle')).toHaveLength(rows * 16 + 1);
  expect(opsOf(empty, 'haze')).toHaveLength(1);
  const inked = new RecordingPainter();
  blotLook.draw(inked, makeCtx(1.2, { drums: hits }));
  expect(opsOf(inked, 'haze').length).toBeGreaterThan(6);
});

test('a blot keeps spreading after it lands', () => {
  const ctx = makeCtx(0, {});
  const grid = rowsFor(ctx) * 16;
  const size = (t: number) => {
    const p = new RecordingPainter();
    blotLook.draw(p, makeCtx(t, { drums: [{ time: 0, kind: 'kick', velocity: 1 }] }));
    return opsOf(p, 'circle')[grid].args[2] as number;
  };
  expect(size(0.5)).toBeGreaterThan(size(0.01));
  expect(size(5)).toBeGreaterThan(size(0.5));
});

test('registry exposes blot as number 13', () => {
  expect(looks.blot).toBe(blotLook);
  expect(blotLook).toMatchObject({ id: 'blot', number: 13, listens: ['drums', 'tempo'] });
});
