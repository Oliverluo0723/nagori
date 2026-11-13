import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { auraLook, countBefore, leapAt, PALETTES } from './aura';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const kick = (time: number): DrumHit => ({ time, kind: 'kick', velocity: 1 });
const snare = (time: number): DrumHit => ({ time, kind: 'snare', velocity: 1 });
const draw = (t: number, readings = {}, extra = {}) => {
  const p = new RecordingPainter();
  auraLook.draw(p, makeCtx(t, readings, extra));
  return p;
};
/** 每組顏色 14 個 haze：場內環境光 1、上球 6、下球 6、相碰點 1。 */
const HAZES_PER_PALETTE = 14;
/** 上球／下球第一層 haze 的索引（一組顏色裡）。 */
const UP = 1;
const LO = 7;

test('registry exposes aura as number 36', () => {
  expect(looks.aura).toBe(auraLook);
  expect(auraLook).toMatchObject({ id: 'aura', number: 36, name: '光球' });
});

test('deterministic: same context gives identical ops', () => {
  const r = { drums: [kick(9.9), snare(9.5)], spectrum: flatSpectrum(60, 0.5) };
  expect(draw(10, r).ops).toEqual(draw(10, r).ops);
});

test('an arena circle; two orbs touching at the centre, each sized by its own bands', () => {
  const p = draw(10, { spectrum: flatSpectrum(60, 0.5) });
  const arena = opsOf(p, 'circle');
  expect(arena).toHaveLength(1);
  expect(arena[0].args).toEqual([540, 960, 1080 * 0.72]);
  const hazes = opsOf(p, 'haze').map((o) => o.args as number[]);
  expect(hazes).toHaveLength(HAZES_PER_PALETTE);
  const rUp = hazes[UP][2] / 1.6;
  const rLo = hazes[LO][2] / 1.6;
  expect(hazes[UP][1] + rUp).toBeCloseTo(960, 5);
  expect(hazes[LO][1] - rLo).toBeCloseTo(960, 5);
  expect(rLo).toBeGreaterThan(rUp);
  // 前 10 秒只有高頻、之後只有低頻：上球先大後小，下球先小後大
  const s = spectrumWith(60, (bin, f) =>
    f < 100 ? (bin >= 10 ? 0.9 : 0.05) : bin < 3 ? 0.9 : 0.05,
  );
  const early = opsOf(draw(5, { spectrum: s }), 'haze').map((o) => o.args as number[]);
  const late = opsOf(draw(30, { spectrum: s }), 'haze').map((o) => o.args as number[]);
  expect(early[UP][2]).toBeGreaterThan(late[UP][2]);
  expect(late[LO][2]).toBeGreaterThan(early[LO][2]);
});

test('a kick leaps the pair upward, then they settle and squash on landing', () => {
  expect(leapAt([kick(10)], 10)).toBe(0);
  expect(leapAt([kick(10)], 10.1)).toBeGreaterThan(0.4);
  expect(leapAt([kick(10)], 10.1)).toBeGreaterThan(leapAt([kick(10)], 10.5));
  expect(leapAt([kick(10)], 11.5)).toBe(0);
  const calm = opsOf(draw(10.1, {}), 'haze').map((o) => o.args as number[]);
  const jump = opsOf(draw(10.1, { drums: [kick(10)] }), 'haze').map((o) => o.args as number[]);
  expect(jump[UP][1]).toBeLessThan(calm[UP][1]);
  expect(jump[LO][1]).toBeLessThan(calm[LO][1]);
  // 落地中：上球的兩半分開（變寬）、半徑變小
  expect(jump[UP][0]).toBeLessThan(jump[UP + 1][0]);
  expect(jump[UP][2]).toBeLessThan(calm[UP][2]);
  // 圈不跳
  expect(opsOf(draw(10.1, { drums: [kick(10)] }), 'circle')[0].args).toEqual([
    540,
    960,
    1080 * 0.72,
  ]);
  expect(
    auraLook.readouts?.(makeCtx(12, { drums: [kick(10), kick(11), snare(11.5), kick(13)] }))[2],
  ).toEqual({
    label: 'JUMPS',
    value: '2',
  });
});

test('each snare switches to the next of five palettes, crossfading for 0.15 s', () => {
  const colourOf = (p: RecordingPainter) => opsOf(p, 'haze')[UP].args[3];
  expect(colourOf(draw(10, {}))).toBe(darkGlow.noteColors[PALETTES[0][0]]);
  const drums = [snare(1), snare(2), snare(3), snare(4), snare(5), snare(6)];
  expect(colourOf(draw(1.5, { drums }))).toBe(darkGlow.noteColors[PALETTES[1][0]]);
  expect(colourOf(draw(5.5, { drums }))).toBe(darkGlow.noteColors[PALETTES[0][0]]);
  expect(colourOf(draw(6.5, { drums }))).toBe(darkGlow.noteColors[PALETTES[1][0]]);
  // 剛換色：兩組都畫（交叉淡入）；0.15 秒後只剩新的一組
  expect(opsOf(draw(2.05, { drums }), 'haze')).toHaveLength(HAZES_PER_PALETTE * 2);
  expect(opsOf(draw(2.3, { drums }), 'haze')).toHaveLength(HAZES_PER_PALETTE);
  expect(countBefore(drums, 'snare', 3)).toBe(3);
  expect(countBefore(drums, 'snare', 2.99)).toBe(2);
  expect(countBefore([], 'snare', 3)).toBe(0);
  expect(auraLook.readouts?.(makeCtx(6.5, { drums }))[3]).toEqual({
    label: 'COLOUR',
    value: '2 / 5',
  });
});

test('paper theme multiplies pastel orbs and never calls glow; empty readings still draw', () => {
  const p = draw(10, {}, { theme: paperInk });
  expect(opsOf(p, 'glow')).toHaveLength(0);
  expect(opsOf(p, 'blend')[0].args[0]).toBe('multiply');
  expect(opsOf(p, 'haze')).toHaveLength(HAZES_PER_PALETTE);
  expect(opsOf(draw(10, {}), 'blend')[0].args[0]).toBe('add');
});

test('readouts: ABOVE / BELOW / JUMPS / COLOUR', () => {
  const r = auraLook.readouts?.(makeCtx(10, { spectrum: flatSpectrum(60, 0.5) })) ?? [];
  expect(r.map((x) => x.label)).toEqual(['ABOVE', 'BELOW', 'JUMPS', 'COLOUR']);
  expect(r[0].value).toMatch(/^highs \d+ %$/);
  expect(r[1].value).toMatch(/^lows \d+ %$/);
  expect(r[2].value).toBe('0');
  expect(r[3].value).toBe('1 / 5');
  const none = auraLook.readouts?.(makeCtx(1, {})) ?? [];
  expect(none[0].value).toBe('highs 0 %');
});
