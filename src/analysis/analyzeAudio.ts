import { detectBass } from './audio/bass';
import { detectChords } from './audio/chords';
import { detectDrums } from './audio/drums';
import { analyzeRhythm } from './audio/rhythm';
import { analyzeSpectrum } from './audio/spectrum';
import { tempoMapFromBpm } from './tempo';
import type { Readings } from './types';

export type Stage = 'decode' | 'spectrum' | 'rhythm' | 'drums' | 'chords' | 'bass';
export type Progress = (stage: Stage, fraction: number) => void;

const DEFAULT_BPM = 120;

/** 純音訊：五個模組依序跑，產出完整的 Readings。pcm 必須是 44.1 kHz 單聲道。 */
export async function analyzeAudio(
  pcm: Float32Array,
  sampleRate: number,
  onProgress: Progress = () => {},
): Promise<Readings> {
  const duration = pcm.length / sampleRate;
  onProgress('spectrum', 0);
  const spectrum = analyzeSpectrum(pcm, sampleRate);
  onProgress('rhythm', 0.2);
  const rhythm = await analyzeRhythm(pcm);
  const hasBeat = rhythm.bpm > 0;
  const tempo = hasBeat ? tempoMapFromBpm(rhythm.bpm, rhythm.offset) : tempoMapFromBpm(DEFAULT_BPM);
  onProgress('drums', 0.4);
  const drums = await detectDrums(pcm, spectrum, sampleRate);
  onProgress('chords', 0.6);
  const { chords, key } = await detectChords(pcm, rhythm.beats);
  onProgress('bass', 0.8);
  const bass = detectBass(pcm, sampleRate);
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
      drums: drums.length ? 'audio' : 'none',
      chords: chords.length ? 'audio' : 'none',
      bass: bass.length ? 'audio' : 'none',
      key: key ? 'audio' : 'none',
    },
  };
}
