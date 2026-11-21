import { expect, test } from 'vitest';
import { createSynth, envelopeAt, midiToHz } from './synth';

test('midiToHz', () => {
  expect(midiToHz(69)).toBe(440);
  expect(midiToHz(60)).toBeCloseTo(261.63, 2);
});

test('createSynth 在沒有 AudioContext 的環境（node）不丟例外，直到真的要發聲', () => {
  expect(() => createSynth()).not.toThrow();
});

test('音量包絡：從 0 起音，5 ms 到頂，之後往 0.6 倍衰減（放開時從這個值收，不從 GainNode 預設的 1）', () => {
  expect(envelopeAt(0)).toBe(0);
  expect(envelopeAt(0.0025)).toBeCloseTo(0.09, 5);
  expect(envelopeAt(0.005)).toBeCloseTo(0.18, 5);
  expect(envelopeAt(10)).toBeCloseTo(0.108, 3);
  expect(envelopeAt(-1)).toBe(0);
});

test('還沒發過聲時沒有音訊時鐘（time() 是 null）', () => {
  expect(createSynth().time()).toBeNull();
});
