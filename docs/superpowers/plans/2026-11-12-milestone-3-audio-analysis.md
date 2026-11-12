# 里程碑 3：純音訊分析（沒有 MIDI 也有畫面）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只丟一個 mp3（沒有 .mid）也能得到完整的 Readings：BPM 與拍格、kick / snare / hat、和弦、調性、bass 音高，六個 look 全部有畫面。分析在 Web Worker 裡跑，有進度；BPM 有候選可以一鍵切換，第一拍可以微調。

**Architecture:** `analysis/audio/` 新增 rhythm、drums、chords、bass 四個模組，各自是純函式（輸入 pcm 或已算好的頻譜，輸出純資料），由 `analyzeAudio` 串起來。essentia.js 只在這條路徑動態載入，由 `essentia.ts` 包成單例；bass 與鼓件分類用自己的 FFT 實作（已驗證）。`mergeReadings` 規定 MIDI 與音訊結果的優先順序：MIDI 有的欄位用 MIDI，沒有的用音訊。`TempoMap` 加一個 `offset`（第一拍在音檔的秒數），所有拍格換算經過它。Worker 用 Vite 的 module worker。

**Tech Stack:** 同前，加 `essentia.js` 0.1.3（已裝；AGPL，自用不發行）。

**Spec:** `docs/superpowers/specs/2026-11-12-oto-reels-tool-design.md` 第 4.1、8（Q13、Q14、Q19）、9 節。

## 已驗證的事實（2026-11-12 在 Node 用 essentia.js 實測）

- `RhythmExtractor2013(vec, 208, 'multifeature', 40)`：合成 120 BPM 的 beat 給 120.02，拍點誤差 ±30 ms，17 秒花 0.4 秒；真歌 60 秒花 1.2 秒。
- `KeyExtractor(vec)`：合成檔 D major 0.90；真歌 D major 0.98。
- HPCP（frameSize 4096、hop 2048、blackmanharris62、SpectralPeaks 到 5 kHz、`HPCP(..., 'unitMax', 440, sr, 12, 'squaredCosine')`）→ `ChordsDetection(hpcps, 2048, sr, 2)`：合成檔 Bm→G→D→A 全對，邊界誤差 ≤ 50 ms；真歌出現 0.05–0.15 秒的碎片（Bb、Dm），需要平滑。
- `PitchYinFFT` 對 bass 幾乎抓不到（大多回 0）。自己的「諧波加總」法（FFT 8192 @ 22.05 kHz，30–250 Hz 候選 f，分數 = |X(f)| + 0.5|X(2f)| + 0.25|X(3f)| − 0.3|X(f/2)|）在合成檔每小節 35 / 31 / 38 / 33 全部命中。
- 真歌 BPM：essentia 給 95.8，自相關給 128，是 3:4 歧義。要給候選。
- essentia 的 wasm 以 base64 內嵌在 `essentia-wasm.es.js`（2.5 MB），Vite 不需要特別設定。

## Global Constraints

- 前兩個里程碑的約束仍適用。
- 音訊路徑一律先重採樣到 44 100 Hz 單聲道（essentia 預設），`decodeAudio` 用 `OfflineAudioContext` 做重採樣。
- essentia 只在「沒有 MIDI」或「MIDI 缺某個角色軌」時動態 `import()`；有完整 MIDI 的歌不載入它。
- 分析在 Worker 裡跑，主執行緒只拿進度與結果；進度回報至少五個階段：decode、spectrum、rhythm、drums、chords、bass。
- `TempoMap.offset`（秒，預設 0）：音檔第 `offset` 秒是第 1 小節第 1 拍。`secondsToTicks(map, t)` 用 `t − offset`，`ticksToSeconds` 加回 `offset`。既有測試（offset 未設）行為不變。
- BPM 候選：`[bpm, bpm×2, bpm÷2, bpm×4/3, bpm×3/4]`，四捨五入到 0.1，只留 60–200 之間，去重，預設選 essentia 的 bpm。
- 鼓件分類門檻（可調參數，先固定）：onset 時刻取 50 fps 頻譜那一幀與下一幀的最大值；`low = bandEnergy(30,150)`、`mid = bandEnergy(150,2500)`、`high = bandEnergy(5000,16000)`。kick：`low ≥ 0.55` 且 `low ≥ mid`；hat：`high ≥ 0.35` 且 `low < 0.4`；其餘 mid ≥ 0.3 → snare；都不符合就丟掉。同一類在 80 ms 內只留最強的一個。
- 和弦平滑：事件邊界吸附到最近的拍；短於半拍的事件併入前一個；名稱轉成我們的顯示法（`F#m` → `F♯m`，`Bb` → `B♭`），`notes` 由三和弦模板算出（大三 0/4/7、小三 0/3/7）。
- bass 分段：連續幀四捨五入到同一個半音、且低頻能量 ≥ 整首最大值的 5%、且峰值/平均 ≥ 6，才算一個音；短於 60 ms 的音丟掉；音內的微小偏移（< 0.5 半音）忽略，≥ 0.5 半音記成 bend。

## Review Focus

1. **前奏很長、靜音開頭的歌**：第一拍 offset 要從 essentia 的第一個 tick 推回（`offset = ticks[0] − k×beat`，k 使 offset 落在 `[0, beat)`），不能把靜音當第 1 小節。測試在 Task 2。
2. **3:4 與 2:1 的 BPM 歧義**：候選清單要含 ×4/3 與 ×3/4，使用者切換後拍格、鼓格、Bass 路徑立刻重算。測試在 Task 2（候選）與 Task 7（切換）。
3. **很短的音檔（< 5 秒）或全靜音**：各模組回空結果而不是丟錯；App 顯示「分析不到節拍」。測試在 Task 2、3、4、5。
4. **和弦碎片**：0.05 秒的 Bb 這種不得出現在 `chords` 裡。測試在 Task 4。
5. **MIDI 只有鼓軌的歌**：合併後鼓用 MIDI、和弦與 bass 用音訊，拍格用 MIDI 的 tempo map。測試在 Task 6。

---

## File Structure

```
src/analysis/
  types.ts                 TempoMap 加 offset?；Readings 加 source: { tempo:'midi'|'audio'; drums; chords; bass; key }；RhythmInfo
  tempo.ts                 offset 支援；tempoMapFromBpm(bpm, offset, ppq=480)
  audio/essentia.ts        getEssentia(): Promise<EssentiaInstance>（單例、動態 import）
  audio/decode.ts          重採樣到 44100
  audio/rhythm.ts          analyzeRhythm(pcm) → RhythmInfo { bpm, confidence, beats, candidates, offset }
  audio/drums.ts           detectDrums(pcm, spectrum) → DrumHit[]
  audio/chords.ts          detectChords(pcm, beats) → { chords: ChordEvent[]; key?: KeyInfo }
  audio/bass.ts            detectBass(pcm) → BassNote[]
  analyzeAudio.ts          analyzeAudio(pcm, sr, onProgress) → Readings
  merge.ts                 mergeReadings(midi?: Readings, audio?: Readings) → Readings
  worker.ts                Worker 入口：收 { pcm, sampleRate, midiBytes? } 回 progress / done
  client.ts                analyzeInWorker(input, onProgress) → Promise<Readings>
test/fixtures/audio.ts     synthBeat(opts) → Float32Array（把 samples/make-beat.mjs 的合成搬進來）
src/app/useProject.ts      沒有 .mid 也接受；走 worker；狀態 analyzing + progress
src/app/App.tsx            進度列、BPM 候選按鈕、第一拍微調（±10 ms、±1 拍）、調性顯示
```

---

### Task 1: essentia 單例、重採樣解碼、音訊 fixture

**Files:**
- Create: `src/analysis/audio/essentia.ts`, `test/fixtures/audio.ts`
- Modify: `src/analysis/audio/decode.ts`
- Test: `src/analysis/audio/essentia.test.ts`, `test/fixtures/audio.test.ts`

**Interfaces:**
```ts
// essentia.ts
export type EssentiaInstance = { version: string; arrayToVector(a: Float32Array): unknown; vectorToArray(v: unknown): Float32Array; [algo: string]: unknown };
export async function getEssentia(): Promise<EssentiaInstance>   // 第一次呼叫時 import('essentia.js')，之後回同一個
// fixtures/audio.ts
export interface SynthOptions { bpm?: number /*120*/; bars?: number /*8*/; sampleRate?: number /*44100*/; drums?: boolean; bass?: number[] /*每小節的 midi，預設 [35,31,38,33]*/; chords?: number[][] /*每小節三和弦 midi，預設 Bm G D A*/; leadIn?: number /*開頭靜音秒數，預設 0*/ }
export function synthBeat(opts?: SynthOptions): Float32Array
export function expectedHits(opts?: SynthOptions): DrumHit[]     // 跟 samples/make-beat.mjs 同樣的 pattern，含 leadIn 位移
// decode.ts
export async function decodeAudio(file: File): Promise<{ pcm: Float32Array; sampleRate: 44100 }>
```

- [ ] **Step 1: 寫失敗測試**：`getEssentia()` 兩次回同一個物件且 `version` 是字串；`synthBeat({ bars: 1 })` 長度 = 2 s × 44100 + 1 s 尾巴，`expectedHits({ bars: 1 })` 有 4 kick（含第 4 拍後半那顆只在奇數小節，所以 bars=1 是 2 kick）… 寫成：`expectedHits({ bars: 2 })` 的 kick 時間為 `[0, 1, 2, 3, 3.75]`，snare `[0.5, 1.5, 2.5, 3.5]`，hat 每 0.25 s 共 16 個。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**。`synthBeat` 把 `samples/make-beat.mjs` 的鼓、bass、pad 合成搬成純函式；`decodeAudio` 先用 `AudioContext.decodeAudioData`，再用 `new OfflineAudioContext(1, Math.ceil(duration*44100), 44100)` 播一遍 `startRendering()` 取得 44.1k 單聲道。
- [ ] **Step 4: 跑測試確認通過**（essentia 在 vitest 的 node 環境要能 import；不行就在 ledger 記下並改用 `vi.mock` 之外的路徑，例如 `createRequire`）。
- [ ] **Step 5: Commit** `feat(analysis): essentia singleton, resampling decode, audio fixture`

---

### Task 2: 節拍與 TempoMap offset

**Files:**
- Modify: `src/analysis/types.ts`, `src/analysis/tempo.ts`
- Create: `src/analysis/audio/rhythm.ts`
- Test: `src/analysis/tempo.test.ts`, `src/analysis/audio/rhythm.test.ts`

**Interfaces:**
```ts
// types.ts
export interface TempoMap { ppq; tempos; timeSignatures; offset?: number }
export interface RhythmInfo { bpm: number; confidence: number; beats: number[]; candidates: number[]; offset: number }
// tempo.ts
export function tempoMapFromBpm(bpm: number, offset = 0, ppq = 480): TempoMap
// rhythm.ts
export async function analyzeRhythm(pcm: Float32Array): Promise<RhythmInfo>   // 44.1k；pcm 短於 3 秒或 essentia 回 bpm 0 → { bpm: 0, confidence: 0, beats: [], candidates: [], offset: 0 }
export function bpmCandidates(bpm: number): number[]
export function firstBeatOffset(beats: number[], bpm: number): number       // Review Focus 1 的公式
```

- [ ] **Step 1: 寫失敗測試（tempo offset）**：`tempoMapFromBpm(120, 0.5)`：`positionAt(map, 0.5)` 是 bar 1 beat 1，`positionAt(map, 2.5)` 是 bar 2 beat 1，`timeOfBar(map, 2)` = 2.5；`secondsToTicks(map, 0.5)` = 0；既有測試不動。
- [ ] **Step 2: 寫失敗測試（rhythm）**：`analyzeRhythm(synthBeat({ bars: 8 }))` → `bpm` 在 119–121；`beats` 每個都離最近的 0.5 倍數 ≤ 0.06；`offset` ≤ 0.06；`candidates` 含接近 120、240、60、160、90 的值且全在 60–200（所以 240 與 60 不在）。`synthBeat({ bars: 8, leadIn: 1.3 })` → `offset` 在 1.3 ± 0.06 的「拍內餘數」（即 `(1.3 % 0.5)` ≈ 0.3，容許 ±0.06）。`analyzeRhythm(new Float32Array(44100))` → bpm 0、beats 空。`bpmCandidates(95.8)` 含 127.7。
- [ ] **Step 3: 跑測試確認失敗**。
- [ ] **Step 4: 實作**。`analyzeRhythm` 用 `RhythmExtractor2013(vec, 208, 'multifeature', 40)`，`beats = vectorToArray(ticks)`。
- [ ] **Step 5: 跑測試確認通過**。
- [ ] **Step 6: Commit** `feat(analysis): rhythm from audio, tempo map offset`

---

### Task 3: 鼓件偵測

**Files:**
- Create: `src/analysis/audio/drums.ts`
- Test: `src/analysis/audio/drums.test.ts`

**Interfaces:**
```ts
export async function detectDrums(pcm: Float32Array, spectrum: Spectrum): Promise<DrumHit[]>
// onset 用 essentia SuperFluxExtractor(vec, 3, 2048, 256, 16, 44100, 0.05) 的 onsets（秒）；分類照 Global Constraints；velocity = 該 onset 在其類別頻帶的能量 / 整首該頻帶最大值，夾到 0.3..1
```

- [ ] **Step 1: 寫失敗測試**：對 `synthBeat({ bars: 8 })` 與 `expectedHits` 比對：每類的 precision 與 recall（命中 = 同類且 |Δt| ≤ 40 ms）都 ≥ 0.85；全靜音 → `[]`；沒有 onset 的純正弦 → `[]`。
- [ ] **Step 2–5**：同流程。Commit `feat(analysis): drum hits from audio`

---

### Task 4: 和弦與調性

**Files:**
- Create: `src/analysis/audio/chords.ts`
- Test: `src/analysis/audio/chords.test.ts`

**Interfaces:**
```ts
export async function detectChords(pcm: Float32Array, beats: number[]): Promise<{ chords: ChordEvent[]; key?: KeyInfo }>
export function smoothChords(raw: { name: string; start: number; end: number }[], beats: number[]): ChordEvent[]   // 純函式，可單獨測
export function chordFromName(name: string): { root: number; notes: number[]; display: string } | null   // 'F#m' → root 6, [6,9,1], 'F♯m'；'N'（無和弦）→ null
```

- [ ] **Step 1: 寫失敗測試**：`chordFromName` 的三個例子；`smoothChords` 把 `[D 0–2.0, Bb 2.0–2.1, D 2.1–4]`（beats 每 0.5）壓成一個 D 0–4（Review Focus 4）；`detectChords(synthBeat({ bars: 8 }), beats)` → 名稱序列 `['Bm','G','D','A','Bm','G','D','A']`，邊界離 2 的倍數 ≤ 0.1；`key` 是 `D major`；全靜音 → `chords: []`、`key: undefined`。
- [ ] **Step 2–5**：同流程。Commit `feat(analysis): chords and key from audio`

---

### Task 5: Bass 音高

**Files:**
- Create: `src/analysis/audio/bass.ts`
- Test: `src/analysis/audio/bass.test.ts`

**Interfaces:**
```ts
export function detectBass(pcm: Float32Array, sampleRate: number): BassNote[]   // 純函式，不用 essentia；內部降採樣到 22 050、FFT 8192、hop 441
export function bassPitchFrames(pcm: Float32Array, sampleRate: number): { t: number; midi: number | null; conf: number; energy: number }[]
```

- [ ] **Step 1: 寫失敗測試**：`detectBass(synthBeat({ bars: 4 }))` → 每小節的音依序 35、31、38、33（允許多切成幾段，但每小節內出現的 midi 只能是該小節的那一個）；每個音的 `time` 離小節頭 ≤ 0.08；全靜音 → `[]`；`synthBeat({ drums: false, bass: [40, 40, 40, 40] })` → 全部 40。
- [ ] **Step 2–5**：同流程。Commit `feat(analysis): bass notes from audio`

---

### Task 6: analyzeAudio、merge、Worker

**Files:**
- Create: `src/analysis/analyzeAudio.ts`, `src/analysis/merge.ts`, `src/analysis/worker.ts`, `src/analysis/client.ts`
- Modify: `src/analysis/types.ts`（`Readings.source`）
- Test: `src/analysis/analyzeAudio.test.ts`, `src/analysis/merge.test.ts`

**Interfaces:**
```ts
export type Stage = 'decode' | 'spectrum' | 'rhythm' | 'drums' | 'chords' | 'bass';
export async function analyzeAudio(pcm: Float32Array, sampleRate: number, onProgress?: (stage: Stage, fraction: number) => void): Promise<Readings>
// Readings.source: { tempo: 'midi' | 'audio' | 'none'; drums: 'midi' | 'audio' | 'none'; chords: ...; bass: ...; key: ... }
export function mergeReadings(midi: Readings | undefined, audio: Readings | undefined): Readings
// 規則：tempo 有 MIDI 用 MIDI；drums/chords/bass/key 各自「MIDI 非空就用 MIDI，否則用音訊」；spectrum 永遠來自音訊；duration 取大
// client.ts
export function analyzeInWorker(input: { pcm: Float32Array; sampleRate: number; midiBytes?: ArrayBuffer; durationHint: number }, onProgress: (stage: Stage, fraction: number) => void): Promise<Readings>
```

- [ ] **Step 1: 寫失敗測試**：`analyzeAudio(synthBeat({ bars: 8 }), 44100)` 的 `tempo` bpm ≈ 120、`drums` 非空、`chords[0].name === 'Bm'`、`bass[0].midi === 35`、`spectrum.frameCount > 0`、`source` 全是 `'audio'`；進度回呼至少被叫 6 次且 stage 依序。`mergeReadings`（Review Focus 5）：MIDI 只有鼓 + 音訊全有 → drums 來自 MIDI、chords/bass/key 來自音訊、tempo 來自 MIDI，`source` 對應。
- [ ] **Step 2–5**：同流程。Worker 本身不在 Node 測；`client.ts` 用 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`，pcm 用 transferable。Commit `feat(analysis): analyzeAudio pipeline, merge, worker`

---

### Task 7: App：沒有 MIDI 也能用、進度、BPM 候選、第一拍微調

**Files:**
- Modify: `src/app/useProject.ts`, `src/app/App.tsx`
- Test: `src/app/useProject.test.ts`

**Interfaces:**
```ts
// useProject.ts
export type LoadResult = { ok: true; readings: Readings; rhythm?: RhythmInfo; audioUrl; name } | { ok: false; reason: 'need-audio' | 'parse-failed' | 'no-beat' }
// 'need-midi' 不再存在。deps 加 analyze?: (input) => Promise<Readings>（App 傳 analyzeInWorker）
export function applyTempo(readings: Readings, bpm: number, offset: number): Readings   // 換 tempo map，其他欄位不動
export type ProjectState = ... | { status: 'analyzing'; stage: Stage; fraction: number } | ...
```
- App：分析中顯示階段與進度；ready 後左欄顯示「BPM 候選」一排按鈕（來自 `rhythm.candidates`，MIDI 歌沒有）、「第一拍」±10 ms 與 ±1 拍四顆鈕、調性名稱；按了用 `applyTempo` 更新 readings，preview 立刻重畫。

- [ ] **Step 1: 寫失敗測試**：只有 mp3 → `ok: true`（注入 `analyze`）；`applyTempo` 後 `positionAt(readings.tempo, offset)` 是 bar 1 beat 1 且 `drums` 參考不變；analyze 回 bpm 0 → `reason: 'no-beat'`。
- [ ] **Step 2–5**：同流程。Commit `feat(app): audio-only songs, progress, bpm candidates, first-beat nudge`

---

### Task 8: 瀏覽器驗收（KILL LOVE 不帶 .mid）

- [ ] **Step 1**：只丟 `kill-love-small.mp3`。記錄分析總時間（目標 < 20 秒）與進度顯示是否順。
- [ ] **Step 2**：六個 look 各截一張；試 BPM 候選 96 vs 128 哪個讓鼓格對齊；第一拍微調是否即時。
- [ ] **Step 3**：筆記 `docs/superpowers/notes/2026-11-12-milestone-3-check.md`：鼓準不準（抽 8 小節人工聽對照）、和弦合不合理、bass 抓到多少。Commit `docs: milestone 3 check`。

---

## 自我檢查紀錄

- 規格覆蓋：第 9 節「純音訊分析升級為正式路徑」、Q13、Q14（手動偏移）、Q19（BPM 與第一拍可手動修；調性手動修留到之後）。
- 型別一致：`RhythmInfo`、`Stage`、`Readings.source`、`TempoMap.offset` 在 Task 1–2、6–7 名稱相同；`DrumHit`、`ChordEvent`、`BassNote`、`KeyInfo` 沿用里程碑 2。
- Review Focus 五條：1 → Task 2；2 → Task 2、7；3 → Task 2、3、4、5；4 → Task 4；5 → Task 6。
