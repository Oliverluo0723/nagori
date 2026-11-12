import { expect, test } from 'vitest';
import { makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { paperInk } from '../compose/themes';
import { paintData, paintLook } from './paint';
import { RecordingPainter } from './painter/recording';
import { mulberry32 } from './prng';
import { readoutsFor } from './readouts';
import { looks } from './registry';

const noisy = () => {
  const rng = mulberry32(5);
  return spectrumWith(60, () => rng(), { fps: 20, bins: 64 });
};

test('registry exposes paint as number 29', () => {
  expect(looks.paint).toBe(paintLook);
  expect(paintLook).toMatchObject({ id: 'paint', number: 29, name: '油畫' });
});

test('deterministic for a seed; another seed moves the strokes', () => {
  const r = makeCtx(0, { spectrum: noisy() }).readings;
  const draw = (seed: number) => {
    const p = new RecordingPainter();
    paintLook.draw(p, { ...makeCtx(30, {}, { seed }), readings: r });
    return p.ops;
  };
  expect(draw(1)).toEqual(draw(1));
  expect(draw(2)).not.toEqual(draw(1));
});

test('geometry is cached per readings object and capped', () => {
  const r = makeCtx(0, { spectrum: noisy() }).readings;
  const a = paintData(r, 1, 0.5625, 10, 300);
  expect(paintData(r, 1, 0.5625, 10, 300)).toBe(a);
  const total = a?.times.length ?? 0;
  expect(total).toBeGreaterThan(200);
  expect(total).toBeLessThanOrEqual(330);
});

test('prints up to t: more strokes later, STROKES matches what is drawn', () => {
  const r = makeCtx(0, { spectrum: noisy() }).readings;
  const count = (t: number) => {
    const p = new RecordingPainter();
    const ctx = { ...makeCtx(t, {}), readings: r };
    paintLook.draw(p, ctx);
    const strokes = readoutsFor(paintLook, ctx).find((x) => x.label === 'STROKES')?.value;
    expect(Number(strokes)).toBe(opsOf(p, 'polyline').length);
    return opsOf(p, 'polyline').length;
  };
  expect(count(10)).toBeLessThan(count(30));
  expect(count(30)).toBeLessThan(count(59.9));
});

test('bass at the bottom, highs on top and painted last', () => {
  const r = makeCtx(0, { spectrum: noisy() }).readings;
  const d = paintData(r, 1, 0.5625, 10, 2000);
  if (!d) throw new Error('no data');
  const startY = (band: number) => {
    const list = d.bands[band];
    return list.reduce((s, st) => s + st.pts[1], 0) / list.length;
  };
  expect(startY(0)).toBeGreaterThan(startY(3));
  expect(startY(3)).toBeGreaterThan(startY(6));
  // 繪製順序：air（墨色）的筆都在 sub/bass（藍）的筆之後
  const p = new RecordingPainter();
  paintLook.draw(p, { ...makeCtx(59.9, {}, { theme: paperInk }), readings: r });
  const colors = opsOf(p, 'stroke').map((o) => o.args[0]);
  expect(colors.indexOf(paperInk.ink)).toBeGreaterThan(colors.lastIndexOf(paperInk.noteColors[9]));
});

test('the batch being painted gets a hollow circle mid-song; nothing without a spectrum', () => {
  const r = makeCtx(0, { spectrum: noisy() }).readings;
  const p = new RecordingPainter();
  paintLook.draw(p, { ...makeCtx(30.05, {}), readings: r });
  const ops = p.ops.map((o) => o.op);
  const last = ops.lastIndexOf('circle');
  expect(ops.slice(0, last).lastIndexOf('noFill')).toBeGreaterThan(
    ops.slice(0, last).lastIndexOf('fill'),
  );
  const empty = new RecordingPainter();
  paintLook.draw(empty, makeCtx(30, {}));
  expect(empty.ops.map((o) => o.op)).toEqual(['background']);
  const ro = readoutsFor(paintLook, makeCtx(30, {}));
  expect(ro.map((x) => x.label)).toEqual(['PRINTED', 'PEN', 'STROKES', 'TIME']);
  expect(ro[1].value).toBe('Paint');
});
