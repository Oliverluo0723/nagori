import { expect, test } from 'vitest';
import { bpmAt } from '../analysis/tempo';
import { beatHits } from './beat';
import { KEY_MAP } from './keys';
import { createLiveSession, type LiveEvent, liveReadings } from './readings';

const on = (midi: number, time: number): LiveEvent => ({ type: 'on', midi, time });
const off = (midi: number, time: number): LiveEvent => ({ type: 'off', midi, time });

test('沒有事件：空的讀數，120 BPM，C 大調，固定音域', () => {
  const r = liveReadings([], 0);
  expect(r.notes).toEqual([]);
  expect(r.drums).toEqual([]);
  expect(r.bass).toEqual([]);
  expect(r.chords).toEqual([]);
  expect(bpmAt(r.tempo, 0)).toBe(120);
  expect(r.key).toEqual({ tonic: 0, mode: 'major', name: 'C major' });
  expect(r.noteRange).toEqual([58, 74]);
  expect(r.spectrum).toBeUndefined();
  expect(r.duration).toBe(60);
});

test('按下再放開是一顆音', () => {
  const r = liveReadings([on(60, 1), off(60, 1.5)], 3);
  expect(r.notes).toEqual([{ time: 1, duration: 0.5, midi: 60, velocity: 0.8 }]);
});

test('還按著的音，長度到現在為止', () => {
  expect(liveReadings([on(60, 1)], 3).notes?.[0].duration).toBe(2);
});

test('同一個音重複按下只算一顆', () => {
  expect(liveReadings([on(60, 1), on(60, 1.1), off(60, 2)], 3).notes).toHaveLength(1);
});

test('按的鼓疊在自動節奏上', () => {
  const r = liveReadings([{ type: 'drum', drum: 'kick', time: 0.3 }], 1);
  expect(r.drums).toEqual(
    [...beatHits(0, 1), { time: 0.3, kind: 'kick', velocity: 1 }].sort((a, b) => a.time - b.time),
  );
});

test('第一次按鍵就開始自動節奏，打到現在為止', () => {
  const r = liveReadings([on(60, 0), off(60, 0.2)], 2.1);
  expect(r.drums).toEqual(beatHits(0, 2.1));
  expect(r.drums.length).toBeGreaterThan(0);
});

test('bass 是同時按住的最低音，換了就分段', () => {
  const r = liveReadings([on(64, 0), on(60, 1), off(60, 2), off(64, 3)], 4);
  expect(r.bass?.map((b) => [b.time, b.duration, b.midi])).toEqual([
    [0, 1, 64],
    [1, 1, 60],
    [2, 1, 64],
  ]);
});

test('C E G 是 C；A C E 是 Am；轉位 E G C 還是 C', () => {
  const name = (ms: number[]) =>
    liveReadings(
      ms.map((m) => on(m, 0)),
      1,
    ).chords?.map((c) => c.name);
  expect(name([60, 64, 67])).toEqual(['C']);
  expect(name([69, 60, 64])).toEqual(['Am']);
  expect(name([64, 67, 72])).toEqual(['C']);
});

test('兩顆音不成和弦', () => {
  expect(liveReadings([on(60, 0), on(64, 0)], 1).chords).toEqual([]);
});

test('session：還沒按鍵時 readings 是同一個物件；開始後每次都新（自動節奏一直在走）', () => {
  const s = createLiveSession();
  expect(s.readings(0)).toBe(s.readings(0));
  s.noteOn(60, 0);
  s.noteOff(60, 2);
  expect(s.readings(3)).not.toBe(s.readings(4));
  expect(s.readings(5).notes?.[0].duration).toBe(2);
});

test('session：releaseAll 放開所有按住的音', () => {
  const s = createLiveSession();
  s.noteOn(60, 1);
  s.noteOn(64, 1);
  s.releaseAll(2);
  expect(s.readings(3).notes?.map((n) => n.duration)).toEqual([1, 1]);
});

test('KEY_MAP：A 是 C4，K 是 C5，Z X C 是 kick snare hat', () => {
  expect(KEY_MAP.KeyA).toEqual({ kind: 'note', midi: 60 });
  expect(KEY_MAP.KeyK).toEqual({ kind: 'note', midi: 72 });
  expect([KEY_MAP.KeyZ, KEY_MAP.KeyX, KEY_MAP.KeyC]).toEqual([
    { kind: 'drum', drum: 'kick' },
    { kind: 'drum', drum: 'snare' },
    { kind: 'drum', drum: 'hat' },
  ]);
  expect(Object.keys(KEY_MAP)).toHaveLength(16);
});
