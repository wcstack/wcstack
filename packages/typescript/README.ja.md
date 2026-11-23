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

ランタイム依存ゼロ。`typescript` は peer dependency — プロジェクト自身のコンパイラを使います。TypeScript 5 か 6 が必要です: TypeScript 7 は、どちらのコマンドも呼べる JavaScript のコンパイラ API を公開しません（`typescript` が公開するのは版だけで、`typescript/lib/tsc.js` もありません）。

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
| `--mount=<path>` | この mount パスの部分木だけを出す — `<wcs-state mount="…">` のボリュームの型ファイルは、単一のツリーの部分木として merge される。ルートの state ファイルでは付けない |
| `--out=<path>` | 出力先 manifest（作業ディレクトリ相対・既定 `wcstack.manifest.json`）。`--out=-` で stdout。4.26 から、無いディレクトリは作る |
| `--merge` | 既存 manifest の他の内容（`filters`・`listContexts`・他の部分木）を保持し、書くスロット — `stateSchema` 全体、または `--mount` の部分木 — だけ置き換える。そのスロットの手書き schema は合成されず置き換わる |
| `--state-source=<path>` | 4.26 から: ページのルートの `<wcs-state src>` が state ファイル自身でないとき — `src/state.ts` からコンパイルした `public/state.js` のようなビルドの出力 —、そのファイル。state ファイルの代わりに `stateSource` に書く（下）。`check` にも同じ指定を渡す。`--mount` とは併用できない |
| `--tsconfig=<path>` | コンパイルに使う `tsconfig.json`（既定: state ファイルから上に辿って最も近いもの、無ければ組み込み既定） |
| `--max-depth=<n>` | ここより深い入れ子は素の `{}` で打ち切る（既定 `5` = 検証器の探索予算と同じ） |

exit code: `0` 書き出し済み · `2` usage エラー / 読めない / 構文エラー / 生成物が自己検査に落ちた。

4.26 から、ルートの emit（`--mount` なし）は schema の元のファイルも書きます: application 名前空間の `stateSource` に、manifest のディレクトリから見た state ファイルのパスを `/` 区切りで（`"src/state/app.ts"`。`--out=-` では作業ディレクトリから）。検証器は、ルートの `<wcs-state src>` がそのファイルであるページにだけ schema を当てます（同じパスの `.js` は同じファイルとみなす）。だから、`wcs-validate` と VS Code 拡張が見つけるプロジェクトのルートに置いた 1 つの `wcstack.manifest.json` で、ページが複数あるアプリが済みます: インラインの state や別の `src` を持つページは、この schema ではなく自分のスクリプトで検査されます。ページがビルドの出力を別のパスから読むとき（`tsc --outDir`）は、そのファイルを `--state-source` で渡してください。渡さないと schema はどのページにも当たりません。`--mount` の emit は `stateSource` をそのまま残します。`stateSource` の無い manifest（4.25 以前に書いたもの）は、今までどおり配下のすべてのページに当たります。`wcs-schema emit <state ファイル> --merge` で書き足せます。

### `wcs-schema check <state.ts|state.js> [options]`

schema を再生成し、`--manifest=<path>`（既定 `wcstack.manifest.json`）の内容とキー順を無視して比較します。

exit code: `0` 最新 · `1` 乖離あり（変更は JSON pointer で列挙: `+` 型にだけある / `-` manifest にだけある / `~` 違う） · `2` usage エラー / manifest が無い / その state の `stateSchema` がまだ無い。

4.26 から、`check` は `stateSource` も state ファイル（または `--state-source`）と比べます: 別のファイルを指す manifest は乖離です（`~ stateSource`・exit `1`）。検証器はその schema を、このファイルのページではなく、そのファイルのページに当てるからです — state ファイルを動かしたか名前を変えて、作り直していない。`stateSource` の無い manifest は最新のままで、`check` は注記を添えます。

推奨する CI ゲート:

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

**ボリュームのある木。** 4.28（未リリース）から、`emit --mount=<path>` はマウントパスを manifest に記録します（application 名前空間の `stateMounts`）。ルートの `check` は、記録された部分木を除いて木を比べ — ボリュームはそれぞれ自分の `--mount` で検査します — ルートの `emit --merge` はそれらを残します。ルートと 2 つのボリュームのゲートは

```bash
npx wcs-schema check src/state/app.ts \
  && npx wcs-schema check src/state/map.ts --mount=map \
  && npx wcs-schema check src/state/cart.ts --mount=cart \
  && npx wcs-validate --strict index.html
```

4.27 までは、ルートの `check` がすべてのボリュームのすべてのキーを乖離として挙げて `1` で終わり、勧める `emit --merge` は、ボリュームごと木を置き換えていました。前の版でボリュームを merge した manifest には `stateMounts` がありません: ボリュームをそれぞれもう一度 emit してください。

### `wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc の引数...]`

`.html` に対する `tsc`: 各 `<wcs-state>` のインライン `<script type="module">` を VS Code 拡張と同じ言語プラグイン（型付き `this`・自動 `defineState` ラップ・bare でも CDN URL でも `@wcstack/state` import を除去）で型検査し、診断は HTML の位置を指します:

```bash
npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0   # optional peer・wcs-tsc だけが必要
npx wcs-tsc --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<…>'. Did you mean 'count'?
```

スクリプトは、ブラウザが実行するとおり JavaScript として検査します（4.26 から。4.25 までは TypeScript として読んでいました）: JSDoc の型が効き（`/** @type {Item[]} */ items: []`・`/** @param {number} n */`・`/** @typedef {import("./api").Item} Item */`）、TypeScript の構文 — 型注釈・`as`・`import type` — はその場所でエラーになります（`index.html(5,14): error TS8010: Type annotations can only be used in TypeScript files.`）。ブラウザでは `SyntaxError` になるからです。検査は `checkJs` の指定に関わらず有効です。`$on` のハンドラの引数には型が付き、`this.$command` は `$commandTokens` に絞られます — `defineState` と同じです（[define-state.ja.md](../state/docs/define-state.ja.md)）。

| オプション | 説明 |
|---|---|
| `--url-imports=any`（既定） | 全ての `http(s)://` モジュール import を `any` に型付ける — buildless なページは tsc が解決できない CDN から import する |
| `--url-imports=error` | URL import をそのまま残す（それぞれ TS2307） |
| `--wcs-defaults` | プロジェクトの tsconfig がページを外している、または ES2015 以降の `target` / `lib` が無ければ、元を extends して `include: "**/*.html"`（と `target`）を足した一時 config で実行する（無指定なら警告だけ） |
| それ以外 | tsc にそのまま渡す（`-p`・`--noEmit` …） |

tsconfig に要るのは、ページに届くことと ES2015 以降を target にすることだけです。4.26 から、HTML のために `noImplicitThis`・`allowJs`・`checkJs` は要りません（JavaScript ではオブジェクトリテラルの `this` に `noImplicitThis` 無しで型が付き、検査はプラグインが有効にします）。監査もそれらを求めません。インラインの `<wcs-state>` を持つページが tsconfig のディレクトリの下にあり、そのどれも program に無いとき — `include: ["src"]` で、ページが tsconfig の隣にある — 警告はページを名指しします: `wcs-tsc: warning: …/tsconfig.json is missing include: "**/*.html" (no page with an inline <wcs-state> is in the program: counter.html is not) — HTML may not be checked; …`（`warning:` は 4.26 から。CI のログを `error|warning` で絞っても残ります）。警告は exit code を変えません。CI では `--wcs-defaults` を付ければ、それでもページを検査します。完全な検査には `strict`（少なくとも `noImplicitAny`）を有効にしてください: 無いと JavaScript のオブジェクトリテラルは開いた型になり、配列の中のオブジェクトのプロパティの綴りの誤り（`this.items[0].nmae`）は報告されません — `this.coutn` は報告されます。

exit code は tsc のもの（`0` クリーン・診断があれば非ゼロ）。`typescript` / `@volar/typescript` が解決できないときと不正なオプションは `2`。1 ページに複数の `<wcs-state>` があれば 1 本の仮想モジュールに合成（import は巻き上げ・各ブロックは自分のスコープ）し、インライン state の無いページは空のモジュールになります。仕組みは vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクト自身の `typescript/lib/tsc.js` にパッチを当てます。

## Vite でビルドする

4.26 から、`@wcstack/typescript/vite` は wcstack のタグで書いたページのための Vite プラグインです:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { wcstack } from "@wcstack/typescript/vite";

export default defineConfig({
  plugins: [wcstack()],
});
```

- **`<wcs-state src="./src/state.ts">`。** `@wcstack/state` はファイルを実行時に `import(src)` で読むので、Vite からは見えません: 開発サーバーは求められれば出しますが、`vite build` は属性をそのまま残してファイルを出さず、本番では state が 404 になります。プラグインがあると、ビルドは `<wcs-state>` のローカルな `src`（ルートの state も `mount` のボリュームも）のファイルをそれぞれ自分の chunk として出し — `export default` を保ち、モジュールはページの bundle と共有する —、属性を `base` の下のそのファイルの URL に書き換えます。`src` はページと同じに解決します: ページか、その `<base href>` から。`.json` の state はアセットとして出し、`public/` のファイルはそのまま、外部の URL は触らず、後ろにファイルの無い `src` はそれを名指ししてビルドを落とします。
- **インラインのスクリプト。** Vite は、開発でもビルドでも、インラインの `<script type="module">` をすべてページから bundle へ移します。`<wcs-state>` の中のもの（state）と `<wcs-guard-handler>` の中のもの（ガード）は要素が読むので、プラグインはページに残します: `vite-ignore` は要りません。

開発では、プラグインは Vite が `<script src>` を変える所でだけ `src` を変えます: 絶対パスには `base` を付け、SPA のフォールバックが深い URL に出すときは相対のものを絶対にします（`<base>` のあるページは除く）。タグ名を変えたページは渡します: `wcstack({ tagNames: { state: "app-state", guardHandler: "app-guard" } })`。`vite`（6 以降）は optional な peer dependency で、プラグインが import するのはその型だけです。

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
// （mount パス・ルートなら null、schema、既存の manifest オブジェクト?、stateSource?）
const manifest = buildManifest(null, schema, undefined, "src/state.ts");
const result = compareStateSchema(JSON.stringify(manifest), null, schema, "src/state.ts"); // { kind: "same" } | { kind: "differs", changes, stateSource? } | …
```

`loadStateFile` / `stateTypeToSchema` は 2 つの半分（コンパイラ program・型 → schema）を別々に組み合わせたいツール向けに公開しています。

## 位置づけ

- 検証器側 — 最近傍 `wcstack.manifest.json` の発見、`wcs/path-nonexistent`、`wcs/path-type-mismatch` — は [`@wcstack/lint`](../lint/README.ja.md#state-の契約を宣言するstateschema) と、規範としては [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md) にあります。
- wcstack アプリの TypeScript の話全体（`defineState` による `this` の型付け、このパッケージ、tag name map、`wcs-tsc`）は [`docs/typescript.ja.md`](https://github.com/wcstack/wcstack/blob/main/docs/typescript.ja.md) にまとめています。

## License

MIT
