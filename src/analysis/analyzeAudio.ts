import { detectBass } from './audio/bass';
import { detectChords } from './audio/chords';
import { detectDrums } from './audio/drums';
import { analyzeRhythm } from './audio/rhythm';
import { analyzeSpectrum } from './audio/spectrum';
import { mixStems, type Stems } from './stems/types';
import { tempoMapFromBpm } from './tempo';
import type { Readings, SourceKind } from './types';

export type Stage = 'decode' | 'separate' | 'spectrum' | 'rhythm' | 'drums' | 'chords' | 'bass';
export type Progress = (stage: Stage, fraction: number) => void;

export interface AnalyzeOptions {
  /** Demucs 分出來的四軌（有的話）：鼓、bass、和弦各吃各的軌 */
  stems?: Stems;
}

const DEFAULT_BPM = 120;

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
  const tempo = hasBeat ? tempoMapFromBpm(rhythm.bpm, rhythm.offset) : tempoMapFromBpm(DEFAULT_BPM);
  onProgress('drums', 0.4);
  const drums = stems
    ? await detectDrums(stems.drums, analyzeSpectrum(stems.drums, sampleRate), sampleRate)
    : await detectDrums(pcm, spectrum, sampleRate);
  onProgress('chords', 0.6);
  const { chords, key } = await detectChords(
    stems ? mixStems(stems, ['other', 'bass']) : pcm,
    rhythm.beats,
  );
  onProgress('bass', 0.8);
  const bass = detectBass(stems ? stems.bass : pcm, sampleRate);
  onProgress('bass', 1);
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
