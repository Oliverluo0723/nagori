/** 純資料的 tempo map，可以序列化進專案檔。ticks 以 ppq 為單位。 */
export interface TempoMap {
  ppq: number;
  tempos: { ticks: number; bpm: number }[];
  timeSignatures: { ticks: number; numerator: number; denominator: number }[];
  /** 音檔第幾秒是第 1 小節第 1 拍（tick 0）。預設 0。 */
  offset?: number;
}

/** 純音訊節拍分析的結果。 */
export interface RhythmInfo {
  bpm: number;
  confidence: number;
  beats: number[];
  candidates: number[];
  offset: number;
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

/**
 * 一顆音（鋼琴捲用）：MIDI 非鼓軌全部攤平，或 Basic Pitch 從音檔轉譜。
 * 以 time 排序；同一個 midi 的音不重疊。
 */
export interface NoteEvent {
  /** 秒 */
  time: number;
  /** 秒 */
  duration: number;
  /** 整數 0–127 */
  midi: number;
  /** 0..1 */
  velocity: number;
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
  /** 每一顆音（MIDI 非鼓軌，或轉譜） */
  notes?: NoteEvent[];
  /** 純音訊節拍分析的結果（有的話），給 BPM 候選與第一拍微調用 */
  rhythm?: RhythmInfo;
  /** 每個欄位是哪裡來的 */
  source?: ReadingsSource;
}

export type SourceKind = 'midi' | 'audio' | 'stem' | 'none';
export interface ReadingsSource {
  tempo: SourceKind;
  drums: SourceKind;
  chords: SourceKind;
  bass: SourceKind;
  key: SourceKind;
  /** 舊專案／舊快取沒有這欄，所以可省略；省略等於 'none' */
  notes?: SourceKind;
}
