import type { Track } from '@tonejs/midi';
import { Chord } from 'tonal';
import { PC_NAMES, pcFromName } from '../../looks/music';
import { ticksToSeconds } from '../tempo';
import type { ChordEvent, TempoMap } from '../types';

const TONAL_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function nameChord(pcs: number[]): { name: string; root: number } {
  const detected = Chord.detect(pcs.map((pc) => TONAL_NAMES[pc]));
  const first = detected[0]?.split('/')[0];
  if (first) {
    const tonic = Chord.get(first).tonic;
    const root = tonic ? pcFromName(tonic) : pcs[0];
    // tonal 用 'M' 表示大三和弦（'GM'）：顯示成 'G'
    const display = first
      .replace(/^([A-G][#b]?)M$/, '$1')
      .replace('#', '♯')
      .replace('b', '♭');
    return { name: display, root: root < 0 ? pcs[0] : root };
  }
  return { name: PC_NAMES[pcs[0]], root: pcs[0] };
}

/**
 * 每拍看「拍開始時正在響」的音，命名後把相同名稱的連續拍合併。
 * tracks 應該只傳和弦角色的軌。
 */
export function extractChords(tracks: Track[], tempo: TempoMap, duration: number): ChordEvent[] {
  const notes = tracks.flatMap((t) => t.notes);
  if (notes.length === 0) return [];
  const events: ChordEvent[] = [];
  let beatIndex = 0;
  let open: ChordEvent | null = null;
  for (;;) {
    const beatT = ticksToSeconds(tempo, beatIndex * tempo.ppq);
    if (beatT >= duration) break;
    const nextT = Math.min(duration, ticksToSeconds(tempo, (beatIndex + 1) * tempo.ppq));
    const sounding = notes.filter(
      (n) => n.time <= beatT + 1e-6 && beatT < n.time + n.duration - 1e-6,
    );
    beatIndex++;
    if (sounding.length === 0) {
      if (open) {
        events.push(open);
        open = null;
      }
      continue;
    }
    // 依最低音在前排序，再去重成 pitch class 集合
    const lowest = Math.min(...sounding.map((n) => n.midi));
    const pcs = [...new Set(sounding.map((n) => n.midi % 12))];
    pcs.sort((a, b) => a - b);
    const rotated = [lowest % 12, ...pcs.filter((p) => p !== lowest % 12)];
    const { name, root } = nameChord(rotated);
    if (open && open.name === name) {
      open.duration = nextT - open.time;
    } else {
      if (open) events.push(open);
      open = { time: beatT, duration: nextT - beatT, root, name, notes: pcs };
    }
  }
  if (open) events.push(open);
  return events;
}
