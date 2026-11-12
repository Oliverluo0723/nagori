import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';

export type EssentiaInstance = Essentia;

let instance: Promise<EssentiaInstance> | null = null;

/**
 * essentia.js 只在純音訊路徑需要，所以動態載入，而且整個 app 只建一個。
 * wasm 以 base64 內嵌在 es 版 dist 裡，瀏覽器與 Node 都不用額外設定。
 */
export function getEssentia(): Promise<EssentiaInstance> {
  if (!instance) {
    instance = (async () => {
      const [{ EssentiaWASM }, core] = await Promise.all([
        import('essentia.js/dist/essentia-wasm.es.js'),
        import('essentia.js/dist/essentia.js-core.es.js'),
      ]);
      return new core.default(EssentiaWASM);
    })();
  }
  return instance;
}
