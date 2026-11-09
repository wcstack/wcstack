# @wcstack/devtools

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**wcstack のページ内 DevTools オーバーレイ。** `<script>` 一行で `<wcs-devtools>`
オーバーレイが載り、state ツリーの検査、各パスがどの DOM ノードに配線されているかの
確認、write / 更新バッチ / command・event トークン発火のライブタイムラインが使える。

- **依存ゼロ・ビルド不要。** ページ上の wcstack ランタイムとは
  [DevTools Hook Protocol](../../docs/devtools-hook-protocol.ja.md)
  （`globalThis.__WCSTACK_DEVTOOLS_HOOK__`）だけで接続する。`@wcstack/state` を
  import せず、ランタイムのコピーが複数あるページでもそのまま動く。
- **標準ファースト。** オーバーレイ自体がカスタム要素で、自分の shadow root の中に
  描画する。ページの DOM / CSS / class / style には一切触れない。ハイライトは
  fixed 配置のオーバーレイ枠として描画する。shadow root は **open** なので、
  テストからは `document.querySelector("wcs-devtools").shadowRoot` で読める
  （[テストからオーバーレイを読む](#テストからオーバーレイを読む)を参照）。
- **本番経路は不活性。** devtools 未接続時、`@wcstack/state` 側計装のコストは
  計装点あたり null チェック 1 回。オーバーレイはタグを書いたページにしか存在しない。
  SSR では何も描画しない。

## クイックスタート

```html
<!-- @wcstack/state より前に読む: 配線台帳が最初からライブになる（遅延アタッチを参照） -->
<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

フローティングの **WCS** バッジ、または **Alt+Shift+D** でパネルが開く。4.21（未リリース）から、
ページで何かが失敗していると、バッジに赤い数が付く（[失敗](#失敗)を参照）。

auto エントリは `<wcs-devtools>` を定義し、ページに無ければ `<body>` 末尾に
1 つ挿入する。配置や属性を制御したい場合は自分でタグを書く:

```html
<wcs-devtools open dock="right" hotkey="Ctrl+Shift+X" buffer="1000"></wcs-devtools>
```

## ペイン

| ペイン | 内容 |
|---|---|
| **State** | 各ルート state ツリー（root node ごとに 1 本・ラベルはルート由来 — v2 に名前次元は無い）のトップレベルキー、配列/オブジェクトの展開、computed getter。値クリックでインライン編集 — 書き込みは通常のリアクティブパイプライン（set トラップ → 更新バッチ → DOM）を通るため、アプリコードが書いたのと同じようにページが反応する。**パス**クリックで束縛ノードをハイライト。ツリーの下には、マウント記録の **Overlays** と、`$eq` / `$eqPath` / `$eqIndex` の購読を path ごとに数えた **Keyed selection**（行・鍵・リスト単位の監視の数と最後の値）が出る。path が getter で、読む getter が全部再評価される形には `tracked` バッジが付く（`@wcstack/state` 3.0 以降）。パネルを開いている間は、更新バッチのたびにペインを読み直す（多くて 1 フレームに 1 回。タイムラインの一時停止中も読み直す）。インライン編集の入力欄にフォーカスがある間と、ペインの中でポインタを押している間は描き直しを待ち、終わってから追いつく。 |
| **Wiring** | ライブ binding 台帳: binding ごとの `property ← path` 行と型バッジ（`text` / `prop` / `for` / …）。**⌖ pick** でページ要素をクリックするとその要素の配線だけに絞れる。行クリックで束縛ノードをハイライト。4.21（未リリース）から、ランタイムが「解決しない」と報告したパス（`state:path-unresolved`。報告されたままのパス — `rows.*.amountLabl` — と、報告したランタイムで突き合わせる）の行には **`unresolved`** バッジが付き、ツールチップに宣言されていないセグメントが出る。ランタイムの検査は getter を評価しないと分からないところ（getter が返すリストの行・空のリスト・`null` の親）では黙るので、バッジの無い行のパスが解決するとは限らない — そこは `npx @wcstack/lint` が読む。**coverage** の切り替えは、state が宣言したものと、パネルが観測を始めてから起きたことを突き合わせる: `$watch` のキーごと（`fired` ×n / `never`）、command・event トークンごと（`emitted` ×n / `never` / `emitted-unheard` — どの発火も購読者ゼロ）、宣言したバインディングごと（`attached` / `never-attached`）。`@wcstack/state` 3.x では、リストに `for` のバインドも `$listKeys` の宣言も無いワイルドカードの行 watch は、`never` ではなく `prerequisite-missing` と出る（3.x ではリストへの書き込みがその watch に届かない）。4.0 の行 watch はどちらも要らないので、4.0 のページでは出ない。 |
| **Timeline** | ring buffer（既定 500 件）: `write`（旧値が取れた場合は併記）、`batch`（drain ごとの dedup 済み更新アドレス）、`command` / `event` トークン発火（引数要約 + 購読者数 — **購読者ゼロの空撃ちには警告バッジ**。whenDefined 前配線レースの検出に効く）、state 要素の登録/解除、ランタイムが隔離した・打ち切った[失敗](#失敗)（警告バッジ）。⏸ で一時停止、🗑 でクリア。4.21（未リリース）から、ヘッダーの **failures** ボタンで失敗だけを表示できる。 |

## 失敗

4.21（未リリース）から。失敗とは、ランタイムが console に出すだけで続行するもの —
ページは何事も無かったように動き続ける:

| Timeline の種別 | 起きたこと |
|---|---|
| `binding-apply-error` | バインディングの適用が throw した（getter が throw した `for:` のリストなど）。バッチの残りは適用された |
| `watch-error` | `$watch`（または `$scan`）が throw した — detail の先頭が段階 |
| `path-unresolved` | バインド・watch したパスが state 上で解決しない。その更新は捨てられる |
| `watch-chain-limit` / `render-chain-limit` | 書き込みの連鎖が深さ上限で打ち切られた |
| `propagation-hop-limit` | 双方向の伝播の連鎖がホップ上限に達した |
| `contract-drift` | サイドカーの manifest が実物の `wcBindable` 宣言と食い違う |

- **バッジ。** 失敗がある間、閉じたバッジの右上に赤い数が出る（100 からは `99+`）。
  無ければ従来どおりの見た目のまま。
- **ヘッダー。** パネルのヘッダーに `⚠ 2 failures` と出る（無いときは淡色の
  `0 failures`）。押すと Timeline が失敗だけになり、もう一度押すと全部に戻る。
- 失敗は専用の buffer（`buffer` と同じ件数）に残るので、忙しいページの
  `write` / `batch` の行に押し出されて見えなくなることはない。⏸ の間も数え、
  🗑 で消えて数も 0 に戻る。
- 購読者ゼロの `command` / `event` の発火は警告バッジのままで、数えない —
  誰も聞いていない event は意図どおりのことが多い。

## テストからオーバーレイを読む

オーバーレイは open な shadow root に描画するので、テストからは他の要素と同じように
読める — スクリーンショットやマウス座標は要らない。Playwright の CSS ロケーターは
open な shadow root をそのまま通り抜ける
（`page.locator('wcs-devtools button[data-role="failures"]')`）。ヘッダーのボタンには
`data-role` が付いている: `failures`・`pick`・`pause`・`clear`・`dock`・`close`。

```js
const devtools = document.querySelector("wcs-devtools");
devtools.toggle(true);                                     // パネルを開く
devtools.shadowRoot.querySelector(".pane-timeline .pane-body").textContent;
devtools.shadowRoot.querySelector('button[data-role="failures"]').textContent; // "⚠ 2 failures"

// 要素の DevtoolsCore（切断中は null）なら DOM を介さずに引ける
devtools.core.getTimeline();   // すべての行: { kind, label, detail, … }
devtools.core.failureCount;    // 4.21（未リリース）から
devtools.core.getFailures();   // 4.21（未リリース）から: 失敗の行だけ
```

## 属性

| 属性 | 既定 | 意味 |
|---|---|---|
| `open` | 閉 | パネルの表示（バッジ/ホットキーでトグル） |
| `dock` | `bottom` | `bottom` または `right` |
| `hotkey` | `Alt+Shift+D` | 開閉ショートカット。`none` で無効 |
| `buffer` | `500` | タイムライン ring buffer 件数（接続時に読む） |

## 遅延アタッチ

バインディング構築**後**に devtools がロード（または注入）されたときに見えるものは、
フックのプロトコルで話す相手のランタイムによって違う:

- **`@wcstack/state` 4.0** はバインディングを列挙できる。devtools がアタッチすると、
  ランタイムがその時点のバインディングをすべて `state:binding-added` として送るので、
  Wiring ペインには、先に読み込んだときと同じライブ台帳が出る。
- **`@wcstack/state` 3.x** は列挙できる台帳を持たないので、アタッチ前の
  `binding-added` は復元できない。Wiring ペインは **declared** ビュー
  （`data-wcs` 属性と `wcs-*` コメントの再スキャン）にフォールバックし、リロード
  導線を出す。

どちらのランタイムでも、それ以外（state ツリー・編集・アタッチ以降のタイムライン）は
全機能動く（アタッチ前のイベントは再生しない）。プロトコル §6 参照。

## 注意・制限

- パネルの再描画は `requestAnimationFrame` 駆動。非表示タブ（どのみち見えない）
  では次のフレームまで描画が止まる。
- パネルを開いている間、ドック側のページ領域は覆われる — 反対側にドックするか
  閉じれば操作できる。
- `@wcstack/signals` 対応は今後（プロトコルは `kind: "signals"` を予約済み）。
  v1 は `@wcstack/state` を対象とする。

## プログラマティック利用

同じプロトコルの上に自前ツールを組むための部品も export している:

```js
import { DevtoolsCore, getOrCreateHookRegistry, formatValue, scanDeclaredBindings }
  from "@wcstack/devtools";

const core = new DevtoolsCore({ timelineCapacity: 200 });
core.connect();
core.onChange((kind) => { /* "sources" | "roster" | "wiring" | "timeline" | "coverage" | "values" */ });
core.getRoster();      // 観測中の <wcs-state> 要素
core.getCoverageReport(); // 宣言 × 実測（coverage ビュー）
core.getTimeline();    // ring buffer スナップショット
```

4.21（未リリース）から: `core.failureCount` と `core.getFailures()`（[失敗](#失敗)を
参照）、`isFailureKind(kind)`（失敗に数える種別か）、`core.getUnresolvedReport(wiringEntry)`
（配線の行に当たる `state:path-unresolved` の報告、無ければ `null`）。

## ライセンス

MIT
