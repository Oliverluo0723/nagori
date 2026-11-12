# look 第二批驗收：六個參考 Reel 裡的 look

日期：2026-11-12。分支 `milestone-4`。素材 KILL LOVE small + .mid（BPM 128，D major），播放線 2:30。截圖同目錄 `2026-11-12-looks2-*.jpg`，Oto 參考圖抓自官網 `/media/hd/looks/<id>.webp`。

| look | 跟 Oto 比 | 這輪修了 | 下輪 |
|---|---|---|---|
| 13 墨點格 Blot | 格點、墨點、空心播放圈都有；黑底的發光暈跟參考很像 | — | Oto 整張有一層淡粉色的背景霧，我們沒有；snare 的墨色點在黑底變白點，可以改成 mute |
| 14 字符譜 Glyph | 72 格字元頻譜、底列 X/x 鼓，結構一樣 | — | KILL LOVE 很響，整面都是 `=`/`+`，`gamma` 預設可能要拉到 2；Oto 還有彩色背景光斑 |
| 15 雷達掃描 Lidar | 透視的掃描線、低中高三色點，結構一樣 | 門檻 0.18 → 0.4，而且門檻以上才算大小，不然每個點一樣大 | 線數 24 → 30 更像；遠處的線可以再淡 |
| 16 地層 Strata | 七團發光體 + 路徑 + sub 的 kick 爆散，結構一樣 | — | Oto 的位置更散、路徑是曲線不是折線；每團旁邊有 Hz 範圍小字 |
| 17 多筆記錄 Polygraph | 六條泳道、時間刻度、印字頭，最像參考 | — | Oto 有 WIDTH、TENSION 兩條我們沒讀數；NOTES 的點可以畫小圓而不是長條 |
| 18 膠體電泳 Gel | 七條泳道色帶、第一道黑點，結構一樣 | 門檻 0.12 → 0.3，門檻以上才算寬度 | 色帶太密太整齊，可以每條加一點固定種子的寬度抖動 |

## 絲滑度

同一台機器（120 Hz 螢幕、預覽寬 540）每幀畫圖時間：Blot 0.5 ms、Glyph 1.4、Lidar 2.1、Strata 0.3、Polygraph 2.0、Gel 2.1。`P5Painter` 這輪加了顏色快取（同色同 alpha 只解析一次），前一批最重的 Mesh 應該也會受惠，還沒重量。

## 自動驗證

`npm test` 174 個全過、`npm run typecheck`、`npm run lint` 綠。look 的測試共用 `test/fixtures/looks.ts` 的 `makeCtx` / `flatSpectrum` / `spectrumWith`。

## 還沒做的參考 look

- Sonar（捲動頻譜圖）：64 bin × 幾百欄的像素畫，需要 Painter 加一個點陣原語（例如 `raster(x, y, w, h, cols, rows, values, color)`，p5 端用 ImageData 畫），不然每幀上萬個 rect。
- Fountain（粒子噴泉）：每個 hit 噴出固定種子的粒子，位置是年齡的函式，幾千個點；先量 p5 畫幾千個小圓要幾毫秒再做。
- Stipple、Tracker：官網只有縮圖沒說明，Tracker 還要立體聲位置，先不做。
- Paint、Hatch：整首歌的筆觸畫，動畫方式要自己定。
