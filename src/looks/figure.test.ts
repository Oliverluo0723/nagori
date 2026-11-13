import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow, paperInk } from '../compose/themes';
import { BODIES, figureLook, partAt, SCRATCHES } from './figure';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const draw = (t: number, readings = {}, extra = {}) => {
  const p = new RecordingPainter();
  figureLook.draw(p, makeCtx(t, readings, extra));
  return p;
};

/** 三團身體的半徑：頭、身的第一層 haze 與地的寬霧，順序照 draw 裡畫的。 */
function radii(p: RecordingPainter): { head: number; body: number; ground: number } {
  const hazes = opsOf(p, 'haze').map((o) => o.args as number[]);
  // 黑底：灰霧、兩團背景紫霧，然後頭三層、身四層、地三層…
  const head = hazes[3][2] / 2.3;
  const body = hazes[6][2] / 2.1;
  const ground = hazes[10][2] / 1.7;
  return { head, body, ground };
}

test('registry exposes figure as number 35', () => {
  expect(looks.figure).toBe(figureLook);
  expect(figureLook).toMatchObject({ id: 'figure', number: 35, name: '發光人形' });
});

test('deterministic for a seed; another seed moves the specks and scratches', () => {
  const r = { spectrum: flatSpectrum(60, 0.5) };
  expect(draw(10, r).ops).toEqual(draw(10, r).ops);
  expect(draw(10, r, { seed: 9 }).ops).not.toEqual(draw(10, r).ops);
});

test('head, body and ground stack on the centre axis, each sized by its own bands', () => {
  const p = draw(10, { spectrum: flatSpectrum(60, 0.5) });
  const hazes = opsOf(p, 'haze').map((o) => o.args as number[]);
  const ys = [hazes[3][1], hazes[6][1], hazes[10][1]];
  expect(ys[0]).toBeLessThan(ys[1]);
  expect(ys[1]).toBeLessThan(ys[2]);
  expect(ys[0] / 1920).toBeCloseTo(BODIES[0].y, 1);
  expect(ys[2] / 1920).toBeCloseTo(BODIES[2].y, 1);
  for (const y of [hazes[3][0], hazes[6][0], hazes[10][0]])
    expect(Math.abs(y - 540)).toBeLessThan(12);
  // 前 10 秒只有高頻、之後只有低頻：頭先大後小，地先小後大
  const s = spectrumWith(60, (bin, f) =>
    f < 100 ? (bin >= 12 ? 0.9 : 0.05) : bin < 3 ? 0.9 : 0.05,
  );
  const early = radii(draw(5, { spectrum: s }));
  const late = radii(draw(30, { spectrum: s }));
  expect(early.head).toBeGreaterThan(late.head);
  expect(late.ground).toBeGreaterThan(early.ground);
});

test('specks twinkle inside the body and the ground; scratches ring the plot', () => {
  const p = draw(10, { spectrum: flatSpectrum(60, 0.5) });
  const circles = opsOf(p, 'circle');
  // 粉點 6、藍點 8，各兩個圓（光暈 + 核心），加上身體裡的亮點
  expect(circles.length).toBeGreaterThan((6 + 8) * 2 + 20);
  expect(opsOf(p, 'polyline')).toHaveLength(SCRATCHES);
  for (const o of opsOf(p, 'polyline')) {
    const pts = o.args[0] as { x: number; y: number }[];
    const { x, y } = pts[1];
    const inBorder = x < 1080 * 0.27 || x > 1080 * 0.73 || y < 1920 * 0.27 || y > 1920 * 0.73;
    expect(inBorder).toBe(true);
  }
  // 身體的亮點隨中頻變多
  const quiet = draw(10, {
    spectrum: spectrumWith(60, (bin) => (bin >= 3 && bin < 9 ? 0.1 : 0.5)),
  });
  const loud = draw(30, {
    spectrum: spectrumWith(60, (bin, f) => (f > 250 && bin >= 3 && bin < 9 ? 0.9 : 0.1)),
  });
  expect(opsOf(loud, 'circle').length).toBeGreaterThan(opsOf(quiet, 'circle').length);
  expect(opsOf(p, 'ellipse')).toHaveLength(2);
});

test('paper theme multiplies pastel bodies and never calls glow; empty readings still draw', () => {
  const p = draw(10, {}, { theme: paperInk });
  expect(opsOf(p, 'glow')).toHaveLength(0);
  expect(opsOf(p, 'blend')[0].args[0]).toBe('multiply');
  expect(opsOf(p, 'haze').length).toBeGreaterThanOrEqual(12);
  const dark = draw(10, {});
  expect(opsOf(dark, 'blend')[0].args[0]).toBe('add');
  expect(opsOf(dark, 'haze')[0].args[3]).toBe(darkGlow.mute);
  expect(opsOf(dark, 'glow')).toHaveLength(0);
});

test('readouts: PART from energy, then the three levels as percentages', () => {
  const s = spectrumWith(60, (_b, f) => (f < 200 ? 0.1 : 0.9));
  expect(partAt(s, 5)).toBe('Quiet');
  expect(partAt(s, 40)).toBe('Drop');
  expect(partAt(undefined, 5)).toBe('Quiet');
  const r = figureLook.readouts?.(makeCtx(40, { spectrum: s })) ?? [];
  expect(r.map((x) => x.label)).toEqual(['PART', 'HEAD · HIGHS', 'BODY · MIDS', 'GROUND · BASS']);
  expect(r[0].value).toBe('Drop');
  for (const x of r.slice(1)) expect(x.value).toMatch(/^\d+ %$/);
  const none = figureLook.readouts?.(makeCtx(1, {})) ?? [];
  expect(none[1].value).toBe('0 %');
});
