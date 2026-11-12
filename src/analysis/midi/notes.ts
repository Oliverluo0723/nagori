import type { Track } from '@tonejs/midi';
import { tidyNotes } from '../audio/notes';
import type { NoteEvent } from '../types';

/**
 * 非鼓軌的音符全部攤平（bass 軌也算，鋼琴捲本來就該有低音）。
 * velocity 用 @tonejs/midi 已經換算好的 0..1（= MIDI velocity / 127）。
 */
export function extractNotes(tracks: readonly Track[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const track of tracks)
    for (const n of track.notes)
      out.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity });
  return tidyNotes(out);
}
