# 里程碑 4：六個 Sheet 系 look（整首歌印出來）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照 Oto 的 Sheet 系列加六個 look：Ridge、Drum、String、Mesh、Corona、Disc。每個都把整首歌「印」在一張圖上，播到哪印到哪，剛印好的那一段用強調色。全部只讀既有的 Readings（drums、spectrum、tempo），不加新讀數。

**Architecture:** 每個 look 一個檔，照 `rings.ts` 的樣子：`params`、`draw(p, ctx)`、`export const xxxLook: Look`。共用的東西放 `src/looks/sheet.ts`：整首歌的能量序列（每幀一個值，用 WeakMap 依 Spectrum 物件快取，所以每幀畫圖不用重算整首歌）、頻帶序列、`m:ss` 時間格式、參數讀取。畫圖仍只經過 `Painter`。

**Tech Stack:** 同前（TypeScript、p5 painter、vitest、RecordingPainter）。

**參考圖：** Oto 官網 `/media/hd/looks/sheet-<id>.webp`，已抓到本次工作階段暫存區；做完要把成品截圖放進 `docs/superpowers/notes/`。

## Global Constraints

- 同輸入同輸出：不得讀 `Date`、不得用 `Math.random`；亂數一律 `mulberry32(ctx.seed)`。
- 「印到哪」的規則統一：只畫 `time ≤ ctx.t` 的資料；最後一拍（`beatSeconds`）內的部分用 `theme.accent`，其餘用 `theme.ink` / `theme.mute`。
- 沒有 spectrum（或 drums 為空）時：仍畫背景、座標與小標，不丟錯。
- 每幀的工作量要跟歌長無關或只是線性一次掃描：整首歌的彙總（每列平均頻譜、每幀能量）用 WeakMap 快取，只有「正在印的那一列」每幀即時算。
- 小標照既有做法：`ctx.label` 畫在左上角，`theme.mute`、mono、`h × 0.012`。
- 編號 7–12，`listens` 要誠實：鼓類 `['drums','tempo']`，頻譜類 `['spectrum','tempo']`。

## 六個 look 的規格

| # | id | 名稱 | 聽什麼 | 畫什麼 |
|---|---|---|---|---|
| 7 | ridge | 頻譜山脊 | spectrum | 歌切成 N 列（預設 24），每列一條「該段平均頻譜」的折線，x 是對數頻率、y 往上是能量。左邊標 m:ss，下面標 Hz。正在印的那列只平均到 t，用強調色。 |
| 8 | drum | 地震鼓紋 | drums、tempo | 一列 N 小節（預設 4），每列一條地震儀線。每個 hit 在它的 x 位置放一個衰減震盪：kick 低頻大振幅、snare 中頻中振幅、hat 高頻小振幅，疊加成折線。正在印的列只畫到 t，最後一拍用強調色。 |
| 9 | string | 鼓釘絲線 | drums、tempo | 只看 kick / snare。每個 hit 是一根釘：角度 = 小節內位置 × 2π，半徑 = 種類基準 + 力度，再加固定種子的小抖動。一條線依時間順序把釘串起來，重複的 groove 會織出穩定的圖形。釘畫到 t，最後一段線用強調色。 |
| 10 | mesh | 頻帶織網 | spectrum、tempo | 六條頻帶（30–80、80–200、200–500、500–1.5k、1.5k–4k、4k–16k Hz）六條泳道，高頻在上。每拍一個樣本，泳道中線上下各一條包絡線，相鄰樣本的上下點交叉連線成網。整首最大聲的那條泳道線最深。印到 t，最後一拍強調色。 |
| 11 | corona | 日冕 | spectrum、tempo | 整首歌繞一圈（12 點鐘起順時針），每半拍一根射線，長度 = 該時刻整體能量；再疊一根細的高頻射線。內圈三個同心圓。印到 t，正在印的射線用墨色當指針。 |
| 12 | disc | 唱片溝槽 | spectrum、tempo | 從中心往外的螺旋溝槽，圈數可調（預設 14）。時間對應弧長，溝槽沿法線方向以固定波長抖動，振幅 = 該時刻整體能量。中心一個十字。印到 t，最後一拍的溝槽用強調色。 |

## Tasks

### Task 1：共用工具 `src/looks/sheet.ts`

- [ ] 失敗測試 `sheet.test.ts`：`energySeries(s)` 回每幀平均值、同一個 spectrum 回同一個陣列實例（快取）；`bandSeries(s, lo, hi)` 同 `bandEnergy`；`formatTime(65)` 是 `1:05`；`paramNum` 沒給時回預設。
- [ ] 實作，測試通過。

### Task 2：Ridge（7）

- [ ] 測試：無 spectrum 仍畫背景、小標、Hz 刻度；有 spectrum 時列數等於參數；t 在第 2 列中段時第 1 列用 ink、第 2 列用 accent、第 3 列沒畫；同輸入 ops 相同。
- [ ] 實作，加進 registry。

### Task 3：Drum（8）

- [ ] 測試：空 drums 仍畫每列基線；一個 kick 之後折線在 kick 位置之後偏離基線、之前在基線上；t 之後的列不畫；同輸入 ops 相同。
- [ ] 實作，加進 registry。

### Task 4：String（9）

- [ ] 測試：hat 不產生釘；kick / snare 各一根釘、一段線；時間晚於 t 的 hit 不畫；同種子同圖。
- [ ] 實作，加進 registry。

### Task 5：Mesh（10）

- [ ] 測試：六條泳道；只有一個頻帶有能量時只有那條泳道有非零包絡；t 之後的拍不畫；同輸入 ops 相同。
- [ ] 實作，加進 registry。

### Task 6：Corona（11）

- [ ] 測試：無 spectrum 畫三個同心圓與小標；射線數 = 印到 t 的半拍數；射線起點在內圈半徑上；同輸入 ops 相同。
- [ ] 實作，加進 registry。

### Task 7：Disc（12）

- [ ] 測試：中心十字；polyline 的點半徑單調不減（螺旋往外）；t 越大點越多；同輸入 ops 相同。
- [ ] 實作，加進 registry。

### Task 8：驗收

- [ ] `npm test`、`npm run typecheck`、`npm run lint` 全綠。
- [ ] 用 KILL LOVE 在 app 裡逐個開，截圖到 `docs/superpowers/notes/2026-11-12-m4-<id>.jpg`，寫 `2026-11-12-milestone-4-check.md`：跟 Oto 參考圖比，三點差異與下一輪要調的參數。
