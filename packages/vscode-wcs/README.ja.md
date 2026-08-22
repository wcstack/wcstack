# WcStack IntelliSense

[@wcstack/state](https://github.com/wcstack/wcstack) 用の VSCode 拡張。HTML 内の `<wcs-state>` インラインスクリプトと `data-wcs` 属性にTypeScript 言語機能を提供します。

## Features

### Inline Script Type Support

`<wcs-state>` 内の `<script type="module">` で TypeScript の型補完が動作します。`import` や `defineState()` の記述は不要です。

```html
<wcs-state>
  <script type="module">
export default {
  count: 0,
  users: [{ name: "Alice", age: 30 }],

  increment() {
    this.count++;              // number
    this["users.*.name"];      // string
    this["users.*.age"];       // number
    this.$getAll("users.*.age"); // WcsStateApi
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
};
  </script>
</wcs-state>
```

### Attribute Binding Completions

`data-wcs` 属性値でプロパティ名、状態パス、フィルタ名の補完候補が表示されます。

- `data-wcs="` → `textContent`, `class.`, `style.`, `onclick`, `for`, `if` ...
- `data-wcs="textContent: ` → `count`, `users`, `users.*.name` ...
- `data-wcs="textContent: count|` → `gt`, `eq`, `uc`, `trim` ...
- `data-wcs="onclick#` → `prevent`, `stop`, `ro`
- `data-wcs="for: ` → 配列型のパスのみ表示
- `data-wcs="onclick: ` → メソッドと `$command.<name>` のみ表示
- `data-wcs="command.play: ` → `$command.<name>`（`$commandTokens` 宣言由来）のみ表示
- `data-wcs="eventToken.value: ` → `$eventTokens` 宣言のトークン名のみ表示

#### for コンテキスト補完

`<template data-wcs="for: items">` 内では、省略パス（`.name`, `.age`）の補完候補が自動生成されます。

```html
<wcs-state>
  <script type="module">
export default {
  items: [{ name: "Alice", age: 30 }]
};
  </script>
</wcs-state>

<template data-wcs="for: items">
  <!-- data-wcs="textContent: " で .name, .age が候補に表示 -->
  <span data-wcs="textContent: .name"></span>
</template>
```

パターンパス（`items.*.name`）や省略パス（`.name`）は `<template for>` の外側では補完候補に含まれません。

### wcs-* タグ補完（HTML Custom Data）

拡張は [`wcs.html-data.json`](./wcs.html-data.json) を同梱します — 各 I/O パッケージの
`static wcBindable` サーフェスと `observedAttributes` から生成される
[VS Code HTML custom data](https://github.com/microsoft/vscode-custom-data) です
（`npm run emit:builtin-tags` で再生成。コミット済みバンドルとの鮮度は CI がゲートします）。
`<wcs-state>` の無い HTML ファイルでも次が効きます:

- 全 `wcs-*` 要素のタグ名補完（`<wcs-f` → `<wcs-fetch>`）
- タグ hover で契約面を表示 — バインド可能プロパティ・input・`command.*` 名 —
  パッケージ README へのリンク付き
- 属性補完（observedAttributes と input のミラー属性）
- `data-wcs` をグローバル属性として宣言（バインディング構文の要約付き）

標準の HTML 言語サービスを使う他エディタ（およびこの拡張を入れていない VS Code）でも、
ファイルをプロジェクトにコピーして `html.customData` 設定から参照すれば同じ補完が得られます:

```json
{ "html.customData": ["./wcs.html-data.json"] }
```

#### ステート名補完

`@` の後にステート名の補完が動作します。`data-wcs`、`{{ }}`、`<!--@@:-->` のすべての構文で利用可能です。

```html
<span data-wcs="textContent: count@"></span>  <!-- @の後にステート名候補 -->
<span>{{ count@ }}</span>                      <!-- 同様 -->
```

### Template Syntax Support

Mustache 構文 `{{ }}` とコメントバインディング構文 `<!--@@:-->` でも補完と診断が動作します。

```html
<!-- Mustache 構文 — パス・フィルタ・ステート名の補完が動作 -->
<p>{{ count|gt(0) }}</p>

<!-- コメントバインディング構文 — FOUC なし -->
<p><!--@@:count|gt(0)--></p>
<p><!--@@wcs-text:count--></p>
```

### Hover・定義へ移動・参照の検索・インレイヒント

バインディングパスは HTML に直接書かれた実行時識別子なので、ソースマップ無しでナビゲーションが成立します。4 機能とも診断と同じ位置付き参照インデックスへのクエリです。

- **Hover**: バインディングパスに種別（data / computed / list / メソッド / command トークン / event トークン）・推定型・所属 state・宣言行を表示。`for` 短縮パスは展開後（`` `.name` → `users.*.name` ``）を表示。フィルタ名にはシグネチャ・説明・型変換（`number → string`）、修飾子（`#prevent` / `#ro` / `#init=` / `#sync=` / `#on<event>`）には意味説明。解決できないパスには何も出しません（誤ヒントゼロ）— ただし `src` 外部 state は「外部定義」と明示します。
- **定義へ移動**（F12）: `data-wcs` / `{{ }}` / `<!--@@:-->` のパスからインライン `<wcs-state>` スクリプト内の宣言へジャンプ。ドットパスは第 1 セグメントへフォールバック。`$command.<name>` は `$commandTokens` へ、event-token 配線は `$eventTokens` へ。`src` 外部 state のパスは `<wcs-state src=…>` タグへジャンプします。
- **参照の検索**（Shift+F12）: 双方向。バインディングパスから全チャネルの出現へ（短縮形は展開後パスと統合）、state スクリプト内の宣言名からそれを読む全バインディングへ（配下パス含む）。
- **インレイヒント**: `for` 短縮パスの後ろに展開後パス（`.name` `= users.*.name` — ランタイムが実際に行う属性書き換えと同一）、フィルタ鎖の末尾に結果型（`→ string`）、spread（`...: target`）に展開規模（`→ 13 props` — 組み込み wcs-* タグ限定。ユーザー定義タグは静的展開不能）。型が静的に決まらない場合はヒントを出しません。

Hover 本文の言語は `wcstack.messageLanguage` に従います（既定: VS Code の表示言語）。

### Binding Diagnostics

`data-wcs` 属性、`{{ }}` 構文、`<!--@@:-->` 構文のリアルタイム検証:

| チェック | 例 | 診断 |
|---|---|---|
| 存在しないパス | `textContent: typo` | ⚠ warning |
| 存在しないフィルタ | `textContent: count\|fake` | ⚠ warning |
| `for:` に非配列 | `for: count` | ❌ error |
| `if:` に非 boolean | `if: count` | ⚠ warning |
| `class.` に非 boolean | `class.active: count` | ⚠ warning |
| `attr.`/`style.` に非 string | `attr.href: count` | ⚠ warning |
| フィルタ入力型不一致 | `count\|uc` (number→string filter) | ⚠ warning |
| フィルタ引数不足 | `count\|mul` | ❌ error |
| フィルタ引数型不一致 | `count\|gt(abc)` | ⚠ warning |
| イベント+フィルタ | `onclick: fn\|gt(10)` | ⚠ warning |
| `<template for>` 外のパターンパス | `textContent: items.*.name` | ⚠ warning |
| `<template for>` 外の省略パス | `textContent: .name` | ⚠ warning |
| 解決済みパス（数値インデックス） | `textContent: items.0.name` | ⚠ warning |
| `<template>` 外の `{{ }}` (FOUC) | `<p>{{ count }}</p>` | ℹ info |
| ネストされたプロパティへの代入 | `this.user.name = "..."` | ⚠ warning |
| `<!--@@:-->` バインディング表示 | `<!--@@:count-->` | ℹ info |

フィルタチェーンの型追跡により、`if: count|gt(0)` (number→boolean) は正しく OK と判定されます。

### JSDoc Type Validation

`@type` アノテーションと初期値の整合性を検証:

```javascript
/** @type {string} */
label: null,        // ⚠ 型 "null" は @type {string} と互換性がありません

/** @type {string|null} */
label: null,        // ✅ OK
```

### Nested Property Assignment Warning

`<wcs-state>` スクリプト内でネストされたプロパティへの代入を検出し、リアクティブ更新がトリガーされない旨を警告します。

```javascript
// ⚠ ネストされたプロパティへの代入はリアクティブ更新をトリガーしません
this.user.name = "Bob";

// ✅ ドットパス記法を使用してください
this["user.name"] = "Bob";
```

### Sidecar Manifest 検証と CLI

静的契約の sidecar ファイル（`wcstack.manifest.json`）を、サポートする JSON-Schema
サブセットに対して検証します: envelope / `kind` チェック、ファイル横断の package 解決、
同名 tag/filter 衝突、衝突後 override の禁止、稼働中の `static wcBindable` サーフェスとの
drift。診断には安定コード（例 `manifest-schema-version` / `manifest-kind-invalid`）が付きます。

単一の `validateDocument` 入口が IDE 診断と CLI の両方を駆動するため、同じ入力に対して
エディタと CI で結果が一致します。意図的な非対称が 1 つ: `<wcs-state src="...">` の
外部 state は CLI だけが（HTML ファイル相対で）解決します——IDE は単一 HTML ファイルを
解析対象とし `src` はスキップします。同梱の **`wcs-validate`** CLI は同じ検査を—— `wcstack.manifest.json`
sidecar および／または HTML の `data-wcs` バインディングに対して——ヘッドレスに CI 実行します。
CLI は npm では [**`@wcstack/lint`**](https://www.npmjs.com/package/@wcstack/lint)
として配布されています（同一の CLI バンドルを同梱する依存ゼロのラッパー）:

```bash
npx @wcstack/lint [--attr=data-wcs] [--state-tag=wcs-state] [--errors-only] <file> [<file> ...]
```

validator 自体を開発する場合や、このリポジトリの CI（`wcs-validate` job はまさに
この起動方法です）では、ソースからビルドして `node` で起動します:

```bash
# 初回のみビルド（リポジトリルートから）
cd packages/vscode-wcs && npm ci && npm run build && cd ../..

node packages/vscode-wcs/dist/cli.cjs [--attr=data-wcs] [--state-tag=wcs-state] [--errors-only] <file> [<file> ...]
```

`--errors-only`（別名 `--quiet`）は表示を error severity の行だけに絞ります。warning/info の
件数集計と exit code は変わりません。exit code は error が 1 件でもあれば `1`、引数不正・
ファイル読み取り失敗は `2`、それ以外は `0` です。

sidecar は**ツール専用**です: 稼働中の `static wcBindable` 宣言を上書きすることはなく、
ファイルの欠落や陳腐化がランタイム挙動を変えることもありません。規範的なスキーマと解決
規則は `docs/wcstack-manifest-schema.md` にあります。

## Settings

| 設定 | デフォルト | 説明 |
|---|---|---|
| `wcstack.bindAttributeName` | `"data-wcs"` | バインド属性名 |
| `wcstack.stateTagName` | `"wcs-state"` | ステート定義のカスタム要素タグ名 |

## Requirements

- VSCode 1.95+
- HTML ファイル内に `<wcs-state>` 要素があること

## License

MIT
