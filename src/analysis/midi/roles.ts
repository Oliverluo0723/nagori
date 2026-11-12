import type { TrackRole, TrackRoleAssignment } from '../types';

export interface TrackInfo {
  index: number;
  name: string;
  channel: number;
}

const DRUM_CHANNEL = 9;

const RULES: { role: TrackRole; words: string[] }[] = [
  { role: 'drums', words: ['drum', 'kick', 'perc'] },
  { role: 'bass', words: ['bass'] },
  { role: 'chords', words: ['chord', 'pad', 'keys', 'piano'] },
];

function roleOf(track: TrackInfo): TrackRole {
  if (track.channel === DRUM_CHANNEL) return 'drums';
  const name = track.name.toLowerCase();
  for (const rule of RULES) {
    if (rule.words.some((w) => name.includes(w))) return rule.role;
  }
  return 'other';
}

/** 依軌名與 channel 指定每軌的角色。認不出來的是 other。 */
export function assignRoles(tracks: TrackInfo[]): TrackRoleAssignment[] {
  return tracks.map((t) => ({ index: t.index, name: t.name, role: roleOf(t) }));
}
