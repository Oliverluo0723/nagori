import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import {
  bpmAt,
  buildTempoMap,
  positionAt,
  secondsToTicks,
  tempoMapFromBeats,
  tempoMapFromBpm,
  ticksToSeconds,
  timeOfBar,
} from './tempo';

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

test('tempoMapFromBpm with an offset puts bar 1 beat 1 at the offset', () => {
  const map = tempoMapFromBpm(120, 0.5);
  expect(positionAt(map, 0.5)).toMatchObject({ bar: 1, beat: 1 });
  expect(positionAt(map, 2.5)).toMatchObject({ bar: 2, beat: 1 });
  expect(timeOfBar(map, 2)).toBeCloseTo(2.5);
  expect(secondsToTicks(map, 0.5)).toBeCloseTo(0);
  expect(ticksToSeconds(map, 0)).toBeCloseTo(0.5);
  expect(bpmAt(map, 10)).toBe(120);
});

test('tempoMapFromBeats: steady beats collapse to one tempo, positions land on the ticks', () => {
  const beats = Array.from({ length: 16 }, (_, i) => 1.3 + i * 0.5);
  const map = tempoMapFromBeats(beats);
  expect(map.tempos).toEqual([{ ticks: 0, bpm: 120 }]);
  expect(map.offset).toBeCloseTo(1.3);
  expect(positionAt(map, 1.3)).toMatchObject({ bar: 1, beat: 1 });
  expect(positionAt(map, 3.31)).toMatchObject({ bar: 2, beat: 1 });
  expect(positionAt(map, 0.8).bar).toBe(0);
});

test('tempoMapFromBeats: a tempo ramp keeps bar positions on the detected beats', () => {
  // 88 → 104 bpm 線性加速 48 拍
  const beats = [1.3];
  for (let i = 0; i < 48; i++) beats.push(beats[i] + 60 / (88 + (16 * i) / 48));
  const map = tempoMapFromBeats(beats);
  for (let i = 0; i < beats.length; i++) {
    const pos = secondsToTicks(map, beats[i]) / map.ppq;
    expect(Math.abs(pos - i)).toBeLessThan(0.05);
  }
  expect(bpmAt(map, beats[0])).toBeLessThan(92);
  expect(bpmAt(map, beats[47])).toBeGreaterThan(100);
  // 最後一拍之後沿用最後的速度
  expect(bpmAt(map, beats[48] + 10)).toBeCloseTo(bpmAt(map, beats[47]), 0);
});

test('tempoMapFromBeats: downbeat index shifts bar 1 and drops the beats before it', () => {
  const beats = Array.from({ length: 12 }, (_, i) => i * 0.5);
  const map = tempoMapFromBeats(beats, { downbeat: 2 });
  expect(map.offset).toBeCloseTo(1);
  expect(positionAt(map, 1)).toMatchObject({ bar: 1, beat: 1 });
  expect(positionAt(map, 0.5)).toMatchObject({ bar: 0, beat: 4 });
  expect(tempoMapFromBeats([2]).tempos[0].bpm).toBe(120);
});
