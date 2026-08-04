# dcc/ — Declarative Custom Components

**正本は [`packages/state/README.md`](../../README.md) の "Declarative Custom Components (DCC)" 節。**
ここは実装側の補足のみを置く。

`data-wc-definition` を持つホストの Declarative Shadow DOM の中に `<wcs-state>` があると、
`State.connectedCallback` が定義モードとして検出し（`components/State.ts` の `_initializeDCC`）、
state をロードして `defineDCC()` を呼ぶ。定義用の `<wcs-state>` はそこで処理を打ち切る。

## ファイル

| ファイル | 役割 |
|---|---|
| `defineDCC.ts` | shadow の内容を template に取り込み、state から prototype を組み立てて `customElements.define` する |
| `dccPropertyFactories.ts` | prototype に生やす getter / setter / メソッドのファクトリ。いずれも `stateElement` 経由で reactive proxy を叩く |
| `processDccDeclarations.ts` | `$bindables` / `$commands` 宣言の検証（`$commandTokens` と同じ強度・存在検査込み） |
| `wcBindable.ts` | `$bindables` / `$commands` から `static wcBindable` と `bindableEventMap` を生成 |

## 実装上の要点

- **prototype の走査範囲**は `getAllPropertyDescriptors`（自身＋プロトタイプチェーン）。
  `State` の getterPaths / setterPaths 収集と同じ走査を共有する。
- **`$` 始まりのプロパティは prototype に生やさない**（`isInternalProperty`）。
  `$bindables` / `$commands` 側でも `$` 始まりの名前は宣言時にエラーにする。
- **`$streams` の名前は `$bindables` に書ける。** 値プロパティはインスタンス側で実体化されるため
  defineDCC の時点では descriptor が無い。アクセサは `streamBackedBindables` として別途生やす。
- **`commands` は一律 `async: true`。** `callFn` が常に `initializePromise` に chain するので、
  state 側のメソッドが同期でも呼び出し側から見た戻り値は Promise になる。
- **shadow は `_ensureShadow()` で遅延構築する。** `for` の行は fragment 上でバインドされる（未接続）ので、
  `connectedCallback` まで待つとアクセサが解決できず書き込みが捨てられる。冪等なので再接続でも
  張り直さない（2 回目の `attachShadow` は `NotSupportedError`）。`template.content` の clone は
  upgrade されていないため、末尾で `customElements.upgrade` を明示的に呼ぶ。
- **変更イベントの発火**は `proxy/methods/setByAddress.ts` が担う。`bindableEventMap` に
  完全一致するパスへの書き込みで、shadow の host に `CustomEvent` を dispatch する
  （`bubbles: true` / `composed` なし。host 自身が起点なので shadow 境界は越えない）。
- **inner `<wcs-state>` は無名であること。** セレクタが `:not([name])` のため、
  `name` を付けると `stateElement` が解決できない。`$bindables` 宣言時は警告を出す。

## 既知の制約

実装と設計の食い違いは
[`docs/architecture-hardening/15-state-component-mechanism-consistency.md`](../../../../docs/architecture-hardening/15-state-component-mechanism-consistency.md)
に集約してある。未修正の主なものは以下。

- 変更イベントは完全一致パスでしか出ない（サブパス変更・配列の in-place 変異では発火しない、§2.1）。
  `$streams` 由来の `$bindables` メンバもこの制約下にある
- getter は同期・setter とメソッドは `initializePromise` 待ちで非対称（§2.2）
