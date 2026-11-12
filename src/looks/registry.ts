import { gridLook } from './grid';
import { ringsLook } from './rings';
import { spectrumLook } from './spectrum';
import type { Look } from './types';

export const looks: Record<string, Look> = {
  [ringsLook.id]: ringsLook,
  [gridLook.id]: gridLook,
  [spectrumLook.id]: spectrumLook,
};
