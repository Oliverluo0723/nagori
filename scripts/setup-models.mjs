// 一次備齊分軌要的模型（不進 git）：
//   public/models/htdemucs_embedded.onnx  ← Hugging Face（或 SETUP_MODELS_FROM=<本機路徑> 直接複製）
// ORT 的 wasm 不用放：separate.ts 用 Vite 的 ?url 從 node_modules 拿。
// 用法：pnpm setup:models
import { copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const MODEL_SOURCE =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const MODEL_BYTES = 180534758;
const MODEL_DIR = join(ROOT, 'public', 'models');
const MODEL_PATH = join(MODEL_DIR, 'htdemucs_embedded.onnx');

function sizeOf(path) {
  return existsSync(path) ? statSync(path).size : -1;
}

async function ensureModel() {
  if (sizeOf(MODEL_PATH) === MODEL_BYTES) {
    console.log('model: ok');
    return;
  }
  mkdirSync(MODEL_DIR, { recursive: true });
  const from = process.env.SETUP_MODELS_FROM;
  if (from && sizeOf(from) === MODEL_BYTES) {
    copyFileSync(from, MODEL_PATH);
    console.log(`model: copied from ${from}`);
    return;
  }
  console.log(`model: downloading ${MODEL_SOURCE} (${(MODEL_BYTES / 1048576).toFixed(0)} MB)`);
  const res = await fetch(MODEL_SOURCE);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  let done = 0;
  let lastPct = -1;
  const progress = new TransformStream({
    transform(chunk, controller) {
      done += chunk.byteLength;
      const pct = Math.floor((done / MODEL_BYTES) * 20) * 5;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\r  ${pct}%`);
      }
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(progress)), createWriteStream(MODEL_PATH));
  process.stdout.write('\n');
  if (sizeOf(MODEL_PATH) !== MODEL_BYTES)
    throw new Error(`model size ${sizeOf(MODEL_PATH)} ≠ expected ${MODEL_BYTES}`);
  console.log('model: downloaded');
}

await ensureModel();
