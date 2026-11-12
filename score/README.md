# 評測集（`pnpm score`）

偵測器或模型的任何改動，都要讓這裡的整組分數變好才收。`pnpm test` 不會跑這些（要 ffmpeg 和 `samples/`）。

## 跑

```
pnpm score
```

- 合成案例永遠會跑，而且有門檻：bass 音高時間正確率 ≥ 80%（2026-11-12 實測 84%）、kick F1 ≥ 90%。退步就紅。
- 真歌：`samples/score/*.json` 每首一個檔，只印表、不擋。結果同時寫到 `score/last-run.md`（不進 git）。

## 標準答案的格式（`SongTruth`）

```json
{
  "name": "kill-love",
  "audio": "samples/kill-love.mp3",
  "stems": "samples/stems/kill-love",
  "bass":   [{ "time": 24.31, "duration": 1.1, "midi": 31 }],
  "chords": [{ "time": 24.2, "duration": 2.5, "root": 7 }],
  "drums":  [{ "time": 0.52, "kind": "kick" }]
}
```

- 路徑相對於 repo 根。`samples/` 是 git-ignore 的，答案檔放那裡不會進 git。
- `bass`、`chords`、`drums` 都可省；省了那一欄就是「–」。
- `root` 是 pitch class（C=0 … B=11）。
- `stems`（可省）：目錄裡有 `bass.wav`、`drums.wav`、`other.wav`（`vocals.wav` 可省）就會走分軌路徑。
  分軌檔可以從 app 的 OPFS 匯出，或用 demucs 另外產生；長度不夠會補零。

## 從 DAW 的 MIDI 產生答案

```
node score/midi-to-truth.mjs samples/song.mid samples/song.mp3 [samples/stems/song] > samples/score/song.json
```

軌名認角色（含 drum/kick/perc、bass、chord/pad/keys/piano），鼓用 GM 音高，和弦取同一起音的最低音當根音。
.mid 要跟音檔從同一個工程、同一個第 1 小節匯出，0 對 0。

## 指標

| 欄 | 意思 |
|---|---|
| bass 音高時間 | 真值有音的時間裡，預測到同一個 midi 的比例（分段方式不影響；主要指標） |
| bass F1 | 起音 ±50 ms、midi 相等的音符 F1（偵測器會把連續同音接在一起，所以會偏低） |
| 八度錯 | 起音對、差整數個八度的音符數 |
| 和弦根音 | 以時間長度加權的根音正確率 |
| kick / snare / hat | 起音 ±50 ms 的 F1 |
