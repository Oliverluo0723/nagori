// essentia.js 0.1.3 的 ES 版 dist 沒有附型別；這裡只宣告我們用到的形狀。
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown;
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export interface EssentiaVector {
    size(): number;
    get(i: number): number;
  }
  export interface EssentiaVectorVector {
    size(): number;
    get(i: number): EssentiaVector;
    push_back(v: EssentiaVector): void;
  }
  export interface EssentiaStringVector {
    size(): number;
    get(i: number): string;
  }
  export default class Essentia {
    constructor(wasm: unknown);
    version: string;
    module: { VectorVectorFloat: new () => EssentiaVectorVector };
    arrayToVector(a: Float32Array): EssentiaVector;
    vectorToArray(v: EssentiaVector): Float32Array;
    FrameGenerator(audio: Float32Array, frameSize?: number, hopSize?: number): EssentiaVectorVector;
    Windowing(
      frame: EssentiaVector,
      normalized?: boolean,
      size?: number,
      type?: string,
    ): { frame: EssentiaVector };
    Spectrum(frame: EssentiaVector, size?: number): { spectrum: EssentiaVector };
    SpectralPeaks(
      spectrum: EssentiaVector,
      magnitudeThreshold?: number,
      maxFrequency?: number,
      maxPeaks?: number,
      minFrequency?: number,
      orderBy?: string,
      sampleRate?: number,
    ): { frequencies: EssentiaVector; magnitudes: EssentiaVector };
    HPCP(
      frequencies: EssentiaVector,
      magnitudes: EssentiaVector,
      bandPreset?: boolean,
      bandSplitFrequency?: number,
      harmonics?: number,
      maxFrequency?: number,
      maxShifted?: boolean,
      minFrequency?: number,
      nonLinear?: boolean,
      normalized?: string,
      referenceFrequency?: number,
      sampleRate?: number,
      size?: number,
      weightType?: string,
      windowSize?: number,
    ): { hpcp: EssentiaVector };
    ChordsDetection(
      pcp: EssentiaVectorVector,
      hopSize?: number,
      sampleRate?: number,
      windowSize?: number,
    ): { chords: EssentiaStringVector; strength: EssentiaVector };
    KeyExtractor(audio: EssentiaVector): { key: string; scale: string; strength: number };
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): {
      bpm: number;
      confidence: number;
      ticks: EssentiaVector;
      estimates: EssentiaVector;
      bpmIntervals: EssentiaVector;
    };
    SuperFluxExtractor(
      signal: EssentiaVector,
      combine?: number,
      frameSize?: number,
      hopSize?: number,
      ratioThreshold?: number,
      sampleRate?: number,
      threshold?: number,
    ): { onsets: EssentiaVector };
  }
}
