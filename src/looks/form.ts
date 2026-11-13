import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Form：hit 當吸引點，場畫成等高線的一團形體。（骨架，待實作） */
export const formLook: Look = {
  id: 'form',
  number: 34,
  name: '聲形等高線',
  listens: ['drums', 'spectrum', 'tempo'],
  params,
  draw,
};
