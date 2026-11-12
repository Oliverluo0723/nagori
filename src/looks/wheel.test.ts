import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import type { ChordEvent, KeyInfo } from '../analysis/types';
import { RecordingPainter } from './painter/recording';
import { pitchWeights, sectorAngles, wheelLook } from './wheel';

const W = 1080;
const H = 1920;
const ACCENT = '#ff4a1c';
const Bm: ChordEvent = { time: 0, duration: 2, root: 11, name: 'Bm', notes: [2, 6, 11] };
const G: ChordEvent = { time: 2, duration: 2, root: 7, name: 'G', notes: [2, 7, 11] };
const dMajor: KeyInfo = { tonic: 2, mode: 'major', name: 'D major' };
const ctx = (t: number, chords?: ChordEvent[], key?: KeyInfo, w = W, h = H) =>
  makeCtx(t, { chords, key }, { w, h });
const texts = (p: RecordingPainter) => opsOf(p, 'text').map((o) => o.args[0]);

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  wheelLook.draw(a, ctx(1, [Bm, G], dMajor));
  wheelLook.draw(b, ctx(1, [Bm, G], dMajor));
  expect(a.ops).toEqual(b.ops);
});

test('wedge length follows how much each pitch class sounds: chord tones long, root longest', () => {
  const v = pitchWeights(ctx(1, [Bm, G], dMajor));
  expect(v[11]).toBeCloseTo(0.82); // 根音 B
  expect(v[2]).toBeCloseTo(0.62); // 和弦音 D
  expect(v[9]).toBeCloseTo(0.14); // 調內但沒在和弦裡的 A
  expect(v[1]).toBeGreaterThan(0); // C♯ 在 D 大調裡
  expect(v[3]).toBe(0); // D♯ 調外
  // 前一個和弦剛結束：它的音還有一點餘音
  const after = pitchWeights(ctx(2.5, [Bm, G], dMajor));
  expect(after[6]).toBeGreaterThan(0.14); // F♯ 只在 Bm 裡
  expect(after[6]).toBeLessThan(0.5);
});

test('current chord root B is an accent wedge plus an accent outline at its fifths sector', () => {
  const p = new RecordingPainter();
  wheelLook.draw(p, ctx(1, [Bm, G], dMajor));
  const [a] = sectorAngles(11);
  const accentFill = p.ops.findIndex((o) => o.op === 'fill' && o.args[0] === ACCENT);
  const filled = p.ops.slice(accentFill + 1).find((o) => o.op === 'wedge');
  expect(filled?.args[4]).toBeCloseTo(a, 9);
  const accentStroke = p.ops.findIndex((o) => o.op === 'stroke' && o.args[0] === ACCENT);
  const outline = p.ops.slice(accentStroke + 1).find((o) => o.op === 'wedge');
  expect(outline?.args[4]).toBeCloseTo(a, 9);
  expect(outline?.args[3] as number).toBeGreaterThan(filled?.args[3] as number);
});

test('the centre shows the key letter and MAJOR; all 12 note names ring the wheel', () => {
  const p = new RecordingPainter();
  wheelLook.draw(p, ctx(1, [Bm, G], dMajor));
  const all = texts(p);
  expect(all).toContain('D');
  expect(all).toContain('MAJOR');
  for (const n of ['C', 'G', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'F']) {
    expect(all).toContain(n);
  }
  // 舊的圖內「CHORD … NEXT …」字樣已移到讀數列
  expect(all.some((s) => typeof s === 'string' && s.includes('NEXT'))).toBe(false);
});

test('readouts: KEY / CHORD NOW / NEXT / ORDER', () => {
  const r = wheelLook.readouts?.(ctx(1, [Bm, G], dMajor));
  expect(r).toEqual([
    { label: 'KEY', value: '≈ D major' },
    { label: 'CHORD NOW', value: 'Bm' },
    { label: 'NEXT', value: 'G' },
    { label: 'ORDER', value: 'circle of fifths' },
  ]);
});

test('a tall cell gets a chord roll under the wheel; a square one does not', () => {
  const tall = new RecordingPainter();
  wheelLook.draw(tall, ctx(1, [Bm, G], dMajor));
  expect(texts(tall)).toContain('Bm');
  const square = new RecordingPainter();
  wheelLook.draw(square, ctx(1, [Bm, G], dMajor, 900, 900));
  expect(texts(square)).not.toContain('Bm');
});

test('no chords and no key: 12 outline wedges, dash in the centre, no accent fill', () => {
  const p = new RecordingPainter();
  wheelLook.draw(p, ctx(1));
  expect(opsOf(p, 'wedge')).toHaveLength(12);
  expect(texts(p)).toContain('–');
  expect(p.ops.some((o) => o.op === 'fill' && o.args[0] === ACCENT)).toBe(false);
});
