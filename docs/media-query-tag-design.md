# 設計メモ: `@wcstack/media-query`（`<wcs-media-query>`）

- **状態**: 実装済み。本文書は実装時の論点整理と決定事項のスナップショットであり、設計意図の参照用に保持している。
- **対象 WebAPI**: CSSOM View `window.matchMedia()`（`MediaQueryList` の `matches` / `media` と `change` イベント）
- **位置づけ**: [network-tag-design.md](./network-tag-design.md) と同じ「最小 monitor パターン」の一員。network との差は**入力を 1 つ持つ**（`query`）ことと、その入力が接続中に変わったとき購読を張り替えることの 2 点だけ。
- **前提資産**: `network`（単一イベント→派生 getter・呼び出し時 API 解決・スナップショット同値ガード）、`raf`（`matchMedia` の注入パターン — happy-dom の `MediaQueryList` change 配送が当てにならないため、テストが preference とその変化を直接制御する。[a11y-design.md](./a11y-design.md) §6-3）、`view-transition`（never-throw な `matchMedia` ガード）。

---

## 0. 存在意義

CSS だけで済むこと（`@media` でスタイルを切り替える）はこのノードの仕事ではない。**メディアクエリの真偽を state に載せ、JS 側のロジックや `data-wcs` の条件分岐に流し込む**のが目的:

- `(prefers-color-scheme: dark)` → テーマ既定値、`<img>` の `src` 切り替え、チャート配色
- `(prefers-reduced-motion: reduce)` → `<wcs-raf>` / `<wcs-timer>` の停止、`<wcs-view-transition>` 以外のアニメーション制御
- `(max-width: 600px)` → リスト/テーブル切り替え、ナビゲーションの折り畳みなどレイアウト構造そのものの分岐
- `(display-mode: standalone)` → PWA としてインストール済みかの判定

手書きなら `matchMedia(q)` → `addEventListener("change")` → 初期値の同期 → 解除、の 4 手が要る。この定型を 1 タグに畳み、他ノードと同じ「学べば全部使える」骨格に乗せる。

---

## 1. 3 ゲート判定（[io-node-candidate-screening.md](./io-node-candidate-screening.md) §1）

| ゲート | 判定 | 根拠 |
|---|---|---|
| Gate 1 — Core が DOM 非依存で書けるか | ✅ | `globalThis.matchMedia` だけで完結。要素参照は不要 |
| Gate 2 — 「1 イベント＋派生 getter」に分解できるか | ✅ | `wcs-media-query:change` に `{ matched, media, supported }` を載せ、3 プロパティを getter で切り出す |
| Gate 3 — never-throw / `_gen` / 冪等 `observe()` に収まるか | ✅ | 購読は同期。query 差し替えが「途中終了・再開」に相当し、`_gen` で古いリストの `change` を遮断できる |

observable surface は「boolean 1 つ＋文字列 2 つ」で薄いが、状態を**持つ** monitor であり、command 専用の一発ノード（§4 境界ケース）ではない。スクリーニング表には未掲載だったが、Network Information（グループ A）と同じ「素直に通る」区分に入る。

---

## 2. 公開する state — **決定: `matched` / `media` / `supported` の 3 つ**

| プロパティ | 型 | 意味 |
|---|---|---|
| `matched` | boolean | `MediaQueryList.matches`。リストが無い状態（非対応・空 query・`matchMedia` の throw）では `false` |
| `media` | string | `MediaQueryList.media`（ブラウザが正規化した文字列。不正な query は `"not all"`）。リストが無ければ `""` |
| `supported` | boolean | `typeof matchMedia === "function"`。**毎回の `observe()` で解決**し、コンストラクタでキャッシュしない（§3.7） |

### 2.1 なぜ `matches` ではなく `matched` か

プラットフォームの名前は `matches` だが、**`Element.prototype.matches(selector)` が全要素に既に存在する**。Shell に boolean の `matches` を生やすと、イベント委譲・`closest` 系ユーティリティ・テストツールが呼ぶ `el.matches(".x")` が壊れる（TypeScript も `TS2416` で拒否する）。wc-bindable のプロパティ名は Core と Shell で同一でなければならないので、Core 側も含めて **`matched`** に統一する。`media` / `supported` / `query` に同種の衝突は無い。

---

## 3. 単一イベント構造 — **決定: 3 フィールドを 1 つの `change` にまとめる**

network と同型。ネイティブの `change` は `matches` が反転したときだけ発火するが、query の差し替えでは `media` も同時に変わるため、スナップショット全体を 1 イベントに載せる方が消費側の整合性が保てる。

---

## 4. 同値ガード — **決定: スナップショット 3 フィールドの浅い比較**

- 同じ query への `observe()` 二重呼び出し → 冪等（購読もイベントも増えない）
- 等価だが文字列の異なる query（`(max-width:600px)` と `(max-width: 600px)`）→ ブラウザが `media` を正規化するため同値ガードに吸収される
- 旧 Safari の `addListener` が二重発火しても再 dispatch しない

---

## 5. リスナー API のフォールバック — **決定: 3 段**

1. `addEventListener("change")` / `removeEventListener` — 現行エンジン全部
2. `addListener` / `removeListener` — Safari 13 以前の非推奨ペア
3. どちらも無い → 購読せず、`observe()` 時点のスナップショットだけ（静的 polyfill 想定）

1 と 2 の判定は**追加・解除のペアが揃っているか**で行う。`addEventListener` だけあって `removeEventListener` が無い半端な実装で 1 を選ぶと解除できないため。

---

## 6. `_gen` 世代ガード — **決定: 持つ**（network との差異）

購読自体は同期なので「非同期 probe の古い解決」は存在しないが、このノードには **query の差し替え**がある。旧リストの `removeEventListener` が効かない実装（leaky）や、解除が throw する実装では、旧リストの `change` が新 query の `matched` を上書きしうる。各購読の `change` リスナーは生成時の世代を閉包で捕捉し、`_teardown()`（差し替え・`dispose()`）で世代を進めることでこれを遮断する。同期 API に `_gen` を持たせる正当性はここにある。

---

## 7. Shell の入力 — **決定: `query` 属性 1 つ、接続中の変更で張り替え**

- `inputs: [{ name: "query", attribute: "query" }]`、`observedAttributes = ["query"]`
- `attributeChangedCallback` は接続中のみ `core.observe(newValue ?? "")`。**属性除去も「何も監視しない」への変更として扱い、`matched` を `false` に落とす**（sse/broadcast が falsy を無視するのと異なる。あちらは「既存接続を生かす」が正解だが、ここでは古い query の真偽が残る方が嘘になる）
- パーサ経由の要素は `attributeChangedCallback` → `connectedCallback` の順で両方 `observe()` を呼ぶが、同一 query なので冪等に吸収される
- `connectedCallback` 冒頭で `upgradeProperties(this)`（§4.1.1）

---

## 8. `:state()` 反映

| ステート | on になる条件 |
|---|---|
| `matched` | `wcs-media-query:change` が `matched === true` で発火 |
| `supported` | 同 `supported === true` |

`media` は文字列なので反映しない。ステート名はプロパティ名の kebab-case（network の `supported` と同じ命名）。非対応判定は `:not(:state(supported))` で書く。

---

## 9. 決定事項と不採用案

| 論点 | 決定 | 不採用案と理由 |
|---|---|---|
| 出力名 | `matched` | `matches` — `Element.prototype.matches()` と衝突（§2.1） |
| 空 query | `matched=false / media="" / supported=true`、`matchMedia` を呼ばない | `matchMedia("")` を呼ぶ — 空リストは「全てにマッチ」なので `true` が返り、誤解を生む |
| `matchMedia` の throw | 空 query と同じ「リスト無し」扱い、`supported` は据え置き | `supported=false` にする — API は存在するので嘘になる |
| 属性除去 | 監視停止・`matched=false` | 無視して旧購読を生かす（sse 型）— 古い真偽が残るのは monitor として不誠実 |
| 複数 query | 1 タグ 1 query | `queries` 配列 — 「1 イベント＋派生 getter」から外れ、`:state()` 反映も崩れる。複数はタグを並べる |
| コマンド | 無し（純粋 monitor） | — |
| secure-context | 制約なし | — |

---

## 10. テスト方針（happy-dom）

happy-dom は `window.matchMedia` を持つが `change` の配送が制御できないため、`FakeMatchMedia` / `FakeMediaQueryList` を用意し、Core には注入、Shell には `globalThis.matchMedia` へ install/remove/restore で差し替える。

- 呼び出し時解決（不在→後から出現で `supported` が反転、`this` が `globalThis` に保たれる）
- 空 query・throw する `matchMedia`・throw する `removeEventListener`（never-throw）
- 同値ガード（同一 change 連続・`media` 単独変化・非文字列 `media` の正規化）
- query 差し替え（旧リスト解除・leaky な旧リストの `change` が世代ガードで遮断される・dispose 後の遅延 change）
- リスナー API 3 段（modern / legacy / mixed / static）
- Shell: 属性変更・属性除去・接続前の属性変更・切断→再接続・property upgrade・bubbles・SSR
- `:state()` 反映一式（network の customStates.test.ts と同型）

カバレッジ閾値は 100 / 100 / 100 / 100（network と同じ）。
