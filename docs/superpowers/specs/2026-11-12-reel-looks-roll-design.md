# 里程碑 6：音符讀數（Basic Pitch）＋ Reel 五個 look 設計

日期：2026-11-12
參考 Reel：https://www.instagram.com/reels/DfF16wtNm18/ （marmarsounds × oto.instrument，8 秒，六格拼貼，170 BPM）
前一份設計：`2026-11-12-oto-reels-tool-design.md`（§4.1 分析、§4.2 分工原則、§10 分軌）

## 1. 這是什麼、為什麼做

使用者最想要的是 Reel 左上那格**鋼琴捲**（Oto 的 Roll）。Oto 的 Roll 只吃 MIDI；我們手上的歌只有 mp3（`samples/kill-love-small.mp3`、`samples/hotel-room.mp3`），電腦上沒有任何真的 .mid（僅有的兩個是腳本估出來的鼓點與測試假檔）。所以這個里程碑的核心是**從音檔長出一顆一顆的音符**，再用這些音符畫鋼琴捲。Reel 裡另外四個 look 一起列進來，排在鋼琴捲後面。

Reel 六格對應的 Oto 正式名稱（官網 HTML `data-name` / `data-sub`）：

| Reel 格 | Oto 名稱 | 官網一句說明 | 本里程碑 |
|---|---|---|---|
| 01 鋼琴捲 | Roll（官網無圖，僅註明需 MIDI） | — | **做，第一順位** |
| 02 點陣 | 22 Pegboard | Eighteen bands as columns of pegs, one row per eighth note | 做 |
| 03 | 42 Trajectory | The path of the track through time, pitch and brightness | 做 |
| 04 流場畫筆 | 01 Sheet · Paint | The track paints a canvas, stroke by stroke | 做 |
| 05 Arcade | 官網 60 個名單裡沒有，未公開 | — | 做，排在 Roll 之後（同樣吃音符） |
| 06 Stars | 37 Stars | Every hit is a star; the line reads the sky | 已有（`stars.ts`），跳過 |

## 2. 目標、非目標、反目標

### 目標

- 新增一種讀數 **`notes`**：每顆音的起點、長度、MIDI 音高、力度。來源依既有規則 MIDI 優先，沒有 MIDI 就用 Basic Pitch 從音檔轉譜。
- **Roll**：丟一首 mp3 進去，鋼琴捲跟著音樂捲動，看起來「大致對、跟著動」。這是驗收標準，不要求轉譜精確。
- Arcade、Pegboard、Trajectory、Paint 四個 look，各自只聽一到三種讀數，照 §4.2 的分工原則。
- 兩首範例歌（KILL LOVE、hotel-room）都要能跑完整首，並留一張 milestone check 截圖。

### 非目標（這個里程碑不做）

- 不改 Worker 與分軌的架構（`milestone-5-stems` 已於 2026-11-12 合併進 `main`，cc948f6）；轉譜只是 `runAnalysis` 裡多一個階段。
- 不轉譜鼓（鼓點已有 `drums` 讀數）。
- 不做 MIDI 檔的 UI 改動；只是把 MIDI 的原始音符保留下來。
- 不做 Oto 的 Orbit、Crowd、Score、Tracker 等其他 look。
- 不調 Basic Pitch 的模型，只調後處理門檻。

### 反目標（做出來就算失敗）

- 鋼琴捲靜止不動、或跟節拍對不上（音符位置明顯早於或晚於聽到的聲音超過一個 16 分音符）。
- 分析時讓使用者覺得當機：轉譜跑在既有的分析 Worker 裡，主執行緒不凍結，期間有進度條。目標是整首 4 分 40 秒的 KILL LOVE 在 M 系列 Mac 的 Chrome 上 60 秒內轉完；實測超過 60 秒不算失敗，但超過 3 分鐘就要回頭調（見 §4.3 的時間試驗）。同一首歌第二次載入不得重跑（快取）。
- 同一首歌兩次分析結果不同（違反「同輸入同輸出」）。
- Node 測試載入 TensorFlow.js 或模型檔。

## 3. 限制

- 既有限制全部沿用：不讀 `Date`、不用 `Math.random`；look 只透過 `Painter` 畫圖、只讀 `LookContext`；顏色只用 `Theme` 的語意色；每個 task 結束 `pnpm test`、`pnpm typecheck`、`pnpm lint` 全綠。
- 依賴：`@spotify/basic-pitch@^1.0.1` 與 `@tensorflow/tfjs@^4`。兩者只在瀏覽器／Worker code path 以動態 `import()` 載入，和 `separate.ts` 對 `onnxruntime-web` 的做法一致。Node 測試注入假的轉譜器。
- 模型檔（`model.json` 0.17 MB + `group1-shard1of1.bin` 0.74 MB）從 `node_modules/@spotify/basic-pitch/model/` 複製到 `public/models/basic-pitch/`，加進既有的 `scripts/setup-models.mjs`（`pnpm setup:models`，`public/models/` 已 git-ignore）。找不到模型就跳過轉譜、`source.notes = 'none'`，並沿用分軌缺模型時的提示方式。
- Basic Pitch 要 22 050 Hz 單聲道；既有分析是 44 100 Hz。轉譜器自己重採樣（2:1 取平均即可，不用高品質濾波），不改 `decodeAudio`。
- 分支：`main` 現在是乾淨的（cc948f6，含 Worker、分軌、`score/`），從這裡開 `milestone-6-notes`，用 git worktree 或直接在工作樹上皆可。

## 4. 已決定的事

### 4.1 新讀數 `notes`

```ts
export interface NoteEvent {
  time: number;      // 秒
  duration: number;  // 秒
  midi: number;      // 整數 0–127
  velocity: number;  // 0..1
}
// Readings 加 notes?: NoteEvent[]
// ReadingsSource 加 notes: SourceKind
// looks/types.ts 的 ReadingKind 加 'notes'
```

- 以 `time` 排序；同一 `midi` 的音符不重疊（後一顆開始前一顆就結束）。
- `mergeReadings` 規則不變：MIDI 有就用 MIDI 的。

### 4.2 MIDI 來源

`analyzeMidi` 把**非鼓軌**（`roles` 不是 `drums` 的軌）的音符全部攤平成 `NoteEvent[]`，velocity 用 MIDI velocity / 127。bass 軌也算進去（鋼琴捲本來就該有低音）。

### 4.3 音訊來源：Basic Pitch

- 套件：`@spotify/basic-pitch`（Spotify 開源，Apache-2.0，TensorFlow.js GraphModel）。
- 新檔 `src/analysis/audio/notes.ts`（純函式：重採樣、後處理、轉 `NoteEvent[]`，Node 可測）＋ `src/analysis/audio/transcribe.ts`（載模型、跑推論；只在 Worker 跑，Node 測試不載入，`runAnalysis` 用注入的 `TranscribeFn`，和 `SeparateFn` 同一套做法）。
- **餵什麼音訊**：有分軌時餵 `mixStems(stems, ['bass', 'other'])`（去掉鼓的泛音和人聲的滑音，保留低音與和聲層）；沒有分軌（沒模型、分軌失敗）就餵混音。
- 流程：44.1 kHz pcm → 22.05 kHz → `BasicPitch.evaluateModel` 得 frames / onsets / contours → `outputToNotesPoly` → `addPitchBendsToNoteEvents` → `noteFramesToTime` → 轉成 `NoteEvent[]`。
- 後處理門檻（spike 用的值，當起點）：onset 0.5、frame 0.3、最短 11 frames（約 0.12 s）。這三個做成 `notes.ts` 的參數，之後 `pnpm score` 可以掃。
- 力度 = Basic Pitch 的 `amplitude`，限制在 0..1。
- 進度：`Stage` 加 `'notes'`，排在 `bass` 之後；進度條用 `evaluateModel` 的 percent callback，走既有的 `progress` 訊息。
- **快取**：`notes` 結果存進 OPFS，key 沿用 `stemKey`（音檔 bytes 的 SHA-256）加上門檻值；介面仿 `StemStore`（`MemoryNoteStore` 給測試、`OpfsNoteStore` 給瀏覽器）。同一首歌第二次載入直接讀快取。
- **時間試驗**：第 2 步做完先在 Chrome 跑整首 KILL LOVE 計時。60 秒內就過；60 秒到 3 分鐘之間接受（有進度條、有快取）；超過 3 分鐘才處理：先試 `webgl` → `webgpu` backend，再不行就把推論 hop 從 Basic Pitch 預設改大（降解析度），**不**改成只轉譜一段（那會改 `notes` 的資料契約）。
- 可重現：tfjs 同一 backend 下推論是確定性的；後處理是純 JS。backend 固定優先 `webgl`，退回 `cpu` 時結果允許有浮點差異，但不得影響音符數量超過 1%（這條是驗收時人工確認，不寫成自動測試）。

**Spike 結果（2026-11-12，Node CPU，`scratchpad/bp-spike/run.mjs`）**

| 歌 | 片段 | 音符 | 八度分布 | 推論 |
|---|---|---|---|---|
| KILL LOVE | 60–90 s | 215 | 1:22 2:82 3:87 4:24 | 17.7 s |
| hotel-room | 40–70 s | 133 | 1:35 2:55 4:19 5:16 6:8 | 17.9 s |

音名落在調內（KILL LOVE 大多是 D / A / E / F♯ / B），bass 與和弦層都有抓到；hotel-room 的高音旋律（A5 / A♯5 / D6）也抓到了。Node CPU 比即時慢 0.6 倍；瀏覽器 WebGL 預期快數倍，整首 KILL LOVE 可在 60 秒內完成。

### 4.3.1 讀數列與分組（五個 look 共用）

- **讀數列畫在 look 裡面**。主設計 §4.2 原本把讀數交給文字格，但 Reel 的每一格都在面板左下印自己的讀數（STARS LIT、SCORE、WINDOW…），那是 Oto look 的一部分，不是版面文字。做一個共用的 `drawReadouts(p, ctx, [{label, value}])` 放在 `sheet.ts`：左下角，等寬字，標籤 `mute` 小字在上、數值 `ink` 在下，欄距固定；`label` 關閉時讀數列也一起關閉（同一個開關）。既有 look 不回頭補。
- `App.tsx` 的 `lookGroup()` 要加 `notes` 這個分組（目前未知的 kind 會被塞進不存在的分組，Roll 和 Arcade 會從 UI 消失）。

### 4.4 Roll（鋼琴捲）look 規格

編號 25，id `roll`，`listens: ['notes', 'tempo']`。照 Reel 01 格的樣子：

- **直式面板**，列 = 音高，一列一個半音；時間由左到右；整張畫布滿版、不留大邊。
- **列範圍**自動：取整首歌 `notes` 的最低到最高音各外擴 2 個半音；沒有 `notes` 時預設 36–72。列高 = 可用高度 ÷ 列數；列數超過 48 時最低與最高各壓到 48 列內（裁掉極端音）。
- **列底色**：白鍵列 `paper`、黑鍵列 `mute` 淡淡一層（alpha 0.25），形成鋼琴捲的黑白條紋。每列之間一條 `line` 細線。
- **現在線**：固定在畫布左起 **38%** 處的垂直 `ink` 線（Reel 裡的線在左邊三分之一附近）。線左邊是已經過去的，右邊是即將來的。
- **視窗**：參數 `bars`（視窗小節數，1–8，預設 2）。整個視窗寬度 = `bars` 小節；小節線用 `line` 畫，拍線更淡。音符隨時間向左捲動，用 `tempo` 的 `timeOfBar` 換算座標，不用固定秒數，這樣 tempo 變化時格線仍對齊。
- **音符**：矩形，高 = 列高 × 0.72，寬 = duration；顏色 `accent`。正在響的（`time ≤ t < time+duration`）實心；未來的 alpha 0.35；過去的 alpha 0.55。velocity 不改顏色，只改高度（0.5 + 0.5·velocity 倍）。
- **讀數列**（左下，沿 `drawLabel` / 其他 look 的排版）：`WINDOW n bars` · `NOTES 正在響/整首` · `RANGE lo–hi`（用 `midiName`）· `SOURCE midi/audio`。
- 不畫音名在音符上（Reel 沒有，而且列太密）。

### 4.5 Arcade look 規格

編號 26，id `arcade`，`listens: ['notes', 'tempo']`。照 Reel 05 格：

- **上半：透視賽道**。lane = 整首歌出現過的音高（去重、由低到高、最多 12 條，超過就取出現次數最多的 12 個）。賽道從上方消失點向下展開；每條 lane 的底端有一個判定圓，lane 顏色 = `noteColor(theme, pc)`。音符是 lane 上的橫條，從遠處隨時間往下接近判定線；到達判定線時圓圈閃一下（0.15 s）。前瞻時間 = 參數 `lookahead`（秒，1–4，預設 2）。
- **下半：按鍵格**。兩排共 lane 數個按鍵，標音名（`midiName`）；正在響的鍵填該 lane 的顏色，其餘 `mute`。
- **計分**（全部由 t 之前的 notes 決定，可重現）：SCORE = Σ 已過音符的 (100 + 10·combo)；COMBO = 連續沒有空超過 1 拍的音符數；lane 數顯示 `Notes · n`；PART 固定 `Track`。右側一條直立的 COMBO 進度條（combo / 20）。
- 讀數列：`SCORE` · `COMBO` · `LANES Notes · n` · `PART Track`。

### 4.6 Pegboard look 規格

編號 27，id `pegboard`，`listens: ['spectrum', 'tempo']`。

- 18 個對數頻帶（從 BANDS7 的概念延伸：40 Hz–16 kHz 等比分 18 段），一帶一欄；一列一個 8 分音符；參數 `rows`（列數，8–24，預設 14）。
- 每格一顆 peg：未亮 `mute` 小圓；亮了填該帶顏色（18 帶映射到 `noteColors` 12 色，以 fifths 順序循環）、直徑隨能量 0.4–1.0。
- 時間由下往上填：最新一列在最下面，整頁填滿後從頭清掉重填（Reel 02 格就是這樣，不是捲動）。
- 讀數列：`STEP k / 8` · `LIT n of 18` · `ROWS n eighths`。

### 4.7 Trajectory look 規格

編號 28，id `trajectory`，`listens: ['bass', 'spectrum']`。

- 等角投影的線框盒：x = TIME（視窗 9 s，參數 `window` 4–16）、y = BASS NOTE（用 `pitchRange(bass)`）、z = BRIGHTNESS（頻譜重心，`spectrum` 算，0–1）。固定斜角，不旋轉。
- 線：視窗內每 1/30 s 一個樣本，y 取 `bassAt`，z 取平滑 0.1 s 的頻譜重心；`accent` 色；bass 音符起點處畫實心圓，現在點畫空心圓。盒底畫線的投影（`mute`）。
- 盒下方一條 TIME 色帶：視窗 9 s 的能量條（`energySeries`），`accent` 淡色，現在位置一條 `ink` 線。
- 讀數列：`WINDOW 9 s` · `BASS 音名` · `BRIGHT 0–100` · `POINTS 視窗內音符數`。

### 4.8 Sheet · Paint look 規格

編號 29，id `paint`，`listens: ['spectrum']`，屬於 Sheet 系（整首歌印成一張）。

- 流場：固定種子的 7 個漩渦源（重用 `flow.ts` 的 `sources`），不隨 t 漂移。
- 筆觸：整首歌每個 16 分音符產生一批筆觸（每帶一條，BANDS7 的 7 帶）；起點 = (時間進度 × 寬, 帶的高度帶內隨機)；沿流場走 `steps` 步；寬度與長度隨該帶能量；顏色 `noteColor` 依帶的 color index；alpha 0.6 疊加。
- 列印進度：`t` 之前的筆觸全部畫出，之後的不畫（Sheet 的 PRINTED %）。正在畫的那批用空心圓標記（Reel 04 格的圓圈）。
- 讀數列：`PRINTED %` · `PEN Paint` · `STROKES n` · `TIME m:ss`。
- 效能：筆觸是靜態幾何，一次算好快取在 look 內（以 readings 物件識別），每幀只畫 `t` 之前的。整首 4 分鐘約 7 × 16 × 4 × 150 ≈ 67k 條，每幀畫到數萬條會掉幀；所以每幀只重畫新增的筆觸到離屏 canvas，`Painter` 若沒有離屏能力就加一個 `layer()` 介面（留給做的人判斷）。

### 4.9 順序

1. `notes` 讀數型別 + MIDI 來源 + `mergeReadings` + `drawReadouts` + `lookGroup` 的 `notes` 分組（純 TS，先讓 `beat.mid` 的 Bass / Pad 進來）。
2. Basic Pitch 轉譜器（Worker 模組 + 純函式後處理 + 快取 + `setup:models`），接著做時間試驗。
3. Roll look。→ 這裡先做一次 milestone check 給使用者看。
4. Arcade。
5. Pegboard、Trajectory、Paint（彼此獨立，可平行）。
6. 更新 `MEMORY` 與主設計文件 §11。

## 5. 留給做的人決定

- 22.05 kHz 重採樣的實作（2:1 平均或簡單 FIR）。
- 轉譜跑在主執行緒時怎麼切片讓 UI 不凍結（`evaluateModel` 本身是分段的，percent callback 之間 `await` 一次即可）。
- Roll 列數上限 48 時的裁切策略（優先保留音符多的區段）。
- Paint 的離屏快取做法與 `Painter` 介面要不要加 `layer()`。
- 18 帶的確切邊界與 12 色映射。
- 各 look 的測試用假 readings（沿用 `test/fixtures`）。

## 6. 參考資料

- Reel：https://www.instagram.com/reels/DfF16wtNm18/ （三個時間點的截圖在對話中，未存檔）
- Oto 官網 look 名單與一句說明：https://otoinstrument.shop/en （HTML 的 `data-name` / `data-sub`）；海報 `https://otoinstrument.shop/media/hd/looks/{pegboard,trajectory,sheet-paint,stars}.webp`
- Basic Pitch：https://github.com/spotify/basic-pitch-ts
- Spike：`/private/tmp/claude-501/-Users-bd-Desktop-oto/b5734e27-89bb-4a7c-a7dd-e5a8a9f7cf2f/scratchpad/bp-spike/run.mjs`（丟棄式，不進 repo；Node 用自製 IOHandler 讀模型，瀏覽器直接給 URL 即可）
