import type { Track } from '@tonejs/midi';
import type { BassNote } from '../types';

/** GM 預設 pitch bend 範圍 ±2 半音。 */
const BEND_RANGE_SEMITONES = 2;

export function extractBass(track: Track): BassNote[] {
  const notes = [...track.notes].sort((a, b) => a.time - b.time);
  const bends = [...track.pitchBends].sort((a, b) => a.time - b.time);
  return notes.map((n) => ({
    time: n.time,
    duration: n.duration,
    midi: n.midi,
    bends: bends
      .filter((b) => b.time >= n.time && b.time < n.time + n.duration)
      .map((b) => ({ time: b.time, semitones: b.value * BEND_RANGE_SEMITONES })),
  }));
}
