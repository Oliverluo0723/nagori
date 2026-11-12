// 把 DAW 匯出的 .mid 轉成評測用的標準答案 JSON（SongTruth）。
// 用法：node score/midi-to-truth.mjs samples/song.mid samples/song.mp3 [samples/stems/song] > samples/score/song.json
// 軌名認角色（跟 app 一樣）：含 drum/kick/perc → 鼓；含 bass → bass；含 chord/pad/keys/piano → 和弦。
// 鼓用 GM 音高：36 kick；38、40 snare；42、44、46 hat。和弦：同一個起音的音符一組，最低音的 pitch class 當根音。
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import pkg from '@tonejs/midi';

const { Midi } = pkg;
const [midiPath, audioPath, stemsDir] = process.argv.slice(2);
if (!midiPath || !audioPath) {
  console.error('usage: node score/midi-to-truth.mjs <song.mid> <song.mp3> [stems dir]');
  process.exit(1);
}

const ROLES = [
  { role: 'drums', words: ['drum', 'kick', 'perc'] },
  { role: 'bass', words: ['bass'] },
  { role: 'chords', words: ['chord', 'pad', 'keys', 'piano'] },
];
const roleOf = (track) => {
  if (track.channel === 9) return 'drums';
  const name = (track.name || '').toLowerCase();
  return ROLES.find((r) => r.words.some((w) => name.includes(w)))?.role;
};
const DRUM_KIND = { 36: 'kick', 35: 'kick', 38: 'snare', 40: 'snare', 42: 'hat', 44: 'hat', 46: 'hat' };

const midi = new Midi(readFileSync(midiPath));
const out = { name: basename(audioPath).replace(/\.[^.]+$/, ''), audio: audioPath };
if (stemsDir) out.stems = stemsDir;
for (const track of midi.tracks) {
  const role = roleOf(track);
  if (role === 'bass') {
    out.bass = track.notes.map((n) => ({ time: n.time, duration: n.duration, midi: n.midi }));
  } else if (role === 'drums') {
    out.drums = track.notes
      .filter((n) => DRUM_KIND[n.midi])
      .map((n) => ({ time: n.time, kind: DRUM_KIND[n.midi] }));
  } else if (role === 'chords') {
    const groups = new Map();
    for (const n of track.notes) {
      const key = Math.round(n.time * 1000);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    out.chords = [...groups.values()]
      .map((notes) => {
        const lowest = notes.reduce((a, b) => (b.midi < a.midi ? b : a));
        return {
          time: lowest.time,
          duration: Math.max(...notes.map((n) => n.duration)),
          root: lowest.midi % 12,
        };
      })
      .sort((a, b) => a.time - b.time);
  }
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
