import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow } from '../compose/themes';
import { CHARS, COLS, charFor, glyphLook } from './glyph';
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

test('rows + 1 strings of 72 chars; time before the song is blank', () => {
  const s = flatSpectrum(60, 0.9);
  const p = new RecordingPainter();
  glyphLook.draw(
    p,
    makeCtx(2, { spectrum: s }, { params: { rows: 12, bars: 2 }, label: '14 GLYPH' }),
  );
  const rows = textRows(p);
  expect(rows).toHaveLength(13);
  // 視窗 4 秒、t = 2：左半在歌開始之前，是空白；右半是重字元
  expect(rows[0].slice(0, 30).trim()).toBe('');
  expect(rows[0].slice(40)).toMatch(/^\*+$/);
  expect(hasText(p, '14 GLYPH')).toBe(true);
});

test('bottom row marks kicks X and snares x in accent', () => {
  const p = new RecordingPainter();
  glyphLook.draw(
    p,
    makeCtx(
      4,
      {
        drums: [
          { time: 1, kind: 'kick', velocity: 1 },
          { time: 3, kind: 'snare', velocity: 1 },
        ],
      },
      { params: { rows: 4, bars: 2 } },
    ),
  );
  const rows = textRows(p);
  const last = rows[rows.length - 1];
  expect(last).toContain('X');
  expect(last).toContain('x');
  expect(last.indexOf('X')).toBeLessThan(last.indexOf('x'));
  const fills = p.ops.filter((o) => o.op === 'fill').map((o) => o.args[0]);
  expect(fills[fills.length - 2]).toBe(darkGlow.accent);
});

test('high frequencies are on top', () => {
  // 只有最高 bin 有能量
  const s = spectrumWith(60, (bin) => (bin === 15 ? 1 : 0));
  const p = new RecordingPainter();
  glyphLook.draw(p, makeCtx(10, { spectrum: s }, { params: { rows: 8, bars: 1 } }));
  const rows = textRows(p);
  expect(rows[0].trim()).not.toBe('');
  expect(rows[7].trim()).toBe('');
});

test('registry exposes glyph as number 14', () => {
  expect(looks.glyph).toBe(glyphLook);
  expect(glyphLook).toMatchObject({ id: 'glyph', number: 14 });
});
