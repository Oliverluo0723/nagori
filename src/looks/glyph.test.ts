import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow, paperInk } from '../compose/themes';
import { CHARS, COLS, charFor, glyphLook, gridFor } from './glyph';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const textRows = (p: RecordingPainter) =>
  opsOf(p, 'text')
    .map((o) => o.args[0] as string)
    .filter((s) => s.length === COLS);

test('charFor maps silence to space and full scale to the heaviest glyph', () => {
  expect(charFor(0, 1.4)).toBe(' ');
  expect(charFor(1, 1.4)).toBe(CHARS[CHARS.length - 1]);
  expect(charFor(0.5, 1)).toBe(CHARS[3]);
});

test('deterministic', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  glyphLook.draw(a, makeCtx(10, { spectrum: s }));
  glyphLook.draw(b, makeCtx(10, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
});

test('the grid fills the box: 72 columns across, rows down to the bottom', () => {
  const ctx = makeCtx(2, { spectrum: flatSpectrum(60, 0.9) }, { params: { bars: 2 } });
  const { rows, rowH, cellW } = gridFor(ctx);
  expect(cellW * COLS).toBeCloseTo(1080);
  expect((rows + 2) * rowH).toBeGreaterThan(1920);
  const p = new RecordingPainter();
  glyphLook.draw(p, ctx);
  const lines = textRows(p);
  expect(lines).toHaveLength(rows + 1);
  // 視窗 4 秒、t = 2：左半在歌開始之前，是空白；右半是重字元
  expect(lines[0].slice(0, 30).trim()).toBe('');
  expect(lines[0].slice(40)).toMatch(/^\*+$/);
  // 字距撐到格寬
  const style = opsOf(p, 'text')[0].args[3] as { size: number; tracking: number };
  expect((0.6 + style.tracking) * style.size).toBeCloseTo(cellW);
  // 寬短的格子也是 72 欄
  expect(gridFor(makeCtx(0, {}, { w: 540, h: 480 })).rows).toBeGreaterThan(10);
});

test('three coloured lights behind the type: added on dark, multiplied on paper', () => {
  const s = flatSpectrum(60, 0.5);
  const dark = new RecordingPainter();
  glyphLook.draw(dark, makeCtx(10, { spectrum: s }));
  expect(opsOf(dark, 'haze').length).toBeGreaterThanOrEqual(6);
  expect(opsOf(dark, 'blend')[0].args[0]).toBe('add');
  const paper = new RecordingPainter();
  glyphLook.draw(paper, makeCtx(10, { spectrum: s }, { theme: paperInk }));
  expect(opsOf(paper, 'blend')[0].args[0]).toBe('multiply');
  expect(opsOf(paper, 'glow')).toHaveLength(0);
});

test('bottom row marks kicks X and snares x in accent; snares leave a light column', () => {
  const p = new RecordingPainter();
  glyphLook.draw(
    p,
    makeCtx(4, {
      drums: [
        { time: 1, kind: 'kick', velocity: 1 },
        { time: 3, kind: 'snare', velocity: 1 },
      ],
    }),
  );
  const rows = textRows(p);
  const last = rows[rows.length - 1];
  expect(last).toContain('X');
  expect(last).toContain('x');
  expect(last.indexOf('X')).toBeLessThan(last.indexOf('x'));
  const fills = p.ops.filter((o) => o.op === 'fill').map((o) => o.args[0]);
  expect(fills[fills.length - 1]).toBe(darkGlow.accent);
  expect(opsOf(p, 'rect')).toHaveLength(1);
});

test('high frequencies are on top', () => {
  // 只有最高 bin 有能量
  const s = spectrumWith(60, (bin) => (bin === 15 ? 1 : 0));
  const p = new RecordingPainter();
  glyphLook.draw(p, makeCtx(10, { spectrum: s }, { params: { bars: 1 } }));
  const rows = textRows(p);
  expect(rows[0].trim()).not.toBe('');
  expect(rows[rows.length - 2].trim()).toBe('');
});

test('readouts: GRID / STEP / BASS', () => {
  const ctx = makeCtx(1.2, { bass: [{ time: 0, duration: 4, midi: 26, bends: [] }] });
  const { rows } = gridFor(ctx);
  expect(glyphLook.readouts?.(ctx)).toEqual([
    { label: 'GRID', value: `72 × ${rows + 1}` },
    { label: 'STEP', value: '10 / 16' },
    { label: 'BASS', value: 'D1' },
  ]);
});

test('registry exposes glyph as number 14', () => {
  expect(looks.glyph).toBe(glyphLook);
  expect(glyphLook).toMatchObject({ id: 'glyph', number: 14 });
});
