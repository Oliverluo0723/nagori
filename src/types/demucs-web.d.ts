/** demucs-web 沒附型別；只宣告我們用到的那一塊 */
declare module 'demucs-web' {
  export interface DemucsProgress {
    progress: number;
    currentSegment: number;
    totalSegments: number;
  }
  export interface DemucsOptions {
    ort: unknown;
    modelPath?: string;
    sessionOptions?: Record<string, unknown>;
    onProgress?: (p: DemucsProgress) => void;
    onLog?: (phase: string, message: string) => void;
    onDownloadProgress?: (loaded: number, total: number) => void;
  }
  export interface DemucsStem {
    left: Float32Array;
    right: Float32Array;
  }
  export class DemucsProcessor {
    constructor(options: DemucsOptions);
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>;
    separate(
      left: Float32Array,
      right: Float32Array,
    ): Promise<{ drums: DemucsStem; bass: DemucsStem; other: DemucsStem; vocals: DemucsStem }>;
  }
  export const CONSTANTS: {
    SAMPLE_RATE: number;
    TRAINING_SAMPLES: number;
    SEGMENT_OVERLAP: number;
    TRACKS: string[];
    DEFAULT_MODEL_URL: string;
  };
}
