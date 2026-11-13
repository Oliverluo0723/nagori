import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Trace：22 條頻帶線疊成山脊向左捲，kick 在低頻線上捲出同心弧。（骨架，待實作） */
export const traceLook: Look = {
  id: 'trace',
  number: 33,
  name: '頻帶描線',
  listens: ['spectrum', 'drums', 'bass'],
  params,
  draw,
};
