# Changelog

## 1.11.0 (Unreleased)

### Deprecations

- **`wcs/named-state-deprecated`**（warning）— 名前付き State（`<wcs-state name="x">` / `path@x` / `{{ path@x }}`）は v2 で廃止され、`<wcs-state mount="x">` と接頭辞付きパス `x.path` に置き換わる（`docs/state-mount-design.md` D1 / D16、`docs/state-mount-impl-plan.md` Phase 1）。1.x には `mount=` が無いのでランタイムは既定で黙り（`config.debug` 下だけ warn 1 回）、この診断と README の告知が主経路。Light DOM の `bind-component`（今日 name が必須）には出さない。`@default` は「外せ」と言う。フィルタ引数の `@` は対象外。severity は warning（v2 で parse error になるとき error に昇格）

### Features

- **`wcs-tsc` の器**（`@wcstack/typescript` が同梱する `dist/tsc-core.cjs`）— Language Plugin を `LanguagePlugin<URI | string>` に一般化（`@volar/typescript` の `runTsc` はファイルパス文字列で呼ぶ）し、`mode: 'tsc'` を追加。proxyCreateProgram は 1 ファイル 1 サービススクリプトしか扱えないため、tsc モードでは全 `<wcs-state>` ブロックを 1 本の仮想 TS に合成する（プリアンブル 1 回・import は巻き上げ・各ブロックは `{ const __wcs_state_N = defineState(…) }` のスコープ・診断は HTML へ写像）。`<wcs-state>` の無いページは空モジュール（undefined を返すと `.html` が素の TS として読まれ構文エラーになる）。`stripWcsImport` は CDN の URL 指定（`https://esm.run/@wcstack/state`・jsDelivr の `@version/+esm` 等）も剥がすようになり、IDE でも URL import 時の TS2307 が消えた。IDE 側の挙動（Language Server モード）は不変

- **sidecar `stateSchema` の消費**（`wcs/path-nonexistent` / `wcs/path-type-mismatch`・error）— `wcstack.application.states[name].stateSchema` は規範・型・`resolveSchemaPath` まで揃っていながら**消費者がゼロ**で、manifest を置いても診断は変わらなかった。HTML の位置から最も近い `wcstack.manifest.json` を自動発見し（規範 §5-1 を改定: 呼び出し側指定 → 最近傍 1 つ・合成なし。CLI 引数の application manifest は発見を丸ごと置き換える）、宣言された state では未存在パスを warning でなく **error** にする。存在判定は候補集合の平坦化ではなく `resolveSchemaPath` の三値で行い、素の `{}` の下（unknown）は沈黙、script 由来のメソッド / getter / `$listKeys` は schema に無くても存在扱い。`for:` に schema で非配列と確定したパスは `wcs/path-type-mismatch`。同じパスの型は schema が勝つ。同名 state を複数の application manifest が宣言すれば `wcs/manifest-state-collision`（error・勝者なし）。application の `stateSchema` も subset 規則（未知 keyword）で検査するようになった。IDE（`provideDiagnostics`）と CLI は同じ `discoverApplicationManifest` を同じ reader で通るので診断は一致する。設計の正本: `docs/app-testing-and-typescript-impl-plan.md` D6 / D8 / D12

- **`attr.aria-*` の属性名検査**（`wcs/aria-attr-unknown`・warning）— `attr.aria-labels: x` のような WAI-ARIA に存在しない属性名へのバインドを検出し、編集距離 2 以内の最近傍（「もしかして: "aria-label"」）を提示する。setAttribute はタイポをそのまま書き、支援技術は黙って無視する —「黙って無効になる」クラスの誤りの静的検出（設計の正本: `docs/a11y-design.md` §8 / D9）。照合リストは WAI-ARIA 1.2 全 states & properties + 実装が先行する 1.3 追加分（deprecated も有効名として許容）。severity は warning リテラル（error 昇格時は `packages/lint/scripts/smoke-test.mjs` の対ケース更新が必須）

- **hover / 定義へ移動 / 参照の検索 / インレイヒント** — 位置情報付き参照インデックス（`core/index/referenceIndex`）へのクエリとして 4 機能を新設（`core/navigation/wiringLens` + `wcs-navigation` Volar プラグイン）。設計の正本: `docs/static-wiring-dx-design.md` §5-2 / §5-3
  - **hover**: バインディングパスに種別（data / computed / list / メソッド / command・event トークン）・推定型・所属 state・宣言行。`for` 短縮パスは展開後（`` `.name` → `users.*.name` ``）を表示。フィルタ名にシグネチャ・説明・型変換、修飾子（`#prevent` / `#stop` / `#ro` / `#init=` / `#sync=` / `#on<event>`）に意味説明。解決できないパスには何も出さない（誤ヒントゼロ）— `src` 外部 state だけは「外部定義」と明示
  - **定義へ移動**（F12）: ドットパスは第 1 セグメントへフォールバック。`$command.<name>` → `$commandTokens`、`$streamStatus.*`/`$streamError.*` → `$streams`、event-token 配線 → `$eventTokens`。`src` 外部 state は `<wcs-state src=…>` タグへ
  - **参照の検索**（Shift+F12）: 双方向（出現 ⇄ 宣言・短縮形は展開後パスで統合）。`$1`〜`$9` は「外側から N 枚目の for テンプレート実体」でスコープし、無関係なループ間では統合しない
  - **インレイ**: `for` 短縮パスの展開後表示（ランタイムの属性書き換えと同一）・フィルタ鎖の結果型（`→ string`。passthrough フィルタは型不明扱い）・spread の展開規模（`→ 13 props` — 組み込み wcs-* タグ限定。wcBindable を持たないタグには出さない）
- **text チャネルの正本化** — mustache / コメントバインディングの解析をランタイムと同じ `parseBindTextForEmbeddedNode` 経路（`;` 無分割）に統一。`{{ a; b }}` は「a; b」1 本のパスとして扱われ、分割由来の偽 problems が消滅。言語サーバー常駐時のパーサキャッシュ単調増加もドキュメント単位の `clearParserCaches` で抑止
- **spread の無宣言タグ検査**（`wcs/spread-no-bindable`・error）— wcBindable を宣言しないヘルパータグ（`wcs-fetch-header` / `wcs-fetch-body` / `wcs-infinite-scroll` / `wcs-voice`）への `...:` spread はランタイム（`expandSpread`）が raiseError で落とす構成。生成カタログに `hasWcBindable` を記録し、静的に error として指摘する（空の wcBindable = `wcs-noise` は合法な 0 展開として対象外）
- **入れ子配列のパス候補導出** — 配列の先頭要素の子（配列・オブジェクト）へ再帰し、`a.*.b.*` / `a.*.b.*.c` / `a.*.meta.title` が補完・検証・hover に載るようになった（script / JSON 両側・深度上限共有）。実 examples で偽の「未知パス」warning が 2 件解消

- **`$watch` 宣言の診断** — `@wcstack/state` の headless 変更購読（`$watch: { "<path>": handler }`）への追従。宣言キーは監視対象の state パスであり、`data-wcs` の右辺と同じ性質を持つ一方で、**誤りの出方が違う**: バインディング側のタイプミスは「描画されない」形で目に見えるが、`$watch` 側は**黙って一度も発火しない**。設計の正本: `docs/state-watch-hook-design.md`
  - `wcs/watch-path-missing`（warning）— キーが状態定義に存在しない。severity は `wcs/binding-path-missing` に揃える（初期値が空配列の行フィールドなど、静的に解決できない正当な形があるため）。パス候補が 1 つも取れないスクリプトでは照合をスキップし誤警告を出さない
  - `wcs/watch-declaration-invalid`（error）— ランタイム（`watch/processWatchDeclaration.ts`）が raiseError で落とす形。`@` 付きの越境 watch（設計 D8 で不採用）/ `$` 始まり / 空のパスセグメント / 明らかな非関数リテラルのハンドラ。識別子参照（`count: this.onChange`）は静的に解決できないため疑わない
  - キー 1 つにつき報告は 1 件（直す順番を増やさない）
  - preamble の `defineState` に `$watch` の文脈型を追加（ハンドラ引数が `noImplicitAny` 下で偽エラーにならない）
- **引用符付きメソッド短縮記法の解析** — `"items.*.price"(cur, prev, index) {}` 形式（ドットや `*` を含むキーは引用符でしか書けず、`$watch` のワイルドカード行ハンドラはまさにこの形）がトップレベルプロパティとして認識されていなかった問題を修正。従来は宣言が解析結果から丸ごと消え、さらに本体内のオブジェクトリテラルが誤ってトップレベルのパス候補になり得た。既存 HTML 全件で診断の差分ゼロを実測
- **`$listKeys` 宣言対応** — `@wcstack/state` のリストキー宣言（`$listKeys: { "<listPath>": "<field>" | (row) => key }`）への追従
  - 宣言されたリストパスを `<listPath>` / `<listPath>.*` / `<listPath>.length` として実体化。初期値が空配列（`items: []`）で要素の形が読めないケースでも `for: items.*.children` 等が補完・検証に載る
  - 文字列キー指定からは行のキーフィールド（`<listPath>.*.<field>`）も導出。関数キー指定はフィールド名が確定しないためリストパスのみ
  - ランタイム（`list/listKeys.ts`）が raiseError で弾く形の宣言 — 空パス / 空セグメント / 末尾 `*` / 非フラットなキーフィールド名 — からは候補を作らず、壊れた宣言を静的側が追認しない
  - preamble の `defineState` にキー指定の文脈型を追加（`(row) => row.uid` が `noImplicitAny` 下で偽エラーにならない）
- **配列破壊的操作の診断** — `<wcs-state>` スクリプト内の配列への破壊的操作を検出する 2 診断を追加（warning、IDE / `wcs-validate` CLI 共通）。設計・検証の正本: `docs/array-mutation-diagnostic-design.md`
  - `wcs/array-mutation` — `this.items.push(...)` 等 9 種の破壊的メソッド呼び出し。リアクティブ更新をトリガーせず、同一参照の自己再代入でも要素の追加・削除は反映されない（動的検証済み）。メッセージでメソッド別の非破壊代替（`concat` / `toSpliced` / `toSorted` 等）を提示
  - `wcs/array-index-assign` — `this.items[0] = x` 形式のインデックス代入（bracket-only チェーン）。単純代入に加え複合代入 15 種（`+=` `??=` 等）・前置/後置 `++` `--`・bracket ルート形（`this["items"][0] = x`）・式添字（`this.items[this.items.length] = x` の append イディオム）も検出（いずれも非リアクティブを動的検証済み）。ドットパス代入 `this["items.0"]` と `with()` を提示。ドットアクセスを含むチェーンは従来どおり `wcs/nested-assign` の担当（二重報告なし）
  - 両診断とも optional chaining（`?.`）・改行/空白折返しチェーン・`$` 含み識別子に対応

### Fixes

- **`wcs/nested-assign` の検出拡張** — 複合代入（`this.user.count += 1`）・前置/後置 `++` `--`・式添字チェーン（`this.rows[this.i].name = x`）が検出されていなかったギャップを解消（ランタイムでは単純代入と同じく非リアクティブ）。識別子添字の提示パスを `a.i.b` から動的添字マーカー `a.<i>.b` へ統一。プレーン `=` の診断 range は不変
- **`<script>` の `type` 属性値を ASCII case-insensitive で判定** — `type="Module"` / `TYPE="MODULE"` のブロックが全 script 系診断からスキップされていた問題を修正（HTML 仕様準拠。`application/json` 判定も同様）
- **state スクリプト走査のトークン境界** — コメント・文字列・テンプレートリテラルの中身を空白に潰した鏡像（オフセットは原文と一致）に対して走査するようにした。従来は生ソースに正規表現をかけていたため、`// note: メモ` のようなコメント内・文字列内の `word:` をトップレベルプロパティと誤認し、そこから次の `,` までを「値」として飲み込んで実在の宣言を丸ごと見失っていた（見失った宣言へのバインディングが `wcs/binding-path-missing` の誤検出になる）
- **getter / setter 本体のスキップ** — getter はメソッドと違い本体を読み飛ばしていなかったため、本体内の `word:`（`return "https:"` 等）で走査位置がずれ、以降の宣言が候補から落ちていた。あわせて `set "ws.message"(value)` 形式の setter を宣言として認識する（従来は構文自体が未対応）。get / set のペアは 1 候補に畳む
- **単独の省略パス `.` の展開** — `<forPath>.*.` と末尾区切り付きに展開していたため、`{{ . }}` / `textContent: .` が要素の実在にかかわらず常に「パスが存在しない」warning になっていた。ランタイム（`@wcstack/state` の `structural/expandShorthandPaths.ts`）と同じく `<forPath>.*` に展開する
- **入れ子 `<template>` の内外判定** — 直近の開始位置と終了位置の比較で判定していたため、内側の `</template>` より後ろが外側 `<template>` の中でも「テンプレート外」と誤判定され、FOUC info と `<template for>` 外の省略パス warning が同時に誤発火していた。`forContext.ts` と同じ深度カウントに統一

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
