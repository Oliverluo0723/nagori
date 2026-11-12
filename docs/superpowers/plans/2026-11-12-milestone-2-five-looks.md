# 里程碑 2：頻譜與和弦分析 + 其餘五個 look 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上規格 4.3 其餘五個 look（和弦輪、鼓格、Bass 路徑、頻譜柱、和弦發光體），以及它們需要的分析（離線頻譜、MIDI 和弦、MIDI bass、調性），App 可以切換 look。

**Architecture:** 延續里程碑 1 的四層。`analysis` 新增 `audio/`（解碼 + 離線 FFT → 每幀的對數頻譜）與 `midi/chords.ts`、`midi/bass.ts`、`midi/key.ts`；`Readings` 多四個可選欄位。look 仍是純函式，但 `Painter` 多三個基本形（扇形、折線、橢圓）。頻譜柱的 peak hold 不用內部狀態，改成「查過去 N 幀的最大值」，維持決定性。

**Tech Stack:** 同里程碑 1，加 `tonal`（和弦命名、音名）。FFT 自己寫（radix-2，約 40 行），不加依賴。

**Spec:** `docs/superpowers/specs/2026-11-12-oto-reels-tool-design.md`（含第 8、9 節）

## Global Constraints

- 里程碑 1 的全部約束仍適用（決定性、只用主題語意色、尺寸以 `h` 比例、GM 鼓音高、軌名規則、主題色值）。
- 頻譜：對數頻率 30 Hz 到 16 kHz，64 個 bin，每秒 50 幀，FFT 2048、Hann 窗、單聲道 44.1 k 或檔案原取樣率。值為 dB 正規化到 0..1：`clamp((dB + 90) / 90, 0, 1)`（原本 /70，真歌驗收時低頻整排頂到天花板，改成 0 dBFS = 1），dB = `20·log10(mag/N + 1e-9)`。
- 和弦：每拍一個事件。取「拍開始時正在響」的和弦軌音符的 pitch class 集合，`Chord.detect` 第一個結果當名稱；偵測不到就用最低音的音名。相同名稱的連續拍合併成一個事件。
- 調性：MIDI 有 keySignature 事件就用它；沒有就以和弦根音出現次數最多的 pitch class 當主音，模式看該根音的和弦大三和弦多還是小三和弦多。
- 五度圈順序（扇形從 12 點順時針）：C、G、D、A、E、B、F♯、C♯、G♯、D♯、A♯、F。
- 沒有對應資料時 look 不得當掉：沒有 `spectrum` 畫空軸；沒有 `chords` 畫調性輪但不亮扇形；沒有 `bass` 只畫網格。
- 不改里程碑 1 已有的介面簽名；只增加。

## Review Focus

1. **只有估計的 .mid（沒有和弦軌、沒有 bass 軌）**：和弦輪、Bass 路徑、和弦發光體要畫出「空」狀態而不是錯誤；App 不應顯示解析失敗。測試在 Task 3、6、7、8。
2. **音檔很長（5 分鐘以上）**：頻譜分析要在數秒內完成，記憶體在數十 MB 內。測試在 Task 2（用合成 60 秒音訊量時間，上限 2 秒）。
3. **t 在最後一幀之後**：頻譜柱與發光體讀 `spectrum` 時 index 要 clamp，不得讀到 undefined。測試在 Task 2 的 `frameAt`。
4. **16 分格量化：hit 落在兩格正中間**：鼓格要穩定落到同一格（四捨五入規則固定），不能一幀一格、下一幀另一格。測試在 Task 5。
5. **和弦軌是分解和弦（arpeggio）**：拍開始只有一個音在響時，`Chord.detect` 沒結果，名稱退回單音，但不能把前一拍的和弦事件切斷成每拍一個新事件。本計畫先接受「每拍重新判斷」的結果，在 Task 3 加一個測試把這個行為釘住，之後再改成「看整拍內出現過的音」。

---

## File Structure

```
src/
  analysis/
    types.ts                   新增 Spectrum、ChordEvent、BassNote、KeyInfo，Readings 加可選欄位
    audio/fft.ts               fft(re, im) in-place radix-2
    audio/spectrum.ts          analyzeSpectrum(pcm, sampleRate, opts) → Spectrum；frameAt、bandEnergy
    audio/decode.ts            decodeAudio(file) → { pcm: Float32Array; sampleRate }（瀏覽器用，不測）
    midi/chords.ts             extractChords(tracks, tempo) → ChordEvent[]
    midi/bass.ts               extractBass(track) → BassNote[]
    midi/key.ts                detectKey(header, chords) → KeyInfo
    analyze.ts                 analyzeMidi 加 chords/bass/key；新增 analyzeTrack({ midi, audio })
  looks/
    painter/painter.ts         加 wedge、polyline、ellipse
    painter/recording.ts       同步
    painter/p5.ts              同步
    grid.ts                    鼓格
    spectrum.ts                頻譜柱
    wheel.ts                   和弦輪
    glide.ts                   Bass 路徑
    bodies.ts                  和弦發光體
    registry.ts                六個 look
    music.ts                   pitch class 工具：pcName、fifthsIndex、noteColor
  app/
    useProject.ts              載入時解碼音檔並跑頻譜
    App.tsx                    look 選單
```

---

### Task 1: Painter 加三個基本形

**Files:**
- Modify: `src/looks/painter/painter.ts`, `src/looks/painter/recording.ts`, `src/looks/painter/p5.ts`
- Test: `src/looks/painter/recording.test.ts`

**Interfaces:**
- Produces（加進 `Painter`）：
  ```ts
  wedge(cx: number, cy: number, rInner: number, rOuter: number, startRad: number, endRad: number): void  // 環形扇面，用目前的 fill/stroke
  polyline(points: { x: number; y: number }[]): void   // 只 stroke
  ellipse(cx: number, cy: number, w: number, h: number): void
  ```

- [ ] **Step 1: 寫失敗測試**：`RecordingPainter` 記錄 `wedge`、`polyline`、`ellipse` 三種呼叫，args 原樣。
- [ ] **Step 2: 跑測試確認失敗**（方法不存在）。
- [ ] **Step 3: 實作**。`P5Painter.wedge` 用 `g.beginShape()` + 外弧 `vertex` 24 段 + 內弧反向 + `endShape(CLOSE)`；`polyline` 用 `beginShape/vertex/endShape` 加 `noFill` 暫時關掉 fill 再還原；`ellipse` 直接 `g.ellipse`。
- [ ] **Step 4: 跑測試確認通過**，`pnpm typecheck`、`pnpm lint`。
- [ ] **Step 5: Commit** `feat(looks): wedge, polyline, ellipse painter primitives`

---

### Task 2: 離線頻譜分析

**Files:**
- Create: `src/analysis/audio/fft.ts`, `src/analysis/audio/spectrum.ts`, `src/analysis/audio/decode.ts`
- Modify: `src/analysis/types.ts`
- Test: `src/analysis/audio/fft.test.ts`, `src/analysis/audio/spectrum.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface Spectrum { fps: number; bins: number; minHz: number; maxHz: number; frames: Float32Array /* frameCount × bins, row-major */; frameCount: number }
  // Readings 加：spectrum?: Spectrum; chords?: ChordEvent[]; bass?: BassNote[]; key?: KeyInfo
  // fft.ts
  export function fft(re: Float64Array, im: Float64Array): void   // in-place，長度為 2 的冪
  // spectrum.ts
  export interface SpectrumOptions { fps?: number /*50*/; bins?: number /*64*/; fftSize?: number /*2048*/; minHz?: number /*30*/; maxHz?: number /*16000*/ }
  export function analyzeSpectrum(pcm: Float32Array, sampleRate: number, opts?: SpectrumOptions): Spectrum
  export function frameAt(s: Spectrum, t: number): number            // clamp 到 [0, frameCount-1]
  export function binValue(s: Spectrum, frame: number, bin: number): number
  export function bandEnergy(s: Spectrum, frame: number, loHz: number, hiHz: number): number  // 該範圍 bin 的平均，0..1
  export function binHz(s: Spectrum, bin: number): number            // 對數刻度：minHz·(maxHz/minHz)^((bin+0.5)/bins)
  export function peakHold(s: Spectrum, frame: number, bin: number, holdFrames: number): number // max over [frame-holdFrames, frame]
  // decode.ts
  export async function decodeAudio(file: File): Promise<{ pcm: Float32Array; sampleRate: number }>  // AudioContext.decodeAudioData，混成單聲道
  ```

- [ ] **Step 1: 寫失敗測試（fft）**：長度 8 的脈衝輸入 → 所有 bin 幅度為 1；長度 64 的 `cos(2π·4·n/64)` → bin 4 幅度 ≈ 32，其他 < 1e-9。
- [ ] **Step 2: 寫失敗測試（spectrum）**：
  ```ts
  test('a 440 Hz sine lands in the bin that contains 440 Hz', () => {
    const sr = 44100; const pcm = new Float32Array(sr * 2); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5;
    const s = analyzeSpectrum(pcm, sr);
    expect(s.fps).toBe(50); expect(s.bins).toBe(64); expect(s.frameCount).toBe(100);
    const f = frameAt(s, 1);
    let best = 0; for (let b = 0; b < 64; b++) if (binValue(s, f, b) > binValue(s, f, best)) best = b;
    expect(binHz(s, best)).toBeGreaterThan(380); expect(binHz(s, best)).toBeLessThan(510);
    expect(bandEnergy(s, f, 5000, 16000)).toBeLessThan(0.15);
  });
  test('frameAt clamps past the end and before 0', () => { /* t=-1 → 0；t=999 → frameCount-1 */ });
  test('peakHold is the max over the hold window', () => { /* 合成：前 1 秒靜音、後 1 秒 440 Hz；在 1.5 s 用 holdFrames=50 查 → 等於該 bin 在 1.0–1.5 s 的最大值 */ });
  test('60 s of audio analyses in under 2 s', () => { /* performance.now 量 analyzeSpectrum */ });
  ```
- [ ] **Step 3: 跑測試確認失敗**。
- [ ] **Step 4: 實作**。`analyzeSpectrum`：hop = `sampleRate / fps`；每幀取 `fftSize` 樣本乘 Hann，FFT，取幅度；每個對數 bin 取其 Hz 範圍內 FFT bin 的最大幅度；套 Global Constraints 的 dB 正規化。`decode.ts` 用 `new AudioContext()` 解碼後 `getChannelData` 平均成單聲道，然後 `close()`。
- [ ] **Step 5: 跑測試確認通過**。
- [ ] **Step 6: Commit** `feat(analysis): offline log spectrum`

---

### Task 3: MIDI 和弦、bass、調性

**Files:**
- Create: `src/analysis/midi/chords.ts`, `src/analysis/midi/bass.ts`, `src/analysis/midi/key.ts`, `src/looks/music.ts`
- Modify: `src/analysis/types.ts`, `src/analysis/analyze.ts`
- Test: `src/analysis/midi/chords.test.ts`, `src/analysis/midi/bass.test.ts`, `src/analysis/midi/key.test.ts`, `src/analysis/analyze.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface ChordEvent { time: number; duration: number; root: number /* pc 0-11 */; name: string; notes: number[] /* pcs, 升序 */ }
  export interface BassNote { time: number; duration: number; midi: number; bends: { time: number; semitones: number }[] }
  export interface KeyInfo { tonic: number /* pc */; mode: 'major' | 'minor'; name: string /* 'D major' */ }
  // chords.ts
  export function extractChords(tracks: Track[], tempo: TempoMap, duration: number): ChordEvent[]
  // bass.ts
  export function extractBass(track: Track): BassNote[]   // pitch bend 值 -1..1 × 2 半音（GM 預設 bend range ±2）
  // key.ts
  export function detectKey(header: Header, chords: ChordEvent[]): KeyInfo | undefined
  // analyze.ts
  export function analyzeMidi(bytes, durationHint?): Readings   // 現在也填 chords、bass、key（角色軌存在時）
  export function withSpectrum(r: Readings, spectrum: Spectrum): Readings
  // looks/music.ts
  export const PC_NAMES: string[]            // ['C','C♯','D',...]
  export const FIFTHS: number[]              // [0,7,2,9,4,11,6,1,8,3,10,5]
  export function fifthsIndex(pc: number): number
  export function noteColor(theme: Theme, pc: number): string
  ```

- [ ] **Step 1: 寫失敗測試（chords）**：120 bpm，chords 軌在 beat 0–3 放 B、D、F♯（長 4 拍），beat 4–7 放 G、B、D → 兩個事件：`{time 0, duration 2, root 11, name 'Bm', notes [2,6,11]}`、`{time 2, duration 2, root 7, name 'GM' 或 'G', notes [2,7,11]}`。加一筆 Review Focus 5：beat 0 只有 D、beat 1 只有 F♯、beat 2 只有 A → 三個單音事件，名稱 'D'、'F♯'、'A'。加一筆：沒有 chords 軌 → `[]`。
- [ ] **Step 2: 寫失敗測試（bass）**：bass 軌兩個音（D1=26、F♯1=30），第二個音帶 pitch bend 事件 → `bends` 有一筆 `semitones ≈ 2 × value`。
- [ ] **Step 3: 寫失敗測試（key）**：header 有 keySignature `D` major → `{tonic 2, mode 'major', name 'D major'}`；沒有 keySignature 但 chords 根音 D 出現 3 次（都大三和弦）→ 同上；都沒有 → `undefined`。
- [ ] **Step 4: 寫失敗測試（analyze）**：`analyzeMidi` 對有 Drums、Bass、Pad 三軌的 fixture 填滿四個欄位；對只有 Drums 的 fixture，`chords` 為 `[]`、`bass` 為 `[]`、`key` 為 `undefined`，不丟錯。
- [ ] **Step 5: 跑測試確認失敗**。
- [ ] **Step 6: 實作**。`extractChords`：用 `positionAt`/`timeOfBar` 不方便逐拍，改為：拍的時間序列由 `tempo` 算（從 0 開始每拍一個時間點，直到 `duration`）；每拍收集 `note.time ≤ beatT < note.time + note.duration` 的音；`Chord.detect(names)` 取第一個，去掉斜線後綴；根音用 `Chord.get(name).tonic` 轉 pc。`makeMidi` fixture 需要加 `bends?: { beat: number; value: number }[]` 到 note 選項（在 `test/fixtures/midi.ts` 補），用 `track.addPitchBend({ ticks, value })`。
- [ ] **Step 7: 跑測試確認通過**。
- [ ] **Step 8: Commit** `feat(analysis): chords, bass, key from MIDI`

---

### Task 4: App 載入時跑頻譜 + look 選單

**Files:**
- Modify: `src/app/useProject.ts`, `src/app/App.tsx`
- Test: `src/app/useProject.test.ts`

**Interfaces:**
- `loadDroppedFiles(files, deps)` 的 `deps` 加可選 `decode?: (audio: File) => Promise<{ pcm: Float32Array; sampleRate: number }>`；有給就在 `analyzeMidi` 之後 `withSpectrum`。App 傳 `decodeAudio`。
- App：左欄多一排 look 按鈕（從 `looks` registry 列出，顯示 `number name`），點了改 `composition.root.lookId`。

- [ ] **Step 1: 寫失敗測試**：`deps.decode` 回傳 1 秒 440 Hz → `r.readings.spectrum?.frameCount === 50`；不給 `decode` → `spectrum` 為 `undefined`。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**。
- [ ] **Step 4: 跑測試確認通過**，`pnpm typecheck`、`pnpm lint`。
- [ ] **Step 5: Commit** `feat(app): spectrum on load, look picker`

---

### Task 5: 鼓格 look

**Files:**
- Create: `src/looks/grid.ts`；Modify: `src/looks/registry.ts`
- Test: `src/looks/grid.test.ts`

**規格（id `grid`，number 2，name `鼓格`，listens drums + tempo）：**
- 參數：`rows`（一頁幾小節，1..8，default 4）。
- 版面：左邊界 `w*0.08`，右邊界 `w*0.92`；上 `h*0.14`，下 `h*0.86`。16 欄，欄寬 `cw = w*0.84/16`，欄中心 `x = w*0.08 + (s+0.5)*cw`。列高 `rh = h*0.72/rows`，列中心 `y = h*0.14 + (r+0.5)*rh`。
- 頁：`bar = positionAt(t).bar`，`page = floor((bar-1)/rows)`，列 r 顯示 bar `page*rows + r + 1`。
- 每列先畫一條 `theme.line` 細線（`h*0.001`）在列中心，再在每個 16 分格畫一個 `theme.line` 小點（圓 d `h*0.004`）當格線。
- hit 量化：`step = round(((hit.time − timeOfBar(b)) / barSec) * 16)`，`step === 16` 歸到下一小節 step 0；超出 0..15 不畫。
- kick：實心圓 `theme.accent`，d = `h*0.016*(0.6+0.4*vel)`；snare：兩條線成 X，半徑 `h*0.008`，stroke `theme.ink` 粗 `h*0.0015`；hat：垂直短線長 `h*0.012`，stroke `theme.mute` 粗 `h*0.001`，在格中心偏上 `h*0.012`。
- 現在這一拍附近（`age = t − hit.time`，`0 ≤ age < 0.15`）的 hit 放大 ×1.6，且 kick 有 glow 時 `glow(theme.accent, h*0.015)`。
- 播放線：在目前的列，x = `w*0.08 + barPhase*w*0.84`，從列頂到列底，stroke `theme.accent` 粗 `h*0.0015`。
- 小標 `02 GRID`；右上角 mono 小字 `bars {first}–{last}`（`theme.mute`，size `h*0.012`，右對齊 `w*0.97`）。

- [ ] **Step 1: 寫失敗測試**：(a) 決定性；(b) 120 bpm，kick 在 1.0 s（bar 1 step 8）、t=1.0 → 有一個 circle 在 `x = 1080*0.08 + 8.5*(1080*0.84/16)`，列 0；(c) Review Focus 4：hit 在 0.0625 s（兩個 16 分格正中間 1/32）在 t=0.1 與 t=0.11 都落在同一個 step；(d) rows=4、t 在 bar 6（`timeOfBar(6)+0.1`）→ 文字含 `bars 5–8`；(e) 沒有 drums 只有格線與播放線。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**，註冊到 registry。
- [ ] **Step 4: 跑測試確認通過**。
- [ ] **Step 5: Commit** `feat(looks): grid look`

---

### Task 6: 頻譜柱 look

**Files:**
- Create: `src/looks/spectrum.ts`；Modify: `src/looks/registry.ts`
- Test: `src/looks/spectrum.test.ts`

**規格（id `spectrum`，number 4，name `頻譜柱`，listens spectrum）：**
- 參數：`holdSeconds`（0.2..3，default 1）、`barsShown`（16..64，default 64，取 spectrum 的前 N 個 bin 等距抽樣）。
- 基線 `y0 = h*0.72`，最高到 `h*0.28`（高度 `h*0.44`）。左右邊界 `w*0.06`..`w*0.94`。柱寬 `bw = (w*0.88)/N`，柱體寬 `bw*0.6` 置中。
- 柱：`rect`，fill `theme.ink`，高 `v*h*0.44`，`v = binValue(frame)`。
- peak：`rect` 高 `h*0.003`，fill `theme.accent`，在 `peakHold(frame, bin, holdSeconds*fps)` 的高度。
- 刻度：在 50、100、500、1k、5k、10k Hz 的 x 位置畫 mono 文字（`theme.mute`，size `h*0.011`，center）於 `y0 + h*0.03`；x 由 `log(hz/minHz)/log(maxHz/minHz)` 映射到 `[w*0.06, w*0.94]`。
- 沒有 `spectrum`：畫基線與刻度即可。
- 小標 `04 SPECTRUM`。

- [ ] **Step 1: 寫失敗測試**：(a) 決定性；(b) 合成 spectrum（1 幀，bin 10 = 1，其餘 0）→ 有一個 rect 高 ≈ `1920*0.44`，位於 bin 10 的 x；(c) `peakHold` 效果：兩幀 spectrum，第一幀 bin 3 = 0.8、第二幀 0.2，t 在第二幀，holdSeconds 足夠 → accent rect 的 y 對應 0.8；(d) 沒有 spectrum → 有基線 line、有 'Hz' 刻度文字、沒有 rect；(e) t 超過最後一幀仍可畫（Review Focus 3）。
- [ ] **Step 2–5**：同上流程，Commit `feat(looks): spectrum look`。

---

### Task 7: 和弦輪 look

**Files:**
- Create: `src/looks/wheel.ts`；Modify: `src/looks/registry.ts`
- Test: `src/looks/wheel.test.ts`

**規格（id `wheel`，number 1，name `和弦輪`，listens chords + key）：**
- 圓心 `(w/2, h*0.45)`，外半徑 `R = h*0.17`，內半徑 `R*0.62`，12 個扇面各 30°，從 12 點順時針依 FIFTHS 排。
- 底：每個扇面 `wedge` stroke `theme.line` 粗 `h*0.001`，noFill。
- 目前和弦（`chords` 中 `time ≤ t < time+duration` 的那個）：根音扇面 fill `theme.accent`；其他和弦音扇面 fill `theme.ink` alpha 0.35。進入後 0.25 秒內 alpha 從 0 漸到目標（`age/0.25`）。
- 下一個和弦（時間上緊接的下一個事件）根音扇面：stroke `theme.accent` 粗 `h*0.002` alpha 0.6，noFill。
- 中心：調性主音名（`key.name` 的主音，如 `D`）sans 700 size `h*0.05` center，顏色 `theme.ink`；下方 size `h*0.014` mono 寫 `major`/`minor`。沒有 key 就寫 `–`。
- 扇面外側每個音名 mono size `h*0.012` `theme.mute`，半徑 `R*1.14`。
- 底部讀數列（`y = h*0.86`，mono size `h*0.012`）：`CHORD {name}   NEXT {name}`。沒有 chords 時寫 `CHORD –`。
- 小標 `01 WHEEL`。

- [ ] **Step 1: 寫失敗測試**：(a) 決定性；(b) chords=[Bm 0–2 s, G 2–4 s]，t=1 → 有 `wedge` 在 accent fill 之後、其起始角對應 B 在 FIFTHS 的 index 5（`start = -π/2 + 5·π/6`）；(c) 文字含 `CHORD Bm` 與 `NEXT G`；(d) 沒有 chords、沒有 key → 12 個 wedge、中心文字 `–`、沒有 accent fill（Review Focus 1）。
- [ ] **Step 2–5**：同上流程，Commit `feat(looks): chord wheel look`。

---

### Task 8: Bass 路徑 look

**Files:**
- Create: `src/looks/glide.ts`；Modify: `src/looks/registry.ts`
- Test: `src/looks/glide.test.ts`

**規格（id `glide`，number 3，name `Bass 路徑`，listens bass + tempo）：**
- 參數：`windowBars`（1..8，default 2）。now 線 `x = w*0.62`，時間 → x 與 Rings 相同（過去在左）。但也畫未來：`x` 可以大於 nowX，畫到 `w`。
- 音高 → y：音域取整首 `bass` 的 min/max midi 再各擴 2 半音；`y = h*0.78 − (midi − lo)/(hi − lo) × h*0.56`。沒有 bass 時音域 24..48。
- 背景網格：每個整數半音畫一條 `theme.line` 線（粗 `h*0.0008`），每 12 個半音（C）線粗 `h*0.0015`。左側每個 C 標音名（mono，size `h*0.011`，`theme.mute`）。
- 每個音：水平線段從 `x(time)` 到 `x(time+duration)`，stroke `noteColor(theme, midi%12)` 粗 `h*0.004`；有 bends 時改成 polyline，點為 `(x(bendTime), y(midi + semitones))`，加上起點與終點。
- 相鄰兩音之間畫一條細的垂直跳線 `theme.mute` 粗 `h*0.001`（從前一音尾到後一音頭）。
- 正在響的音：在其線段上的 now 線交點畫一個圓 d `h*0.02` fill `theme.accent`（有 glow 時 glow `h*0.015`），右側寫音名（`Note.fromMidi`）mono size `h*0.016` `theme.ink`。
- 小標 `03 GLIDE`。

- [ ] **Step 1: 寫失敗測試**：(a) 決定性；(b) bass=[{time 0, duration 1, midi 26}]，t=0.5 → 有一條 line 的 y 等於 midi 26 的 y；有一個 circle 在 `x = 1080*0.62`；文字含 `D1`；(c) 有 bends 的音畫成 polyline，點數 = bends 數 + 2；(d) 沒有 bass → 只有網格線與文字，沒有 circle（Review Focus 1）。
- [ ] **Step 2–5**：同上流程，Commit `feat(looks): bass glide look`。

---

### Task 9: 和弦發光體 look

**Files:**
- Create: `src/looks/bodies.ts`；Modify: `src/looks/registry.ts`
- Test: `src/looks/bodies.test.ts`

**規格（id `bodies`，number 5，name `和弦發光體`，listens chords + spectrum）：**
- 目前和弦的每個組成音一團：位置用 `mulberry32(seed + chordIndex*7919)` 取，`x ∈ [w*0.25, w*0.75]`，`y ∈ [h*0.30, h*0.62]`；同一和弦內的團固定（同一個 prng 序列）。
- 大小：基準 `h*0.11`；乘上 `0.85 + 0.3 × bandEnergy(150, 2500)`（沒有 spectrum 時 1）；根音那團 ×1.25。
- 畫法：三層 `ellipse` 同心，fill `noteColor(theme, pc)`，alpha 分別 0.12、0.25、0.6，直徑分別 ×1.8、×1.3、×1.0；有 glow 時先 `glow(color, h*0.05)`。
- 進入：和弦開始後 0.3 秒內整體 alpha 乘 `age/0.3`。
- 和弦名稱：在 `(w/2, h*0.76)` sans 700 size `h*0.04` center `theme.ink`。
- 沒有 chords：只畫名稱 `–` 與小標。
- 小標 `05 BODIES`。

- [ ] **Step 1: 寫失敗測試**：(a) 決定性；(b) chords=[Bm 0–2 s]，t=1 → ellipse 數 = 3 音 × 3 層 = 9；(c) 同一和弦 t=1 與 t=1.5 的 ellipse 中心相同；(d) 紙感主題沒有 glow 呼叫；(e) 沒有 chords → 沒有 ellipse（Review Focus 1）。
- [ ] **Step 2–5**：同上流程，Commit `feat(looks): chord bodies look`。

---

### Task 10: 瀏覽器驗收

- [ ] **Step 1**：`pnpm dev`，用 `samples/beat.wav + beat.mid`（有 Drums、Bass 軌）看六個 look 各一張截圖，兩種主題；用 `samples/kill-love-small.mp3 + kill-love.mid`（估計的鼓、沒有和弦）確認和弦輪、Bass 路徑、發光體顯示空狀態、頻譜柱與鼓格正常。
- [ ] **Step 2**：`samples/make-beat.mjs` 加一個 `Pad` 軌（Bm、G、D、A 各一小節輪替，三個音長一小節），重新產生，讓和弦類 look 有資料可看。
- [ ] **Step 3**：筆記寫到 `docs/superpowers/notes/2026-11-12-milestone-2-check.md`，每個 look 一行「對不對、味道、下輪參數」。Commit `docs: milestone 2 visual check`。

---

## 自我檢查紀錄

- 規格覆蓋：4.3 六個 look 全部到位；4.1 的和弦、bass、頻帶、調性四種讀數到位；LUFS 與文字格留到輸出/文字格計畫；4.4 拼版編輯器與 mp4 另開計畫。
- 型別一致：`Spectrum`、`ChordEvent`、`BassNote`、`KeyInfo` 在 Task 2、3 定義，Task 6–9 使用相同名稱；`frameAt`/`binValue`/`bandEnergy`/`peakHold` 簽名一致。
- Review Focus 五條各有對應測試：1 → Task 3、7、8、9；2、3 → Task 2；4 → Task 5；5 → Task 3。
