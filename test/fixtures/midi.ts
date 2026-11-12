import { Midi } from '@tonejs/midi';

export interface FixtureNote {
  beat: number;
  midi: number;
  velocity?: number;
  durationBeats?: number;
}

export interface FixtureTrack {
  name?: string;
  channel?: number;
  notes: FixtureNote[];
}

export interface MakeMidiOptions {
  bpm?: number;
  tempoChanges?: { beat: number; bpm: number }[];
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
    }
  }
  return midi.toArray();
}
