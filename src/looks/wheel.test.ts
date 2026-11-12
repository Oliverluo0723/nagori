import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { ChordEvent, KeyInfo, Readings } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import type { LookContext } from './types';
import { wheelLook } from './wheel';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const W = 1080;
const H = 1920;
const Bm: ChordEvent = { time: 0, duration: 2, root: 11, name: 'Bm', notes: [2, 6, 11] };
const G: ChordEvent = { time: 2, duration: 2, root: 7, name: 'G', notes: [2, 7, 11] };
const dMajor: KeyInfo = { tonic: 2, mode: 'major', name: 'D major' };
const ctx = (t: number, chords?: ChordEvent[], key?: KeyInfo): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 60, tempo, drums: [], roles: [], chords, key } as Readings,
  theme: darkGlow,
  params: {},
  seed: 1,
  label: '01 WHEEL',
});
const wedges = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'wedge');
const texts = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'text').map((o) => o.args[0]);

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  wheelLook.draw(a, ctx(1, [Bm, G], dMajor));
  wheelLook.draw(b, ctx(1, [Bm, G], dMajor));
  expect(a.ops).toEqual(b.ops);
});

test('current chord root B is an accent-filled wedge at fifths index 5', () => {
  const p = new RecordingPainter();
  wheelLook.draw(p, ctx(1, [Bm, G], dMajor));
  const accentFillIdx = p.ops.findIndex((o) => o.op === 'fill' && o.args[0] === '#ff4a1c');
  expect(accentFillIdx).toBeGreaterThan(-1);
  const next = p.ops.slice(accentFillIdx + 1).find((o) => o.op === 'wedge');
  expect(next).toBeDefined();
  expect(next?.args[4]).toBeCloseTo(-Math.PI / 2 + (5 * Math.PI) / 6, 9);
});

test('readout names the current and next chord; centre shows the key tonic', () => {
  const p = new RecordingPainter();
  wheelLook.draw(p, ctx(1, [Bm, G], dMajor));
  const all = texts(p);
  expect(all.some((s) => typeof s === 'string' && s.includes('CHORD Bm'))).toBe(true);
  expect(all.some((s) => typeof s === 'string' && s.includes('NEXT G'))).toBe(true);
  expect(all).toContain('D');
  expect(all).toContain('major');
});

test('no chords and no key: 12 outline wedges, dash in the centre, no accent fill (review focus 1)', () => {
  const p = new RecordingPainter();
  wheelLook.draw(p, ctx(1));
  expect(wedges(p)).toHaveLength(12);
  expect(texts(p)).toContain('–');
  expect(p.ops.some((o) => o.op === 'fill' && o.args[0] === '#ff4a1c')).toBe(false);
  expect(texts(p).some((s) => typeof s === 'string' && s.includes('CHORD –'))).toBe(true);
});
