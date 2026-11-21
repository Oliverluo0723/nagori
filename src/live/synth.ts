import type { DrumKind } from '../analysis/types';

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export interface Synth {
  noteOn(midi: number): void;
  noteOff(midi: number): void;
  /** at：音訊時鐘的秒數（預排用）；沒給就是現在 */
  drum(drum: DrumKind, at?: number): void;
  /** 音訊時鐘現在的秒數；還沒發過聲（AudioContext 還沒建立）是 null */
  time(): number | null;
  allOff(): void;
  close(): void;
}

const MASTER = 0.2;
const ATTACK = 0.005;
const RELEASE = 0.15;
/** 每個音的音量：13 顆同時按也不破音（再加一層 compressor 保險） */
const VOICE = 0.18;

/** 起音後衰減到的比例與時間常數（setTargetAtTime） */
const SUSTAIN = 0.6;
const DECAY_TAU = 0.4;

/**
 * 按下後 elapsed 秒的音量，跟 noteOn 排的包絡一樣。放開時從這個值收：
 * GainNode 在第一個 render quantum 之前的 .value 是預設的 1，拿它來收會爆一下。
 */
export function envelopeAt(elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed <= ATTACK) return (VOICE * elapsed) / ATTACK;
  const floor = VOICE * SUSTAIN;
  return floor + (VOICE - floor) * Math.exp(-(elapsed - ATTACK) / DECAY_TAU);
}

interface Voice {
  osc: OscillatorNode[];
  gain: GainNode;
  start: number;
}

/**
 * 內建音色：兩個微微走音的三角波疊一個低八度的正弦，軟起音、短釋放。
 * 鼓：kick 是下滑的正弦，snare 是帶通雜訊加一點音高，hat 是高通的短雜訊。
 * AudioContext 在第一次 noteOn / drum 時才建立（瀏覽器要求在使用者操作裡）。
 */
export function createSynth(): Synth {
  let ctx: AudioContext | null = null;
  let out: AudioNode | null = null;
  let noise: AudioBuffer | null = null;
  const voices = new Map<number, Voice>();

  const ensure = (): AudioContext | null => {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    if (typeof AudioContext === 'undefined') return null;
    ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = MASTER;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    out = master;
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // 固定的偽隨機（LCG），每次開頁同一段雜訊
    let s = 1;
    for (let i = 0; i < data.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = (s / 2 ** 32) * 2 - 1;
    }
    return ctx;
  };

  const release = (v: Voice, at: number) => {
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setValueAtTime(envelopeAt(at - v.start), at);
    v.gain.gain.linearRampToValueAtTime(0, at + RELEASE);
    for (const o of v.osc) o.stop(at + RELEASE + 0.02);
  };

  const noiseBurst = (
    c: AudioContext,
    filter: BiquadFilterNode,
    level: number,
    decay: number,
    t: number,
  ) => {
    if (!noise || !out) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    const g = c.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + decay + 0.02);
  };

  return {
    noteOn(midi) {
      const c = ensure();
      if (!c || !out || voices.has(midi)) return;
      const t = c.currentTime;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(VOICE, t + ATTACK);
      gain.gain.setTargetAtTime(VOICE * SUSTAIN, t + ATTACK, DECAY_TAU);
      const hz = midiToHz(midi);
      const parts: [OscillatorType, number, number][] = [
        ['triangle', hz, 0],
        ['triangle', hz, 6],
        ['sine', hz / 2, 0],
      ];
      const osc = parts.map(([type, freq, detune]) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(gain);
        o.start(t);
        return o;
      });
      gain.connect(out);
      voices.set(midi, { osc, gain, start: t });
    },
    noteOff(midi) {
      const v = voices.get(midi);
      if (!v || !ctx) return;
      voices.delete(midi);
      release(v, ctx.currentTime);
    },
    drum(kind, at) {
      const c = ensure();
      if (!c || !out) return;
      const t = Math.max(c.currentTime, at ?? 0);
      if (kind === 'kick') {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(1, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.4);
      } else if (kind === 'snare') {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1800;
        bp.Q.value = 0.8;
        noiseBurst(c, bp, 0.8, 0.18, t);
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, t);
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.12);
      } else {
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        noiseBurst(c, hp, 0.5, 0.05, t);
      }
    },
    time() {
      return ctx ? ctx.currentTime : null;
    },
    allOff() {
      if (!ctx) return;
      const t = ctx.currentTime;
      for (const v of voices.values()) release(v, t);
      voices.clear();
    },
    close() {
      voices.clear();
      void ctx?.close();
      ctx = null;
      out = null;
    },
  };
}
