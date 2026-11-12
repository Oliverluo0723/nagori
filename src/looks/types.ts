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

export type ReadingKind = 'drums' | 'tempo' | 'spectrum' | 'chords' | 'bass' | 'key' | 'notes';

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

/** 面板左下讀數列的一欄，例如 { label: 'TEMPO', value: '137 BPM' }。 */
export interface Readout {
  label: string;
  value: string;
}

export interface Look {
  id: string;
  number: number;
  name: string;
  listens: ReadingKind[];
  params: ParamDef[];
  draw(p: Painter, ctx: LookContext): void;
  /** 自訂讀數列；沒給就由 readoutsFor 依 listens 組。 */
  readouts?(ctx: LookContext): Readout[];
}
