import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { binHz } from '../analysis/audio/spectrum';
import type { BassNote, ChordEvent, DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { cometLook } from './comet';
import { dewDropsAt, dewLook, dewThreads } from './dew';
import { flowLook, sources } from './flow';
import { fountainLook } from './fountain';
import { kaleidoLook } from './kaleido';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { bassAt, rngFor, ticksAlive } from './sheet';
import { noteOf, starsLook } from './stars';
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
  [kaleidoLook, 21],
  [cometLook, 22],
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

test('fountain: sparks fade out after their life; a louder song sprays more; readouts count them', () => {
  const sparks = (t: number, v: number) => {
    const r = fountainLook.readouts?.(makeCtx(t, { spectrum: flatSpectrum(60, v), drums: hits }));
    expect(r?.map((x) => x.label)).toEqual(['SPARKS', 'SIDES · LOWS', 'MIDDLE · HIGHS']);
    return Number(r?.[0].value);
  };
  expect(sparks(1.2, 0)).toBeGreaterThan(0); // kick 甩出的火花
  expect(sparks(5, 0)).toBe(0); // 都熄了
  expect(sparks(5, 0.9)).toBeGreaterThan(sparks(5, 0.3));
  // 火花用小方塊畫、不用 glow；黑底用相加疊光
  const p = new RecordingPainter();
  fountainLook.draw(p, makeCtx(5, { spectrum: flatSpectrum(60, 0.8), drums: hits }));
  expect(opsOf(p, 'rect').length).toBeGreaterThan(1000);
  expect(opsOf(p, 'glow')).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'blend' && o.args[0] === 'add')).toBe(true);
});

test('dew: drops only on threads of bands with energy, and they slide down over time', () => {
  const s = spectrumWith(60, (bin) => {
    const hz = binHz(
      { fps: 10, bins: 16, minHz: 30, maxHz: 16000, frames: new Float32Array(), frameCount: 0 },
      bin,
    );
    return hz > 60 && hz < 250 ? 1 : 0;
  });
  const threads = dewThreads(16, 1);
  const at = (t: number) =>
    dewDropsAt(makeCtx(t, { spectrum: s }, { params: { fall: 10 } }), threads);
  const drops = at(3.1);
  expect(drops.length).toBeGreaterThan(0);
  for (const d of drops) {
    const th = threads[d.thread];
    expect(th.hi).toBeGreaterThan(40);
    expect(th.lo).toBeLessThan(320);
  }
  // 最舊的那滴（第一拍出的，壽命 10 秒所以兩邊都還在）在 3.6 秒時比 3.1 秒時低
  const later = at(3.6);
  expect(later.at(-1)?.thread).toBe(drops.at(-1)?.thread);
  expect(later.at(-1)?.y ?? 0).toBeGreaterThan(drops.at(-1)?.y ?? 0);
  const r = dewLook.readouts?.(makeCtx(3.1, { spectrum: s }, { params: { fall: 10 } }));
  expect(r?.map((x) => x.label)).toEqual(['THREADS', 'FALLING', 'FULLEST', 'HAZE']);
  expect(r?.[0].value).toBe('16');
  expect(r?.[1].value).toBe(String(drops.length));
});

test('kaleido: each particle appears 2 × segments times (halo + core on dark); old hits vanish', () => {
  const p = new RecordingPainter();
  kaleidoLook.draw(p, makeCtx(1.1, { drums: [hits[0]] }, { params: { segments: 6 } }));
  expect(opsOf(p, 'circle')).toHaveLength(6 * 12 * 2);
  expect(opsOf(p, 'glow')).toHaveLength(0);
  const q = new RecordingPainter();
  kaleidoLook.draw(q, makeCtx(10, { drums: [hits[0]] }));
  expect(opsOf(q, 'circle')).toHaveLength(0);
  const fills = p.ops.filter((o) => o.op === 'fill').map((o) => o.args[0]);
  expect(fills).toContain(darkGlow.accent);
});

test('comet: head sits on the now line at the bass pitch; falls back to low band without bass', () => {
  const p = new RecordingPainter();
  cometLook.draw(p, makeCtx(3, { bass, chords }));
  const head = opsOf(p, 'circle').slice(-2)[0];
  expect(head.args[0]).toBeCloseTo(1080 * 0.62);
  const higher = new RecordingPainter();
  cometLook.draw(higher, makeCtx(1, { bass, chords })); // midi 38 低於 43 → y 更大
  const headY = (r: RecordingPainter) => opsOf(r, 'circle').slice(-2)[0].args[1] as number;
  expect(headY(higher)).toBeGreaterThan(headY(p));
  const noBass = new RecordingPainter();
  cometLook.draw(noBass, makeCtx(3, { spectrum: flatSpectrum(60, 0.5) }));
  expect(opsOf(noBass, 'circle').length).toBeGreaterThan(0);
  const nothing = new RecordingPainter();
  cometLook.draw(nothing, makeCtx(3, {}));
  expect(opsOf(nothing, 'circle')).toHaveLength(0);
});

test('stars: the whole sky is laid out, the playhead lights it; newest star is ringed and named', () => {
  const ctx = (t: number) => makeCtx(t, { drums: hits, bass });
  const circles = (t: number) => {
    const p = new RecordingPainter();
    starsLook.draw(p, ctx(t));
    return p;
  };
  // 8 小節 = 16 秒：前三個 hit 在這片天空，40 秒的不在；140 顆細塵 + 3 顆星，亮了才多一個圈
  expect(opsOf(circles(0.5), 'circle')).toHaveLength(140 + 3);
  expect(opsOf(circles(1.2), 'circle')).toHaveLength(140 + 3 + 1);
  const lit = (t: number) => starsLook.readouts?.(ctx(t)) ?? [];
  expect(lit(0.5)[0]).toEqual({ label: 'STARS LIT', value: '0' });
  expect(lit(1.2)[0]).toEqual({ label: 'STARS LIT', value: '1' });
  expect(lit(2)[0]).toEqual({ label: 'STARS LIT', value: '3' });
  expect(lit(2).map((r) => r.label)).toEqual(['STARS LIT', 'SKY', 'TEMPO']);
  expect(lit(2)[1].value).toBe('bars 1–8');
  // 1 秒的 kick 落在 bass（38 + bend 2 = E2）上
  expect(hasText(circles(1.2), 'E2')).toBe(true);
  expect(
    noteOf({ duration: 1, tempo: makeCtx(0, {}).readings.tempo, drums: [], roles: [] }, hits[0]),
  ).toBe('KICK');
  // 小節號含終點；後面的天空換自己的小節號
  expect(hasText(circles(2), '9')).toBe(true);
  const page3 = circles(40);
  expect(hasText(page3, '17')).toBe(true);
  expect(lit(40)[1].value).toBe('bars 17–24');
});

test('flow: fine lines + 11 source rings sized by band energy; sources are fixed per seed', () => {
  const p = new RecordingPainter();
  flowLook.draw(
    p,
    makeCtx(5, { spectrum: flatSpectrum(60, 0.5) }, { params: { lines: 30, steps: 10 } }),
  );
  expect(opsOf(p, 'polyline').length).toBeGreaterThan(20);
  expect(opsOf(p, 'circle')).toHaveLength(11);
  expect(sources(1)).toEqual(sources(1));
  expect(sources(1)).not.toEqual(sources(2));
  // 前半首小聲、後半首大聲：後半的圈比較大
  const s = spectrumWith(60, (_b, f) => (f < 300 ? 0.2 : 0.9));
  const ring = (t: number) => {
    const q = new RecordingPainter();
    flowLook.draw(q, makeCtx(t, { spectrum: s }, { params: { lines: 30, steps: 10 } }));
    return opsOf(q, 'circle')[0].args[2] as number;
  };
  expect(ring(50)).toBeGreaterThan(ring(10));
  const r = flowLook.readouts?.(makeCtx(50, { spectrum: s }));
  expect(r?.map((x) => x.label)).toEqual(['SOURCES', 'STRONGEST', 'SWIRL', 'DRIFT']);
  expect(r?.[0].value).toBe('11');
});
