# 里程碑 5 驗收：瀏覽器內分軌（Demucs）＋ Worker ＋ 評測集

日期：2026-11-12。Chrome，Apple Silicon Mac，`pnpm dev`，模型由 `pnpm setup:models` 放在 `public/models/`。

## KILL LOVE（`kill-love-small.mp3`，4 分 48 秒，不帶 .mid）

- 第一次：解碼 → **分軌 80 秒** → 頻譜 / 節拍 / 鼓 / 和弦 / bass 17 秒，共 97 秒。分析期間主執行緒每 500 ms 的計時器沒有超過 1.5 秒的空洞，UI 不卡。
- 來源：tempo 音訊、drums / chords / bass / key **分軌**。
- 第二次丟同一個檔：階段直接從「算頻譜」起跳，沒有「分軌」（OPFS 快取命中，key 是檔案 SHA-256），來源不變。
- 結果：BPM 96，D major，1798 個鼓點，259 個和弦事件，333 個 bass 音（里程碑 3 純混音時 214 個）。
- 截圖：`2026-11-12-m5-killlove-stems.jpg`。

## Hotel Room（Lionclad remix，`hotel-room.mp3`，2 分 28 秒）

- 清掉快取後重量：**分軌 25 秒**（即時的 6 倍快），全部 31.6 秒。
- 結果：BPM 139.9，G minor，672 個鼓點，126 個和弦事件，33 個 bass 音；10–16 秒的 pad 不再被當成 bass（里程碑 3 之後的 bass 修正 + 分軌雙重保險）。
- 截圖：`2026-11-12-m5-hotelroom-stems.jpg`。

## `pnpm score`

| 歌 | 分軌 | bass 音高時間 | bass F1 | 八度錯 | 和弦根音 | kick | snare | hat |
|---|---|---|---|---|---|---|---|---|
| synthetic | 無 | 84% | 8% | 0 | – | 100% | 100% | 100% |

合成案例的門檻：bass 音高時間 ≥ 80%、kick F1 ≥ 90%。真歌還沒有標準答案（`samples/score/` 是空的）；要從 DAW 的 MIDI 用 `score/midi-to-truth.mjs` 產生。

## 已知問題 / 沒做

- **WebGPU 還是 WASM**：ORT 在 Worker 裡初始化，頁面看不到 `ort.env`；demucs-web 作者說 Conv1d 會退回 WASM。兩首的速度（4–6 倍即時）跟 spike 的 WASM 12 執行緒一致，推測是 WASM。要確認得在 Worker 裡回報 `session` 的 provider。
- **和弦 D / Dm 混淆**仍在（分軌不會改變這個，是和弦偵測本身的問題）。候選方案：ChordMini（2026，BTC 架構，要轉 ONNX），等評測集有真歌再比。
- bass F1 偏低是指標特性：偵測器會把連續同音接成一段，起音 F1 算不到；主要看「音高時間」。
- 吉他、鋼琴不分軌（六軌 Demucs 的鋼琴軌品質太差）。
- 沒給模型時的提示（「找不到分軌模型…」）只有單元測試，沒在瀏覽器實際看過。
- 分軌結果只存 OPFS，不在專案檔裡；換瀏覽器 profile 要重算。
