import { cellsOf, setCellLook } from '../compose/layout';
import type { LayoutNode } from '../compose/types';

/**
 * 彈奏時可以選的 look：只讀音符、鼓、bass、和弦、調（彈得出來的讀數），不讀頻譜，
 * 也不靠整首歌定比例。順序也是替換版面時的分配順序。
 */
export const LIVE_LOOK_IDS = ['roll', 'grid', 'groove', 'stars', 'wheel', 'glide'] as const;

const LIVE = new Set<string>(LIVE_LOOK_IDS);

export function isLiveLook(id: string): boolean {
  return LIVE.has(id);
}

/** 不是即時 look 的格子，依序換成 LIVE_LOOK_IDS[0], [1], …（繞回）；已經是的不動。 */
export function liveLayout(root: LayoutNode): LayoutNode {
  let next = root;
  cellsOf(root).forEach((cell, i) => {
    if (!isLiveLook(cell.lookId))
      next = setCellLook(next, cell.id, LIVE_LOOK_IDS[i % LIVE_LOOK_IDS.length]);
  });
  return next;
}
