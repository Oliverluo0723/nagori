import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import { lidarLook } from './lidar';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

test('deterministic', () => {
  const s = flatSpectrum(60, 0.6);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  lidarLook.draw(a, makeCtx(10, { spectrum: s }));
  lidarLook.draw(b, makeCtx(10, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum only the label is drawn', () => {
  const p = new RecordingPainter();
  lidarLook.draw(p, makeCtx(10, {}, { label: '15 LIDAR' }));
  expect(opsOf(p, 'circle')).toHaveLength(0);
  expect(hasText(p, '15 LIDAR')).toBe(true);
});

test('lines × dots when everything is above threshold; nearer lines are lower and wider', () => {
  const s = flatSpectrum(60, 0.6);
  const p = new RecordingPainter();
  lidarLook.draw(p, makeCtx(30, { spectrum: s }, { params: { lines: 10, dots: 8 } }));
  const circles = opsOf(p, 'circle');
  expect(circles).toHaveLength(80);
  const first = circles.slice(0, 8).map((c) => c.args as number[]);
  const last = circles.slice(-8).map((c) => c.args as number[]);
  expect(first[0][1]).toBeGreaterThan(last[0][1]); // 最近的線在下面
  const width = (row: number[][]) => row[7][0] - row[0][0];
  expect(width(first)).toBeGreaterThan(width(last));
});

test('silence draws nothing; lines before the song start are skipped', () => {
  const quiet = new RecordingPainter();
  lidarLook.draw(quiet, makeCtx(30, { spectrum: flatSpectrum(60, 0) }));
  expect(opsOf(quiet, 'circle')).toHaveLength(0);
  const early = new RecordingPainter();
  // t = 0.6 秒、每線半拍 0.25 秒 → 只有 3 條線有時間 ≥ 0
  lidarLook.draw(
    early,
    makeCtx(0.6, { spectrum: flatSpectrum(60, 0.6) }, { params: { lines: 10, dots: 4 } }),
  );
  expect(opsOf(early, 'circle')).toHaveLength(12);
});

test('registry exposes lidar as number 15', () => {
  expect(looks.lidar).toBe(lidarLook);
  expect(lidarLook).toMatchObject({ id: 'lidar', number: 15, listens: ['spectrum', 'tempo'] });
});

test('readouts: scan lines, points drawn, frequency range', () => {
  const r = lidarLook.readouts?.(
    makeCtx(30, { spectrum: flatSpectrum(60, 0.6) }, { params: { lines: 10, dots: 8 } }),
  );
  expect(r).toEqual([
    { label: 'SCAN LINES', value: '10' },
    { label: 'POINTS', value: '80' },
    { label: 'RANGE', value: '40 Hz – 14 kHz' },
  ]);
});
