import { assertStems, type StemName, type Stems } from './types';

// ORT 的 wasm 膠水檔：用 new URL(相對路徑, import.meta.url)，dev 由 Vite 直接服務 node_modules，
// build 時當 asset 打包。放 public/ 不行（Vite dev 不讓 public 裡的 .mjs 被 import()），
// 用 bare specifier 也不行（套件的 exports 沒開放 dist/）。jsep 版同時支援 webgpu 與 wasm。
const ORT_MJS = new URL(
  '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
  import.meta.url,
);
const ORT_WASM = new URL(
  '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
  import.meta.url,
);

/** 模型由 `pnpm setup:models` 放進 public/models/，同源提供（COEP 之下跨域要 CORS，自己放最省事） */
export const MODEL_URL = '/models/htdemucs_embedded.onnx';
export const MODEL_SOURCE =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
export const MODEL_BYTES = 180534758;
/** separateStems 在模型不在時丟的錯誤訊息開頭（useProject 靠它挑提示文字） */
export const MODEL_MISSING = 'model missing';

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
  ort.env.wasm.wasmPaths = { mjs: ORT_MJS.href, wasm: ORT_WASM.href };
  ort.env.wasm.numThreads = globalThis.navigator?.hardwareConcurrency || 4;
  // demucs-web 寫死 executionProviders: ['webgpu', 'wasm']。有 WebGPU 的 Chrome 會走 GPU，
  // 實測（M 系列 Mac、Chrome 157）卡在 0% 超過一分鐘；WASM 一首 2:18 的歌 23 秒。所以只給 wasm。
  const wasmOnly = {
    ...ort,
    InferenceSession: {
      create: (
        model: Uint8Array,
        options?: import('onnxruntime-web').InferenceSession.SessionOptions,
      ) => ort.InferenceSession.create(model, { ...options, executionProviders: ['wasm'] }),
    },
  };
  return new DemucsProcessor({
    ort: wasmOnly,
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
  const modelUrl = opts.modelUrl ?? MODEL_URL;
  // 真的要載 ORT 之前先確認模型在（省掉 29 MB 的 wasm 載入，也不靠 ORT 去拒絕一份 index.html）
  if (!opts.createProcessor && !(await modelAvailable(modelUrl)))
    throw new Error(`${MODEL_MISSING}: ${modelUrl}`);
  const processor = await (opts.createProcessor ?? createDemucsProcessor)(onProgress);
  await processor.loadModel(modelUrl);
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

/**
 * 模型檔在不在：HEAD 要 ok、不是 text/html（Vite dev 對不存在的檔會回 200 的 index.html）、
 * 有 content-length 的話要等於模型大小。抓不到就 false，讓流程退回直接分析混音。
 */
export async function modelAvailable(
  url: string = MODEL_URL,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, { method: 'HEAD' });
    if (!res.ok) return false;
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return false;
    const length = res.headers.get('content-length');
    return length === null || Number(length) === MODEL_BYTES;
  } catch {
    return false;
  }
}
