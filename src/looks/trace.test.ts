import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { BASS_LINES, CURL_LINES, kicksIn, LINES, traceLook } from './trace';

const kick = (time: number): DrumHit => ({ time, kind: 'kick', velocity: 1 });
/** 每個捲弧在最低三條線上各捲三圈。 */
const ARCS_PER_KICK = CURL_LINES * 3;

test('registry exposes trace as number 33', () => {
  expect(looks.trace).toBe(traceLook);
  expect(traceLook).toMatchObject({ id: 'trace', number: 33, name: '頻帶描線' });
});

test('deterministic; 22 lines with a dot at each right end; paper issues no glow or add', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  traceLook.draw(a, makeCtx(12, { spectrum: s }));
  traceLook.draw(b, makeCtx(12, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
  expect(opsOf(a, 'polyline')).toHaveLength(LINES);
  // 每條線 12 s × 30 個樣本 + 現在那一點
  expect((opsOf(a, 'polyline')[0].args[0] as unknown[]).length).toBe(362);
  // 黑底：每個尾端點是光暈加核心
  expect(opsOf(a, 'circle')).toHaveLength(LINES * 2);
  expect(opsOf(a, 'glow')).toHaveLength(0);

  const paper = new RecordingPainter();
  traceLook.draw(paper, makeCtx(12, { spectrum: s }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
  expect(opsOf(paper, 'blend')).toHaveLength(0);
  expect(opsOf(paper, 'circle')).toHaveLength(LINES);
  // 最低幾條線的點是強調色，其餘墨色
  const fills = opsOf(paper, 'fill').filter((o) => o.args[0] !== paperInk.mute);
  expect(fills.slice(0, BASS_LINES).every((o) => o.args[0] === paperInk.accent)).toBe(true);
  expect(fills.slice(BASS_LINES).every((o) => o.args[0] === paperInk.ink)).toBe(true);
});

test('the first kick of each bar curls three arcs on each of the lowest lines', () => {
  const s = flatSpectrum(60, 0.5);
  const none = new RecordingPainter();
  traceLook.draw(none, makeCtx(12, { spectrum: s, drums: [kick(30)] }));
  const one = new RecordingPainter();
  traceLook.draw(one, makeCtx(12, { spectrum: s, drums: [kick(11)] }));
  expect(opsOf(one, 'polyline').length - opsOf(none, 'polyline').length).toBe(ARCS_PER_KICK);
  // 弧開口朝上：所有點都在基線上方（y 更小）
  const arc = opsOf(one, 'polyline')[0].args[0] as { x: number; y: number }[];
  const base = Math.max(...arc.map((q) => q.y));
  expect(arc[0].y).toBeCloseTo(base);
  expect(Math.min(...arc.map((q) => q.y))).toBeLessThan(base - 10);

  // 120 BPM 一小節 2 秒；0.5–10.4 秒每 0.1 秒一個 kick，只有每小節第一個捲
  const many = Array.from({ length: 100 }, (_, i) => kick(0.5 + i * 0.1));
  const tempo = makeCtx(0, {}).readings.tempo;
  const curls = kicksIn(many, tempo, 0, 12);
  expect(curls.map((k) => k.time.toFixed(1))).toEqual(['10.0', '8.0', '6.0', '4.0', '2.0', '0.5']);
  const dense = new RecordingPainter();
  traceLook.draw(dense, makeCtx(12, { spectrum: s, drums: many }));
  expect(opsOf(dense, 'polyline').length - opsOf(none, 'polyline').length).toBe(6 * ARCS_PER_KICK);
});

test('a band louder than usual lifts its line end; silence still draws 22 flat lines', () => {
  // 前 10 秒小聲、之後大聲
  const s = spectrumWith(60, (_b, f) => (f < 100 ? 0.1 : 0.9));
  const topDotY = (t: number) => {
    const p = new RecordingPainter();
    traceLook.draw(p, makeCtx(t, { spectrum: s }));
    const circles = opsOf(p, 'circle');
    return circles[circles.length - 1].args[1] as number;
  };
  expect(topDotY(20)).toBeLessThan(topDotY(5));

  const empty = new RecordingPainter();
  traceLook.draw(empty, makeCtx(12, {}));
  expect(opsOf(empty, 'polyline')).toHaveLength(0);
  expect(opsOf(empty, 'circle')).toHaveLength(LINES * 2);
});

test('bar numbers run along the bottom for the window and the empty strip to its right', () => {
  // 120 BPM 4/4：每小節 2 s；視窗 [0, 12] 加右邊 14% → 小節 1..7
  const p = new RecordingPainter();
  traceLook.draw(p, makeCtx(12, { spectrum: flatSpectrum(60, 0.5) }));
  for (const bar of ['1', '4', '7']) expect(hasText(p, bar)).toBe(true);
  expect(hasText(p, '8')).toBe(false);
  expect(opsOf(p, 'line')).toHaveLength(7);
});

test('readouts: LINES / WINDOW / BASS', () => {
  const bass = [{ time: 0, duration: 60, midi: 26, bends: [] }];
  const r = traceLook.readouts?.(makeCtx(12, { bass })) ?? [];
  expect(r).toEqual([
    { label: 'LINES', value: '22' },
    { label: 'WINDOW', value: '12 s' },
    { label: 'BASS', value: 'D1' },
  ]);
  const short = traceLook.readouts?.(makeCtx(12, {}, { params: { window: 8 } })) ?? [];
  expect(short[1].value).toBe('8 s');
  expect(short[2].value).toBe('—');
});
