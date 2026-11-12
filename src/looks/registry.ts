import { gridLook } from './grid';
import { ringsLook } from './rings';
import type { Look } from './types';

export const looks: Record<string, Look> = {
  [ringsLook.id]: ringsLook,
  [gridLook.id]: gridLook,
};
