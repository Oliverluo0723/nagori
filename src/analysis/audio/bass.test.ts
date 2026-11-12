import { expect, test } from 'vitest';
import { synthBeat } from '../../../test/fixtures/audio';
import { bassPitchFrames, detectBass } from './bass';

const SR = 44100;

test('synthetic beat: each bar holds only its own bass note (35, 31, 38, 33)', () => {
  const notes = detectBass(synthBeat({ bars: 4 }), SR);
  expect(notes.length).toBeGreaterThanOrEqual(4);
  const expected = [35, 31, 38, 33];
  for (const n of notes) {
    // 起音允許 100 ms 誤差（kick 會蓋住 bass 起音約 100 ms），小節歸屬也給同樣的寬限
    const bar = Math.floor((n.time + 0.1) / 2);
    expect(n.midi, `note at ${n.time.toFixed(2)}`).toBe(expected[bar]);
  }
  // 每小節至少一個音，且第一個音離小節頭不超過 100 ms
  for (let bar = 0; bar < 4; bar++) {
    const inBar = notes.filter((n) => n.time >= bar * 2 - 0.1 && n.time < bar * 2 + 2);
    expect(inBar.length, `bar ${bar}`).toBeGreaterThan(0);
    expect(Math.abs(inBar[0].time - bar * 2)).toBeLessThanOrEqual(0.1);
  }
});

test('a constant bass of midi 40 without drums gives only 40s', () => {
  const notes = detectBass(synthBeat({ bars: 2, drums: false, bass: [40, 40, 40, 40] }), SR);
  expect(notes.length).toBeGreaterThan(0);
  for (const n of notes) expect(n.midi).toBe(40);
});

test('silence gives no notes; frames report null pitch (review focus 3)', () => {
  const silent = new Float32Array(SR * 3);
  expect(detectBass(silent, SR)).toEqual([]);
  const frames = bassPitchFrames(silent, SR);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((f) => f.midi === null)).toBe(true);
});
