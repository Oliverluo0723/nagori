import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { bpmAt, buildTempoMap, positionAt, timeOfBar } from './tempo';

test('120 bpm 4/4: t=2s is bar 2 beat 1', () => {
  const midi = new Midi(makeMidi({ bpm: 120, tracks: [] }));
  const map = buildTempoMap(midi.header);
  expect(positionAt(map, 2)).toMatchObject({ bar: 2, beat: 1, bpm: 120 });
  expect(positionAt(map, 2.25).beatPhase).toBeCloseTo(0.5);
  expect(timeOfBar(map, 3)).toBeCloseTo(4);
});

test('tempo change at beat 8 from 120 to 60 matches ticksToSeconds', () => {
  const midi = new Midi(makeMidi({ bpm: 120, tempoChanges: [{ beat: 8, bpm: 60 }], tracks: [] }));
  const map = buildTempoMap(midi.header);
  const ppq = midi.header.ppq;
  expect(timeOfBar(map, 4)).toBeCloseTo(midi.header.ticksToSeconds(12 * ppq));
  expect(positionAt(map, timeOfBar(map, 4) + 0.5)).toMatchObject({ bar: 4, beat: 1 });
  expect(bpmAt(map, 10)).toBe(60);
});

test('first tempo event after tick 0: timeOfBar and positionAt agree (reviewer finding)', () => {
  // 唯一的 tempo 事件在第 4 拍（tick 4*ppq），之前的段落應沿用同一個 bpm
  const map = { ppq: 480, tempos: [{ ticks: 4 * 480, bpm: 100 }], timeSignatures: [] };
  expect(timeOfBar(map, 3)).toBeCloseTo(4.8);
  expect(positionAt(map, 4.8)).toMatchObject({ bar: 3, beat: 1 });
  expect(bpmAt(map, 0)).toBe(100);
});
