# @wcstack/typescript

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**もし、state に書いた型がそれをバインドする HTML まで届いたら？**

`@wcstack/state` のページは DOM と state をパス文字列（`users.*.name`）で結びます。TypeScript の state ファイルはそのパス全部と型を知っています — しかし HTML は `.d.ts` を消費できず、静的検証器（`wcs-validate`・VS Code 拡張）はインラインスクリプトを型注釈を理解しない正規表現アナライザで読みます。`users: [] as { name: string }[]` では `users.*.name` が解決できず、本物の typo は warning 止まり、正しいバインドには偽警告が付きます。

`@wcstack/typescript` はこの穴をコマンド 1 つで塞ぎます。`wcs-schema` は state ファイルを TypeScript コンパイラ API でコンパイルし、検証器が消費する sidecar `wcstack.manifest.json` の `stateSchema` を書き出します — CI でも、どのエディタでも。manifest は**派生物**です: 正本は型のままで、乖離すれば `wcs-schema check` が CI を落とします。

```bash
npm install -D @wcstack/typescript typescript@6
npx wcs-schema emit src/state.ts          # ./wcstack.manifest.json を書く
npx wcs-validate --strict index.html      # typo は error に、偽警告は消える
```

ランタイム依存ゼロ。`typescript` は peer dependency — プロジェクト自身のコンパイラを使います。`wcs-schema` には TypeScript 5 か 6 が必要です: TypeScript 7 は JavaScript のコンパイラ API を公開しません（`typescript` が公開するのは版だけで、`typescript/lib/tsc.js` もありません）。`wcs-tsc` は 5 か 6 で動き、4.8（未リリース）からは content mapper を通して 7.1 以降でも動きます（後述）。

## コマンド

### `wcs-schema emit <state.ts|state.js> [options]`

ファイルの `export default` から manifest の単一の `stateSchema`（`schemaVersion` 2）を生成します（`defineState(...)` は構文的に剥がすので、このパッケージは `@wcstack/state` を解決できなくても動きます）。生成結果は書き出す前に検証器自身の manifest 検査を通します。

トップレベルの spread は、その型のキーを持ち込みます: `{ ...defaults(), get total() { … } }` は、`defaults()` の戻り値の型が挙げるキーを載せます。4.4 から、キーを挙げない型 —— index signature（`Record<string, unknown>`）・`any`・`unknown` —— の spread があると、schema は開いた `{}` になります（警告付き）。コンパイラは spread から index signature を落とすので、literal 自身のキーだけの schema にすると、spread のキーがすべて `wcs/path-nonexistent` になってしまうためです。その式に型を付けてください。キーが表から来るなら、型も表から導けば、宣言は 1 か所のままです:

```javascript
export const FIELDS = /** @type {const} */ ({ total: { type: "amount" }, married: { type: "flag" } });
/**
 * @typedef {{ amount: number, flag: boolean }} ValueOf
 * @typedef {{ -readonly [K in keyof typeof FIELDS]: ValueOf[(typeof FIELDS)[K]["type"]] }} Inputs
 * @returns {Inputs}
 */
export const defaults = () => /** @type {Inputs} */ (Object.fromEntries(
  /** @type {(keyof typeof FIELDS)[]} */ (Object.keys(FIELDS)).map((k) => [k, FIELDS[k].type === "flag" ? false : 0])));
```

4.4 から、コマンドは大きなスタックの worker スレッドで動きます。spread のある literal では、TypeScript のチェッカーが `this` を読む getter 1 本ごとに 1 段再帰し、getter が 100 本ほどの state で主スレッドのスタックが尽きたためです。API（`generateStateSchema()`）から呼ぶと、そうした state は `the TypeScript checker ran out of stack` を投げることがあります。`resourceLimits.stackSizeMb` を大きくした worker で呼んでください。

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

exit code は tsc のもの（`0` クリーン・診断があれば非ゼロ）。`typescript` / `@volar/typescript` が解決できないときと不正なオプションは `2`。1 ページに複数の `<wcs-state>` があれば 1 本の仮想モジュールに合成（import は巻き上げ・各ブロックは自分のスコープ）し、インライン state の無いページは空のモジュールになります。TypeScript 5 と 6 での仕組みは vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクト自身の `typescript/lib/tsc.js` にパッチを当てます。7.1 以降では、次の content mapper です。

### TypeScript 7.1: content mapper（experimental）

4.8（未リリース）から、このパッケージは [content mapper](https://github.com/wcstack/wcstack/blob/main/docs/typescript-content-mapper.ja.md) でもあります — TypeScript 7.1 が知らない種類のファイルを読む仕組みです。`tsconfig.json` で名指せば、TypeScript 自身の `tsc` が、`wcs-tsc` と同じ仮想コードで各 `<wcs-state>` のブロックを検査し、HTML の位置で報告します:

```jsonc
{
  "compilerOptions": { "noEmit": true },
  "contentMappers": [
    { "package": "@wcstack/typescript", "extensions": [".html"] }
  ]
}
```

```bash
npm i -D @wcstack/typescript typescript@^7.1
npx tsc --runExternalCode          # TypeScript はこのフラグがあるときだけ mapper を動かす
```

| オプション（項目の `"options"`） | 説明 |
|---|---|
| `urlImports`: `"any"`（既定）/ `"error"` | `wcs-tsc --url-imports` と同じ: `http(s)://` のモジュール import を `any` にするか、それぞれ TS2307 にする |
| `stateTagName`（既定 `"wcs-state"`） | state を持つ要素。VS Code 拡張の `wcstack.stateTagName` と同じ |

- **7.1 以降の `wcs-tsc`** は tsconfig を変えなくてよい: プロジェクトの `tsc --runExternalCode` を動かし、設定が mapper を名指していなければ、設定の隣に一時の設定（`.wcs-tsc.<名前>`、終われば消す）を置いて mapper を足す。継承している他の content mapper は保つ。`--wcs-defaults` と警告は上と同じように働く（7.1 では、`.html` が program に入っていることと `noImplicitThis` が有効なことを確かめる）。`@wcstack/typescript` は tsconfig のある場所に入っている必要がある — TypeScript はそこから mapper を読む。Volar は要らない。TypeScript 7.0 には content mapper が無く、断る。
- **エディタ。** VS Code に TypeScript 7 の拡張があり、ワークスペースを信頼していると、wcstack の拡張の隣で TypeScript のサーバーも `.html` に答える。どちらか一方にするには `"js/ts.contentMappers.enabled": false` を設定する。
- `wcs-schema` は今までどおり TypeScript 5 か 6 が要る。

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
| `Date`、`Map`、`Set`、DOM 型、ライブラリ由来の型、`any`、`unknown`、`Record<string, T>`、インデックスシグネチャを持つオブジェクト型（`{ [year: number]: T }`、`{ [key: string]: T }`） | **素の `{}`** |
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
