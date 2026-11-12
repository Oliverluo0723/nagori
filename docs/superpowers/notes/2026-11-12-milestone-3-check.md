# 里程碑 3 驗收：KILL LOVE 不帶 .mid

日期：2026-11-12。只丟 `samples/kill-love-small.mp3`（4 分 48 秒）。

- 分析時間：約 20 秒（主執行緒，畫面有「分析中：階段 %」）。Worker 還沒做。
- 結果：BPM 96（候選 96 / 192 / 128 / 72），D major，1804 個鼓點，234 個和弦事件，214 個 bass 音，來源全是 audio。
- 和弦輪：D 亮起，和弦進行 D / Bm / F♯m / G / A 合理。發光體跟著換色。
- 鼓格：有 kick / snare / hat 分布；切到 128 BPM 候選後整個格子立刻重算（截圖 `2026-11-12-m3-killlove-grid-96.jpg` vs `-128.jpg`）。哪個對要聽著比，96 的格子看起來 kick 位置比較規律。
- Bass 路徑：214 個音，實際音高是否正確要聽著比；合成檔上每小節全對。
- 沒做：Task 6 的 Worker（分析時會卡住 UI 20 秒）、Task 8 的逐小節人工聽對照、fresh reviewer 的最終審查。

截圖：`2026-11-12-m3-killlove-bodies.jpg`、`2026-11-12-m3-killlove-grid-96.jpg`、`2026-11-12-m3-killlove-grid-128.jpg`。
