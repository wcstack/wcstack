# WcStack IntelliSense

[@wcstack/state](https://github.com/wcstack/wcstack) 4.0 用の VSCode 拡張。HTML 内の `<wcs-state>` インラインスクリプトと `data-wcs` 属性にTypeScript 言語機能を提供します。

> **@wcstack/state 4.0。** 同梱のパーサと manifest は 4.0 のもので、検査は 4.0 の規則に従います: 4.0 で外れた名前（3.2 の旧名・`$scan`・`substr`）は書き換え先を添えて報告し、数値の添字のパス（`items.0.name`・`groups.0.items.1.v`）は報告しません。4.0 の設定（`$behavior`・`$features`・`<wcs-state features>`）と修飾子 `#direct` を理解します。3.x のプロジェクトでは拡張 1.21.x を使ってください（1.21.0 は 3.5 を同梱し、4.0 で変わる形を `wcs/v4-migration` の案内で知らせます）。

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
- `data-wcs="textContent: count|` → `gt`, `eq`, `upper`, `trim` ...
- `data-wcs="onclick#` → `prevent`, `stop`, `ro`, `direct`（`direct` は 4.0 の修飾子。`on*:` を root へ委譲せず、その要素に直接リスナーを付ける）
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

パス候補は `<wcs-state>` スクリプト（と JSON state）から導出します。入れ子の配列も辿り（`a.*.b.*.c`）、`$stream` のエントリは値プロパティと `$streamStatus.<name>` / `$streamError.<name>` に、`$listKeys` の宣言は初期値が `[]` のリストパス（リスト自体・`.*`・`.length`・キーフィールド。それ以外の行フィールドは含まない）になります。

初期値が `[]` のリストの**行の形**は、行を足す / 置き換える代入式の行リテラルから読みます — `this.items = this.items.concat({ id, kind: "general" })`、`.toSpliced(i, n, { … })`、`.with(i, { … })`、`[...this.items, { … }]` / `[{ … }, ...this.items]` — スクリプト内のどこにあっても（メソッド・getter・`$connectedCallback`・`$watch` ハンドラ）対象です。既に配列と分かっているパスにだけフィールドを足し、明示的な初期値を上書きしません。`$listKeys` の宣言は「これはリストである」と伝えるもう一つの手段で、`$listKeys: { items: "id" }` だけで解析器は `items`・`items.*`・`items.length` とキーフィールド `items.*.id` を知ります —— 行についてそれ以上は知りません。変数で渡した行（`concat(row)`）は読めないので、その場合は `stateSchema` を宣言してください。

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

@wcstack/state 4.0 もコメントバインディングを束ねます（`$behavior: { enableMustache: false }` のページでも）。SSR の無いページで `<template>` の外の FOUC を避ける書き方として、引き続き勧めます。どちらの形も式は複数行にまたがってよく、拡張も複数行の式を検証します。`<textarea>` と `<title>` の中のコメントはブラウザが文字にするので束縛ではなく、検証もしません（その中の `{{ }}` はテキストノードなので束ねられます）。

### Hover・定義へ移動・参照の検索・インレイヒント

バインディングパスは HTML に直接書かれた実行時識別子なので、ソースマップ無しでナビゲーションが成立します。4 機能とも診断と同じ位置付き参照インデックスへのクエリです。

- **Hover**: バインディングパスに種別（data / computed / list / メソッド / command トークン / event トークン）・推定型・所属 state・宣言行を表示。`for` 短縮パスは展開後（`` `.name` → `users.*.name` ``）を表示。フィルタ名にはシグネチャ・説明・型変換（`number → string`）、修飾子（`#prevent` / `#ro` / `#direct` / `#init=` / `#sync=` / `#on<event>`）には意味説明。4.0 で外れたフィルタ名（`uc`・`fix`・`substr` など）には書き換え先を表示。解決できないパスには何も出しません（誤ヒントゼロ）— ただし `src` 外部 state は「外部定義」と明示します。
- **定義へ移動**（F12）: `data-wcs` / `{{ }}` / `<!--@@:-->` のパスからインライン `<wcs-state>` スクリプト内の宣言へジャンプ。ドットパスは第 1 セグメントへフォールバック。`$command.<name>` は `$commandTokens` へ、event-token 配線は `$eventTokens` へ。`src` 外部 state のパスは `<wcs-state src=…>` タグへジャンプします。
- **参照の検索**（Shift+F12）: 双方向。バインディングパスから全チャネルの出現へ（短縮形は展開後パスと統合）、state スクリプト内の宣言名からそれを読む全バインディングへ（配下パス含む）。
- **インレイヒント**: `for` 短縮パスの後ろに展開後パス（`.name` `= users.*.name` — ランタイムが実際に行う属性書き換えと同一）、フィルタ鎖の末尾に結果型（`→ string`）、spread（`...: target`）に展開規模（`→ 13 props` — 組み込み wcs-* タグ限定。ユーザー定義タグは静的展開不能）。型が静的に決まらない場合はヒントを出しません。

Hover 本文の言語は `wcstack.messageLanguage` に従います（既定: VS Code の表示言語）。

### Binding Diagnostics

`data-wcs` 属性、`{{ }}` 構文、`<!--@@:-->` 構文のリアルタイム検証:

重大度の方針: **error** = ランタイムが throw する・束縛がけっして動かない、**warning** = 動くが黙って違うことをする、**info** = 助言。意図した例外: 存在しないフィルタ（4.0 で外れた名前と `substr` を含む）と `wcs/wildcard-rank`（`for` の外のパターンパス・省略パス・ループの添字 #1401 / #1402、段数の不足 #1401、別のリストの `*` #1403）は、4.0 のランタイムでは初期化で throw しますが **warning** です — ページは実行時に自前のフィルタを登録でき、拡張からはそれが見えないため、また `for` のスコープはマークアップから組み立て直すので、どの形でも厳密とは限らないためです。CI で落としたいときは `wcs-validate --strict` を使ってください。

`outerHTML:` / `outerText:` の検査（#203）は、生のマークアップから要素の入れ子を組み立て直します。終了タグの省略（`<li>…<li>`・`<p>…<div>`・表の行とセル）は直前に開いた要素だけを見て閉じる近似で（HTML のパーサの scope の規則のすべてではない）、`/>` は void 要素と `<svg>` / `<math>` の中だけで閉じたとみなします。引用符の無い `data-wcs` は、囲むテンプレートと要素の判定には読みますが、束縛そのものの検証は引用符付きの属性だけです。

| チェック | 例 | 診断 |
|---|---|---|
| 存在しないパス | `textContent: typo` | ⚠ warning |
| ループの添字でも状態のパスでもない `$0`・`$01`・`$1000`（`wcs/binding-path-missing`。ランタイムは同じコードで束縛を失敗させる） | `textContent: $0` | ❌ error |
| `for` の中の範囲の外の添字（`wcs/index-param-range`。添字は `$1`〜`$128`、上限は manifest の `syntax.indexParam.maxDepth`。`for` の外は「for の外のループ添字」— `wcs/wildcard-rank`） | `textContent: $129` | ❌ error |
| 存在しないフィルタ（4.0 で外れた旧名 `uc` / `fix` … と `substr` を含む。書き換え先を案内 — `substr(2, 3)` → `slice(2, 5)`） | `textContent: count\|fake` | ⚠ warning |
| `for:` に非配列 | `for: count` | ❌ error |
| `if:` に非 boolean | `if: count` | ⚠ warning |
| `class.` に非 boolean | `class.active: count` | ⚠ warning |
| `attr.`/`style.` に非 string | `attr.href: count` | ⚠ warning |
| フィルタ入力型不一致 | `count\|upper` (number→string filter) | ⚠ warning |
| フィルタ引数不足 | `count\|mul` | ❌ error |
| フィルタ引数型不一致 | `count\|gt(abc)` | ⚠ warning |
| イベント+フィルタ | `onclick: fn\|gt(10)` | ⚠ warning |
| `<template for>` 外のパターンパス・省略パス・ループの添字（`wcs/wildcard-rank`。4.0 は初期化で #1401 / #1402 を投げる — code はランタイムと同じ） | `textContent: items.*.name`・`.name`・`$1` | ⚠ warning |
| 行の中で別のリストの `*` を読む（4.0 の #1403） | `for: a` の中の `textContent: b.*.y` | ⚠ warning |
| `for` / `if` テンプレートの中の `outerHTML:` / `outerText:`（4.0 は初期化で throw — #203） | `<template data-wcs="for: items"><div data-wcs="outerHTML: h">` | ❌ error |
| イベント束縛以外の `#direct`（無視される） | `value#direct: name` | ⚠ warning |
| 4.0 が root へ委譲するイベント（`click`・`input`・`submit` など 11 種）のハンドラが、イベント引数の `currentTarget` を最初の `await` の前に読む（`wcs/delegated-current-target`。そこでは要素ではなく root になる — `on*#direct:` か `event.target.closest(…)`。`#direct` 付き・カスタム要素の `input` / `change` / `submit`・自前の `<wcs-state>` を持つ `<template>` の中は出さない。router の route の中は出す） | `onclick: pick` で `pick(e) { e.currentTarget.dataset.id }` | ⚠ warning |
| パスの `__proto__` / `prototype` の段（4.0 の #120） | `textContent: a.__proto__.x` | ❌ error |
| `<template>` 外の `{{ }}` (FOUC) | `<p>{{ count }}</p>` | ℹ info |
| ネストされたプロパティへの代入 | `this.user.name = "..."` | ⚠ warning |
| `<!--@@:-->` バインディング表示 | `<!--@@:count-->` | ℹ info |

フィルタチェーンの型追跡により、`if: count|gt(0)` (number→boolean) は正しく OK と判定されます。

数値の添字のパス（`items.0.name`・`groups.0.items.1.v`・行の中の `groups.*.sel.0.id`）は報告しません — 4.0 は添字の数によらず、いまその位置にある行を読んで書き込みに追従します。存在は添字を `*` に読み替えて確かめます（`items.0.nmae` は存在しないパスとして報告）。

#### `<wcs-state>` スクリプト（4.0 で外れた名前・4.0 の設定）

| チェック | 例 | 診断 |
|---|---|---|
| 4.0 で外れた API の旧名（`wcs/name-alias`。読んだ時点で throw） | `this.$trackDependency("a")` → `$dependOn` | ❌ error |
| 4.0 で外れた宣言キー（`wcs/declaration-alias`。読み込み時に throw — ボリュームは接ぎ木を拒んで console.error） | `$streams` → `$stream`、`$updatedCallback` → `$renderedCallback` | ❌ error |
| 4.0 で外れた宣言キーの読み出し（`wcs/declaration-alias-read`。黙って undefined） | `this.$streams` | ⚠ warning |
| 4.0 で外れた `$scan`（`wcs/scan-declaration-invalid`。読み込み時に throw — ボリュームは接ぎ木を拒んで console.error） | `$scan: { … }` → `$watch` / `$on` で畳む | ❌ error |
| `$behavior` のキー・値・形、ボリュームの `$behavior`（`wcs/behavior-invalid`。キーと値の型は manifest の `behaviorOptions`） | `$behavior: { enableMustach: false }` | ❌ error |
| `$features` / root の `features=` の知らない名前（`wcs/feature-unknown`。名前は manifest の `features`） | `$features: ["temporl"]` | ❌ error |
| 配列でない・ボリュームの `$features`（error）、root 以外の `<wcs-state>` の `features=`（読まれない — warning）（`wcs/features-invalid`） | `<wcs-state mount="x" features="formats">` | ❌ / ⚠ |
| 範囲の外の添字の読み出し（`wcs/index-param-range`。読んだ時点で throw。class 構文の state は warning） | `get "items.*.x"() { return this.$129; }` | ❌ error |
| ボリュームが拒む宣言（`wcs/volume-declaration`。4.0 の scopes/volume.ts。`$stream`・`$watch`・`$listKeys`・`$renderedCallback` は接ぎ木を拒んで console.error — error。`$commandTokens`・`$eventTokens`・`$on`・`$errorCallback` は console.warn で知らせて無視 — warning。class 構文の state は 1 段下げる） | `<wcs-state mount="cart">` の `$watch: { … }` | ❌ / ⚠ |
| 読み込みと併記した `bind-component`（`wcs/bind-component-source`。state はホスト要素のプロパティだけで、ランタイムは読み込みを拒んで console.error — コンポーネントはマウントされない。中のスクリプトはランタイムが読まないので、ほかの検査を重ねない） | `<wcs-state bind-component="state" json='{}'>` | ❌ error |
| 同じ root の 2 つ目の `<wcs-state>`（`wcs/second-root`。state の木は root ごとに 1 つで、後から読み込んだ方は拒まれる） | `<wcs-state>` を `mount` なしで 2 つ | ❌ error |

診断のコードはランタイムと同じです。4.0 のランタイムは、診断の後付けが無いと `[@wcstack/state] [wcs/template-syntax] #203 "outerHTML"` のようにコード・番号・値だけを出し、全部入りの `auto` は文を出します。どの入口を読んだか（`wcs/feature-not-installed`）など、ページを動かさないと分からないものは静的には出しません。マウントしたコンポーネントで `$watch`・`$stream`・`$renderedCallback` が動かないという警告（`wcs/mount-dollar-declaration`）も出しません — その state はコンポーネントの JavaScript のプロパティにあり、拡張は読みません（`<wcs-state bind-component>` の中に書いたスクリプトはランタイムが読まない — `wcs/bind-component-source`）。ボリュームの `$watch` は接ぎ木ごと拒まれるので、キーの存在（`wcs/watch-path-missing`）は検査しません。

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
