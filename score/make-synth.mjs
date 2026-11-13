// 產生第二首較難的合成歌 synth-b：96 bpm、1.3 s 前奏靜音、12 小節；
// 七和弦與轉位（bass 不一定在根音）、旋律線、切分鼓。同時寫 .mid、.wav 與標準答案 JSON。
// 用法：node score/make-synth.mjs  → samples/synth-b.{mid,wav}、samples/score/synth-b.json
import { mkdirSync, writeFileSync } from 'node:fs';
import pkg from '@tonejs/midi';
const { Midi } = pkg;

// 變體：`node score/make-synth.mjs ramp` → synth-c，速度從 88 線性升到 104（真歌常有的漂移），其餘一樣
const VARIANT = process.argv[2] ?? 'b';
const NAME = `synth-${VARIANT === 'ramp' ? 'c' : 'b'}`;
const BPM = 96, BARS = 12, SR = 44100, LEAD = 1.3;
const BPM0 = VARIANT === 'ramp' ? 88 : BPM, BPM1 = VARIANT === 'ramp' ? 104 : BPM;
const TOTAL = BARS * 4;
const bpmAtBeat = (b) => BPM0 + (BPM1 - BPM0) * Math.min(1, Math.max(0, b / TOTAL));
// 拍 → 秒：逐拍累加（每拍用該拍開頭的 bpm），小數拍線性內插
const beatTimes = [0];
for (let b = 0; b < TOTAL + 8; b++) beatTimes.push(beatTimes[b] + 60 / bpmAtBeat(b));
const tOf = (b) => { const i = Math.floor(b); const f = b - i; return LEAD + beatTimes[i] + f * (beatTimes[i + 1] - beatTimes[i]); };
const beatSec = 60 / BPM; // 只給名義長度用（音長）
// [和弦音（實際彈的 voicing）, 根音 pc, 小調?, 這小節 bass 走的音]
const PROG = [
  { voicing: [57, 60, 64, 67], root: 9, minor: true, bass: [45, 45, 52, 45] }, // Am7，bass 碰 5th
  { voicing: [53, 57, 60, 65], root: 5, minor: false, bass: [41, 48, 41, 45] }, // F，bass 碰 5th/3rd
  { voicing: [55, 60, 64, 67], root: 0, minor: false, bass: [43, 43, 48, 43] }, // C/G（轉位）
  { voicing: [55, 59, 62, 67], root: 7, minor: false, bass: [43, 43, 50, 43] },
  { voicing: [50, 53, 57, 62], root: 2, minor: true, bass: [38, 38, 45, 38] }, // Dm
  { voicing: [52, 56, 59, 62], root: 4, minor: false, bass: [40, 40, 47, 40] }, // E7
];
const MELODY = [69, 72, 74, 76, 79, 81, 76, 74]; // A 小調五聲

const midi = new Midi();
const ppq = midi.header.ppq;
// tempo map：前奏用 BPM0 走 LEAD 秒，之後每拍一個 tempo 事件（ramp 變體），固定速度就只有一個
const leadTicks = Math.round((LEAD / (60 / BPM0)) * ppq);
midi.header.tempos = [{ ticks: 0, bpm: BPM0 }];
if (VARIANT === 'ramp') for (let b = 1; b < TOTAL; b++) midi.header.tempos.push({ ticks: leadTicks + b * ppq, bpm: bpmAtBeat(b) });
midi.header.update();
const drums = midi.addTrack(); drums.name = 'Drums'; drums.channel = 9;
const bassT = midi.addTrack(); bassT.name = 'Bass';
const pad = midi.addTrack(); pad.name = 'Pad';
const lead = midi.addTrack(); lead.name = 'Lead';

const truth = { name: NAME, audio: `samples/${NAME}.wav`, bpm: VARIANT === 'ramp' ? undefined : BPM, beats: [], downbeats: [], notes: [], chords: [], bass: [], drums: [] };
const hits = []; // [sec, kind, vel]
const tones = []; // [sec, dur, midi, vel, kind]
const note = (track, midiNum, beat, durBeats, vel, kind) => {
  track.addNote({ midi: midiNum, ticks: leadTicks + Math.round(beat * ppq), durationTicks: Math.round(durBeats * ppq), velocity: vel });
  const dur = tOf(beat + durBeats) - tOf(beat);
  const ev = { time: +tOf(beat).toFixed(4), duration: +dur.toFixed(4), midi: midiNum };
  truth.notes.push(ev);
  if (kind === 'bass') truth.bass.push(ev);
  tones.push([tOf(beat), dur, midiNum, vel, kind]);
};
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

for (let bar = 0; bar < BARS; bar++) {
  const ch = PROG[bar % PROG.length];
  const b0 = bar * 4;
  // 鼓：kick 1、2 的後半、3；snare 2、4；hat 8 分；偶數小節第 4 拍後半 snare 碎拍
  const hit = (m, beat, vel, kind) => {
    drums.addNote({ midi: m, ticks: leadTicks + Math.round(beat * ppq), durationTicks: ppq / 8, velocity: vel });
    hits.push([tOf(beat), kind, vel]);
    truth.drums.push({ time: +tOf(beat).toFixed(4), kind });
  };
  for (const k of [0, 1.5, 2]) hit(36, b0 + k, 1, 'kick');
  for (const s of [1, 3]) hit(38, b0 + s, 0.85, 'snare');
  if (bar % 2 === 1) hit(38, b0 + 3.5, 0.5, 'snare');
  for (let e = 0; e < 8; e++) hit(42, b0 + e / 2, e % 2 ? 0.4 : 0.6, 'hat');
  // Pad：整小節
  for (const m of ch.voicing) note(pad, m, b0, 4, 0.6, 'pad');
  truth.chords.push({ time: +tOf(b0).toFixed(4), duration: +(tOf(b0 + 4) - tOf(b0)).toFixed(4), root: ch.root, minor: ch.minor });
  // Bass：每拍一顆，第 2 拍是兩個 8 分
  for (let b = 0; b < 4; b++) {
    if (b === 1) { note(bassT, ch.bass[b], b0 + b, 0.5, 0.8, 'bass'); note(bassT, ch.bass[b], b0 + b + 0.5, 0.5, 0.7, 'bass'); }
    else note(bassT, ch.bass[b], b0 + b, 0.9, 0.85, 'bass');
  }
  // 旋律：8 分音符為主、偶爾 4 分，從第 2 小節開始
  if (bar >= 1) {
    let pos = 0;
    while (pos < 4) {
      const dur = rnd() < 0.3 ? 1 : 0.5;
      const m = MELODY[Math.floor(rnd() * MELODY.length)];
      if (rnd() > 0.15) note(lead, m, b0 + pos, dur * 0.9, 0.75, 'lead');
      pos += dur;
    }
  }
}
for (let b = 0; tOf(b) <= tOf(BARS * 4); b++) truth.beats.push(+tOf(b).toFixed(4));
truth.downbeats = truth.beats.filter((_, i) => i % 4 === 0);
truth.notes.sort((a, b) => a.time - b.time || a.midi - b.midi);

// 合成音訊
const seconds = tOf(BARS * 4) + 1.5;
const n = Math.floor(seconds * SR); const buf = new Float32Array(n);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const add = (start, len, fn) => { const s0 = Math.floor(start * SR); const cnt = Math.min(Math.floor(len * SR), n - s0); for (let i = 0; i < cnt; i++) buf[s0 + i] += fn(i / SR); };
let ns = 3; const nrnd = () => { ns = (ns * 1664525 + 1013904223) >>> 0; return ns / 4294967296 - 0.5; };
for (const [t0, kind, vel] of hits) {
  if (kind === 'kick') add(t0, 0.25, (t) => Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12) * 0.9 * vel);
  if (kind === 'snare') add(t0, 0.18, (t) => (nrnd() * 0.8 + Math.sin(2 * Math.PI * 180 * t) * 0.3) * Math.exp(-t * 20) * 0.7 * vel);
  if (kind === 'hat') { let n1 = 0, n2 = 0; add(t0, 0.05, (t) => { const n0 = nrnd(); const hp = n0 - 2 * n1 + n2; n2 = n1; n1 = n0; return hp * 0.5 * Math.exp(-t * 80) * 0.35 * (vel / 0.6); }); }
}
for (const [t0, dur, m, vel, kind] of tones) {
  const f = hz(m);
  if (kind === 'bass') add(t0, dur, (t) => { const env = Math.min(1, t * 200) * Math.exp(-t * 2) * Math.min(1, (dur - t) * 40); return (Math.sin(2 * Math.PI * f * t) * 0.8 + Math.sin(2 * Math.PI * f * 2 * t) * 0.3 + Math.sin(2 * Math.PI * f * 3 * t) * 0.1) * env * 0.33 * vel; });
  if (kind === 'pad') add(t0, dur, (t) => { const env = Math.min(1, t * 15) * Math.min(1, (dur - t) * 8); let s = 0; for (let h = 1; h <= 4; h++) s += Math.sin(2 * Math.PI * f * h * t) / h; return s * env * 0.06 * vel; });
  if (kind === 'lead') add(t0, dur, (t) => { const env = Math.min(1, t * 80) * Math.exp(-t * 1.5) * Math.min(1, (dur - t) * 30); const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5.5 * t); let s = 0; for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * f * vib * h * t) / (h * h); return s * env * 0.16 * vel; });
}
const wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.max(-1, Math.min(1, buf[i])) * 32767, 44 + i * 2);
mkdirSync('samples/score', { recursive: true });
writeFileSync(`samples/${NAME}.mid`, midi.toArray());
writeFileSync(`samples/${NAME}.wav`, wav);
writeFileSync(`samples/score/${NAME}.json`, `${JSON.stringify(truth)}\n`);
console.log('ok', truth.notes.length, 'notes', truth.beats.length, 'beats', seconds.toFixed(1), 's');
