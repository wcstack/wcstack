# Changelog

## Unreleased

### Features

- **配列破壊的操作の診断** — `<wcs-state>` スクリプト内の配列への破壊的操作を検出する 2 診断を追加（warning、IDE / `wcs-validate` CLI 共通）。設計・検証の正本: `docs/array-mutation-diagnostic-design.md`
  - `wcs/array-mutation` — `this.items.push(...)` 等 9 種の破壊的メソッド呼び出し。リアクティブ更新をトリガーせず、同一参照の自己再代入でも要素の追加・削除は反映されない（動的検証済み）。メッセージでメソッド別の非破壊代替（`concat` / `toSpliced` / `toSorted` 等）を提示
  - `wcs/array-index-assign` — `this.items[0] = x` 形式のインデックス代入（bracket-only チェーン）。単純代入に加え複合代入 15 種（`+=` `??=` 等）・前置/後置 `++` `--`・bracket ルート形（`this["items"][0] = x`）・式添字（`this.items[this.items.length] = x` の append イディオム）も検出（いずれも非リアクティブを動的検証済み）。ドットパス代入 `this["items.0"]` と `with()` を提示。ドットアクセスを含むチェーンは従来どおり `wcs/nested-assign` の担当（二重報告なし）
  - 両診断とも optional chaining（`?.`）・改行/空白折返しチェーン・`$` 含み識別子に対応

### Fixes

- **`wcs/nested-assign` の検出拡張** — 複合代入（`this.user.count += 1`）・前置/後置 `++` `--`・式添字チェーン（`this.rows[this.i].name = x`）が検出されていなかったギャップを解消（ランタイムでは単純代入と同じく非リアクティブ）。識別子添字の提示パスを `a.i.b` から動的添字マーカー `a.<i>.b` へ統一。プレーン `=` の診断 range は不変
- **`<script>` の `type` 属性値を ASCII case-insensitive で判定** — `type="Module"` / `TYPE="MODULE"` のブロックが全 script 系診断からスキップされていた問題を修正（HTML 仕様準拠。`application/json` 判定も同様）

## 1.10.0

`@wcstack/state` の現行実装（command-token / event-token / spread / `$streams`）への追従。

### Features

- **`$streams` 宣言対応** — エントリ名を値プロパティとして実体化（`initial` から型・配列パスを導出）し、`$streamStatus.<name>` / `$streamError.<name>` を補完・検証対象に追加
- **command-token 対応** — `$commandTokens` 宣言から `$command.<name>` 候補を導出。`onclick: $command.<name>` / `command.<method>: $command.<name>` の右辺を宣言と照合
- **event-token 対応** — `$eventTokens` 宣言からトークン名候補を導出。`eventToken.<prop>: <name>` の右辺を宣言と照合（state パスとしては検証しない）
- **スプレッド / radio / checkbox** — `...:` のフィルタ禁止・ターゲット必須をランタイムと同じく error 化。`...` / `radio` / `checkbox` / `command.` / `eventToken.` を補完候補に追加
- **prop 側 input フィルタ** — `value|int: path` の書き戻しフィルタを解釈し、フィルタ名・引数を検証
- **修飾子 `ro`** — 双方向バインディングの書き戻し抑止修飾子を補完候補に追加
- **ループインデックス** — `$1` 等を存在検証から除外し、`<template for>` 外での使用に warning を追加

### Fixes

- トップレベルの `$` 予約キー（`$streams` / `$commandTokens` / `$eventTokens` / `$on` / `$bindables` / ライフサイクル）が偽のデータパス（`streams` 等）として補完・検証に混入していた問題を修正
- preamble の `$getAll` シグネチャをランタイム実装 `(path, indexes?)` に修正（旧: `(path, defaultValue?)`）
- preamble に `$command` / `$streamStatus` / `$streamError` 名前空間と `this["$streamStatus.<name>"]` の dotted アクセス型を追加（`$streams` 利用スクリプトの偽型エラーを解消）

## 0.1.0

Initial release.

### Features

- **Inline script type support** — Full TypeScript IntelliSense inside `<wcs-state>` `<script type="module">` blocks
  - Typed `this` access with dot-path resolution (`this["users.*.age"]` → `number`)
  - Auto-wraps `export default { ... }` with `defineState()` for `ThisType<T>` support
  - No imports required in inline scripts

- **Attribute binding completions** — IntelliSense for `data-wcs` attribute values
  - Property name completions (`textContent`, `class.`, `style.`, `attr.`, `onclick`, etc.)
  - State path completions (dynamically generated from `<wcs-state>` script analysis)
  - Filter name completions (40+ built-in filters)
  - Event modifier completions (`prevent`, `stop`)

- **Binding diagnostics** — Real-time validation of `data-wcs` expressions
  - Unknown path detection
  - Unknown filter detection
  - Type checking for `for:` (requires array), `if:` (requires boolean), `class.` (requires boolean), `attr.`/`style.` (requires string)
  - Filter chain type tracking (input/output type compatibility)
  - Filter argument count and type validation
  - Event handler + filter misuse detection

- **State type validation** — JSDoc `@type` annotation checking
  - Validates initial values against declared types
  - Supports union types (`boolean|null`)

- **Configurable** — `wcstack.bindAttributeName` setting for custom attribute names
