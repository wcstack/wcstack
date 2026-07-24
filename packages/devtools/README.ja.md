# @wcstack/devtools

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**wcstack のページ内 DevTools オーバーレイ。** `<script>` 一行で `<wcs-devtools>`
オーバーレイが載り、state ツリーの検査、各パスがどの DOM ノードに配線されているかの
確認、write / 更新バッチ / command・event トークン発火のライブタイムラインが使える。

- **依存ゼロ・ビルド不要。** ページ上の wcstack ランタイムとは
  [DevTools Hook Protocol](../../docs/devtools-hook-protocol.md)
  （`globalThis.__WCSTACK_DEVTOOLS_HOOK__`）だけで接続する。`@wcstack/state` を
  import せず、ランタイムのコピーが複数あるページでもそのまま動く。
- **標準ファースト。** オーバーレイ自体がカスタム要素で、Shadow DOM 内で完結。
  ページの DOM / CSS / class / style には一切触れない。ハイライトは fixed 配置の
  オーバーレイ枠として描画する。
- **本番経路は不活性。** devtools 未接続時、`@wcstack/state` 側計装のコストは
  計装点あたり null チェック 1 回。オーバーレイはタグを書いたページにしか存在しない。
  SSR では何も描画しない。

## クイックスタート

```html
<!-- @wcstack/state より前に読む: 配線台帳がライブで captured される -->
<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

フローティングの **WCS** バッジ、または **Alt+Shift+D** でパネルが開く。

auto エントリは `<wcs-devtools>` を定義し、ページに無ければ `<body>` 末尾に
1 つ挿入する。配置や属性を制御したい場合は自分でタグを書く:

```html
<wcs-devtools open dock="right" hotkey="Ctrl+Shift+X" buffer="1000"
              hidden-states="analytics"></wcs-devtools>
```

## ペイン

| ペイン | 内容 |
|---|---|
| **State** | 各 `<wcs-state>`（ランタイム source 単位）のトップレベルキー、配列/オブジェクトの展開、computed getter。値クリックでインライン編集 — 書き込みは通常のリアクティブパイプライン（set トラップ → 更新バッチ → DOM）を通るため、アプリコードが書いたのと同じようにページが反応する。**パス**クリックで束縛ノードをハイライト。 |
| **Wiring** | ライブ binding 台帳: binding ごとの `property ← path@state` 行と型バッジ（`text` / `prop` / `for` / …）。**⌖ pick** でページ要素をクリックするとその要素の配線だけに絞れる。行クリックで束縛ノードをハイライト。 |
| **Timeline** | ring buffer（既定 500 件）: `write`（旧値が取れた場合は併記）、`batch`（drain ごとの dedup 済み更新アドレス）、`command` / `event` トークン発火（引数要約 + 購読者数 — **購読者ゼロの空撃ちには警告バッジ**。whenDefined 前配線レースの検出に効く）、state 要素の登録/解除。⏸ で一時停止、🗑 でクリア。 |

## 属性

| 属性 | 既定 | 意味 |
|---|---|---|
| `open` | 閉 | パネルの表示（バッジ/ホットキーでトグル） |
| `dock` | `bottom` | `bottom` または `right` |
| `hotkey` | `Alt+Shift+D` | 開閉ショートカット。`none` で無効 |
| `buffer` | `500` | タイムライン ring buffer 件数（接続時に読む） |
| `hidden-states` | — | 非表示にする state 名（カンマ区切り。`wcs-devtools` 始まりは常に非表示） |

## 遅延アタッチ

バインディング構築**後**に devtools がロード（または注入）された場合、過去の
`binding-added` は復元できない。Wiring ペインは **declared** ビュー
（`data-wcs` 属性と `wcs-*` コメントの再スキャン）にフォールバックし、リロード
導線を出す。それ以外（state ツリー・編集・以降のタイムライン）は全機能動く。
プロトコル §6 参照。

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
core.onChange((kind) => { /* "sources" | "roster" | "wiring" | "timeline" */ });
core.getRoster();      // 観測中の <wcs-state> 要素
core.getTimeline();    // ring buffer スナップショット
```

## ライセンス

MIT
