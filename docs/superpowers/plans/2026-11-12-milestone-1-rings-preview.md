# 里程碑 1：讀歌 + Hit 圓環 + 預覽 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在瀏覽器裡丟進一首 mp3 與同名 .mid，分析出拍格與鼓 hit，用「Hit 圓環」look 在一格 9:16 畫布上跟著播放畫出來，黑底發光與紙感墨印兩套主題可切。

**Architecture:** 四層：`analysis`（檔案 → 純資料的 Readings）、`looks`（純函式，透過 `Painter` 介面畫一幀，不碰 p5）、`compose`（畫布模型、主題、把各格合成一幀）、`render`（預覽：播放器時間 → 逐幀叫 compose）。`Painter` 有兩個實作：測試用的 `RecordingPainter` 把繪圖指令記成陣列，讓 look 可以在 Node 裡測決定性；app 用的 `P5Painter` 包一個 `p5.Graphics`。React 只在最外層操作模型。

**Tech Stack:** Vite 8、TypeScript 5.9、React 19、p5 2.4（instance mode，自帶型別）、@tonejs/midi 2.0、vitest、biome、pnpm。只支援 Chrome。

**Spec:** `docs/superpowers/specs/2026-11-12-oto-reels-tool-design.md`

## Global Constraints

- 同樣輸入必須得到同樣畫面：look 不得讀取 `Date`、`Math.random`、p5 的 `random()`/`noise()` 以外的狀態；需要亂數一律用 `LookContext.seed` 建立的 PRNG。
- look 只用主題的語意顏色（`paper`、`ink`、`mute`、`line`、`accent`、`noteColors`），不寫死色碼。
- look 的尺寸一律以格子高度的比例表示（例如 `h * 0.02`），不寫死像素，預覽與輸出才會一致。
- 拍格以 MIDI 的 tempo map 為準；MIDI 與音檔 0 對 0。
- 鼓用 General MIDI 音高分：kick = 35、36；snare = 38、40；hat = 42、44、46；其他音高忽略。
- MIDI 軌名含 `drum`、`kick`、`perc`（不分大小寫）或 channel 為 9（第 10 軌）→ 鼓；含 `bass` → bass；含 `chord`、`pad`、`keys`、`piano` → 和弦；其餘 `other`。
- 第一版只做 9:16，邏輯解析度 1080 × 1920；預覽用較小尺寸畫同樣的東西。
- 主題色值：黑底發光 `paper #0f0f0f`、`ink #efece4`、`mute #7a7a7a`、`line #2a2a2a`、`accent #ff4a1c`、`glow true`；紙感墨印 `paper #f1ede4`、`ink #161616`、`mute #6b665c`、`line #c9c3b6`、`accent #ff4a1c`、`glow false`。
- 專案根目錄 `/Users/bd/Desktop/oto`，目前不是 git repo，Task 1 要 `git init`。

## Review Focus

1. **MIDI 裡沒有鼓軌**：Readings.drums 為空陣列，Rings 只畫時間軸與 now 線，app 顯示「找不到鼓軌」。測試在 Task 3。
2. **軌名是中文或空字串、但 channel 是 9**：仍要認成鼓。測試在 Task 3。
3. **中途變速的 MIDI**：變速後的小節位置要跟 @tonejs/midi 的 `ticksToSeconds` 一致。測試在 Task 2。
4. **只丟 mp3 沒丟 .mid**：本里程碑沒有音訊備援，app 要顯示「需要同名 .mid」而不是當掉。測試在 Task 8。
5. **播放超過 MIDI 的最後一個 hit**：t 大於所有 hit 時 Rings 仍正常畫（圓圈淡出後畫面只剩軸）。測試在 Task 6。

---

## File Structure

```
oto/
  package.json  vite.config.ts  tsconfig.json  biome.json  index.html
  src/
    main.tsx                      React 進入點
    app/App.tsx                   拖檔、主題切換、播放鈕、畫布容器
    analysis/
      types.ts                    Readings、TempoMap、DrumHit、TrackRole
      tempo.ts                    buildTempoMap、positionAt、timeOfBar
      midi/roles.ts               assignRoles
      midi/drums.ts               extractDrumHits
      analyze.ts                  analyzeMidi(buffer, durationHint) → Readings
    looks/
      types.ts                    Look、LookContext、ParamDef
      painter/painter.ts          Painter 介面
      painter/recording.ts        RecordingPainter
      painter/p5.ts               P5Painter
      prng.ts                     mulberry32(seed)
      rings.ts                    ringsLook
      registry.ts                 looks: Record<string, Look>
    compose/
      types.ts                    Composition、LayoutNode、Cell、Theme
      themes.ts                   darkGlow、paperInk、themes
      render.ts                   renderFrame
    render/
      preview.ts                  createPreview
  test/
    fixtures/midi.ts              makeMidi 產生測試用 .mid bytes
```

---

### Task 1: 專案骨架

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `biome.json`, `index.html`, `src/main.tsx`, `src/app/App.tsx`, `.gitignore`
- Test: `src/app/App.test.ts`（只驗證 vitest 能跑）

**Interfaces:**
- Produces: `pnpm dev`、`pnpm test`、`pnpm typecheck`、`pnpm lint` 四個指令。

- [ ] **Step 1: 初始化 repo 與套件**

```bash
cd /Users/bd/Desktop/oto && git init
pnpm init
pnpm add react react-dom p5 @tonejs/midi
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest @biomejs/biome
```

- [ ] **Step 2: 寫設定檔**

`vite.config.ts` 用 `@vitejs/plugin-react`，`test.environment` 設 `node`。`tsconfig.json` 以 P5 專案（`/Users/bd/Desktop/P5/tsconfig.json`）為範本，`strict: true`、`jsx: react-jsx`。`biome.json` 直接複製 P5 專案的。`.gitignore` 含 `node_modules`、`dist`、`.superpowers/`。`package.json` scripts：`dev`、`build`、`test: vitest run`、`typecheck: tsc --noEmit`、`lint: biome check .`。

- [ ] **Step 3: 寫冒煙測試**

```ts
// src/app/App.test.ts
import { expect, test } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 4: 寫最小 App**

`src/main.tsx` 掛 `<App />` 到 `#root`；`App.tsx` 先回傳 `<h1>oto</h1>`。

- [ ] **Step 5: 驗證四個指令都過**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全部 exit 0，vitest 顯示 1 passed。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + react + vitest + biome"
```

---

### Task 2: Tempo map 與拍格

**Files:**
- Create: `src/analysis/types.ts`, `src/analysis/tempo.ts`, `test/fixtures/midi.ts`
- Test: `src/analysis/tempo.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface TempoMap { ppq: number; tempos: { ticks: number; bpm: number }[]; timeSignatures: { ticks: number; numerator: number; denominator: number }[] }
  export interface BarPosition { bar: number; beat: number; barPhase: number; beatPhase: number; bpm: number }
  export type DrumKind = "kick" | "snare" | "hat";
  export interface DrumHit { time: number; kind: DrumKind; velocity: number }
  export type TrackRole = "drums" | "bass" | "chords" | "other";
  export interface Readings { duration: number; tempo: TempoMap; drums: DrumHit[]; roles: { index: number; name: string; role: TrackRole }[] }
  // tempo.ts
  export function buildTempoMap(header: Header): TempoMap          // Header 來自 @tonejs/midi
  export function positionAt(map: TempoMap, t: number): BarPosition  // bar、beat 都從 1 起算
  export function timeOfBar(map: TempoMap, bar: number): number
  export function bpmAt(map: TempoMap, t: number): number
  // test/fixtures/midi.ts
  export function makeMidi(opts: { bpm?: number; tempoChanges?: { beat: number; bpm: number }[]; tracks: { name?: string; channel?: number; notes: { beat: number; midi: number; velocity?: number; durationBeats?: number }[] }[] }): Uint8Array
  ```

- [ ] **Step 1: 寫 fixture 產生器**

`makeMidi` 用 `new Midi()`，`header.setTempo(bpm ?? 120)`，`tempoChanges` 逐一 push 到 `header.tempos`（ticks = beat × ppq）後呼叫 `header.update()`，每個 track 用 `midi.addTrack()`、設 `name`、`channel`、`addNote({ midi, ticks: beat*ppq, durationTicks, velocity })`，回傳 `midi.toArray()`。

- [ ] **Step 2: 寫失敗測試**

```ts
// src/analysis/tempo.test.ts
test("120 bpm 4/4: t=2s is bar 2 beat 1", () => {
  const midi = new Midi(makeMidi({ bpm: 120, tracks: [] }));
  const map = buildTempoMap(midi.header);
  expect(positionAt(map, 2)).toMatchObject({ bar: 2, beat: 1, bpm: 120 });
  expect(positionAt(map, 2.25).beatPhase).toBeCloseTo(0.5);
  expect(timeOfBar(map, 3)).toBeCloseTo(4);
});
test("tempo change at beat 8 from 120 to 60 matches ticksToSeconds", () => {
  const midi = new Midi(makeMidi({ bpm: 120, tempoChanges: [{ beat: 8, bpm: 60 }], tracks: [] }));
  const map = buildTempoMap(midi.header);
  const ppq = midi.header.ppq;
  expect(timeOfBar(map, 4)).toBeCloseTo(midi.header.ticksToSeconds(12 * ppq));
  expect(positionAt(map, timeOfBar(map, 4) + 0.5)).toMatchObject({ bar: 4, beat: 1 });
  expect(bpmAt(map, 10)).toBe(60);
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `pnpm vitest run src/analysis/tempo.test.ts`
Expected: FAIL，找不到 `buildTempoMap`。

- [ ] **Step 4: 實作 `tempo.ts`**

`buildTempoMap` 只是把 header 的 `ppq`、`tempos`、`timeSignatures`（`timeSignature[0]`、`[1]`）抄成純資料。`positionAt`：先把秒轉 ticks（自己依 tempos 分段積分，不要依賴 Header 物件，因為 Readings 要能序列化），ticks ÷ ppq 得 beats，再依 timeSignatures 分段算 bar。沒有 timeSignature 事件時當 4/4。

- [ ] **Step 5: 跑測試確認通過**

Run: `pnpm vitest run src/analysis/tempo.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/analysis test/fixtures && git commit -m "feat(analysis): tempo map and bar positions from MIDI header"
```

---

### Task 3: MIDI 軌角色與鼓 hit

**Files:**
- Create: `src/analysis/midi/roles.ts`, `src/analysis/midi/drums.ts`, `src/analysis/analyze.ts`
- Test: `src/analysis/midi/roles.test.ts`, `src/analysis/midi/drums.test.ts`, `src/analysis/analyze.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `TempoMap`、`DrumHit`、`TrackRole`、`Readings`、`makeMidi`。
- Produces:
  ```ts
  export function assignRoles(tracks: { index: number; name: string; channel: number }[]): { index: number; name: string; role: TrackRole }[]
  export function extractDrumHits(track: Track): DrumHit[]   // Track 來自 @tonejs/midi，用 note.time（秒）與 note.velocity
  export function analyzeMidi(bytes: ArrayBuffer | Uint8Array, durationHint?: number): Readings
  // duration = max(durationHint ?? 0, midi.duration)
  ```

- [ ] **Step 1: 寫失敗測試（roles）**

```ts
test("names map to roles, channel 9 is drums regardless of name", () => {
  expect(assignRoles([
    { index: 0, name: "Drums", channel: 0 },
    { index: 1, name: "808 Bass", channel: 1 },
    { index: 2, name: "Pad chords", channel: 2 },
    { index: 3, name: "鼓", channel: 9 },
    { index: 4, name: "", channel: 3 },
  ]).map(r => r.role)).toEqual(["drums", "bass", "chords", "drums", "other"]);
});
```

- [ ] **Step 2: 寫失敗測試（drums）**

```ts
test("GM pitches become kick/snare/hat with normalized velocity, others dropped", () => {
  const midi = new Midi(makeMidi({ bpm: 120, tracks: [{ name: "Drums", notes: [
    { beat: 0, midi: 36, velocity: 1 }, { beat: 1, midi: 38, velocity: 0.5 },
    { beat: 1.5, midi: 42, velocity: 0.8 }, { beat: 2, midi: 49, velocity: 1 } ] }] }));
  expect(extractDrumHits(midi.tracks[0])).toEqual([
    { time: 0, kind: "kick", velocity: 1 },
    { time: 0.5, kind: "snare", velocity: 0.5 },
    { time: 0.75, kind: "hat", velocity: 0.8 },
  ]);
});
```

- [ ] **Step 3: 寫失敗測試（analyze）**

```ts
test("analyzeMidi collects hits from every drums track, sorted by time", () => {
  const bytes = makeMidi({ bpm: 120, tracks: [
    { name: "Kick", notes: [{ beat: 2, midi: 36 }] },
    { name: "x", channel: 9, notes: [{ beat: 0, midi: 42 }] },
    { name: "Bass", notes: [{ beat: 0, midi: 40 }] } ] });
  const r = analyzeMidi(bytes, 30);
  expect(r.drums.map(h => [h.time, h.kind])).toEqual([[0, "hat"], [1, "kick"]]);
  expect(r.duration).toBe(30);
  expect(r.roles.map(x => x.role)).toEqual(["drums", "drums", "bass"]);
});
test("no drums track gives empty drums, not an error", () => {
  const r = analyzeMidi(makeMidi({ tracks: [{ name: "Bass", notes: [{ beat: 0, midi: 40 }] }] }));
  expect(r.drums).toEqual([]);
});
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `pnpm vitest run src/analysis`
Expected: 三個新檔案 FAIL。

- [ ] **Step 5: 實作三個檔案**

`analyzeMidi`：`new Midi(bytes)` → `buildTempoMap` → `assignRoles` → 對每個 role 為 drums 的軌 `extractDrumHits`，合併後依 `time` 排序。

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm vitest run src/analysis`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/analysis && git commit -m "feat(analysis): track roles, drum hits, analyzeMidi"
```

---

### Task 4: Painter 介面與 RecordingPainter

**Files:**
- Create: `src/looks/painter/painter.ts`, `src/looks/painter/recording.ts`, `src/looks/prng.ts`
- Test: `src/looks/painter/recording.test.ts`, `src/looks/prng.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // painter.ts
  export interface TextStyle { size: number; font: "sans" | "mono"; align?: "left" | "center" | "right"; weight?: 400 | 700 }
  export interface Painter {
    background(color: string): void;
    fill(color: string, alpha?: number): void;      // alpha 0..1，預設 1
    noFill(): void;
    stroke(color: string, weight: number, alpha?: number): void;
    noStroke(): void;
    glow(color: string, blur: number): void;        // blur 單位 px；主題 glow=false 時 P5Painter 忽略
    noGlow(): void;
    circle(x: number, y: number, d: number): void;
    line(x1: number, y1: number, x2: number, y2: number): void;
    rect(x: number, y: number, w: number, h: number): void;
    text(s: string, x: number, y: number, style: TextStyle): void;
  }
  // recording.ts
  export type PaintOp = { op: keyof Painter; args: unknown[] };
  export class RecordingPainter implements Painter { readonly ops: PaintOp[]; }
  // prng.ts
  export function mulberry32(seed: number): () => number   // 回傳 [0,1)
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
test("RecordingPainter records every call in order with args", () => {
  const p = new RecordingPainter();
  p.fill("#fff"); p.circle(1, 2, 3);
  expect(p.ops).toEqual([{ op: "fill", args: ["#fff", undefined] }, { op: "circle", args: [1, 2, 3] }]);
});
test("mulberry32 is deterministic", () => {
  const a = mulberry32(7), b = mulberry32(7);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
```

- [ ] **Step 2: 跑測試確認失敗**，Run: `pnpm vitest run src/looks`，Expected: FAIL。

- [ ] **Step 3: 實作三個檔案**。`mulberry32` 用標準實作。

- [ ] **Step 4: 跑測試確認通過**，Run: `pnpm vitest run src/looks`，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/looks && git commit -m "feat(looks): Painter interface, RecordingPainter, seeded prng"
```

---

### Task 5: 主題與畫布模型

**Files:**
- Create: `src/compose/types.ts`, `src/compose/themes.ts`, `src/looks/types.ts`
- Test: `src/compose/themes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // compose/types.ts
  export interface Theme { id: string; name: string; paper: string; ink: string; mute: string; line: string; accent: string; noteColors: string[]; glow: boolean }
  export interface Cell { kind: "cell"; id: string; lookId: string; params: Record<string, number | boolean> }
  export interface Split { kind: "split"; id: string; direction: "row" | "column"; ratio: number; a: LayoutNode; b: LayoutNode }
  export type LayoutNode = Cell | Split;        // 本里程碑只會出現 Cell
  export interface Composition { aspect: { w: number; h: number }; root: LayoutNode; themeId: string }
  // compose/themes.ts
  export const darkGlow: Theme; export const paperInk: Theme;
  export const themes: Record<string, Theme>;
  // looks/types.ts
  export interface ParamDef { key: string; label: string; min: number; max: number; default: number }
  export interface LookContext { t: number; w: number; h: number; readings: Readings; theme: Theme; params: Record<string, number | boolean>; seed: number; label?: string }
  export interface Look { id: string; number: number; name: string; listens: ("drums" | "tempo")[]; params: ParamDef[]; draw(p: Painter, ctx: LookContext): void }
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
test("both themes define 12 note colours and the spec'd core colours", () => {
  for (const th of [darkGlow, paperInk]) expect(th.noteColors).toHaveLength(12);
  expect(darkGlow).toMatchObject({ paper: "#0f0f0f", ink: "#efece4", accent: "#ff4a1c", glow: true });
  expect(paperInk).toMatchObject({ paper: "#f1ede4", ink: "#161616", accent: "#ff4a1c", glow: false });
  expect(themes[darkGlow.id]).toBe(darkGlow);
});
```

- [ ] **Step 2: 跑測試確認失敗**，Expected: FAIL。

- [ ] **Step 3: 實作**。`noteColors` 12 色依 C、C♯、D … B 順序。黑底用飽和但偏亮的色（例如 C `#ff6b4a`、E `#f3b23e`、G `#8dd3c7`、A `#4f7cff`，其餘由實作者在這個範圍內補齊）；紙感用同色相但降飽和、降明度的版本，確保在 `#f1ede4` 上看得清。

- [ ] **Step 4: 跑測試確認通過**，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/compose src/looks/types.ts && git commit -m "feat(compose): themes and composition model"
```

---

### Task 6: Hit 圓環 look

**Files:**
- Create: `src/looks/rings.ts`, `src/looks/registry.ts`
- Test: `src/looks/rings.test.ts`

**Interfaces:**
- Consumes: `Painter`、`RecordingPainter`、`Look`、`LookContext`、`Theme`、`Readings`、`mulberry32`。
- Produces: `export const ringsLook: Look`（`id: "rings"`, `number: 6`, `name: "Hit 圓環"`），`export const looks: Record<string, Look>`。

**Rings 的規格（從 Oto 的 Rings「每個 hit 在時間軸上落一個圓」改成格子版）：**

- 參數：`windowBars`（視窗涵蓋幾小節，min 1、max 8、default 2）、`fadeSeconds`（圓圈淡出秒數，min 0.5、max 4、default 1.5）。
- 背景 `theme.paper`。水平時間軸在 `y = h * 0.5`，顏色 `theme.line`，粗細 `h * 0.0015`。
- now 線在 `x = w * 0.62`，垂直，長 `h * 0.12`，顏色 `theme.ink`，粗細 `h * 0.002`。
- 時間 → x：`pxPerSec = w / (windowBars × 一小節秒數)`，一小節秒數用 `timeOfBar(bar+1) − timeOfBar(bar)`，bar 取 `positionAt(t).bar`。hit 的 `x = nowX − (t − hit.time) × pxPerSec`。只畫 `hit.time ≤ t` 且 `t − hit.time < fadeSeconds` 且 x 在 `[−w*0.1, w*1.1]` 內的 hit。
- 每個 hit 的 `age = t − hit.time`，`grow = 1 − exp(−age × 9)`，`alpha = 1 − age / fadeSeconds`。
- kick：實心圓，`d = h × (0.03 + 0.05 × velocity) × grow`，色 `theme.accent`，有 glow 時 `glow(theme.accent, h*0.02)`。
- snare：空心圓，`d = h × (0.04 + 0.06 × velocity) × grow`，stroke `theme.ink` 粗 `h*0.0025`。
- hat：短直線，從 `y = h*0.5 − h*0.03` 到 `y − h*0.02×grow`，stroke `theme.ink` 粗 `h*0.0015`。
- 小標：`ctx.label`（例如 `"06 RINGS"`）存在時在 `(w*0.03, h*0.04)` 用 mono、size `h*0.012`、色 `theme.mute` 畫出。
- 畫圖順序：background → 軸 → hits（由舊到新）→ now 線 → 小標。

- [ ] **Step 1: 寫失敗測試**

```ts
const readings = (hits: DrumHit[]): Readings => ({ duration: 60, tempo: buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header), drums: hits, roles: [] });
const ctx = (t: number, hits: DrumHit[], theme = darkGlow): LookContext => ({ t, w: 1080, h: 1920, readings: readings(hits), theme, params: {}, seed: 1, label: "06 RINGS" });

test("deterministic: same context gives identical ops", () => {
  const a = new RecordingPainter(), b = new RecordingPainter();
  ringsLook.draw(a, ctx(1.2, [{ time: 1, kind: "kick", velocity: 1 }]));
  ringsLook.draw(b, ctx(1.2, [{ time: 1, kind: "kick", velocity: 1 }]));
  expect(a.ops).toEqual(b.ops);
});
test("a kick at now is a filled accent circle at the now line", () => {
  const p = new RecordingPainter();
  ringsLook.draw(p, ctx(1, [{ time: 1, kind: "kick", velocity: 1 }]));
  const fills = p.ops.filter(o => o.op === "fill");
  expect(fills.some(o => o.args[0] === "#ff4a1c")).toBe(true);
  const circle = p.ops.find(o => o.op === "circle");
  expect(circle?.args[0]).toBeCloseTo(1080 * 0.62);
});
test("snare is stroked not filled; hat is a line", () => {
  const p = new RecordingPainter();
  ringsLook.draw(p, ctx(1.1, [{ time: 1, kind: "snare", velocity: 1 }, { time: 1.05, kind: "hat", velocity: 1 }]));
  expect(p.ops.filter(o => o.op === "circle")).toHaveLength(1);
  expect(p.ops.filter(o => o.op === "line").length).toBeGreaterThanOrEqual(2); // 軸 + hat
});
test("hits older than fadeSeconds and future hits are not drawn", () => {
  const p = new RecordingPainter();
  ringsLook.draw(p, ctx(10, [{ time: 1, kind: "kick", velocity: 1 }, { time: 20, kind: "kick", velocity: 1 }]));
  expect(p.ops.filter(o => o.op === "circle")).toHaveLength(0);
});
test("paper theme never calls glow; empty drums still draws axis and label", () => {
  const p = new RecordingPainter();
  ringsLook.draw(p, ctx(3, [], paperInk));
  expect(p.ops.some(o => o.op === "glow")).toBe(false);
  expect(p.ops.some(o => o.op === "text" && o.args[0] === "06 RINGS")).toBe(true);
});
```

- [ ] **Step 2: 跑測試確認失敗**，Run: `pnpm vitest run src/looks/rings.test.ts`，Expected: FAIL。

- [ ] **Step 3: 實作 `rings.ts` 與 `registry.ts`**。實作者依上面規格寫；`registry.ts` 只是 `{ rings: ringsLook }`。

- [ ] **Step 4: 跑測試確認通過**，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/looks && git commit -m "feat(looks): rings look"
```

---

### Task 7: P5Painter、Surface 與 renderFrame

**Files:**
- Create: `src/looks/painter/p5.ts`, `src/compose/surface.ts`, `src/compose/render.ts`
- Test: `src/compose/render.test.ts`

**Interfaces:**
- Consumes: Task 4 `Painter`，Task 5 模型，Task 6 `looks`。
- Produces:
  ```ts
  // compose/surface.ts
  export interface Surface { painter: Painter; image: CanvasImageSource | null; resize(w: number, h: number): void }
  export interface SurfaceProvider { get(cellId: string, w: number, h: number): Surface }
  export class RecordingSurfaceProvider implements SurfaceProvider { surfaces: Map<string, { painter: RecordingPainter; w: number; h: number }> }
  export class P5SurfaceProvider implements SurfaceProvider { constructor(p: p5) }   // 每個 cellId 一個 p5.Graphics，尺寸變才重建
  // compose/render.ts
  export interface CellRect { id: string; x: number; y: number; w: number; h: number }
  export function layoutCells(root: LayoutNode, w: number, h: number): CellRect[]   // Cell → 一個全幅 rect；Split 依 direction/ratio 遞迴
  export function renderFrame(opts: { composition: Composition; t: number; readings: Readings; surfaces: SurfaceProvider; target: { w: number; h: number; ctx?: CanvasRenderingContext2D } }): void
  // looks/painter/p5.ts
  export class P5Painter implements Painter { constructor(g: p5.Graphics, glowEnabled: boolean) }
  ```
- `renderFrame`：對每個 `CellRect` 取 surface（尺寸 = rect 尺寸）、組 `LookContext`（`label = \`${String(look.number).padStart(2,"0")} ${look.name 的 id 大寫}\``，`seed` = cellId 字串的 hash），叫 `look.draw`，有 `target.ctx` 時 `ctx.drawImage(surface.image, x, y, w, h)`。`params` 用 look 的 `ParamDef.default` 填補 cell 沒給的值。

- [ ] **Step 1: 寫失敗測試**

```ts
test("single cell fills the target and draws with the right size", () => {
  const surfaces = new RecordingSurfaceProvider();
  const composition: Composition = { aspect: { w: 9, h: 16 }, root: { kind: "cell", id: "c1", lookId: "rings", params: {} }, themeId: "darkGlow" };
  renderFrame({ composition, t: 0, readings, surfaces, target: { w: 540, h: 960 } });
  const s = surfaces.surfaces.get("c1")!;
  expect([s.w, s.h]).toEqual([540, 960]);
  expect(s.painter.ops[0]).toEqual({ op: "background", args: ["#0f0f0f"] });
});
test("layoutCells splits a row by ratio", () => {
  const root: LayoutNode = { kind: "split", id: "s", direction: "row", ratio: 0.25, a: { kind: "cell", id: "a", lookId: "rings", params: {} }, b: { kind: "cell", id: "b", lookId: "rings", params: {} } };
  expect(layoutCells(root, 1000, 100)).toEqual([{ id: "a", x: 0, y: 0, w: 250, h: 100 }, { id: "b", x: 250, y: 0, w: 750, h: 100 }]);
});
test("missing params fall back to ParamDef defaults (windowBars=2)", () => {
  // 120 bpm 一小節 2 秒，視窗 2 小節 = 4 秒，pxPerSec = 540/4 = 135
  // kick 在 1 秒，t = 1.5：x = 0.62*540 − 0.5*135 = 267.3
  const surfaces = new RecordingSurfaceProvider();
  const composition: Composition = { aspect: { w: 9, h: 16 }, root: { kind: "cell", id: "c1", lookId: "rings", params: {} }, themeId: "darkGlow" };
  const r: Readings = { ...readings, drums: [{ time: 1, kind: "kick", velocity: 1 }] };
  renderFrame({ composition, t: 1.5, readings: r, surfaces, target: { w: 540, h: 960 } });
  const circle = surfaces.surfaces.get("c1")!.painter.ops.find(o => o.op === "circle");
  expect(circle?.args[0]).toBeCloseTo(267.3, 1);
});
```

- [ ] **Step 2: 跑測試確認失敗**，Run: `pnpm vitest run src/compose`，Expected: FAIL。

- [ ] **Step 3: 實作 `P5Painter`**。對應關係：`fill` → `g.fill(color)` 加 alpha（用 `g.color()` 設 alpha）；`stroke` → `g.stroke` + `g.strokeWeight`；`glow` → 有啟用時設 `g.drawingContext.shadowBlur / shadowColor`，否則 no-op；`noGlow` → `shadowBlur = 0`；`text` → `g.textFont(font === "mono" ? "JetBrains Mono, ui-monospace, monospace" : "Inter, sans-serif")`、`g.textSize`、`g.textAlign`。字體檔案本里程碑先用系統 fallback，打包字體留到輸出計畫。

- [ ] **Step 4: 實作 `surface.ts` 與 `render.ts`**。`P5SurfaceProvider.get` 用 `p.createGraphics(w, h)`，`image` 回傳 `graphics.elt`（HTMLCanvasElement）。

- [ ] **Step 5: 跑測試確認通過**，Expected: PASS（P5 相關檔案不在 Node 測試裡 import，`render.test.ts` 只用 Recording 版）。

- [ ] **Step 6: Commit**

```bash
git add src/compose src/looks/painter/p5.ts && git commit -m "feat(compose): renderFrame, layout, p5 painter and surfaces"
```

---

### Task 8: 預覽迴圈與 App

**Files:**
- Create: `src/render/preview.ts`, `src/app/useProject.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/useProject.test.ts`

**Interfaces:**
- Consumes: Task 3 `analyzeMidi`，Task 7 `renderFrame`、`P5SurfaceProvider`，Task 5 `themes`。
- Produces:
  ```ts
  // render/preview.ts
  export interface Preview { setComposition(c: Composition): void; setReadings(r: Readings): void; play(): Promise<void>; pause(): void; seek(t: number): void; destroy(): void }
  export function createPreview(opts: { host: HTMLElement; audio: HTMLAudioElement; width: number }): Preview
  // app/useProject.ts
  export type LoadResult = { ok: true; readings: Readings; audioUrl: string; name: string } | { ok: false; reason: "need-midi" | "need-audio" | "parse-failed" }
  export async function loadDroppedFiles(files: File[], deps: { getDuration: (audio: File) => Promise<number>; createUrl?: (audio: File) => string }): Promise<LoadResult>
  // App 傳入的 getDuration 用 <audio> 的 loadedmetadata 讀 duration；createUrl 預設 URL.createObjectURL
  // 規則：找副檔名 mp3/wav/aiff/flac/m4a/ogg 的檔當音檔、.mid/.midi 當 MIDI；缺音檔 need-audio，缺 MIDI need-midi；duration 用 <audio> 的 loadedmetadata 取得後傳給 analyzeMidi。
  ```
- `createPreview`：在 `host` 裡建一個 `<canvas>`，寬 `width`、高 `width*16/9`；建立一個 instance mode 的 `p5`（`setup` 裡 `p.noCanvas(); p.noLoop();`）只拿來 `createGraphics`；`requestAnimationFrame` 迴圈：`t = audio.currentTime` → `renderFrame`。`pause()` 後再畫一幀讓畫面停在正確位置。`seek` 設 `audio.currentTime` 並立刻畫一幀。

- [ ] **Step 1: 寫失敗測試（loadDroppedFiles 的分流，不碰 DOM audio：把 duration 讀取抽成可注入的 `getDuration` 參數，測試注入 `async () => 30`）**

```ts
test("mp3 without mid → need-midi", async () => {
  const r = await loadDroppedFiles([new File([""], "song.mp3")], { getDuration: async () => 30 });
  expect(r).toEqual({ ok: false, reason: "need-midi" });
});
test("mid without audio → need-audio", async () => {
  const r = await loadDroppedFiles([new File([makeMidi({ tracks: [] })], "song.mid")], { getDuration: async () => 30 });
  expect(r).toEqual({ ok: false, reason: "need-audio" });
});
test("mp3 + mid → readings with duration from audio", async () => {
  const r = await loadDroppedFiles([new File([""], "song.mp3"), new File([makeMidi({ tracks: [] })], "song.mid")], { getDuration: async () => 30, createUrl: () => "blob:x" });
  expect(r).toMatchObject({ ok: true, name: "song", audioUrl: "blob:x" });
  if (r.ok) expect(r.readings.duration).toBe(30);
});
```

- [ ] **Step 2: 跑測試確認失敗**，Run: `pnpm vitest run src/app`，Expected: FAIL。

- [ ] **Step 3: 實作 `useProject.ts`（`loadDroppedFiles` 與一個 React hook `useProject()` 回傳 `{ state, drop(files), setTheme(id), play(), pause() }`）與 `preview.ts`。**

- [ ] **Step 4: 改 `App.tsx`**。畫面：整頁可拖放；左側一欄顯示歌名、BPM（`bpmAt(tempo, 0)`）、hit 數、三種錯誤訊息（「需要同名 .mid」「需要音檔」「解析失敗」）、主題切換（兩顆按鈕）、播放/暫停；右側放預覽（`width = 540`）。預設 composition：單一 cell、`lookId: "rings"`、`themeId: "darkGlow"`。

- [ ] **Step 5: 跑測試與型別檢查**，Run: `pnpm test && pnpm typecheck && pnpm lint`，Expected: 全過。

- [ ] **Step 6: 手動驗證**

Run: `pnpm dev`，在 Chrome 打開。把一首歌的 mp3 與同名 .mid 一起拖進去。
Expected：左側出現 BPM 與 hit 數；按播放後圓圈在 now 線上隨 kick/snare/hat 出現並向左流走；切主題立刻換色；暫停後畫面停住；只拖 mp3 時顯示「需要同名 .mid」。

- [ ] **Step 7: Commit**

```bash
git add src/app src/render && git commit -m "feat(app): drop files, preview loop, theme switch"
```

---

### Task 9: 對照驗收

**Files:**
- Create: `docs/superpowers/notes/2026-11-12-milestone-1-check.md`

- [ ] **Step 1: 用使用者的歌錄一段**。Chrome 開 `pnpm dev`，載入使用者提供的歌，黑底與紙感各截一張播放中的圖，存到 `docs/superpowers/notes/`。

- [ ] **Step 2: 跟 Oto 的 Rings 並排**。Oto 的範例在 `https://otoinstrument.shop/media/hd/looks/sheet-rings.webp` 與 `.mp4`。在 notes 檔裡寫下三點：對不對得準（kick 是否落在 now 線）、味道差在哪（線的粗細、發光強度、留白）、下一輪要改的參數。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes && git commit -m "docs: milestone 1 visual check against Oto rings"
```

---

## 自我檢查紀錄

- 規格覆蓋：本計畫只實作里程碑 1（規格 4.1 的 MIDI 主路徑中拍格與鼓、4.2 版式小標、4.3 的 look 6、4.5 主題、4.6 的預覽等於輸出）。4.3 其餘五個 look、4.4 拼版編輯器與 mp4、4.6 輸出、4.8 專案檔、4.1 的音訊備援與手動修正，各自另開計畫。`LayoutNode` 的 `Split` 型別與 `layoutCells` 先做，因為 renderFrame 的介面不想之後重改。
- 型別一致：`DrumHit`、`Readings`、`TempoMap`、`Painter`、`Look`、`LookContext`、`Composition`、`SurfaceProvider` 的名稱在各 task 相同。
- Review Focus 五條各有對應測試：1 → Task 3 與 Task 6 末題；2 → Task 3 roles 測試；3 → Task 2 第二題；4 → Task 8 第一題；5 → Task 6 第四題。
