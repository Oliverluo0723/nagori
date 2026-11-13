import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Figure：高頻是頭、中頻是身、bass 是地，三團光疊成人形。（骨架，待實作） */
export const figureLook: Look = {
  id: 'figure',
  number: 35,
  name: '發光人形',
  listens: ['spectrum'],
  params,
  draw,
};
