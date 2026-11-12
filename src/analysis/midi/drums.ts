import type { Track } from '@tonejs/midi';
import type { DrumHit, DrumKind } from '../types';

/** General MIDI 打擊樂音高 → 三種鼓件。其他音高忽略。 */
const GM_DRUMS: Record<number, DrumKind> = {
  35: 'kick',
  36: 'kick',
  38: 'snare',
  40: 'snare',
  42: 'hat',
  44: 'hat',
  46: 'hat',
};

export function extractDrumHits(track: Track): DrumHit[] {
  const hits: DrumHit[] = [];
  for (const note of track.notes) {
    const kind = GM_DRUMS[note.midi];
    if (!kind) continue;
    hits.push({ time: note.time, kind, velocity: note.velocity });
  }
  return hits.sort((a, b) => a.time - b.time);
}
