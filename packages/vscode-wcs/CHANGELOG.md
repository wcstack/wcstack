# Changelog

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
