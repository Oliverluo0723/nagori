import { Midi } from '@tonejs/midi';

export interface FixtureNote {
  beat: number;
  midi: number;
  velocity?: number;
  durationBeats?: number;
  /** pitch bend 事件，value -1..1，beat 為絕對拍 */
  bends?: { beat: number; value: number }[];
}

export interface FixtureTrack {
  name?: string;
  channel?: number;
  notes: FixtureNote[];
}

export interface MakeMidiOptions {
  bpm?: number;
  tempoChanges?: { beat: number; bpm: number }[];
  /** 例如 { key: 'D', scale: 'major' } */
  keySignature?: { key: string; scale: string };
  tracks: FixtureTrack[];
}

/** 產生測試用的 .mid 位元組。beat 以四分音符為單位，從 0 起算。 */
export function makeMidi(opts: MakeMidiOptions): Uint8Array {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  midi.header.setTempo(opts.bpm ?? 120);
  for (const change of opts.tempoChanges ?? []) {
    midi.header.tempos.push({ ticks: change.beat * ppq, bpm: change.bpm });
  }
  if (opts.keySignature) {
    midi.header.keySignatures.push({
      ticks: 0,
      key: opts.keySignature.key,
      scale: opts.keySignature.scale,
    });
  }
  midi.header.update();
  for (const t of opts.tracks) {
    const track = midi.addTrack();
    track.name = t.name ?? '';
    track.channel = t.channel ?? 0;
    for (const n of t.notes) {
      track.addNote({
        midi: n.midi,
        ticks: n.beat * ppq,
        durationTicks: (n.durationBeats ?? 0.25) * ppq,
        velocity: n.velocity ?? 1,
      });
      // @tonejs/midi 寫檔時不會把 -1..1 換算回 14 位元，但讀檔會除以 8192：先乘回去
      for (const b of n.bends ?? []) {
        track.addPitchBend({ ticks: b.beat * ppq, value: Math.round(b.value * 8192) });
      }
    }
  }
  const bytes = midi.toArray();
  if (opts.keySignature) {
    // MIDI 調號只存升降號數：小調要用關係大調（主音 +3 半音）的數量
    const { key, scale } = opts.keySignature;
    const major = scale === 'minor' ? MAJOR_NAME_OF_PC[(PC_OF[key] + 3) % 12] : key;
    patchKeySignature(bytes, major);
  }
  return bytes;
}

const KEY_SHARPS: Record<string, number> = {
  Cb: -7,
  Gb: -6,
  Db: -5,
  Ab: -4,
  Eb: -3,
  Bb: -2,
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
};

/**
 * @tonejs/midi 寫 key signature 時把索引多加了 7（讀檔時又會加 7），讀回來會變 undefined。
 * 直接把 meta 事件 FF 59 02 <sharps> <scale> 的 sharps 位元組改成正確的有號值。
 */
const PC_OF: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
  Cb: 11,
};
const MAJOR_NAME_OF_PC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function patchKeySignature(bytes: Uint8Array, key: string): void {
  const sharps = KEY_SHARPS[key];
  if (sharps === undefined) throw new Error(`unknown key ${key}`);
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
      bytes[i + 3] = sharps & 0xff;
      return;
    }
  }
  throw new Error('key signature meta event not found');
}
