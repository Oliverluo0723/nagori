# 評測集（`pnpm score`）

偵測器或模型的任何改動，都要讓這裡的整組分數變好才收。`pnpm test` 不會跑這些（要 ffmpeg 和 `samples/`）。

## 跑

```
pnpm score
```

- 合成案例永遠會跑，而且有門檻：bass 音高時間正確率 ≥ 80%（2026-11-12 實測 84%）、kick F1 ≥ 90%。退步就紅。
- 真歌：`samples/score/*.json` 每首一個檔，只印表、不擋。結果同時寫到 `score/last-run.md`（不進 git）。
- 整條流程跟 app 一樣（`runAnalysis`），轉譜用 Node 版的 Basic Pitch（`score/transcribeNode.ts`，tfjs cpu，30 秒的歌約 20 秒）。

## 合成歌

`samples/` 不進 git，所以要先產：

```
node samples/make-beat.mjs                      # beat：120 bpm、三和弦、8 小節
node score/midi-to-truth.mjs samples/beat.mid samples/beat.wav > samples/score/beat.json
node score/make-synth.mjs                       # synth-b：96 bpm、1.3 s 前奏、七和弦與轉位、旋律、12 小節
node score/make-synth.mjs ramp                  # synth-c：同上，但速度從 88 漸升到 104
```

2026-11-13 的分數（`pnpm score`）：

| 歌 | 拍 F1 | 拍格 | 強拍 | 音符 F1 | 和弦根音 | 和弦品質 |
|---|---|---|---|---|---|---|
| beat | 98% | 100% | 100% | 56% | 96% | 96% |
| synth-b | 98% | 100% | 100% | 62% | 100% | 92% |
| synth-c | 100% | 100% | 100% | 61% | 100% | 92% |

音符的 precision 只有五成：多出來的幾乎都是八度泛音假音，門檻掃過（`NOTE_THRESHOLDS`），
再往上要靠分軌（app 有 stems 時轉譜吃 bass + other）。

## 標準答案的格式（`SongTruth`）

```json
{
  "name": "kill-love",
  "audio": "samples/kill-love.mp3",
  "stems": "samples/stems/kill-love",
  "bass":   [{ "time": 24.31, "duration": 1.1, "midi": 31 }],
  "chords": [{ "time": 24.2, "duration": 2.5, "root": 7, "minor": false }],
  "drums":  [{ "time": 0.52, "kind": "kick" }],
  "beats":  [0.52, 0.99, 1.46],
  "downbeats": [0.52],
  "bpm": 128,
  "notes":  [{ "time": 24.31, "duration": 1.1, "midi": 55 }]
}
```

- 路徑相對於 repo 根。`samples/` 是 git-ignore 的，答案檔放那裡不會進 git。
- `bass`、`chords`、`drums` 都可省；省了那一欄就是「–」。
- `root` 是 pitch class（C=0 … B=11）；`minor` 省略就只看根音。
- `beats` 是每一拍（含弱拍）、`downbeats` 是每小節第 1 拍；`bpm` 只給固定速度的歌。`notes` 是鋼琴捲要畫的所有非鼓音符。
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
| 拍 F1 / bpm 比 / 拍誤差 | `rhythm.beats` 對真值拍 ±70 ms 的 F1；bpm 比 1 = 對、2 或 0.5 = 八度錯；命中拍的平均誤差 |
| 拍格 / 格誤差 / 強拍 | looks 真正看的 tempo map：真值拍落在格線 ±70 ms 的比例、平均誤差、真值強拍被算成第 1 拍的比例 |
| 音符 F1 / P/R / 顆數 | 鋼琴捲音符：起音 ±50 ms、midi 相等的 F1，precision / recall，預測顆數 / 真值顆數 |
| 和弦品質 | 根音對而且大小調對（真值有標 `minor` 才看），時間長度加權 |
| bass 音高時間 | 真值有音的時間裡，預測到同一個 midi 的比例（分段方式不影響；主要指標） |
| bass F1 | 起音 ±50 ms、midi 相等的音符 F1（偵測器會把連續同音接在一起，所以會偏低） |
| 八度錯 | 起音對、差整數個八度的音符數 |
| 和弦根音 | 以時間長度加權的根音正確率 |
| kick / snare / hat | 起音 ±50 ms 的 F1 |
