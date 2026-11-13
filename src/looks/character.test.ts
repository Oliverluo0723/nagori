import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { characterLook, movingIndex, partAt, positions, SCALES } from './character';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const kick = (time: number): DrumHit => ({ time, kind: 'kick', velocity: 1 });

test('registry exposes character as number 38', () => {
  expect(looks.character).toBe(characterLook);
  expect(characterLook).toMatchObject({ id: 'character', number: 38, name: '聲音性格' });
});

test('deterministic; five scales, ten words, one glowing zig-zag; paper issues no glow or add', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  characterLook.draw(a, makeCtx(20, { spectrum: s }));
  characterLook.draw(b, makeCtx(20, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
  expect(opsOf(a, 'line')).toHaveLength(SCALES.length);
  for (const [left, right] of SCALES) {
    expect(hasText(a, left)).toBe(true);
    expect(hasText(a, right)).toBe(true);
  }
  // 寬的淡線 + 細的亮線
  expect(opsOf(a, 'polyline')).toHaveLength(2);
  // 5 個小點 + 5 個大點（光暈 + 核心）
  expect(opsOf(a, 'circle')).toHaveLength(5 + 5 * 2);
  // 移動中的那條量尺：兩個字各一個框
  expect(opsOf(a, 'rect')).toHaveLength(2);
  expect(opsOf(a, 'glow')).toHaveLength(0);
  expect(opsOf(a, 'blend').some((o) => o.args[0] === 'add')).toBe(true);

  const paper = new RecordingPainter();
  characterLook.draw(paper, makeCtx(20, { spectrum: s }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
  expect(opsOf(paper, 'blend').some((o) => o.args[0] === 'add')).toBe(false);
  expect(opsOf(paper, 'circle')).toHaveLength(5 + 5);
});

test('empty readings still draw the frame', () => {
  const p = new RecordingPainter();
  characterLook.draw(p, makeCtx(5, {}));
  expect(opsOf(p, 'line')).toHaveLength(SCALES.length);
  expect(opsOf(p, 'polyline')).toHaveLength(2);
  expect(positions(makeCtx(5, {}), 0.4).every((q) => q.now === 0.5 && q.before === 0.5)).toBe(true);
});

test('brightness and weight follow where the energy sits; the scale that moved most is tinted', () => {
  // 前 48 秒能量在 250 Hz 以下（bin 0–4），之後在高頻
  const s = spectrumWith(60, (b, f) => (f < 480 ? (b < 5 ? 0.9 : 0.05) : b >= 5 ? 0.9 : 0.05));
  const early = positions(makeCtx(10, { spectrum: s }), 0.4);
  expect(early[0].now).toBeLessThan(0.2); // dark
  expect(early[4].now).toBeGreaterThan(0.8); // heavy
  const late = positions(makeCtx(50, { spectrum: s }), 0.4);
  expect(late[0].now).toBeGreaterThan(0.8); // bright
  expect(late[4].now).toBeLessThan(0.2); // light
  // 上一段（42–46 s）還是暗的
  expect(late[0].before).toBeLessThan(0.2);
  expect([0, 4]).toContain(movingIndex(late));

  const p = new RecordingPainter();
  characterLook.draw(p, makeCtx(50, { spectrum: s }));
  const hazes = opsOf(p, 'haze').filter((o) => o.args[3] === darkGlow.accent);
  expect(hazes).toHaveLength(1);
  const blue = opsOf(p, 'haze').filter((o) => o.args[3] === darkGlow.noteColors[9]);
  expect(blue.length).toBeGreaterThan(4);
});

test('drum transients make the sound harder', () => {
  const s = flatSpectrum(60, 0.5);
  const drums = Array.from({ length: 60 }, (_, i) => kick(i * 0.5));
  const withHits = positions(makeCtx(10, { spectrum: s, drums }), 0.4);
  const after = positions(makeCtx(50, { spectrum: s, drums }), 0.4);
  expect(withHits[2].now).toBeGreaterThan(after[2].now);
});

test('readouts: NOW three words, MOVING, PART from recent energy', () => {
  // 前 30 秒小聲、之後大聲
  const s = spectrumWith(60, (_b, f) => (f < 300 ? 0.1 : 0.9));
  expect(partAt(s, 10)).toBe('Quiet');
  expect(partAt(s, 50)).toBe('Drop');
  expect(partAt(undefined, 10)).toBe('—');
  // t = 34：上一段（26–30 s）還在小聲的那半，CALM–INTENSE 是移動最多的量尺
  const r = characterLook.readouts?.(makeCtx(34, { spectrum: s })) ?? [];
  expect(r.map((x) => x.label)).toEqual(['NOW', 'MOVING', 'PART']);
  expect(r[0].value).toMatch(/^[a-z]+ · [a-z]+ · [a-z]+$/);
  expect(r[0].value).toContain('intense');
  expect(r[1].value).toBe('intense');
  expect(r[2].value).toBe('Drop');
});
