/** 純資料的 tempo map，可以序列化進專案檔。ticks 以 ppq 為單位。 */
export interface TempoMap {
  ppq: number;
  tempos: { ticks: number; bpm: number }[];
  timeSignatures: { ticks: number; numerator: number; denominator: number }[];
}

/** 某個時間點在小節格上的位置。bar、beat 都從 1 起算。 */
export interface BarPosition {
  bar: number;
  beat: number;
  barPhase: number;
  beatPhase: number;
  bpm: number;
}

export type DrumKind = 'kick' | 'snare' | 'hat';

export interface DrumHit {
  time: number;
  kind: DrumKind;
  velocity: number;
}

export type TrackRole = 'drums' | 'bass' | 'chords' | 'other';

export interface TrackRoleAssignment {
  index: number;
  name: string;
  role: TrackRole;
}

/** 離線算好的對數頻譜：frameCount × bins，row-major，值 0..1。 */
export interface Spectrum {
  fps: number;
  bins: number;
  minHz: number;
  maxHz: number;
  frames: Float32Array;
  frameCount: number;
}

/** 每拍判斷一次、相同名稱合併後的和弦事件。root、notes 都是 pitch class 0–11。 */
export interface ChordEvent {
  time: number;
  duration: number;
  root: number;
  name: string;
  notes: number[];
}

export interface BassNote {
  time: number;
  duration: number;
  midi: number;
  bends: { time: number; semitones: number }[];
}

export interface KeyInfo {
  tonic: number;
  mode: 'major' | 'minor';
  name: string;
}

/** 一首歌分析一次的「樂曲讀數」。所有 look 只讀這份資料。 */
export interface Readings {
  duration: number;
  tempo: TempoMap;
  drums: DrumHit[];
  roles: TrackRoleAssignment[];
  spectrum?: Spectrum;
  chords?: ChordEvent[];
  bass?: BassNote[];
  key?: KeyInfo;
}
