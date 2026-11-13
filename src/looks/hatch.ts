import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Sheet·Hatch：整首歌印成一張，橫向墨線左右鏡射成水中倒影般的直立形體。（骨架，待實作） */
export const hatchLook: Look = {
  id: 'hatch',
  number: 31,
  name: '水影排線',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};
