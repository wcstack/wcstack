# 設計メモ: `@wcstack/audio`（`<wcs-audio>` ＋ 音声ノードタグ群）

- **状態**: ✅ 設計確定（2026-08-02）。前提となる [handle graph wiring ADR](./architecture-hardening/14-handle-graph-wiring.ja.md) は G1〜G6 すべて採択済み。実装計画は [audio-impl-plan.ja.md](./audio-impl-plan.ja.md)。
- **対象 WebAPI**: Web Audio API（`AudioContext`、`OscillatorNode` / `BiquadFilterNode` / `GainNode` / `DelayNode` / `WaveShaperNode` / `ConstantSourceNode` / `AudioBufferSourceNode` / `AnalyserNode` / `DynamicsCompressorNode`、`AudioParam` のスケジューリング API）。
- **位置づけ**: **ライブハンドルの有向グラフを内部に持つ初の I/O ノード**。camera が「生ハンドル1本」で開いた地平の続きだが、ADR G2 の推奨どおりハンドルを一切公開しないため、**プロトコル境界から見れば worker / websocket / broadcast と同じ「内部に非シリアライズ資源を持つが値しか出さないノード」**になる。
- **原型**: [examples/synth-playground/wcs-synth.js](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js)（1063行・Playwright スモーク 14/14。パッケージ化に伴い `cbd5598e` で削除済みのため、以降の行リンクはすべて削除前の commit を指す）。挙動の正しさは実証済みで、本設計はそれを wcstack の骨格に載せ替える作業を規定する。
- **前提資産**: camera（生ハンドルを state に入れない不変条件）、worker / websocket / broadcast（handle 非公開・Core が所有し破棄）、resize（構造変更は teardown → 再構築・冪等な `observe()`）、wakelock（desired / actual 二相）、raf（外部クロックと描画反映の遅延契約）、sensor 族（connect では何も始まらない）。

---

## 0. スコープ — 何を入れて何を入れないか【ADR G6 の帰結】

synth-playground の 14 タグのうち、パッケージに入れるのは **11 タグ**。

| 入れる | 理由 |
|---|---|
| `<wcs-audio>`（root・旧 `<wcs-synth>`）、`<wcs-voice>` | グラフのライフサイクルとポリフォニーの所有者 |
| `<wcs-osc>` `<wcs-noise>` `<wcs-biquad>` `<wcs-gain>` `<wcs-delay>` `<wcs-shaper>` `<wcs-env>` `<wcs-lfo>` | Web Audio ノードの宣言的ラッパー |
| `<wcs-analyser>` | `AnalyserNode` の**データだけ**出す。描画はしない |

| 入れない | 理由 |
|---|---|
| `<wcs-keys>`（鍵盤 UI） | 見た目を持つ。**I/O ノード族は描画を持たない**（ADR G6）。example に残す |
| `<wcs-scope>`（canvas 描画） | 同上。`<wcs-analyser>` ＋ `<wcs-raf>` ＋ 利用者の canvas に分解する |
| `<wcs-midi>` | Web MIDI は独立した Web 標準 API。[`@wcstack/midi`](./midi-tag-design.md) として先行昇格 |

- **✅ 決定 0-1: `<wcs-mixer>` を落とす**。原型では `<wcs-gain>` の意味論的エイリアス（挙動は完全に同一）だった。**グローバルなタグ名を1つ恒久占有して挙動ゼロ**なので、`<wcs-gain id="bus">` に統一することを推奨。
- **v1 に入れないが将来候補**: `<wcs-pan>`（`StereoPannerNode`）、`<wcs-compressor>`、`<wcs-convolver>`、`<wcs-sampler>`（`decodeAudioData`）、`<wcs-sequencer>`。

---

## 1. Core / Shell 境界 — descriptor tree がパッチの正本【ADR G1 案D の具体化】

ガイドライン §3.1 は **「Core は DOM 要素に依存してはならない（MUST NOT）」** と規範化している。DOM を歩くグラフコンパイラをそのまま Core に置くと即座に違反する。そこで **DOM とグラフの間に plain object のパッチ記述を挟む**。

```ts
// Core が受け取る唯一の入力。DOM を知らない。
export type PatchNode = {
  kind: "osc" | "noise" | "biquad" | "gain" | "delay" | "shaper" | "env" | "lfo" | "analyser";
  key: string;                       // 安定キー（Shell が採番・setParam の宛先）
  id?: string;                       // out=/param= の参照名
  params?: Record<string, number>;   // frequency, q, gain, ...（AudioParam）
  props?: Record<string, string>;    // type, mix, ...（AudioParam でない設定）
  out?: string[];                    // ["bus"] / ["vcf.frequency"]
  param?: string;                    // modulator が駆動する親の AudioParam 名
  note?: boolean;                    // ノート番号に追従するか
  children?: PatchNode[];            // 入れ子＝信号チェーン
};
export type Patch = {
  nodes: PatchNode[];
  voices: { key: string; poly: number; nodes: PatchNode[] }[];
};
```

| 層 | 責務 | DOM 依存 |
|---|---|---|
| `AudioGraphCore`（`EventTarget`） | `Patch` → `AudioNode` グラフの構築 / 破棄、`setParam`、ノート割り当て、ボイス生成、`AudioContext` ライフサイクル | **なし** |
| `<wcs-audio>` Shell | DOM サブツリーを歩いて `Patch` を作り `core.setPatch(patch)` に渡す。属性 → 入力 property、CustomStateSet 反映 | あり |
| ノードタグ Shell（`<wcs-osc>` 等） | **descriptor のみ**。自分の `key` だけを保持し、数値属性の変更を `core.setParam(key, name, value)` に転送する | あり |

**ノードタグの Shell は `AudioNode` を一切保持しない。** これが ADR G2（ハンドル非公開）を構造として担保する箇所である。

### 1.1 Core の公開 API（ヘッドレスサーフェス・ガイドライン §3.9）

```ts
class AudioGraphCore extends EventTarget {
  constructor(target?: EventTarget);
  readonly ready: Promise<void>;                 // SSR / unsupported 判定用
  setPatch(patch: Patch): void;                  // 構造変更 → rebuild（可聴な断絶を伴う）
  setParam(key: string, name: string, v: number): void;   // live 更新 → rebuild しない
  setProp(key: string, name: string, v: string): void;    // 同上（type 等）
  sample(key: string, mode: "wave" | "fft"): Uint8Array | null;  // analyser 読み出し（fresh 配列）
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
  resume(): Promise<void>; suspend(): Promise<void>;
  dispose(): void;
}
```

パッチをデータとして直接組める＝**DOM を使わずに Core だけで音を出せる**。これが「Core は公開ヘッドレスサーフェス」を audio でも成立させる。

---

## 2. 配線モデル（原型を踏襲・[README](../examples/synth-playground/README.md) §Wiring model）

1. **入れ子＝信号チェーン**。親の出力が入れ子の子へ流れる。チェーン子を持たず `out=` も無い葉はマスターへ。
2. **入れ子で表せないものは id 参照**。`out="bus"`（オーディオ送出・多対一）、`out="vcf.frequency"`（任意の `AudioParam` を駆動）、`param="frequency"`（modulator が**親**の param を駆動する短縮形）。

### 2.1 id 解決は `getRootNode()` 起点【必須の是正】
原型は `document.getElementById` / `this.querySelector("#id")` を使っており（[wcs-synth.js:650](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L650)、[:827](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L827)）、Shadow DOM 内で解決できない。**fullscreen / pointer-lock / intersection / resize が統一している `getRootNode() as Document | ShadowRoot` 規約**（[Fullscreen.ts:152](../packages/fullscreen/src/components/Fullscreen.ts#L152)）に揃える。加えて解決範囲は `<wcs-audio>` サブツリー内に限定する（別のパッチの id を誤って掴まない）。

### 2.2 `out` の属性名【✅ 据え置き】
`out` は一般名詞として弱い。将来 ADR G3 の「2例目」が出たときの横断抽出を考えると `audio-out` / `to` などの選択肢がある。**推奨: `out` 据え置き**（パッチ記法としての可読性を優先。ADR G3 で「パッケージローカル語彙」と位置づけたので衝突しない）。

---

## 3. wcBindable サーフェス

### 3.1 `<wcs-audio>`（root）

```ts
properties: [
  { name: "state",     event: "wcs-audio:statechange", semantics: "state" },  // suspended|running|closed|unsupported
  { name: "running",   event: "wcs-audio:statechange", semantics: "state" },  // 派生 getter
  { name: "voices",    event: "wcs-audio:voices",      semantics: "state" },  // 発音中ボイス数
  { name: "noteOn",    event: "wcs-audio:noteon",      semantics: "event" },
  { name: "noteOff",   event: "wcs-audio:noteoff",     semantics: "event" },
  { name: "error",     event: "wcs-audio:error",       semantics: "state" },
  { name: "errorInfo", event: "wcs-audio:error",       semantics: "state" },
],
inputs:   [{ name: "volume", attribute: "volume" }, { name: "limiter", attribute: "limiter" }],
commands: [{ name: "resume", async: true }, { name: "suspend", async: true },
           { name: "noteOn" }, { name: "noteOff" }, { name: "allNotesOff" }],
```

- `noteOn(note, velocity)` は **位置引数素通し**（[command-token 引数転送](./spec-proposal-command-token-arguments.md) の MUST）。`await` しない。
- **`AudioNode` は1つも properties に出さない**（ADR G2）。`handle` 分類は 0 のまま。
- **CustomStateSet**: `:state(running)` / `:state(suspended)` / `:state(unsupported)` / `:state(error)`。

### 3.2 ノードタグ（`<wcs-osc>` 等）

- **`properties: []`（観測面を持たない純 sink）**。wakelock が「全タグ初の純 sink」だったのに対し、こちらは observable すら持たない完全な入力専用ノードになる。
- `inputs` に数値パラメータを宣言する。`data-wcs="frequency: cutoff"` は `element.frequency = v` の property 代入として届き、Shell が `core.setParam(key, ...)` に転送する。
- 例外は `<wcs-analyser>`: `command.sample` ＋ `wcs-analyser:frame`（`semantics: "event"`）を持つ（§7）。

### 3.3 配線例

```html
<wcs-audio volume="0.7" data-wcs="command.noteOn: $command.play; voices: activeVoices">
  <wcs-voice poly="8">
    <wcs-osc type="sawtooth" note out="vcf"></wcs-osc>
    <wcs-biquad id="vcf" data-wcs="frequency: cutoff; q: reso">
      <wcs-lfo rate="4" depth="0" param="frequency" data-wcs="depth: lfoDepth"></wcs-lfo>
      <wcs-env attack="0.01" release="0.35" out="bus"></wcs-env>
    </wcs-biquad>
  </wcs-voice>
  <wcs-gain id="bus" gain="0.8">
    <wcs-delay time="0.28" feedback="0.35" mix="0.2"></wcs-delay>
  </wcs-gain>
</wcs-audio>
```

**構造は宣言、値は反応** — この一文がパッケージの説明そのものになる。

---

## 4. `AudioContext` の所有と共有

- ブラウザは同時 `AudioContext` 数を制限するため、**ページ内の全 `<wcs-audio>` が1つの context を共有**する（原型と同じ）。各ルートは自分の master gain ＋ limiter を持つ。
- 原型はクラス static で共有しており、**CDN で版が混在すると context が2つできる**（signals の「`.`/`.dom` 混在で reactive core が二重化」と同型の問題）。
- **推奨**: `config.ts` に context provider を置き `getConfig()` / `setConfig()` で差し替え可能にする（既存 config 規約）。既定実装は `globalThis[Symbol.for("@wcstack/audio.context")]` を経由した遅延生成 singleton とし、**版跨ぎでも1つに収束させる**。
- **limiter**: `DynamicsCompressorNode` を耳保護として既定 on（原型どおり）。`limiter="off"` で外せる。
- **ユーザージェスチャ**: 原型は `document` に capture リスナを張る（[wcs-synth.js:558-564](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L558-L564)）。パッケージがグローバル副作用を勝手に持つのは行儀が悪い。**✅ 決定 4-1: `resume-on-gesture` 属性で制御し、既定 on**（原型と同じ体験を保つ）。`resume-on-gesture="off"` を指定した場合はリスナを一切張らず、`command.resume` を利用者が撃つ。リスナはルート要素が接続されている間だけ張り、`disconnectedCallback` で必ず外す（グローバル副作用を残さない）。
- **グローバル CSS 注入の是正**: 原型は `document.head` に `<style>` を挿入する（[wcs-synth.js:1050-1054](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L1050-L1054)）。`document.head` を触るパッケージは `<wcs-head>` だけという規範に反する。**`getRootNode().adoptedStyleSheets` に一度だけ `CSSStyleSheet` を追加**する形に改める（Shadow DOM 内でも効く）。

---

## 5. グラフ再構築の契約【ADR G5】

| 変更の種類 | 反応 |
|---|---|
| 数値属性 / property（`frequency` `gain` `attack` …） | **live 更新**。rebuild しない。発音中のボイスも含め全インスタンスに適用 |
| 構造属性（`out` `param` `note` `poly` `id`） | **rebuild** |
| audio タグの追加 / 削除 / 移動 | **rebuild** |
| それ以外の DOM 変更 | **何もしない（MUST NOT rebuild）** |

- **原型の欠陥**: `MutationObserver` を `subtree: true` で無差別に張っているため（[wcs-synth.js:538-539](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L538-L539)）、コントロール用の `<div>` を1個足しただけでグラフ全体が再構築され**発音中の音が切れる**。パッケージ化では変異を audio タグ関連に絞り込むフィルタが必須。
- **rebuild は可聴な断絶を伴う**（発音中のボイスを落とす）。README と契約に明記する。
- **coalesce は microtask**。原型は `setTimeout(0)`（[wcs-synth.js:596](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L596)）で、[横断契約 §3](./timing-and-firing-contract.ja.md)「microtask が task に先行する」に未追随。
- `setPatch()` は **冪等**（同一 patch を渡しても rebuild しない）。resize §12.3 と同型。patch の同値判定は構造ハッシュで行う。

---

## 6. `<wcs-voice>` — ポリフォニー

- `<wcs-voice poly="N">` はサブツリーを**パッチテンプレート**として扱い、ノートごとに独立したグラフを生成する。voice の外は live / モノフォニック（last-note priority ＋ legato ＋ `glide`）。
- ボイスから出る音（既定出力と `out=` 送出の両方）は **per-voice gain に集約**し、ノートスティール時にボイス全体をフェードできるようにする（原型どおり）。
- ゲート（`<wcs-env>`）を持たないパッチには **暗黙の安全エンベロープ**（5ms / 80ms）を与え、無限に鳴り続けないようにする。
- **✅ 決定 6-1: ボイス回収を `setTimeout` から audio クロック基準に変える**。原型は `setTimeout(release * 3 + 0.3)` で回収する（[wcs-synth.js:499](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L499)）が、**バックグラウンドタブではタイマーが 1 分間隔まで絞られる一方オーディオは鳴り続ける**ため、ボイスが回収されず蓄積する。推奨: 解放済みボイスに `freeAt = ctx.currentTime + release` を持たせ、**ノートイベントごと＋ `statechange` ごとに遅延スイープ**する（タイマーはフォールバックとしてのみ併用）。

---

## 7. `<wcs-analyser>` と producer snapshot contract

`AnalyserNode` は「外部クロックで動き続けるデータ源」であり、wcstack では **raf 族と組み合わせて pull する**形に分解する。

```html
<wcs-raf data-wcs="eventToken.tick: onTick"></wcs-raf>
<wcs-analyser id="scope" data-wcs="command.sample: $command.grab; eventToken.frame: onFrame"></wcs-analyser>
```

- `command.sample` → Core が読み出し → `wcs-analyser:frame`（`semantics: "event"`）で publish。**command-token / event-token だけでフレームループが閉じる**。
- **✅ 決定 7-1: バッファは再利用しない**。[producer snapshot contract](./architecture-hardening/11-react-immutable-snapshot-boundary.md) は「公開後に producer が変更しない」を MUST とするため、**フレームごとに新しい `Uint8Array` を割り当てる**のが規範に沿う（2048 byte × 60fps ≒ 120KB/s の allocation）。再利用バッファを使うと `handle` 相当になり ADR G2 の「handle 0」が崩れる。**推奨: 常に fresh 配列**。性能が問題になった実測が出てから再検討する。
- **描画は行わない**（ADR G6）。canvas 描画は example が担う。
- 原型は analyser の後段に gain 0 のノードを置き `ctx.destination` へ流している（[wcs-synth.js:385](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L385)）。これは **Chromium が suspended 中に張った sink-only な AnalyserNode へのエッジを黙って落とす**問題への対策であり、実ブラウザ検証で得られた知見なので**そのまま維持する**。
  - **この keep-alive は `destination` へ繋ぐ必要がある**。master へ戻すとフィードバックループになる。gain が 0 なので信号は流れず、**リミッターを迂回する経路にはならない**（Phase B の PoC でエッジ集合を実測して確認した）。
  - analyser の信号入力側は master タップ（`master.connect(analyser)`）であり、こちらは元からリミッター前の正しい位置にある。
  - `statechange` での再接続（`rekickTaps`）も維持する。

---

## 8. 適用時刻の契約【ADR G4】

> 入力プロパティへの書き込みは同期に受理され、getter は直ちに新しい値を返す（desired）。**その値が可聴になる時刻は `AudioContext` のレンダークォンタム境界と出力レイテンシに依存し、本契約では規定しない**。実効値（actual）は公開しない。

- 同値ガードは **desired 値**で行う（`param.value` を読み戻さない）。
- パラメータ更新は `setTargetAtTime(v, ctx.currentTime, 0.02)` で平滑化する（クリック音の防止）。**この平滑化定数はパッケージの契約の一部**として README に書く。
- raf §18.4「描画反映はちょうど 1 フレーム遅延」と同族だが、audio の遅延はハードウェア依存で固定値にできない点が異なる。

---

## 9. タグ名の占有【✅ 短名維持 ＋ `<wcs-biquad>` 改名】

11 個のグローバルなカスタム要素名を恒久的に占有する。

| 案 | 例 | 評価 |
|---|---|---|
| **A. 短名（原型どおり）** | `<wcs-osc>` `<wcs-gain>` `<wcs-env>` | パッチとして読みやすい。音楽の文脈では曖昧さが無い |
| B. 全て接頭辞つき | `<wcs-audio-osc>` `<wcs-audio-gain>` | 衝突しないが冗長でパッチが読みにくい |

- **推奨: A（短名）＋ 1つだけ改名**。`<wcs-filter>` → **`<wcs-biquad>`**。理由: `filter` は `@wcstack/state` のフィルタパイプライン（`|filter(args)`）と語が衝突し、ドキュメント上の誤解を生む。`BiquadFilterNode` に忠実な名前でもある。
- `<wcs-mixer>` は §0-1 のとおり落とす（挙動ゼロのエイリアスに名前を使わない）。

---

## 10. 罠（README Notes 行き）

- **`AudioContext` はユーザージェスチャ後でないと `running` にならない**。suspended のまま `noteOn` しても無音（never-throw で `state` に出す）。
- **構造変更は音を切る**（§5）。
- **ボイス回収とバックグラウンドタブ**（§6-1）。
- **Chromium は suspended 中に張った sink-only な AnalyserNode へのエッジを落とす**（§7・実ブラウザ検証で判明）。
- **同時 `AudioContext` 数の上限**。複数版が同居すると context が分裂しうる（§4）。
- **`glide` / `detune` / `transpose` の単位**（秒 / セント / 半音）。
- **`<wcs-env>` は文脈で役割が変わる**（チェーン上なら VCA、`param=` 付きなら param エンベロープ）。
- **SSR**: サーバーには `AudioContext` が無い → `unsupported`。ノードタグは何も描画しない（`display: contents`）ので SSR 出力は空。

---

## 11. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| ADR G1 トポロジの正本 | ✅ descriptor tree（`Patch`）。DOM はオーサリング面 |
| ADR G2 ハンドル公開 | ✅ **公開しない**（`AudioNode` は Core が所有・破棄） |
| §0 スコープ | ✅ 11 タグ。keys / scope / midi / mixer は外す |
| §0-1 `<wcs-mixer>` | ✅ **落とす**（`<wcs-gain id="bus">` に統一） |
| §1 Core/Shell | ✅ `AudioGraphCore` は DOM 非依存。ノードタグは descriptor のみ |
| §2.1 id 解決 | ✅ `getRootNode()` 起点 ＋ ルートサブツリー限定 |
| §2.2 `out` の名前 | ✅ 据え置き |
| §3.2 ノードタグ | ✅ `properties: []` の完全な入力専用ノード |
| §4 context 共有 | ✅ config 差し替え可能な `Symbol.for` singleton。**`BaseAudioContext` を注入可能にする**（`OfflineAudioContext` でのレンダリング検証に使う） |
| §4-1 `resume-on-gesture` | ✅ オプトイン属性化・**既定 on**（原型と同じ体験。`resume-on-gesture="off"` で外す） |
| §5 rebuild 契約 | ✅ 誘発条件を列挙・可聴断絶を明記・microtask coalesce・冪等 |
| §6-1 ボイス回収 | ✅ audio クロック基準の遅延スイープ |
| §7-1 analyser バッファ | ✅ 常に fresh 配列（handle 化しない） |
| §8 適用時刻 | ✅ desired のみ公開・可聴時刻は規定しない |
| §9 タグ名 | ✅ 短名維持 ＋ `<wcs-filter>` → `<wcs-biquad>` |

> §0-1 と §9 はリリース後に変更できない一方通行の決定であり、推奨どおり確定させた（2026-08-02）。

---

## 12. 実装計画

→ [audio-impl-plan.ja.md](./audio-impl-plan.ja.md)
