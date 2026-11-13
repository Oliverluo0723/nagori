import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [];

function draw(p: Painter, ctx: LookContext): void {
  p.background(ctx.theme.paper);
}

/** Ink：八小節一張，kick 是群青噴霧光點、snare 是毛邊墨環、hat 是斑點。（骨架，待實作） */
export const inkLook: Look = {
  id: 'ink',
  number: 32,
  name: '墨噴',
  listens: ['drums', 'tempo'],
  params,
  draw,
};
