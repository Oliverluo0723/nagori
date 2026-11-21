import type { DrumKind } from '../analysis/types';

export type LiveKey = { kind: 'note'; midi: number } | { kind: 'drum'; drum: DrumKind };

const note = (midi: number): LiveKey => ({ kind: 'note', midi });
const drum = (d: DrumKind): LiveKey => ({ kind: 'drum', drum: d });

/**
 * KeyboardEvent.code → 鍵。用 code（實體位置）不用 key：注音輸入法開著時 key 是 'Process'。
 * 中排是白鍵 C4–C5，上排是黑鍵，下排三個鼓。
 */
export const KEY_MAP: Readonly<Record<string, LiveKey>> = {
  KeyA: note(60),
  KeyW: note(61),
  KeyS: note(62),
  KeyE: note(63),
  KeyD: note(64),
  KeyF: note(65),
  KeyT: note(66),
  KeyG: note(67),
  KeyY: note(68),
  KeyH: note(69),
  KeyU: note(70),
  KeyJ: note(71),
  KeyK: note(72),
  KeyZ: drum('kick'),
  KeyX: drum('snare'),
  KeyC: drum('hat'),
};

/** 顯示用的一行提示 */
export const KEY_HINT = 'A S D F G H J K 彈音　W E T Y U 黑鍵　Z X C 加鼓';
