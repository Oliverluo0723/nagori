import { Midi } from '@tonejs/midi';
import { extractDrumHits } from './midi/drums';
import { assignRoles } from './midi/roles';
import { buildTempoMap } from './tempo';
import type { DrumHit, Readings } from './types';

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
  const drums: DrumHit[] = [];
  for (const r of roles) {
    if (r.role === 'drums') drums.push(...extractDrumHits(midi.tracks[r.index]));
  }
  drums.sort((a, b) => a.time - b.time);
  return {
    duration: Math.max(durationHint ?? 0, midi.duration),
    tempo,
    drums,
    roles,
  };
}
