import type { Readings, ReadingsSource } from './types';

const NONE: ReadingsSource = {
  tempo: 'none',
  drums: 'none',
  chords: 'none',
  bass: 'none',
  key: 'none',
  notes: 'none',
};

/** MIDI 有的欄位用 MIDI，沒有的用音訊；spectrum 永遠來自音訊；duration 取大。 */
export function mergeReadings(midi: Readings | undefined, audio: Readings | undefined): Readings {
  if (!midi) {
    if (!audio) throw new Error('mergeReadings: nothing to merge');
    return audio;
  }
  if (!audio) return midi;
  const ms = midi.source ?? NONE;
  const as = audio.source ?? NONE;
  const pick = <T>(m: T, a: T, has: boolean) => (has ? m : a);
  const useMidiDrums = midi.drums.length > 0;
  const useMidiChords = (midi.chords?.length ?? 0) > 0;
  const useMidiBass = (midi.bass?.length ?? 0) > 0;
  const useMidiKey = midi.key !== undefined;
  const useMidiNotes = (midi.notes?.length ?? 0) > 0;
  return {
    duration: Math.max(midi.duration, audio.duration),
    tempo: midi.tempo,
    roles: midi.roles,
    drums: pick(midi.drums, audio.drums, useMidiDrums),
    chords: pick(midi.chords, audio.chords, useMidiChords),
    bass: pick(midi.bass, audio.bass, useMidiBass),
    key: pick(midi.key, audio.key, useMidiKey),
    notes: pick(midi.notes, audio.notes, useMidiNotes),
    spectrum: audio.spectrum,
    rhythm: audio.rhythm,
    source: {
      tempo: ms.tempo,
      drums: useMidiDrums ? 'midi' : as.drums,
      chords: useMidiChords ? 'midi' : as.chords,
      bass: useMidiBass ? 'midi' : as.bass,
      key: useMidiKey ? 'midi' : as.key,
      notes: useMidiNotes ? 'midi' : (as.notes ?? 'none'),
    },
  };
}
