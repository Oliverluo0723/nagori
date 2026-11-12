import type { Theme } from '../compose/types';

/** pitch class 名稱，C 起算，升記號用 ♯。 */
export const PC_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** 五度圈順序的 pitch class：C G D A E B F♯ C♯ G♯ D♯ A♯ F。 */
export const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export function fifthsIndex(pc: number): number {
  return FIFTHS.indexOf(((pc % 12) + 12) % 12);
}

export function pcName(pc: number): string {
  return PC_NAMES[((pc % 12) + 12) % 12];
}

export function noteColor(theme: Theme, pc: number): string {
  return theme.noteColors[((pc % 12) + 12) % 12] ?? theme.ink;
}

/** 'F#' / 'Gb' / 'C♯' 這類名稱 → pitch class。認不出來回 -1。 */
export function pcFromName(name: string): number {
  const m = /^([A-Ga-g])([#♯b♭]*)/.exec(name.trim());
  if (!m) return -1;
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let pc = base[m[1].toLowerCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}
