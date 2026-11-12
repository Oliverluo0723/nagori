import { Midi } from '@tonejs/midi';
import { extractBass } from './midi/bass';
import { extractChords } from './midi/chords';
import { extractDrumHits } from './midi/drums';
import { detectKey } from './midi/key';
import { assignRoles } from './midi/roles';
import { buildTempoMap } from './tempo';
import type { BassNote, DrumHit, Readings, Spectrum } from './types';

/**
 * 讀一個 .mid，產出 Readings。
 * durationHint 是音檔的長度（秒）；duration 取它與 MIDI 長度的較大者。
 */
export function analyzeMidi(bytes: ArrayBuffer | Uint8Array, durationHint?: number): Readings {
  const midi = new Midi(bytes);
  const tempo = buildTempoMap(midi.header);
  const roles = assignRoles(
    midi.tracks.map((t, index) => ({ index, name: t.name, channel: t.channel })),
  );
  const duration = Math.max(durationHint ?? 0, midi.duration);

  const drums: DrumHit[] = [];
  const bass: BassNote[] = [];
  const chordTracks = [];
  for (const r of roles) {
    const track = midi.tracks[r.index];
    if (r.role === 'drums') drums.push(...extractDrumHits(track));
    else if (r.role === 'bass') bass.push(...extractBass(track));
    else if (r.role === 'chords') chordTracks.push(track);
  }
  drums.sort((a, b) => a.time - b.time);
  bass.sort((a, b) => a.time - b.time);
  const chords = extractChords(chordTracks, tempo, duration);
  const key = detectKey(midi.header, chords);

  return { duration, tempo, drums, roles, chords, bass, key };
}

export function withSpectrum(r: Readings, spectrum: Spectrum): Readings {
  return { ...r, spectrum };
}
