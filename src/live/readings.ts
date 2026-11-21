import { chordName, QUALITIES } from '../analysis/audio/chords';
import { tempoMapFromBpm } from '../analysis/tempo';
import type {
  BassNote,
  ChordEvent,
  DrumHit,
  DrumKind,
  NoteEvent,
  Readings,
  TempoMap,
} from '../analysis/types';
import { beatHits, LIVE_BPM } from './beat';

export { LIVE_BPM };

/** 即時彈奏的事件；time 是從第一次按鍵起算的秒數。 */
export type LiveEvent =
  | { type: 'on'; midi: number; time: number }
  | { type: 'off'; midi: number; time: number }
  | { type: 'drum'; drum: DrumKind; time: number };

/** 鋼琴捲固定顯示的音域：鍵位 C4–C5 各外擴 2 個半音 */
export const LIVE_NOTE_RANGE: [number, number] = [58, 74];

const VELOCITY = 0.8;
const MIN_DURATION = 0.02;
const MAX_EVENTS = 4000;
const LIVE_KEY = { tonic: 0, mode: 'major' as const, name: 'C major' };
const LIVE_TEMPO: TempoMap = tempoMapFromBpm(LIVE_BPM);

/** 按住的音組成的 pitch class 集合，剛好是某個和弦模板時回傳 [root, quality]。 */
function chordOf(held: readonly number[]): [number, number] | null {
  const pcs = new Set(held.map((m) => m % 12));
  if (pcs.size < 3) return null;
  const lowestPc = Math.min(...held) % 12;
  let found: [number, number] | null = null;
  for (let root = 0; root < 12; root++) {
    for (let q = 0; q < QUALITIES.length; q++) {
      const tpl = QUALITIES[q].intervals.map((i) => (root + i) % 12);
      if (tpl.length !== pcs.size || !tpl.every((pc) => pcs.has(pc))) continue;
      if (root === lowestPc) return [root, q];
      if (!found) found = [root, q];
    }
  }
  return found;
}

/**
 * 按鍵事件 → 樂曲讀數（純函式）。look 讀這份資料，不知道它是彈出來的。
 * 還按著的音長度算到 now；bass 是每段時間裡按住的最低音；和弦是按住的音剛好組成的三和弦或七和弦。
 */
export function liveReadings(events: readonly LiveEvent[], now: number): Readings {
  const notes: NoteEvent[] = [];
  const drums: DrumHit[] = [];
  const bass: BassNote[] = [];
  const chords: ChordEvent[] = [];
  /** midi → 按下的時間 */
  const held = new Map<number, number>();
  let segStart = 0;

  /** 一段「按住的音不變」的時間結束；長度 0 的段落丟掉 */
  const closeSegment = (end: number) => {
    if (held.size > 0 && end > segStart) {
      const keys = [...held.keys()];
      const low = Math.min(...keys);
      const duration = end - segStart;
      bass.push({ time: segStart, duration, midi: low, bends: [] });
      const c = chordOf(keys);
      if (c) {
        const [root, q] = c;
        const notesPc = QUALITIES[q].intervals.map((i) => (root + i) % 12);
        chords.push({ time: segStart, duration, root, name: chordName(root, q), notes: notesPc });
      }
    }
    segStart = end;
  };

  for (const e of events) {
    if (e.type === 'drum') {
      drums.push({ time: e.time, kind: e.drum, velocity: 1 });
    } else if (e.type === 'on') {
      if (held.has(e.midi)) continue;
      closeSegment(e.time);
      held.set(e.midi, e.time);
    } else {
      const start = held.get(e.midi);
      if (start === undefined) continue;
      closeSegment(e.time);
      held.delete(e.midi);
      notes.push({
        time: start,
        duration: Math.max(MIN_DURATION, e.time - start),
        midi: e.midi,
        velocity: VELOCITY,
      });
    }
  }
  for (const [midi, start] of held) {
    notes.push({
      time: start,
      duration: Math.max(MIN_DURATION, now - start),
      midi,
      velocity: VELOCITY,
    });
  }
  closeSegment(now);
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  // 第一次按鍵（時間 0）就開始自動節奏；按的鼓疊在上面
  const allDrums =
    events.length > 0 ? [...beatHits(0, now), ...drums].sort((a, b) => a.time - b.time) : drums;

  return {
    duration: Math.max(60, now),
    tempo: LIVE_TEMPO,
    drums: allDrums,
    roles: [],
    notes,
    bass,
    chords,
    key: LIVE_KEY,
    noteRange: LIVE_NOTE_RANGE,
    source: {
      tempo: 'midi',
      drums: 'midi',
      chords: 'midi',
      bass: 'midi',
      key: 'midi',
      notes: 'midi',
    },
  };
}

export interface LiveSession {
  noteOn(midi: number, time: number): void;
  noteOff(midi: number, time: number): void;
  drum(drum: DrumKind, time: number): void;
  /** 放開所有按住的音 */
  releaseAll(time: number): void;
  /** 還沒按過鍵時回傳同一個物件；開始後自動節奏一直在走，每次都重算 */
  readings(now: number): Readings;
}

export function createLiveSession(): LiveSession {
  const events: LiveEvent[] = [];
  const held = new Set<number>();
  let empty: Readings | null = null;

  const push = (e: LiveEvent) => {
    events.push(e);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  };

  return {
    noteOn(midi, time) {
      if (held.has(midi)) return;
      held.add(midi);
      push({ type: 'on', midi, time });
    },
    noteOff(midi, time) {
      if (!held.delete(midi)) return;
      push({ type: 'off', midi, time });
    },
    drum(drum, time) {
      push({ type: 'drum', drum, time });
    },
    releaseAll(time) {
      for (const midi of [...held]) this.noteOff(midi, time);
    },
    readings(now) {
      if (events.length > 0) return liveReadings(events, now);
      if (!empty) empty = liveReadings(events, now);
      return empty;
    },
  };
}
