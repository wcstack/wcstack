# signals とカスタム要素の定義タイミング — 制約・イディオム・`mountNode` (Definition Timing & Node Mounting)

- **対象**: `@wcstack/signals` でヘッドレス I/O ノードを束縛するアプリの作者、および signals のアダプタ層（`bindNode` / `mountNode`）に触れる実装者・レビュアー
- **状態**: 記述的（informative）＋ `mountNode` の実装記録（§5 は as-built）。プロトコル（wc-bindable / command-token / event-token）には一切手を入れない
- **なぜ存在するか**: `bindNode` は「呼んだ瞬間にクラスが登録済みであること」を前提とする同期 API であり、この前提はドキュメント上レシピの1行（`await whenDefined`）に暗黙に埋まっているだけだった。examples の実装（signals-tilt-maze）で「センサーパッケージのロード失敗時に部分縮退できない」形で顕在化したため、(1) 制約の構造的な理由、(2) ロード状況ごとの正しいイディオム、(3) それを標準形にする `mountNode` ヘルパの設計、(4) 背後にあるプラットフォームの縫い目、を一箇所に規範化する
- **関連**: [signals-state-design.md](./signals-state-design.md)（bindNode の設計原点 §3）、[defined-tag-design.md](./defined-tag-design.md)（`<wcs-defined>` = whenDefined の失敗セマンティクス補完）、`packages/signals/README.md`（mountNode の利用者向け正本）
- **日付**: 2026-07-28

---

## 0. TL;DR — ロード状況 → イディオムの決定表

| ロード状況 | イディオム | ロード失敗時の挙動 |
|---|---|---|
| アプリが**必須**ノードを自分でロードする | `import "@wcstack/<pkg>/auto"`（副作用 import）+ `mountNode(tag)` | モジュールグラフごと評価失敗 = **うるさく死ぬ**（正しい） |
| アプリが**オプショナル**ノードを自分でロードする | `import("@wcstack/<pkg>/auto").then(() => mountNode(tag)).catch(縮退)` | `import()` が **reject** = パッケージ単位の失敗境界 |
| **自分がロードしないタグ**に束縛する（autoloader 経由・state と混在するページ・第三者のスクリプト） | `await customElements.whenDefined(tag)` の後に `bindNode(el)`、または `<wcs-defined>` でゲート | whenDefined は**永久保留**（reject しない）— UX が必要なら `<wcs-defined>` の timeout で `missing` 化 |
| 純ロジックノードを **JS だけ**で使う（要素・`:state()`・state 併用が不要） | **Core 直接**: `import { XxxCore }` + `bindNode(new XxxCore())`（§3.4） | import の失敗規則そのまま（static = 評価失敗・dynamic = reject）。**レジストリ非関与 = 定義タイミング問題が存在しない** |

決定表の含意: `whenDefined` は「第一推奨」ではなく「自分がロードしないタグ専用の最後の手段」。アプリがノードを所有するなら、順序保証は実行時の協調ではなく **module graph（ES モジュールの評価順保証）** に載せる。さらに要素そのものが不要なら、Core 直接利用（§3.4 の床3）で定義タイミング問題は消滅する。

---

## 1. 制約の構造 — なぜ `bindNode` は定義前に呼べないか

`bindNode(el)` は同期 API であり、呼んだその場でアダプタ（`signals.*` / `set` / `command` / …）を返す契約を持つ。descriptor は `el.constructor.wcBindable` から読む（`packages/signals/src/bindNode.ts` の入口）ため、**呼び出し時点で custom element クラスが登録済み（要素が upgrade 済み）であることが前提条件**になる。upgrade 前の要素の `constructor` は素の `HTMLElement` で descriptor を持たず、汎用エラー（"no wc-bindable descriptor"）で throw する。

これは `@wcstack/state` の `data-wcs` との本質的な非対称である:

- **宣言的レイヤ（state）は待てる** — バインディングは属性というデータであり、解釈するランタイムが upgrade まで配線を遅延できる（command-token の購読はタグ定義まで deferred）。
- **命令的 API（signals）は待てない** — 値を今すぐ返す同期 API は descriptor を今すぐ必要とする。

したがってこの制約は signals で I/O ノードを**要素として**使う限りどの場面でも付いてくる（要素を作らない Core 直接利用 = §3.4 の床3は、この制約の外にある正規の脱出口）。`nodeSource` は第1引数に**構築済みの** `BoundNode` を要求する（内部で `bindNode` を呼ぶのではない）ため、同じ制約を上流の `bindNode` 呼び出しから継承する。`bindNode(el, descriptor)` に手書き descriptor を渡せば定義前束縛も理論上可能だが、プロトコル宣言の複製になるため標準イディオムとしては採らない（非カスタム要素ターゲット向けの逃げ道として残す）。

## 2. 従来イディオムの実態と故障セマンティクス

リポジトリ内の `bindNode` 全使用箇所（2026-07-28 時点で5ファイル）は2系統のイディオムに分かれていた:

| イディオム | 使用箇所 | happy path | CDN ロード失敗時 |
|---|---|---|---|
| 同一モジュール内 static import → bindNode | examples/websocket-chat/signals、packages/fetch/examples/pagination/signals | module graph が評価順を保証（await 不要） | モジュールグラフごと評価失敗 → アプリ全体が起動しない（コンソールにエラーは出る） |
| `await customElements.whenDefined()` → bindNode | examples/signals-live-search、examples/signals-tilt-maze、README §3 | 即 resolve | **静かに永久ハング**（whenDefined は仕様上 reject しない） |

顕在化した問題（signals-tilt-maze）: 4タグ全部を `await Promise.all(whenDefined×4)` していたため、センサーパッケージが1つでも落ちると promise が解決せず、**ドラッグフォールバック含めアプリ全体が一切マウントされない**。state 版（state-tilt-maze）が `<wcs-defined timeout>` で解いた故障モードそのものを、signals 版は抱えたままだった。

重要な切り分け: **順序問題を解くのは static import であり、createElement ではない**。static import + HTML 内タグでも順序は安全（`define()` 時に接続済み要素は同期 upgrade される）。`mountNode` が追加で消すのは残りの結合 — パーサ生成タグが定義より先に存在する可能性そのもの、HTML 側へのタグ設置、`getElementById` の間接参照 — である。

## 3. 推奨イディオム（§0 の展開）

### 3.1 必須ノード: static import + `mountNode`

```js
import "@wcstack/raf/auto";        // 定義 — module graph が「この行の後は定義済み」を保証
import { mountNode } from "@wcstack/signals/dom";

const loop = mountNode("wcs-raf");
```

失敗セマンティクス: import 失敗はモジュールグラフの評価失敗としてコンソールに即出る。必須ノード（ゲームループ等）が無ければアプリは成立しないので、all-or-nothing で**うるさく**死ぬのが正しい。

### 3.2 オプショナルノード: dynamic import + `mountNode`

```js
const tilt = signal(null);
import("@wcstack/tilt/auto")
  .then(() => tilt.set(mountNode("wcs-tilt")))
  .catch(() => {/* 縮退モード — アプリは動き続ける */});
```

`import()` は `whenDefined` と違い**ロード失敗で reject する**ため、タイムアウトというヒューリスティック無しに真の失敗検出ができる。パッケージ単位の失敗境界がそのまま部分縮退の設計単位になる。

留保: `import()` の reject はブラウザのネットワークタイムアウト任せで、停滞したコネクションでは数十秒かかりうる。「5秒で縮退 UI を解放」のような snappy な要件には `Promise.race` でタイムアウトを足すか、その箇所だけ `<wcs-defined>`（待ち時間の規範化が本業）を併用する。

### 3.3 自分がロードしないタグ: `whenDefined` / `<wcs-defined>`

autoloader 経由の遅延登録、state と signals が混在するページで他者がロードするタグ、実行時に注入されるコンテンツ — ここでは import による順序保証が構造的に不可能なので、`whenDefined`（+`AbortSignal.timeout` との race）か `<wcs-defined>` ゲートが引き続き唯一の手段。

### 3.4 床3: Core 直接利用 — 要素を作らない

I/O ノードは Core（フレームワーク非依存ロジック）/ Shell（カスタム要素）に分層しており、**Core 単体で完結した wc-bindable ノード**である。形は全パッケージ統一（DefinedCore / TiltCore / RafCore で確認）: `extends EventTarget`・`constructor(target?)` は `target ?? this`（既定で自分自身に dispatch）・`static wcBindable` 保持・観測プロパティは public getter。よって `bindNode(new XxxCore())` は **descriptor 省略でも** `core.constructor.wcBindable` が解決し、seed も正しく読める。これは後付けの裏技ではなく signals の建国実証そのもの — `packages/signals/__tests__/integration.fetchCore.test.ts` は無改変の実 FetchCore を要素なしで束縛し DOM 更新まで通す PoC 起点のテストである。

```js
import { DefinedCore } from "@wcstack/defined";
import { bindNode } from "@wcstack/signals/dom";

// <wcs-defined> と同じ timeout→missing・遅延昇格ロジックを、要素もレジストリも無しで
const gate = bindNode(new DefinedCore(["wcs-tilt", "wcs-accelerometer"], "all", 5000));
gate.signals.pending.get();
```

床モデル（本書の全体像）:

| 床 | 形 | 定義タイミング問題 |
|---|---|---|
| 1 | `data-wcs` + Shell（state） | ランタイムが upgrade まで配線を遅延（利用者は意識しない） |
| 2 | `bindNode` / `mountNode` + Shell（signals） | §0 決定表で管理（import 順序・gate） |
| 3 | `bindNode` + Core 直接（signals） | **存在しない**（`customElements` レジストリ非関与） |

適用判断:

- **向く**: 純ロジックノード（fetch / websocket / sse / broadcast / timer / debounce / defined / raf …）を JS だけで使う場合。
- **Shell が価値を持ち続ける**: 要素結合ノード（intersection / resize の観測対象・camera のプレビュー内包・fullscreen / pip / pointer-lock のターゲット）、`:state()` CSS 反映（Shell / ElementInternals 専用 — 例: tilt-maze の `wcs-raf:state(running)` チップ）、HTML 宣言性・state との併用・autoloader・属性ベース設定。
- **代償**: ライフサイクルが手動になる（`observe()` / `dispose()` ないし start / stop コマンドを自分で駆動 — `onCleanup(() => core.dispose())` と合成）。

規範化済み（2026-07-28）: [async-io-node-guidelines.md](./async-io-node-guidelines.md) **§3.9** が Core を公開 headless adopter surface として規範化した — entry export（MUST）・構造保証（EventTarget 継承・自己 dispatch 既定・`static wcBindable`・public getter・`observe()/dispose()/ready`・never-throw）の semver 保護・headless 構築可能（MUST）・各パッケージ README の headless（Core）節（MUST）。棚卸しで全 I/O ノード 38 Core の逸脱ゼロを確認済み。これにより**床3は正式な推奨イディオム**。コンストラクタの設定引数の形だけはパッケージ個別（各 README が正）。利用者向け正本は signals README の「Binding a Core directly」節。

## 4. examples への適用方針

比較デモ（signals-tilt-maze・websocket-chat）は「state 版と同じタグが HTML に並ぶ」対称性自体に展示価値があるため、機械的な全面置換はしない。新規の signals 単独デモ・README の正典レシピは §0 の決定表に従う（README §3 には whenDefined が「自分がロードしないタグ用の形」である旨の注記を追加済み）。

## 5. `mountNode` API（as-built・v1.22.6 時点で Unreleased）

`@wcstack/signals/dom` エクスポート。`packages/signals/src/dom.ts` 実装、テスト `__tests__/mountNode.test.ts`（12本）。

```ts
mountNode<S extends NodeShape = DefaultNodeShape>(
  tagName: string,
  options?: {
    attrs?: Record<string, string | number | boolean>;
    parent?: Node;                    // 既定 document.body
    descriptor?: WcBindableDescriptor; // bindNode 第2引数への素通し
  },
): MountedNode<S>   // = BoundNode<S> & { el: HTMLElement; unmount(): void }
```

### 5.1 決定事項

1. **内部順序 = 生成 → attrs → 束縛 → 接続（規範）**。attrs は接続前に設定（Shell は `connectedCallback` で設定を読む）、アダプタ購読も接続より先。`connectedCallback` から発火するイベントの取りこぼし窓が**構造的にゼロ**になる（bindNode の re-seed に依存しない）。テストは connect 時発火イベントの捕捉で直接検証。
2. **未定義タグは原因の分かる Error を即 throw**。bindNode の汎用エラー（"no wc-bindable descriptor"）では初見に原因（タグ未定義）が読めない。メッセージには副作用 import・whenDefined・descriptor 逃げ道への誘導を含む。`descriptor` 明示時はチェックをスキップ（非カスタム要素ターゲット向け・bindNode と対称）。
3. **attrs は HTML boolean 属性セマンティクス**: `true` → 空属性、`false` → 属性なし、他は文字列化。`setProp` の属性規約（`true` → 空属性・`false` → 削除）と整合。
4. **リアクティブオーナーに自動登録しない**（bindNode と同一規約）。teardown は明示 `unmount()`（アダプタ dispose + `el.remove()`・冪等）。スコープと束ねたければ `onCleanup(() => m.unmount())`。ページ寿命のヘッドレスノードをトップレベルで作るのが標準形なので、暗黙の紐付けはかえって危険。
5. **`./dom` エントリの SSR 契約を維持**: モジュールレベルで DOM に触れず、非 DOM 環境での呼び出しは `createSignalsElement` と同書式の分かりやすい Error（`@wcstack/signals/dom:` プレフィクス・`document` / `customElements` 個別ガード・対処の提示）。
6. **`MountedNode` の `dispose()` は `unmount()` のエイリアス（レビュー起源の決定）**。継承したアダプタ限定 `dispose()` をそのまま公開すると、「シグナルは inert に見えるが要素は接続されたまま Shell の IO が生き続ける」静かな部分 teardown になる（bindNode の習慣で `m.dispose()` を呼ぶ利用者・`BoundNode` 型で受けるジェネリックヘルパが踏む）。mountNode は要素のライフサイクルを所有するので dispose = 完全 teardown に上書きする。
7. **タグ名は小文字に正規化（レビュー起源の決定）**。レジストリは exact-key・`createElement` は ASCII 小文字化するため、正規化しないと `mountNode(el.tagName)`（HTML 文書では大文字）が「定義済みなのに not defined」と誤診し、エラーメッセージの誘導（`whenDefined("WCS-X")` は invalid name で reject）まで的外れになる。

### 5.2 非目標

- **lazy 変種（`mountNode.lazy(spec, tag)` 等）は持たない** — dynamic import との合成（§3.2）が十分に短く、タイムアウト・縮退 UI はアプリのポリシー層なので API に畳み込まない。
- **deferred アダプタ（定義前に未配線アダプタを返し upgrade 時に配線する変種）は採らない** — sugar ではなく規範決定を伴う: upgrade 前 `command` の throw/drop（state 側は「token は replay しない」を規範化済みで整合が要る）、upgrade 前 `set` の expando 書き込みは upgrade で拾われない（lazy-properties 問題）。bindNode の fail-fast はこの決定を避けた正直な形であり、mountNode は「定義後に生成する」ことで問題自体を消す。

### 5.3 未決事項（候補）

- `bindNode` 自体の診断改善: ターゲットが `-` 入りタグ名の HTMLElement で `customElements.get()` が空のとき、汎用エラーの代わりに「タグ未定義」の専用メッセージを出す。mountNode 経路は本実装でカバー済みのため優先度は下がったが、既存要素への直接 bindNode（§3.3 経路）の初見の転び方を救う価値は残る。

## 6. 背景 — プラットフォームの縫い目としての「カスタムタグのロード問題」

この問題系は本質的に Web プラットフォームの未解決領域であり、3層に分解できる:

1. **タグ名→モジュール解決**（誰が `<wcs-fetch>` の提供モジュールを知るか）— 標準提案が存在する: [WICG/webcomponents#782 "Lazy Custom Element Definitions"](https://github.com/WICG/webcomponents/issues/782)（`customElements.defineLazy(name, () => import(...))`、2018 年 Tokyo f2f から議論・2026-07 時点で未出荷）。**`@wcstack/autoloader` はこの提案の userland 実装そのもの**（import map 連携の宣言形）。
2. **ロード失敗の可視性**（`whenDefined` が reject しない）— 仕様の手抜きではなく構造的: レジストリはローダーを知らないので「もう来ない」を原理的に判定できない。①が解けて初めて本物の失敗シグナルが流れる。**`<wcs-defined>` の timeout → `missing`（遅延到着で昇格）はこの構造的不在への正直な答え**。
3. **失敗時ポリシー**(部分縮退・disabled ボタン・待ち時間) — ブラウザが完璧になっても永遠にアプリ層に残る。

隣接軸の Scoped Custom Element Registries（名前衝突）は Safari 26 / Chrome 146 で出荷済みだが、ロード軸は HTML Imports の撤退（ブラウザが一度所有して手放した前歴）以来、userland の実証待ちが続いている。**wcstack の立場**: autoloader / `<wcs-defined>` は「独自機能」ではなく「あるべきプラットフォームプリミティブの userland 形（polyfill-shaped）」であり、標準が来たら薄くなって消える設計。`mountNode` はそのどちらでもなく、③と「ライブラリ API 設計で引き受けるべき部分」を signals 側で引き受ける道具である。
