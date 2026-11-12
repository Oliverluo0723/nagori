import { blotLook } from './blot';
import { bodiesLook } from './bodies';
import { cometLook } from './comet';
import { coronaLook } from './corona';
import { dewLook } from './dew';
import { discLook } from './disc';
import { drumLook } from './drum';
import { flowLook } from './flow';
import { fountainLook } from './fountain';
import { gelLook } from './gel';
import { glideLook } from './glide';
import { glyphLook } from './glyph';
import { gridLook } from './grid';
import { kaleidoLook } from './kaleido';
import { lidarLook } from './lidar';
import { meshLook } from './mesh';
import { polygraphLook } from './polygraph';
import { ridgeLook } from './ridge';
import { ringsLook } from './rings';
import { spectrumLook } from './spectrum';
import { starsLook } from './stars';
import { strataLook } from './strata';
import { stringLook } from './string';
import type { Look } from './types';
import { wheelLook } from './wheel';

export const looks: Record<string, Look> = {
  [ringsLook.id]: ringsLook,
  [gridLook.id]: gridLook,
  [spectrumLook.id]: spectrumLook,
  [wheelLook.id]: wheelLook,
  [glideLook.id]: glideLook,
  [bodiesLook.id]: bodiesLook,
  [ridgeLook.id]: ridgeLook,
  [drumLook.id]: drumLook,
  [stringLook.id]: stringLook,
  [meshLook.id]: meshLook,
  [coronaLook.id]: coronaLook,
  [discLook.id]: discLook,
  [blotLook.id]: blotLook,
  [glyphLook.id]: glyphLook,
  [lidarLook.id]: lidarLook,
  [strataLook.id]: strataLook,
  [polygraphLook.id]: polygraphLook,
  [gelLook.id]: gelLook,
  [fountainLook.id]: fountainLook,
  [dewLook.id]: dewLook,
  [kaleidoLook.id]: kaleidoLook,
  [cometLook.id]: cometLook,
  [starsLook.id]: starsLook,
  [flowLook.id]: flowLook,
};
