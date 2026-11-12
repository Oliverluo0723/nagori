# 里程碑 5：瀏覽器內分軌（Demucs）＋ Worker ＋ 評測集 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 沒有 MIDI 的歌，先在瀏覽器裡用 Demucs 拆成 drums / bass / other / vocals 四軌，再讓既有的鼓、bass、和弦偵測器各吃各的軌；整條分析搬進 Web Worker；加一個可重複跑的評測腳本，之後任何偵測器或模型的改動都要過它。

**Architecture:** 分軌用 `demucs-web`（Meta htdemucs 轉成的 172 MB 嵌入權重 ONNX）跑在 `onnxruntime-web` 上，多執行緒 WASM（需要 COOP/COEP 標頭）。`analyzeAudio` 多收一個可選的 `stems`：有就讓 drums / bass / chords 改吃對應的軌，spectrum 與節拍仍用混音。分軌和分析都在一個 module Worker 裡跑，主執行緒只負責解碼、快取（OPFS，以檔案 SHA-256 當 key）和畫進度。模型與 ORT 的 wasm 由一個腳本放進 `public/`（git-ignore），找不到模型就退回直接分析混音，app 不會壞。

**Tech Stack:** 同前（Vite 8、TypeScript、React、vitest、biome），新增 `onnxruntime-web`、`demucs-web`。

**Spec:** `docs/superpowers/specs/2026-11-12-oto-reels-tool-design.md` §4.1、§9，以及本計畫 Task 0 新增的 §10（分軌決定）。

**Spike 證據（2026-11-12，使用者的 Mac、Chrome）：** KILL LOVE 前 60 秒分軌 15.2 秒（即時的 4 倍快），模型本機載入 1.3 秒；bass 軌上偵測覆蓋率 41% → 69%，高八度假音 10 → 0。Spike 程式在工作階段暫存區，不進專案。

## Global Constraints

- 分支：從 `1ea6b8a`（milestone-4 的 HEAD，等於 milestone-3）開 `milestone-5-stems`，**用 git worktree**（`superpowers:using-git-worktrees`），因為目前的工作樹在 milestone-4 上有另一份未 commit 的 Sheet looks 工作，不能碰。
- 瀏覽器限定 Chrome；dev server 與 preview 都要送 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`（SharedArrayBuffer）。
- 模型與 wasm 不進 git：`public/models/`、`public/ort/` 加進 `.gitignore`；`pnpm setup:models` 一次備齊。
- Node 測試不得載入 `onnxruntime-web` 或 `demucs-web`：兩者只在瀏覽器 code path 用動態 `import()`，測試一律注入假的 processor。
- 同輸入同輸出；不讀 `Date`、不用 `Math.random`。
- 有 MIDI 的欄位永遠以 MIDI 優先（`mergeReadings` 規則不變）；只有 `needsAudio` 時才分軌。
- 每個 task 結束：`pnpm test`、`pnpm typecheck`、`pnpm lint` 全綠再 commit。commit 訊息結尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 回覆使用者用繁體中文；程式註解照既有風格（繁中）。

## Review Focus

1. **模型檔不存在（還沒跑 `setup:models`、或 build 後忘了放）**：分析要照常完成，讀數來源是 `audio`，UI 顯示一行提示，不能卡在「分軌 0%」。→ Task 7 測試 `separation unavailable → falls back to mix analysis`。
2. **第二次開同一首歌**：不能再跑一次 Demucs；快取命中時進度直接跳過 `separate`。→ Task 6 測試 `cache hit skips separation`。
3. **單聲道音檔**：demucs 需要雙聲道，左右都給同一條。→ Task 4 測試 `mono input is duplicated to both channels`。
4. **分軌後的 bass 軌是空的（純鋼琴曲、清唱）**：`detectBass` 回空陣列、`source.bass` 為 `none`，不丟錯。→ Task 2 測試 `silent bass stem → no bass notes, source none`。
5. **Worker 內 essentia.js 的 WASM 載入**：essentia 在 Worker 裡初始化的路徑跟主執行緒不同，可能載不到。→ Task 6 的瀏覽器驗證步驟明確檢查 console 沒有 essentia 錯誤，且 `source.tempo === 'audio'`。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/analysis/stems/types.ts` | `Stems`、`StemName`、`STEM_NAMES` |
| `src/analysis/stems/separate.ts` | 把 demucs-web 包成 `separateStems(left, right, opts)`；混成單聲道；模型／wasm 路徑常數；`modelAvailable()` |
| `src/analysis/stems/cache.ts` | `StemStore` 介面、`stemKey()`、`MemoryStemStore`、`OpfsStemStore` |
| `src/analysis/analyzeAudio.ts` | 新增 `options.stems`：有就各軌各吃；`Stage` 加 `'separate'` |
| `src/analysis/types.ts` | `SourceKind` 加 `'stem'` |
| `src/analysis/worker.ts` | module Worker 入口：收 PCM（＋可選 stems）→ 分軌 → 分析 → 回傳 |
| `src/analysis/workerClient.ts` | `analyzeInWorker()`：主執行緒的 Promise 包裝 |
| `src/analysis/audio/decode.ts` | 解碼同時回傳左右聲道 |
| `src/app/useProject.ts` | 流程：解碼 → 算 key → 查快取 → Worker 分析 → 寫快取 |
| `src/app/App.tsx` | 進度文字加 `separate`；來源顯示加 `stem`；模型缺少的提示 |
| `vite.config.ts` | COOP/COEP 標頭；`optimizeDeps.exclude` |
| `scripts/setup-models.mjs` | 下載模型到 `public/models/`、複製 ORT wasm 到 `public/ort/` |
| `eval/metrics.ts`、`eval/run.test.ts` | 評測：音符 F1、和弦根音正確率；跑 `samples/eval/` 裡有答案的歌 |
| `docs/superpowers/notes/2026-11-12-milestone-5-check.md` | 驗收紀錄與截圖 |

---

### Task 0: 分支、bass 修正、規格修訂

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-oto-reels-tool-design.md`（加 §10）
- Modify: `src/analysis/audio/bass.ts`、`src/analysis/audio/bass.test.ts`、`test/fixtures/audio.ts`（套用既有的 patch）
- Create: `docs/superpowers/plans/2026-11-12-milestone-5-stems.md`（這份）

- [ ] **Step 1: 開 worktree**

用 `superpowers:using-git-worktrees`，分支名 `milestone-5-stems`，基底 `1ea6b8a`。之後所有步驟都在 worktree 裡做。

- [ ] **Step 2: 套用 bass 修正 patch**

Run: `git apply /private/tmp/claude-501/-Users-bd-Desktop-oto/47148870-331a-45d8-8b3d-f3c2cba6fa35/scratchpad/bass-fix.patch && pnpm install && pnpm test`
Expected: `Tests  108 passed`（原 104 ＋ bass 新增 4：弱基頻八度、弱基頻覆蓋率、pad-only 無鼓、pad+鼓）

若 patch 檔不在（新的工作階段），改從 milestone-4 工作樹複製那三個檔案：`src/analysis/audio/bass.ts`、`src/analysis/audio/bass.test.ts`、`test/fixtures/audio.ts`。

- [ ] **Step 3: Commit bass 修正**

```bash
git add src/analysis/audio/bass.ts src/analysis/audio/bass.test.ts test/fixtures/audio.ts
git commit -m "fix(analysis): bass pitch by subharmonic summation; harmonicity, fundamental and blip gates

基頻弱的 bass（失真、808）之前抓到泛音：八度錯、五度錯、覆蓋 20%。
改成 6 個泛音加總（sqrt 壓縮、扣雜訊底），加三個門檻：
諧波度（擋 kick）、基頻存在（擋被折一個八度的 pad/string）、
夾在同音之間的短音丟掉。KILL LOVE 覆蓋 20% → 47%，Hotel Room 的 pad 不再被當 bass。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 規格加 §10**

在規格最後加：

```markdown
## 10. 2026-11-12 里程碑 3 之後的修訂：分軌

- **§4.1「不上重型模型」取消**。純音訊路徑先用 Demucs（htdemucs，172 MB ONNX，`demucs-web` + `onnxruntime-web`）在瀏覽器內拆成 drums / bass / other / vocals，再讓鼓、bass、和弦偵測器各吃各的軌；spectrum 與節拍仍用混音。Spike 實測：60 秒音訊 15 秒分完（即時的 4 倍快），bass 覆蓋率 41% → 69%，高八度假音歸零。
- **理由**：電子樂的 pad / string / fx 坐在 150–300 Hz，任何直接聽混音的 bass 偵測都會把它們折一個八度當 bass；分軌從源頭解決，而且鼓和和弦同時受益。各樂器的最佳辨識模型（ADTOF、hFT-Transformer、GAPS）都是在乾淨單一樂器上測的，混音直接餵會掉很多。
- **讀數來源**加 `stem`。MIDI 仍優先，只有 `needsAudio` 的歌才分軌。
- **分析搬進 Web Worker**（含分軌），主執行緒不再凍結。
- **分軌結果快取**在 OPFS，key 是音檔 bytes 的 SHA-256；同一首第二次不重算。
- **模型自己託管**在 `public/models/`（git-ignore），`pnpm setup:models` 下載；找不到模型就退回分析混音並提示。
- **評測集**：`pnpm eval` 對 `samples/eval/` 裡有標準答案的歌算 bass 音符 F1、和弦根音正確率；偵測器與模型的改動要讓整組平均變好才收。
- **bass 偵測法**改為泛音加總 + 諧波度 / 基頻存在 / 短音門檻（見 commit）。
- 不做：吉他、鋼琴分軌（六軌 Demucs 的鋼琴軌品質太差）；和弦改用神經網路模型（ChordMini）留到有評測集之後。
```

- [ ] **Step 5: 把這份計畫複製進 worktree，連同規格一起 commit**

```bash
git add docs/superpowers/specs/2026-11-12-oto-reels-tool-design.md docs/superpowers/plans/2026-11-12-milestone-5-stems.md
git commit -m "docs: spec §10 stems decision; milestone 5 plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Stems 型別與 `SourceKind`

**Files:**
- Create: `src/analysis/stems/types.ts`
- Modify: `src/analysis/types.ts:92`
- Test: `src/analysis/stems/types.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const;
  export type StemName = (typeof STEM_NAMES)[number];
  /** 四軌，各自單聲道、同長度、44 100 Hz */
  export interface Stems { sampleRate: 44100; drums: Float32Array; bass: Float32Array; other: Float32Array; vocals: Float32Array }
  export function assertStems(s: Stems): void; // 長度不一致或 sampleRate 不是 44100 就 throw
  export function mixStems(s: Stems, names: StemName[]): Float32Array; // 逐樣本相加，不正規化
  ```
  `SourceKind = 'midi' | 'audio' | 'stem' | 'none'`

- [ ] **Step 1: 寫測試**

```ts
test('mixStems adds sample-wise', () => {
  const s = stems({ bass: [1, 2], other: [10, 20] });
  expect(Array.from(mixStems(s, ['bass', 'other']))).toEqual([11, 22]);
});
test('assertStems rejects mismatched lengths', () => {
  expect(() => assertStems(stems({ bass: [1, 2, 3] }))).toThrow(/length/);
});
```
（`stems()` 是測試裡的小 helper：沒給的軌補零、長度取第一個給的。）

- [ ] **Step 2: 跑測試確認失敗**　Run: `pnpm vitest run src/analysis/stems` → FAIL（模組不存在）
- [ ] **Step 3: 實作**　`types.ts` 如上；`types.ts:92` 的 union 加 `'stem'`。
- [ ] **Step 4: 跑測試確認通過**；`pnpm typecheck`（`merge.ts`、`App.tsx` 的 `Record<SourceKind, …>` 若有，補 `stem` 項）
- [ ] **Step 5: Commit**　`feat(analysis): Stems type, source kind 'stem'`

---

### Task 2: `analyzeAudio` 吃 stems

**Files:**
- Modify: `src/analysis/analyzeAudio.ts`
- Test: `src/analysis/analyzeAudio.test.ts`

**Interfaces:**
- Consumes: `Stems`、`mixStems`（Task 1）
- Produces:
  ```ts
  export type Stage = 'decode' | 'separate' | 'spectrum' | 'rhythm' | 'drums' | 'chords' | 'bass';
  export interface AnalyzeOptions { stems?: Stems }
  export async function analyzeAudio(pcm: Float32Array, sampleRate: number, onProgress?: Progress, options?: AnalyzeOptions): Promise<Readings>
  ```
  有 `stems` 時：`drums = detectDrums(stems.drums, analyzeSpectrum(stems.drums, sr), sr)`、`chords/key = detectChords(mixStems(stems, ['other','bass']), beats)`、`bass = detectBass(stems.bass, sr)`；`spectrum`、`rhythm` 仍用 `pcm`。`source.drums/chords/bass/key` 有結果時為 `'stem'`，空則 `'none'`。進度分數不變（`separate` 階段由 Worker 另外報）。

- [ ] **Step 1: 寫測試**

```ts
test('with stems: drums come from the drum stem, bass from the bass stem, sources are stem', async () => {
  const mix = synthBeat({ bars: 4 });
  const stems = { sampleRate: 44100 as const, drums: synthBeat({ bars: 4, bassPartials: [], chords: [[]] }),
    bass: synthBeat({ bars: 4, drums: false, chords: [[]] }), other: synthBeat({ bars: 4, drums: false, bassPartials: [] }), vocals: new Float32Array(mix.length) };
  const r = await analyzeAudio(mix, 44100, () => {}, { stems });
  expect(r.source).toMatchObject({ drums: 'stem', bass: 'stem', chords: 'stem', key: 'stem', tempo: 'audio' });
  expect(r.bass?.every((n) => [35, 31, 38, 33].includes(n.midi))).toBe(true);
  expect(r.drums.filter((h) => h.kind === 'kick').length).toBeGreaterThanOrEqual(8);
});
test('silent bass stem → no bass notes, source none', async () => {
  const mix = synthBeat({ bars: 2 });
  const z = new Float32Array(mix.length);
  const r = await analyzeAudio(mix, 44100, () => {}, { stems: { sampleRate: 44100, drums: mix, bass: z, other: mix, vocals: z } });
  expect(r.bass).toEqual([]);
  expect(r.source?.bass).toBe('none');
});
```
（`synthBeat` 的 `chords: [[]]` 表示沒有 pad；若 fixture 不支援空和弦陣列，在 `test/fixtures/audio.ts` 讓 `chords: [[]]` 合法。）

- [ ] **Step 2: 跑測試確認失敗**　Run: `pnpm vitest run src/analysis/analyzeAudio.test.ts`
- [ ] **Step 3: 實作**　照 Interfaces；既有無 stems 的路徑行為不變。
- [ ] **Step 4: 跑全部測試、typecheck、lint**
- [ ] **Step 5: Commit**　`feat(analysis): analyzeAudio takes stems; drums/bass/chords read their own stem`

---

### Task 3: 解碼回傳左右聲道

**Files:**
- Modify: `src/analysis/audio/decode.ts`
- Modify: `src/app/useProject.ts:20`（`LoadDeps.decode` 的型別）

**Interfaces:**
- Produces:
  ```ts
  export interface DecodedAudio { pcm: Float32Array; sampleRate: 44100; left: Float32Array; right: Float32Array }
  export async function decodeAudio(file: File): Promise<DecodedAudio>
  ```
  `OfflineAudioContext` 改成 2 聲道渲染；`pcm = (left + right) / 2`；來源單聲道時 `left === right`（同一條）。`LoadDeps.decode` 改回傳 `DecodedAudio`，但 `left`/`right` 設成可選（`Partial<Pick<DecodedAudio,'left'|'right'>>`），讓既有測試只給 `pcm` 仍能過；沒給時 `useProject` 用 `pcm` 當左右。

- [ ] **Step 1: 改型別、改實作**（瀏覽器專屬，沒有 Node 測試）
- [ ] **Step 2: `pnpm typecheck && pnpm test`** 全綠（既有 useProject 測試不需改）
- [ ] **Step 3: Commit**　`feat(decode): return left/right channels for separation`

---

### Task 4: `separateStems`：demucs-web 包裝 ＋ 模型腳本 ＋ Vite 標頭

**Files:**
- Create: `src/analysis/stems/separate.ts`
- Create: `scripts/setup-models.mjs`
- Modify: `vite.config.ts`、`package.json`（scripts、dependencies）、`.gitignore`
- Test: `src/analysis/stems/separate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MODEL_URL = '/models/htdemucs_embedded.onnx';
  export const MODEL_SOURCE = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
  export const ORT_WASM_PATH = '/ort/';
  export interface StemProcessor {
    loadModel(url: string): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<Record<StemName, { left: Float32Array; right: Float32Array }>>;
  }
  export interface SeparateOptions {
    /** 預設：動態 import onnxruntime-web + demucs-web 建 DemucsProcessor */
    createProcessor?: (onProgress: (fraction: number) => void) => Promise<StemProcessor>;
    modelUrl?: string;
    onProgress?: (fraction: number) => void; // 0–1
  }
  export async function separateStems(left: Float32Array, right: Float32Array, opts?: SeparateOptions): Promise<Stems>;
  export function toMono(ch: { left: Float32Array; right: Float32Array }): Float32Array;
  export async function modelAvailable(url?: string, fetchFn?: typeof fetch): Promise<boolean>; // HEAD 200 才 true
  ```
  預設 `createProcessor`：`const ort = await import('onnxruntime-web'); const { DemucsProcessor } = await import('demucs-web');`，設 `ort.env.wasm.wasmPaths = ORT_WASM_PATH`、`ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4`，`new DemucsProcessor({ ort, onProgress: ({ progress }) => onProgress(progress) })`。`separateStems` 的 `left.length !== right.length` 就 throw。

- [ ] **Step 1: 寫測試（注入假 processor）**

```ts
test('separateStems mixes each stem to mono and reports progress', async () => {
  const calls: number[] = [];
  const fake: StemProcessor = { loadModel: async () => {}, separate: async (l, r) => {
    const st = (k: number) => ({ left: l.map((v) => v * k), right: r.map((v) => v * k) });
    return { drums: st(1), bass: st(2), other: st(3), vocals: st(4) }; } };
  const s = await separateStems(new Float32Array([1, 1]), new Float32Array([3, 3]),
    { createProcessor: async (p) => { p(0.5); p(1); return fake; }, onProgress: (f) => calls.push(f) });
  expect(Array.from(s.bass)).toEqual([4, 4]); // (1·2 + 3·2) / 2
  expect(s.sampleRate).toBe(44100);
  expect(calls).toEqual([0.5, 1]);
});
test('mono input is duplicated to both channels', async () => {
  const seen: number[][] = [];
  const fake: StemProcessor = { loadModel: async () => {}, separate: async (l, r) => { seen.push(Array.from(l), Array.from(r)); const z = { left: l, right: r }; return { drums: z, bass: z, other: z, vocals: z }; } };
  await separateStems(new Float32Array([5]), new Float32Array([5]), { createProcessor: async () => fake });
  expect(seen).toEqual([[5], [5]]);
});
test('modelAvailable is false on 404', async () => {
  expect(await modelAvailable('/x', async () => new Response(null, { status: 404 }))).toBe(false);
});
```

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: `pnpm add onnxruntime-web demucs-web`**，實作 `separate.ts`
- [ ] **Step 4: `scripts/setup-models.mjs`**：(a) 若 `public/models/htdemucs_embedded.onnx` 不存在或大小 ≠ 180534758 bytes，從 `MODEL_SOURCE` 用 `fetch` 串流下載並印進度；(b) 把 `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{mjs,wasm}` 複製到 `public/ort/`。`package.json` 加 `"setup:models": "node scripts/setup-models.mjs"`。`.gitignore` 加 `public/models/` 與 `public/ort/`。
- [ ] **Step 5: `vite.config.ts`**：`server.headers` 與 `preview.headers` 都加 COOP/COEP 兩行；`optimizeDeps: { exclude: ['onnxruntime-web', 'demucs-web'] }`；`worker: { format: 'es' }`。
- [ ] **Step 6: 跑 `pnpm setup:models`**（模型檔若已在 spike 資料夾 `/private/tmp/claude-501/-Users-bd-Desktop-oto/47148870-331a-45d8-8b3d-f3c2cba6fa35/scratchpad/spike-demucs/htdemucs_embedded.onnx`，腳本支援 `SETUP_MODELS_FROM=<path>` 環境變數直接複製，省 172 MB 下載），確認 `public/models/` 與 `public/ort/` 齊了。
- [ ] **Step 7: 全部測試、typecheck、lint 綠**；確認 `pnpm test` 的輸出沒有 onnxruntime 相關字樣（Node 沒載到它）
- [ ] **Step 8: Commit**　`feat(stems): demucs-web wrapper, model setup script, COOP/COEP headers`

---

### Task 5: 分軌快取（OPFS）

**Files:**
- Create: `src/analysis/stems/cache.ts`
- Test: `src/analysis/stems/cache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StemStore { get(key: string): Promise<Stems | undefined>; put(key: string, stems: Stems): Promise<void> }
  export async function stemKey(bytes: ArrayBuffer): Promise<string>; // 'v1-' + SHA-256 hex（crypto.subtle，Node 20+ 也有）
  export class MemoryStemStore implements StemStore { … }
  export class OpfsStemStore implements StemStore { … } // navigator.storage.getDirectory() → 子目錄 'stems'，每軌一個檔 `${key}.${name}.f32`，另存 `${key}.json` 記 length；任何一軌缺就當 miss
  ```
  key 前綴 `v1-` 讓以後換模型時整批失效。

- [ ] **Step 1: 寫測試**

```ts
test('stemKey is stable and changes with content', async () => {
  const a = await stemKey(new Uint8Array([1, 2, 3]).buffer);
  expect(a).toMatch(/^v1-[0-9a-f]{64}$/);
  expect(await stemKey(new Uint8Array([1, 2, 3]).buffer)).toBe(a);
  expect(await stemKey(new Uint8Array([1, 2, 4]).buffer)).not.toBe(a);
});
test('MemoryStemStore round-trips', async () => { … put 然後 get 回同內容；get 未知 key 回 undefined });
```

- [ ] **Step 2: 跑測試確認失敗**　- [ ] **Step 3: 實作**（OPFS 版無 Node 測試，保持薄）　- [ ] **Step 4: 測試、typecheck、lint**
- [ ] **Step 5: Commit**　`feat(stems): stem cache (memory + OPFS), content-hash key`

---

### Task 6: Worker ＋ 主執行緒接線

**Files:**
- Create: `src/analysis/worker.ts`、`src/analysis/workerClient.ts`
- Modify: `src/app/useProject.ts`、`src/app/App.tsx:18-25`
- Test: `src/app/useProject.test.ts`

**Interfaces:**
- Consumes: `separateStems`、`modelAvailable`、`MODEL_URL`（Task 4）；`StemStore`、`stemKey`（Task 5）；`analyzeAudio(..., { stems })`（Task 2）
- Produces:
  ```ts
  // workerClient.ts
  export interface AnalyzeInput { pcm: Float32Array; sampleRate: number; left: Float32Array; right: Float32Array; stems?: Stems; separate: boolean }
  export type AnalyzeFn = (input: AnalyzeInput, onProgress: Progress, onStems?: (stems: Stems) => void) => Promise<Readings>;
  export const analyzeInWorker: AnalyzeFn; // new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })，Float32Array 用 transfer
  export const analyzeInline: AnalyzeFn;   // 同一套流程不開 Worker（測試與退路用）：separate → analyzeAudio
  ```
  Worker 訊息：`{ id, type: 'progress', stage, fraction } | { id, type: 'stems', stems } | { id, type: 'done', readings } | { id, type: 'error', message }`。流程（`analyzeInline` 與 worker 共用一個 `runAnalysis(input, onProgress, onStems, separateFn)`）：若 `input.separate && !input.stems` → `onProgress('separate', f)` 跟著 `separateStems` 的進度，成功就 `onStems(stems)`；失敗（含模型 404）`console.warn` 後當作沒有 stems 繼續。然後 `analyzeAudio(pcm, sampleRate, onProgress, { stems })`。
  `LoadDeps` 改：`analyze?: AnalyzeFn`（預設 `analyzeInWorker`）、新增 `stemStore?: StemStore`（預設 `OpfsStemStore`，Node 測試給 `MemoryStemStore`）、`separate?: boolean`（預設 `true`）。`loadDroppedFiles`：`needsAudio` 成立時，`bytes = await audio.arrayBuffer()`、`key = await stemKey(bytes)`、`cached = await store.get(key)`，呼叫 `analyze({ …, stems: cached, separate: deps.separate !== false && !cached }, progress, (s) => store.put(key, s))`。`ProjectState.analyzing` 不變。`App.tsx` 的 `STAGE_TEXT` 加 `separate: '分軌（第一次約一分鐘）'`；來源顯示的對照表加 `stem: '分軌'`。

- [ ] **Step 1: 寫測試（`useProject.test.ts`）**

```ts
test('needsAudio → analyze gets separate=true and stems are cached under the file hash', async () => {
  const store = new MemoryStemStore(); const inputs: AnalyzeInput[] = [];
  const stems = fakeStems(44100);
  const analyze: AnalyzeFn = async (input, _p, onStems) => { inputs.push(input); onStems?.(stems); return fakeReadings; };
  await loadDroppedFiles([new File(['abc'], 'song.mp3')], { ...deps, decode: fakeDecode, analyze, stemStore: store });
  expect(inputs[0].separate).toBe(true);
  expect(await store.get(await stemKey(new TextEncoder().encode('abc').buffer))).toBe(stems);
});
test('cache hit skips separation', async () => { … 先 put，再 load，expect(inputs[0]).toMatchObject({ separate: false, stems }) });
test('mp3 + full mid → no separation requested', async () => { … expect(inputs).toHaveLength(0) 或 separate false });
test('analyzeInline: separation failure falls back to mix analysis', async () => {
  const r = await analyzeInline({ pcm, sampleRate: 44100, left: pcm, right: pcm, separate: true }, () => {}, undefined, /* separateFn */ async () => { throw new Error('404'); });
  expect(r.source?.bass).not.toBe('stem');
});
```
既有測試裡的 `analyze: fakeAudio` 改成新簽名（`(input) => …`）。

- [ ] **Step 2: 跑測試確認失敗**　- [ ] **Step 3: 實作** `worker.ts`、`workerClient.ts`、`useProject.ts`、`App.tsx`
- [ ] **Step 4: 測試、typecheck、lint 綠**
- [ ] **Step 5: 瀏覽器驗證（用 `superpowers` 的瀏覽器工具或請使用者）**：`pnpm dev` → 拖 `samples/kill-love.mp3`（不要給 .mid）→ 進度出現「分軌」且一路走到完成；console 沒有 essentia / onnxruntime 錯誤；來源列顯示 drums / chords / bass / key 都是「分軌」、tempo 是「音訊」；UI 在分析期間能互動（切主題不卡）。再拖一次同一首：沒有「分軌」階段，直接「算頻譜」起跳。
- [ ] **Step 6: Commit**　`feat(app): analysis in a Web Worker with Demucs separation and OPFS stem cache`

---

### Task 7: 模型缺少的提示

**Files:**
- Modify: `src/analysis/workerClient.ts`（`runAnalysis` 回報 `separated: boolean`）、`src/app/useProject.ts`、`src/app/App.tsx`
- Test: `src/app/useProject.test.ts`

**Interfaces:**
- `LoadResult.ok` 加 `notes: string[]`（給 UI 的提示，例如 `['找不到分軌模型，改用混音分析：先跑 pnpm setup:models']`）；`ProjectState.ready` 加 `notes`。`App.tsx` 在來源列下方用 `theme.mute` 色列出。

- [ ] **Step 1: 測試** `separation unavailable → falls back to mix analysis`：`analyze` 回傳的 readings `source.bass === 'audio'` 且 `r.notes` 含「分軌模型」字樣。
- [ ] **Step 2: 實作**　- [ ] **Step 3: 測試綠**　- [ ] **Step 4: Commit**　`feat(app): note when separation model is missing`

---

### Task 8: 評測集

**Files:**
- Create: `eval/metrics.ts`、`eval/metrics.test.ts`、`eval/run.test.ts`、`eval/README.md`、`samples/eval/README.md`（samples 是 git-ignore，README 例外：`.gitignore` 加 `!samples/eval/README.md`）
- Modify: `package.json`（`"eval": "vitest run --dir eval"`）、`vite.config.ts`（`test.include` 不含 `eval/**`，`pnpm test` 不會跑它）

**Interfaces:**
- Produces:
  ```ts
  export interface TruthNote { time: number; duration: number; midi: number }
  export interface TruthChord { time: number; duration: number; root: number }
  export interface SongTruth { name: string; audio: string; stems?: string; bass?: TruthNote[]; chords?: TruthChord[]; drums?: { time: number; kind: 'kick'|'snare'|'hat' }[] }
  export function noteF1(pred: BassNote[], truth: TruthNote[], onsetTol?: number): { precision: number; recall: number; f1: number }; // onset ±50 ms、midi 相等；八度錯另計 octaveErrors
  export function chordRootAccuracy(pred: ChordEvent[], truth: TruthChord[]): number; // 以時間長度加權
  export function drumF1(pred: DrumHit[], truth: SongTruth['drums'], tol?: number): Record<'kick'|'snare'|'hat', number>;
  ```
  `run.test.ts`：讀 `samples/eval/*.json`（每首一個 `SongTruth`），用 `ffmpeg` 解碼 `audio` 成 44.1k 單聲道（`execFileSync`，跟 `samples/mp3-to-mid.mjs` 一樣），若 `stems` 目錄有 `{bass,drums,other}.wav` 就組成 `Stems` 傳進 `analyzeAudio`，印一張表（歌名｜bass F1｜八度錯｜和弦根音｜kick/snare/hat F1）並寫到 `eval/last-run.md`（git-ignore）。沒有任何 json 時印「沒有評測集」並通過。另外內建一個合成案例（`synthBeat({ bars: 8 })` 的 bass / drums 真值來自 fixture），永遠會跑，門檻：bass F1 ≥ 0.9、kick F1 ≥ 0.9。

- [ ] **Step 1: 寫 `metrics.test.ts`**：`noteF1` 對完全相同的清單是 1；onset 偏 40 ms 仍算中、偏 80 ms 不算；八度錯不算中但 `octaveErrors` +1；`chordRootAccuracy` 對半對半錯是 0.5。
- [ ] **Step 2: 確認失敗、實作 `metrics.ts`、確認通過**
- [ ] **Step 3: `run.test.ts` 與 README**（README 寫清楚 json 格式、怎麼用 spike 頁或 app 匯出 stems、怎麼從 DAW MIDI 產生真值：`samples/eval/midi-to-truth.mjs` 一個小腳本，用 `@tonejs/midi` 把 bass 軌與和弦軌轉成 `SongTruth`）
- [ ] **Step 4: `pnpm eval`** → 合成案例過門檻；`pnpm test` 不含 eval
- [ ] **Step 5: Commit**　`feat(eval): bass/chord/drum metrics and eval runner`

---

### Task 9: 驗收紀錄

**Files:**
- Create: `docs/superpowers/notes/2026-11-12-milestone-5-check.md`（＋截圖 `…-m5-killlove-stems.jpg`、`…-m5-hotelroom-stems.jpg`）

- [ ] **Step 1:** `pnpm dev`，KILL LOVE 與 `samples/hotel-room.mp3` 各跑一次，記錄：分軌時間、整體分析時間、來源列、`pnpm eval` 的表。截圖 bodies 或 grid look。
- [ ] **Step 2:** 寫 note：結果、已知問題（和弦 D/Dm 混淆仍在；WebGPU 是否真的被用到——在 console 用 `ort.env` 查，記下來）、下一步候選（ChordMini、吉他/鋼琴）。
- [ ] **Step 3: Commit**　`docs: milestone 5 check (stems)`

---

## 自我檢查

- 規格覆蓋：§10 每一條都有 task（分軌 4、各軌各吃 2、Worker 6、快取 5、模型託管/退路 4+7、評測 8、bass 法 0、來源 stem 1）。
- 型別一致：`Stems`（Task 1）→ Task 2/4/5/6；`StemProcessor`/`separateStems`（Task 4）→ Task 6；`StemStore`/`stemKey`（Task 5）→ Task 6；`AnalyzeFn`/`AnalyzeInput`（Task 6）→ Task 7。
- Review Focus 五條各有測試或驗證步驟（1→T7、2→T6、3→T4、4→T2、5→T6 Step 5）。
