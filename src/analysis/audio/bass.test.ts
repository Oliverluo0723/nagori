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
    const bar = Math.min(3, Math.floor((n.time + 0.16) / 2)); // 尾巴 1 秒算最後一小節
    expect(n.midi, `note at ${n.time.toFixed(2)}`).toBe(expected[bar]);
  }
  // 每小節至少一個音，且第一個音離小節頭不超過 100 ms
  for (let bar = 0; bar < 4; bar++) {
    const inBar = notes.filter((n) => n.time >= bar * 2 - 0.1 && n.time < bar * 2 + 2);
    expect(inBar.length, `bar ${bar}`).toBeGreaterThan(0);
    expect(Math.abs(inBar[0].time - bar * 2)).toBeLessThanOrEqual(0.16); // A1 那小節 kick 掃頻剛好壓在 55 Hz 上
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

/** KILL LOVE 的 bass：基音比第 2、3 泛音弱約 10 dB（失真 bass／808 常見），最強的是 2f、3f */
const WEAK_FUNDAMENTAL = [0.25, 0.8, 0.6, 0.35, 0.2];

test('weak fundamental: right octave and no fifths (no 2f / 3f picks)', () => {
  const pcm = synthBeat({ bars: 4, bassPartials: WEAK_FUNDAMENTAL });
  const notes = detectBass(pcm, SR);
  const expected = [35, 31, 38, 33];
  let right = 0;
  let total = 0;
  for (const n of notes) {
    const bar = Math.min(3, Math.floor((n.time + 0.16) / 2));
    total += n.duration;
    if (n.midi === expected[bar]) right += n.duration;
  }
  expect(total).toBeGreaterThan(0);
  expect(right / total).toBeGreaterThan(0.9);
});

test('weak fundamental: bass is found for most of each beat (coverage)', () => {
  const pcm = synthBeat({ bars: 4, bassPartials: WEAK_FUNDAMENTAL });
  const notes = detectBass(pcm, SR);
  const covered = notes.reduce(
    (s, n) => s + Math.min(n.time + n.duration, 8) - Math.max(n.time, 0),
    0,
  );
  // bass 每拍 0.5 s 都有聲音，但後段衰減到 −14 dB；至少要蓋到 60%
  expect(covered / 8).toBeGreaterThan(0.6);
});

test('pad only (no bass, no drums) gives no notes: a chord at B3–A4 must not be reported an octave down', () => {
  const notes = detectBass(synthBeat({ bars: 4, bassPartials: [], drums: false }), SR);
  expect(notes.map((n) => `${n.time.toFixed(2)}:${n.midi}`)).toEqual([]);
});

test('pad + drums, no bass: nothing longer than a kick tail, and never the pad an octave down', () => {
  const notes = detectBass(synthBeat({ bars: 4, bassPartials: [] }), SR);
  // 合成的 kick 是掃到 50 Hz 的正弦波，尾巴本身就是 G1，短短的可以接受
  for (const n of notes) {
    expect(n.duration, `note at ${n.time.toFixed(2)}`).toBeLessThan(0.2);
    expect([43, 47, 50, 54], `pad an octave down at ${n.time.toFixed(2)}`).not.toContain(n.midi);
  }
});
