import { detectBass } from './audio/bass';
import { detectChords } from './audio/chords';
import { detectDrums } from './audio/drums';
import { analyzeRhythm, downbeatIndex } from './audio/rhythm';
import { analyzeSpectrum } from './audio/spectrum';
import { mixStems, type Stems } from './stems/types';
import { tempoMapFromBeats, tempoMapFromBpm } from './tempo';
import type { Readings, SourceKind } from './types';

export type Stage =
  | 'decode'
  | 'separate'
  | 'spectrum'
  | 'rhythm'
  | 'drums'
  | 'chords'
  | 'bass'
  | 'notes';
export type Progress = (stage: Stage, fraction: number) => void;

export interface AnalyzeOptions {
  /** Demucs 分出來的四軌（有的話）：鼓、bass、和弦各吃各的軌 */
  stems?: Stems;
}

const DEFAULT_BPM = 120;
/** 分軌比混音小聲超過這個 dB 數就當作「這首歌沒有這一軌」：Demucs 不輸出數位零，純鋼琴曲的 bass 軌是殘留 */
const STEM_LEAK_DB = 35;

function rms(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

/** 偵測器本身是尺度不變的（門檻都是相對值），所以要在這裡跟混音比 */
function stemIsLive(stem: Float32Array, mix: Float32Array): boolean {
  return rms(stem) > rms(mix) * 10 ** (-STEM_LEAK_DB / 20);
}

/**
 * 純音訊：五個模組依序跑，產出完整的 Readings。pcm 必須是 44.1 kHz 單聲道。
 * 有 stems 時：drums 吃 drums 軌、bass 吃 bass 軌、chords/key 吃 other + bass；
 * spectrum 與節拍永遠用混音。
 */
export async function analyzeAudio(
  pcm: Float32Array,
  sampleRate: number,
  onProgress: Progress = () => {},
  options: AnalyzeOptions = {},
): Promise<Readings> {
  const { stems } = options;
  const kind: SourceKind = stems ? 'stem' : 'audio';
  const duration = pcm.length / sampleRate;
  onProgress('spectrum', 0);
  const spectrum = analyzeSpectrum(pcm, sampleRate);
  onProgress('rhythm', 0.2);
  const rhythm = await analyzeRhythm(pcm);
  const hasBeat = rhythm.bpm > 0;
  onProgress('drums', 0.4);
  let drums: Readings['drums'] = [];
  if (!stems) drums = await detectDrums(pcm, spectrum, sampleRate);
  else if (stemIsLive(stems.drums, pcm))
    drums = await detectDrums(stems.drums, analyzeSpectrum(stems.drums, sampleRate), sampleRate);
  onProgress('chords', 0.6);
  const harmonic = stems ? mixStems(stems, ['other', 'bass']) : pcm;
  const { chords, key } =
    !stems || stemIsLive(harmonic, pcm)
      ? await detectChords(harmonic, rhythm.beats)
      : { chords: [], key: undefined };
  onProgress('bass', 0.8);
  let bass: Readings['bass'] = [];
  if (!stems) bass = detectBass(pcm, sampleRate);
  else if (stemIsLive(stems.bass, pcm)) bass = detectBass(stems.bass, sampleRate);
  onProgress('bass', 1);
  // tempo map 跟著拍點走（速度漂移的歌小節格才不會漂）；強拍看 kick 與和弦換的時刻
  const downbeat = downbeatIndex(rhythm.beats, [
    ...drums.filter((h) => h.kind === 'kick').map((h) => ({ time: h.time, weight: 1 })),
    ...chords.map((c) => ({ time: c.time, weight: 2 })),
  ]);
  const tempo = hasBeat
    ? tempoMapFromBeats(rhythm.beats, { downbeat })
    : tempoMapFromBpm(DEFAULT_BPM);
  return {
    duration,
    tempo,
    drums,
    roles: [],
    spectrum,
    chords,
    bass,
    key,
    rhythm: hasBeat ? rhythm : undefined,
    source: {
      tempo: hasBeat ? 'audio' : 'none',
      drums: drums.length ? kind : 'none',
      chords: chords.length ? kind : 'none',
      bass: bass.length ? kind : 'none',
      key: key ? kind : 'none',
    },
  };
}
