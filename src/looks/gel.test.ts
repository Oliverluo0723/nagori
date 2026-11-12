import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { binHz } from '../analysis/audio/spectrum';
import { gelLook } from './gel';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { BANDS7 } from './sheet';

test('deterministic', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  gelLook.draw(a, makeCtx(10, { spectrum: s }));
  gelLook.draw(b, makeCtx(10, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
});

test('seven lane backgrounds, print head and label even without spectrum', () => {
  const p = new RecordingPainter();
  gelLook.draw(p, makeCtx(10, {}, { label: '18 GEL' }));
  expect(opsOf(p, 'rect')).toHaveLength(BANDS7.length);
  expect(opsOf(p, 'line')).toHaveLength(1);
  expect(hasText(p, '18 GEL')).toBe(true);
});

test('one band per half bar per lane that is above threshold, up to t', () => {
  // 一小節 2 秒、每小節 2 條 → 1 秒一條；t = 10 → 10 條 × 7 道
  const p = new RecordingPainter();
  gelLook.draw(p, makeCtx(10, { spectrum: flatSpectrum(60, 0.6) }));
  expect(opsOf(p, 'rect')).toHaveLength(BANDS7.length + 10 * BANDS7.length);
  // 只有 bass 頻帶有能量 → 只有一道有色帶
  const s = spectrumWith(60, (bin) => {
    const hz = binHz(
      { fps: 10, bins: 16, minHz: 30, maxHz: 16000, frames: new Float32Array(), frameCount: 0 },
      bin,
    );
    return hz > 60 && hz < 250 ? 1 : 0;
  });
  const q = new RecordingPainter();
  gelLook.draw(q, makeCtx(10, { spectrum: s }));
  expect(opsOf(q, 'rect')).toHaveLength(BANDS7.length + 10);
});

test('kicks are dots in the first lane; later kicks wait', () => {
  const p = new RecordingPainter();
  gelLook.draw(
    p,
    makeCtx(10, {
      drums: [
        { time: 1, kind: 'kick', velocity: 1 },
        { time: 2, kind: 'snare', velocity: 1 },
        { time: 40, kind: 'kick', velocity: 1 },
      ],
    }),
  );
  expect(opsOf(p, 'circle')).toHaveLength(1);
});

test('registry exposes gel as number 18', () => {
  expect(looks.gel).toBe(gelLook);
  expect(gelLook).toMatchObject({ id: 'gel', number: 18 });
});
