import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Aura：兩團光球，kick 往上跳、snare 換色。（骨架，待實作） */
export const auraLook: Look = {
  id: 'aura',
  number: 36,
  name: '光球',
  listens: ['drums', 'spectrum'],
  params,
  draw,
};
