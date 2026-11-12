import { assertStems, type StemName, type Stems } from './types';

/** 模型與 ORT wasm 都由 `pnpm setup:models` 放進 public/，同源提供（COEP 之下跨域要 CORS，自己放最省事） */
export const MODEL_URL = '/models/htdemucs_embedded.onnx';
export const MODEL_SOURCE =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
export const ORT_WASM_PATH = '/ort/';

export interface StereoChannels {
  left: Float32Array;
  right: Float32Array;
}

/** demucs-web 的 DemucsProcessor 用到的那一小塊介面；測試注入假的 */
export interface StemProcessor {
  loadModel(url: string): Promise<void>;
  separate(left: Float32Array, right: Float32Array): Promise<Record<StemName, StereoChannels>>;
}

export interface SeparateOptions {
  /** 預設：動態 import onnxruntime-web + demucs-web 建 DemucsProcessor（只在瀏覽器） */
  createProcessor?: (onProgress: (fraction: number) => void) => Promise<StemProcessor>;
  modelUrl?: string;
  /** 0–1 */
  onProgress?: (fraction: number) => void;
}

/** 左右平均 */
export function toMono(ch: StereoChannels): Float32Array {
  const out = new Float32Array(ch.left.length);
  for (let i = 0; i < out.length; i++) out[i] = (ch.left[i] + ch.right[i]) / 2;
  return out;
}

async function createDemucsProcessor(
  onProgress: (fraction: number) => void,
): Promise<StemProcessor> {
  const ort = await import('onnxruntime-web');
  const { DemucsProcessor } = await import('demucs-web');
  ort.env.wasm.wasmPaths = ORT_WASM_PATH;
  ort.env.wasm.numThreads = globalThis.navigator?.hardwareConcurrency || 4;
  return new DemucsProcessor({
    ort,
    onProgress: ({ progress }: { progress: number }) => onProgress(progress),
  }) as unknown as StemProcessor;
}

/**
 * 把一首歌拆成四軌（各自混成單聲道）。left/right 必須同長度、44 100 Hz；
 * 單聲道來源就兩條給同一個陣列。
 */
export async function separateStems(
  left: Float32Array,
  right: Float32Array,
  opts: SeparateOptions = {},
): Promise<Stems> {
  if (left.length !== right.length)
    throw new Error(`separateStems: channel length mismatch ${left.length} vs ${right.length}`);
  const onProgress = opts.onProgress ?? (() => {});
  const processor = await (opts.createProcessor ?? createDemucsProcessor)(onProgress);
  await processor.loadModel(opts.modelUrl ?? MODEL_URL);
  const out = await processor.separate(left, right);
  const stems: Stems = {
    sampleRate: 44100,
    drums: toMono(out.drums),
    bass: toMono(out.bass),
    other: toMono(out.other),
    vocals: toMono(out.vocals),
  };
  assertStems(stems);
  return stems;
}

/** 模型檔在不在（HEAD 200）；抓不到就 false，讓流程退回直接分析混音 */
export async function modelAvailable(
  url: string = MODEL_URL,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
