# @wcstack/typescript

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**もし、state に書いた型がそれをバインドする HTML まで届いたら？**

`@wcstack/state` のページは DOM と state をパス文字列（`users.*.name`）で結びます。TypeScript の state ファイルはそのパス全部と型を知っています — しかし HTML は `.d.ts` を消費できず、静的検証器（`wcs-validate`・VS Code 拡張）はインラインスクリプトを型注釈を理解しない正規表現アナライザで読みます。`users: [] as { name: string }[]` では `users.*.name` が解決できず、本物の typo は warning 止まり、正しいバインドには偽警告が付きます。

`@wcstack/typescript` はこの穴をコマンド 1 つで塞ぎます。`wcs-schema` は state ファイルを TypeScript コンパイラ API でコンパイルし、検証器が消費する sidecar `wcstack.manifest.json` の `stateSchema` を書き出します — CI でも、どのエディタでも。manifest は**派生物**です: 正本は型のままで、乖離すれば `wcs-schema check` が CI を落とします。

```bash
npm install -D @wcstack/typescript typescript
npx wcs-schema emit src/state.ts          # ./wcstack.manifest.json を書く
npx wcs-validate --strict index.html      # typo は error に、偽警告は消える
```

ランタイム依存ゼロ。`typescript` は peer dependency — プロジェクト自身のコンパイラを使います。

## コマンド

### `wcs-schema emit <state.ts|state.js> [options]`

ファイルの `export default` から `states[<name>].stateSchema` を生成します（`defineState(...)` は構文的に剥がすので、このパッケージは `@wcstack/state` を解決できなくても動きます）。生成結果は書き出す前に検証器自身の manifest 検査を通します。

| オプション | 説明 |
|---|---|
| `--state=<name>` | state 名（既定 `default`） |
| `--out=<path>` | 出力先 manifest（作業ディレクトリ相対・既定 `wcstack.manifest.json`）。`--out=-` で stdout |
| `--merge` | 既存 manifest の他の内容（他 state・`filters`・`listContexts`）を保持し、この state の `stateSchema` だけ置き換える。同じ state の手書き schema は合成されず置き換わる |
| `--tsconfig=<path>` | コンパイルに使う `tsconfig.json`（既定: state ファイルから上に辿って最も近いもの、無ければ組み込み既定） |
| `--max-depth=<n>` | ここより深い入れ子は素の `{}` で打ち切る（既定 `5` = 検証器の探索予算と同じ） |

exit code: `0` 書き出し済み · `2` usage エラー / 読めない / 構文エラー / 生成物が自己検査に落ちた。

### `wcs-schema check <state.ts|state.js> [options]`

schema を再生成し、`--manifest=<path>`（既定 `wcstack.manifest.json`）の内容とキー順を無視して比較します。

exit code: `0` 最新 · `1` 乖離あり（変更は JSON pointer で列挙: `+` 型にだけある / `-` manifest にだけある / `~` 違う） · `2` usage エラー / manifest が無い / その state の `stateSchema` がまだ無い。

推奨する CI ゲート:

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

### `wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc の引数...]`

`.html` に対する `tsc`: 各 `<wcs-state>` のインライン `<script type="module">` を VS Code 拡張と同じ言語プラグイン（型付き `this`・自動 `defineState` ラップ・bare でも CDN URL でも `@wcstack/state` import を除去）で型検査し、診断は HTML の位置を指します:

```bash
npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0   # optional peer・wcs-tsc だけが必要
npx wcs-tsc --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<…>'. Did you mean 'count'?
```

| オプション | 説明 |
|---|---|
| `--url-imports=any`（既定） | 全ての `http(s)://` モジュール import を `any` に型付ける — buildless なページは tsc が解決できない CDN から import する |
| `--url-imports=error` | URL import をそのまま残す（それぞれ TS2307） |
| `--wcs-defaults` | プロジェクトの tsconfig に `**/*.html` を覆う `include`・`noImplicitThis`・`allowJs`・`checkJs` が無ければ、元を extends してそれらを足した一時 config で実行する（無指定なら警告だけで HTML が検査されないことがある） |
| それ以外 | tsc にそのまま渡す（`-p`・`--noEmit` …） |

exit code は tsc のもの（`0` クリーン・診断があれば非ゼロ）。`typescript` / `@volar/typescript` が解決できないときと不正なオプションは `2`。1 ページに複数の `<wcs-state>` があれば 1 本の仮想モジュールに合成（import は巻き上げ・各ブロックは自分のスコープ）し、インライン state の無いページは空のモジュールになります。仕組みは vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクト自身の `typescript/lib/tsc.js` にパッチを当てます。

## 生成される schema の中身

sidecar 規範が許す JSON-Schema サブセットだけ（`type` / `properties` / `required` / `items` / `enum` / `const` / `anyOf`）:

| TypeScript | stateSchema |
|---|---|
| `string` / `number` / `boolean` / `null` | `{ "type": … }`（`integer` は使わず全て `number`） |
| `"a" \| "b"`、`1 \| 2` | `{ "type": "string", "enum": ["a", "b"] }` |
| `T[]`、`readonly T[]`、タプル | `{ "type": "array", "items": … }` |
| `T \| null` | `{ "anyOf": [T, { "type": "null" }] }` |
| `T \| undefined`、`x?: T` | `T`。`x` は `required` に入らない |
| `A \| B`（オブジェクトや混在プリミティブ） | `{ "anyOf": [A, B] }` |
| 自分のコードのオブジェクトリテラル / interface / class | `{ "type": "object", "properties": …, "required": … }` |
| `Date`、`Map`、`Set`、DOM 型、ライブラリ由来の型、`any`、`unknown`、`Record<string, T>` | **素の `{}`** |
| `get x(): T` | `x: T` — getter はメンバー |
| `get "users.*.ageCategory"(): string` | `users.items.properties.ageCategory` に注入 — パス getter は計算先のパスのメンバー |
| メソッド、関数値プロパティ、`$` 始まりキー（`$watch`・`$commandTokens` …） | 捨てる |
| `--max-depth` より深い入れ子 | 素の `{}` |

素の `{}` が要点です: 検証器はこれを *unknown* として扱いその下では沈黙しますが、メンバーを欠く型付きオブジェクトは *nonexistent* で **error** です。`Date` や `Record<string, unknown>` の下のパスが偽 error になることはありません。

## ライブラリ API

```ts
import { generateStateSchema, buildManifest, compareStateSchema } from "@wcstack/typescript";

const { schema, warnings } = generateStateSchema("src/state.ts");   // { tsconfig?, maxDepth? }
const manifest = buildManifest("default", schema /*, 既存の manifest オブジェクト */);
const result = compareStateSchema(JSON.stringify(manifest), "default", schema); // { kind: "same" } | { kind: "differs", changes } | …
```

`loadStateFile` / `stateTypeToSchema` は 2 つの半分（コンパイラ program・型 → schema）を別々に組み合わせたいツール向けに公開しています。

## 位置づけ

- 検証器側 — 最近傍 `wcstack.manifest.json` の発見、`wcs/path-nonexistent`、`wcs/path-type-mismatch` — は [`@wcstack/lint`](../lint/README.ja.md#state-の契約を宣言するstateschema) と、規範としては [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md) にあります。
- wcstack アプリの TypeScript の話全体（`defineState` による `this` の型付け、このパッケージ、tag name map、`wcs-tsc`）は [`docs/typescript.ja.md`](https://github.com/wcstack/wcstack/blob/main/docs/typescript.ja.md) にまとめています。

## License

MIT
