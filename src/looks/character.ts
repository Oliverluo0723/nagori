import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Character：五條量尺，現在與上一段用發光折線串起來。（骨架，待實作） */
export const characterLook: Look = {
  id: 'character',
  number: 38,
  name: '聲音性格',
  listens: ['spectrum', 'drums'],
  params,
  draw,
};
