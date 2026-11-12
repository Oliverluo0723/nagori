import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { binHz } from '../analysis/audio/spectrum';
import type { BassNote, ChordEvent, DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { dewLook } from './dew';
import { flowLook, sources } from './flow';
import { fountainLook } from './fountain';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { bassAt, rngFor, ticksAlive } from './sheet';
import { starsLook } from './stars';
import type { Look } from './types';

const hits: DrumHit[] = [
  { time: 1, kind: 'kick', velocity: 1 },
  { time: 1.5, kind: 'snare', velocity: 0.8 },
  { time: 1.75, kind: 'hat', velocity: 0.5 },
  { time: 40, kind: 'kick', velocity: 1 },
];
const bass: BassNote[] = [
  { time: 0, duration: 2, midi: 38, bends: [{ time: 1, semitones: 2 }] },
  { time: 2, duration: 2, midi: 43, bends: [] },
];
const chords: ChordEvent[] = [{ time: 0, duration: 8, root: 2, name: 'D', notes: [2, 6, 9] }];
const full = { spectrum: flatSpectrum(60, 0.6), drums: hits, bass, chords };

const all: [Look, number][] = [
  [fountainLook, 19],
  [dewLook, 20],
  [starsLook, 23],
  [flowLook, 24],
];

test('helpers: ticksAlive covers [t − life, t]; rngFor is stable per (seed, k); bassAt applies bends', () => {
  expect(ticksAlive(2, 10, 0.5)).toEqual([16, 20]);
  expect(ticksAlive(0.1, 10, 5)).toEqual([0, 1]);
  expect(rngFor(1, 3)()).toBe(rngFor(1, 3)());
  expect(rngFor(1, 3)()).not.toBe(rngFor(1, 4)());
  expect(bassAt(bass, 0.5)?.midi).toBe(38);
  expect(bassAt(bass, 1.5)?.midi).toBe(40);
  expect(bassAt(bass, 3)?.midi).toBe(43);
  expect(bassAt(bass, 5)).toBeNull();
  expect(bassAt(bass, 5, true)?.midi).toBe(43);
  expect(bassAt(bass, -1, true)).toBeNull();
});

for (const [look, number] of all) {
  test(`${look.id}: deterministic, registered as ${number}, empty readings draw the label, paper never glows`, () => {
    const a = new RecordingPainter();
    const b = new RecordingPainter();
    look.draw(a, makeCtx(2.2, full));
    look.draw(b, makeCtx(2.2, full));
    expect(a.ops).toEqual(b.ops);
    expect(a.ops.length).toBeGreaterThan(5);
    expect(looks[look.id]).toBe(look);
    expect(look.number).toBe(number);
    const empty = new RecordingPainter();
    look.draw(empty, makeCtx(2.2, {}, { theme: paperInk, label: look.id.toUpperCase() }));
    expect(hasText(empty, look.id.toUpperCase())).toBe(true);
    expect(opsOf(empty, 'glow')).toHaveLength(0);
    const paper = new RecordingPainter();
    look.draw(paper, makeCtx(2.2, full, { theme: paperInk }));
    expect(opsOf(paper, 'glow')).toHaveLength(0);
  });
}

test('fountain: sparks fade out after their life; a louder song sprays more', () => {
  const count = (t: number, v: number) => {
    const p = new RecordingPainter();
    fountainLook.draw(p, makeCtx(t, { spectrum: flatSpectrum(60, v), drums: hits }));
    return opsOf(p, 'circle').length;
  };
  expect(count(1.2, 0)).toBeGreaterThan(0); // kick 的火花
  expect(count(5, 0)).toBe(0); // 都落地了
  expect(count(5, 0.9)).toBeGreaterThan(count(5, 0.3));
});

test('dew: drops only on threads of bands with energy, and they fall over time', () => {
  const s = spectrumWith(60, (bin) => {
    const hz = binHz(
      { fps: 10, bins: 16, minHz: 30, maxHz: 16000, frames: new Float32Array(), frameCount: 0 },
      bin,
    );
    return hz > 60 && hz < 250 ? 1 : 0;
  });
  const p = new RecordingPainter();
  dewLook.draw(p, makeCtx(3, { spectrum: s }, { params: { threads: 1, fall: 10 } }));
  const drops = opsOf(p, 'circle');
  expect(drops.length).toBeGreaterThan(0);
  const xs = new Set(drops.map((d) => d.args[0]));
  expect(xs.size).toBe(1); // 只有 bass 那條線
  const q = new RecordingPainter();
  dewLook.draw(q, makeCtx(3.5, { spectrum: s }, { params: { threads: 1, fall: 10 } }));
  // 同一滴（第 0 拍出的，壽命 10 秒所以兩邊都還在）在 3.5 秒時比 3 秒時低
  const first = (r: RecordingPainter) => opsOf(r, 'circle')[0].args[1] as number;
  expect(first(q)).toBeGreaterThan(first(p));
});

test('stars: every hit of the sky is a star, lit ones are bigger, later skies show their own bars', () => {
  const p = new RecordingPainter();
  starsLook.draw(p, makeCtx(2, { drums: hits }));
  // 8 小節 = 16 秒：前三個 hit 在這片天空（亮 = 2 圈、未亮 = 1 圈），40 秒的不在
  expect(opsOf(p, 'circle')).toHaveLength(3 * 2);
  expect(hasText(p, '1')).toBe(true);
  const later = new RecordingPainter();
  starsLook.draw(later, makeCtx(1.2, { drums: hits }));
  expect(opsOf(later, 'circle')).toHaveLength(2 + 1 + 1); // kick 亮、snare 與 hat 未亮
  const page3 = new RecordingPainter();
  starsLook.draw(page3, makeCtx(40, { drums: hits }));
  expect(hasText(page3, '17')).toBe(true);
});

test('flow: lines + 7 source rings; sources are fixed per seed', () => {
  const p = new RecordingPainter();
  flowLook.draw(
    p,
    makeCtx(5, { spectrum: flatSpectrum(60, 0.5) }, { params: { lines: 30, steps: 10 } }),
  );
  expect(opsOf(p, 'polyline').length).toBeGreaterThan(20);
  expect(opsOf(p, 'circle')).toHaveLength(14);
  expect(sources(1)).toEqual(sources(1));
  expect(sources(1)).not.toEqual(sources(2));
});
