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

/** 一首歌分析一次的「樂曲讀數」。所有 look 只讀這份資料。 */
export interface Readings {
  duration: number;
  tempo: TempoMap;
  drums: DrumHit[];
  roles: TrackRoleAssignment[];
}
