import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Chakra：柔和橢圓光暈裡一排 18 個頻帶色塊。（骨架，待實作） */
export const chakraLook: Look = {
  id: 'chakra',
  number: 37,
  name: '脈輪',
  listens: ['spectrum'],
  params,
  draw,
};
