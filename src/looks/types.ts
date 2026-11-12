import type { Readings } from '../analysis/types';
import type { Theme } from '../compose/types';
import type { Painter } from './painter/painter';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export type ReadingKind = 'drums' | 'tempo' | 'spectrum' | 'chords' | 'bass' | 'key';

/** 畫一幀需要的全部輸入。look 不得讀取這以外的狀態。 */
export interface LookContext {
  t: number;
  w: number;
  h: number;
  readings: Readings;
  theme: Theme;
  params: Record<string, number | boolean>;
  seed: number;
  /** 例如 "06 RINGS"；有給就畫在左上角。 */
  label?: string;
}

export interface Look {
  id: string;
  number: number;
  name: string;
  listens: ReadingKind[];
  params: ParamDef[];
  draw(p: Painter, ctx: LookContext): void;
}
