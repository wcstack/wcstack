# wcstack と TypeScript

- **状態**: wcstack で*アプリを作る*ときの TypeScript に関する唯一の入口（パッケージ自体の開発向けではない）。2026-08-30 に [app-testing-and-typescript-impl-plan.md](./app-testing-and-typescript-impl-plan.md) と並行して起草。*予定* と付いた節は同計画の Phase で実装される。
- **対象**: wcstack パッケージを `npm install` して `tsc` を回すプロジェクト。CDN だけのページ（Import Map・`https://esm.run/...`）にも §2 は届く — 検証器の仕事は HTML と manifest だけで成立する — が、§3 と §4 はパッケージの型が TypeScript プログラムに載っている必要がある。

wcstack の UI と state の契約は**パス文字列**であり、TypeScript は文字列の中を見ない。したがって wcstack アプリの「型安全」は 4 つの別々のことで、それぞれに道具がある:

| 欲しいもの | 道具 | 届く先 |
|---|---|---|
| state のメソッド / getter 内で型の付いた `this` | `defineState`（§1） | state ファイルを型検査する全プロジェクト |
| HTML の `data-wcs` パスを state の本当の型で検証（CI でも全エディタでも） | `wcs-schema` → `wcs-validate`（§2） | CDN ページ含む全プロジェクト |
| `document.querySelector("wcs-fetch")` が `WcsFetch` に型付く | `HTMLElementTagNameMap` 拡張（§3・*予定*） | npm + tsc プロジェクト |
| `<wcs-state>` 内のインライン `<script type="module">` を CI の `tsc` で検査 | `wcs-tsc`（§4・*予定*） | npm + tsc プロジェクト |

## 1. state に型を付ける: `defineState`

`@wcstack/state/define` が export する `defineState` は identity 関数で、メソッドと getter の中の `this` にドットパス参照込みで正しい型を与えることだけが仕事。ランタイムを持たない `/define` から import する — 4.0 では `@wcstack/state` から import すると、バンドルにエンジン全体（gzip で約 21 KB）が残る:

```ts
import { defineState } from "@wcstack/state/define";

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],
  increment() { this.count++; },              // number
  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";   // string
  },
});
```

ツール向けに `WcsPaths<T>` と `WcsPathValue<T, P>` も export されている。リファレンス: [packages/state/docs/define-state.ja.md](../packages/state/docs/define-state.ja.md)。

本体が `this` を読む getter には戻り値の型を書く（`get total(): number { … }`）: 書かないと、TypeScript はその戻り値が依存する読みを `any` にする。4.26から、lint もその注釈を読む: 4.25 までは、戻り値の型を書いた getter やメソッドが lint からまったく見えず、スクリプトの規則もそれを飛ばしていた。同じく 4.26 から、`$on` のハンドラの引数に型が付く — `state`（state: そのデータ・getter・パス・API。メソッドは `any`）、`event`（`CustomEvent`）、行の添字（`number`）、`this` は `void`（`this` を読むハンドラは投げる）— そして `this.$command` は `$commandTokens` の名前ちょうどになる: 綴りを間違えたトークンは型のエラーで、`noUncheckedIndexedAccess` で使うたびに「undefined かもしれない」と言われることもない。`<T>` だけを渡す呼び出しは、前の型付けのまま。

再帰パス（`$recursion` で宣言する `**`）はパターン索引シグネチャで `any` になる — 深さの族はユニオンとして列挙できないため — 一方、通常のドットパスは解決された型を保つ。VS Code 拡張の preamble も同じシグネチャを宣言しているので、エディタと `tsc` の報告は一致する。

`tsc` 単体で検査できるのはここまで — state ファイルだけ。HTML のことは何も知らない。

## 2. HTML に届ける: `wcs-schema` と sidecar の `stateSchema`

静的検証器（`@wcstack/lint` の `wcs-validate`・VS Code 拡張）は全ての `data-wcs` パスを state と照合する — ただし state を読むのは型チェッカーでなく正規表現アナライザ（4.26から、戻り値の型の注釈を読み、TypeScript の構文を含む本体は Node 自身の型の除去（Node 22.13 以降）を通して読む）。`users: [] as { name: string }[]` では `users.*.name` が解決できず、typo は **warning**（`wcs/binding-path-missing`・exit 0）止まりで、正しいパスには偽警告が付く。

検証器には、生産者が居なかった型付き入力がある: `application` sidecar manifest の `stateSchema`（JSON-Schema サブセット・[wcstack-manifest-schema.md](./wcstack-manifest-schema.md) §4）。`@wcstack/typescript` がその生産者:

```bash
npm install -D @wcstack/typescript typescript@6
npx wcs-schema emit src/state.ts        # ./wcstack.manifest.json — state の型から stateSchema（manifestExtensions["wcstack.application"]）。.js の JSDoc の型も読む
npx wcs-validate --strict index.html    # HTML と同じ / 上のディレクトリの manifest を自動発見
```

`stateSchema` が宣言されると、その state に対する検証器の挙動が変わる（規範 §6）:

- schema 上に確定的に存在しないパス → `wcs/path-nonexistent`・**error**
- `for:` に非配列 → `wcs/path-type-mismatch`・**error**
- 素の `{}` の下（`Date`・`Map`・`Record<string, T>`・生成器が記述できないもの）→ 沈黙
- インラインスクリプトのメソッド・getter・`$listKeys` は引き続き存在扱い。script と schema の両方が知るパスは schema の型が勝つ
- 4.26から、最上位のキーが state のスクリプトと食い違う schema は `wcs/drift-state-key`（warning）: schema が古いか、別のページのもの。4.25 までは、`.ts` で改名して HTML に残した名前が、古い schema に対して lint を通った — 気づくのは `wcs-schema check` だけだった

VS Code 拡張も同じファイルを発見するので、IDE と CI は一致する。

**複数のページに 1 つの manifest。** 4.26から、`wcs-schema emit` は state のファイルを `stateSource`（manifest からの相対）として書き、検証器はその schema を、ルートの `<wcs-state src>` がそのファイルであるページにだけ当てる（その `.js` も同じファイルと数える）。`wcstack.manifest.json` をプロジェクトのルートに 1 つ置けば、`wcs-validate` と拡張がそれを見つける: 自分のインライン state を持つページは、この schema ではなく自分のスクリプトで検査される。別のファイルを名指す manifest は、`wcs-schema check` が乖離として報告する。4.25 以前が書いた manifest には `stateSource` が無く、作り直すまではその下のすべてのページに当たる。ページがビルドの出力を別のパスから読む（`tsc --outDir`）ときは、`--state-source=<その .js>` を付けて emit する。

**state が `.ts` のページをビルドする。** エンジンは `<wcs-state src>` を実行時に import するので、そのファイルは JavaScript として配られる必要がある。4.26から、Vite では `@wcstack/typescript` のプラグインを足す:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { wcstack } from "@wcstack/typescript/vite";
export default defineConfig({ plugins: [wcstack()] });
```

開発サーバーは `src="./src/state.ts"` をそのまま配る。プラグインは `vite build` に、ローカルの `<wcs-state src>` のファイル（ルートの state と `mount` のボリューム）を、`export default` を保ったそれぞれの chunk として出させ、属性を `base` の下のビルド後の URL に書き換える。プラグインが無いと、ビルドは属性を残してファイルを出さず、本番は state が 404 になる。`<wcs-state>` と `<wcs-guard-handler>` のインラインの `<script type="module">` もページに残す — Vite はそれをバンドルへ取り出してしまう（その `export default` を誰も import しなければ捨てる）。詳細: [Vite でビルドする](../packages/typescript/README.ja.md#vite-でビルドする)。バンドラを使わないなら、state を `tsc` でコンパイルし、`src` を `.js` に向ける。

manifest は**派生物** — 正本は型。CI で同期を保つ:

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

`check` は乖離した JSON pointer を列挙して exit `1`。変換の詳細（union・リテラル・パス getter・深さの打ち切り）は [packages/typescript/README.ja.md](../packages/typescript/README.ja.md)。

罠:

- `--strict` は検証器が読めない `<wcs-state src>` 由来の warning でも落ちる — 先に全ての `src=` を HTML 相対で解決可能にしておく。
- `--merge` は書き込むスロットだけを丸ごと置き換える —— `stateSchema` 全体、または `--mount=<path>` の部分木（ボリュームの型は単一ツリーの部分木として merge される）。同じスロットの手書き schema は残らない（sidecar 規範は暗黙 merge を禁じている）。手書きの schema は生成しないスロットのためのもの。
- 2 つの application manifest が両方 `stateSchema` を宣言すると `wcs/manifest-state-collision`（error・勝者なし。v2 はページ 1 ツリー＝schema スロットは 1 つ）。生成 schema はちょうど 1 つの manifest に置く。4.32（未リリース）から、それぞれが違う state のファイル（`wcs-schema emit` が書く `stateSource`）を名指す 2 つは、1 回の実行に渡しても衝突しない: 各ページには、ルートの `<wcs-state src>` が読むファイルの schema が当たる —— 生成した schema を持つアプリ 2 つを、1 回の lint で検査できる。同じファイルを名指す 2 つ、名指さないものがあるときは、今までどおり衝突。

## 3. 型付きの要素取得: `HTMLElementTagNameMap`

全コンポーネントパッケージが**既定**タグ名で `HTMLElementTagNameMap` を拡張しているので、タグ名による取得が要素クラスに型付く:

```ts
import "@wcstack/fetch";                       // 拡張はパッケージの index.d.ts に同梱
import type { WcsFetch } from "@wcstack/fetch";

const el = document.querySelector("wcs-fetch");   // WcsFetch | null
el!.url = "/api/users";                           // 型付きプロパティ
document.querySelectorAll("wcs-route");           // NodeListOf<Route>
```

- **パッケージの型がプログラムに載っているときだけ効く。** `import "@wcstack/fetch"`（副作用 import — パッケージを既に読み込んでいれば実行時コストはゼロ）か、`tsconfig.json` の `"types": ["@wcstack/fetch"]`。`https://esm.run/@wcstack/fetch/auto` を読むだけで import しないページは従来どおり `HTMLElement`。
- **既定タグ名のみ。** `IWritableTagNames` でタグ名を変えたプロジェクト（`bootstrapFetch({ tagNames: { fetch: "my-fetch" } })`）はこの map の対象外 — 型付きの取得が欲しければ自前で拡張を宣言する。
- 対象: 全パッケージの全 `wcs-*` 要素。ヘルパー・ノードタグ（`wcs-fetch-header`・`wcs-voice`・`wcs-osc` …）、`wcs-state` / `wcs-ssr`、router のタグを含む。`wcs-guard-handler` は要素クラスを持たない config 名なので対象外。
- ドリフトはテストされる: vscode-wcs の `tagNameMap.test.ts`（CI の `wcs-validate` job で常時実行）が組み込みタグカタログと宣言の一致を双方向で検査し、`state` / `router` / `devtools` は自分の `config.tagNames` と宣言を比較する。

## 4. インライン state スクリプトの型検査: `wcs-tsc`

`wcs-tsc`（同じく `@wcstack/typescript`）は `.html` に対して `tsc` を回す。各 `<wcs-state>` のインライン `<script type="module">` は VS Code 拡張と**同じ** Volar 言語プラグインを通る — 型付き `this` のプリアンブル、素の `export default {}` の自動 `defineState` ラップ、`@wcstack/state` の import（bare — `/define` などのエントリも — でも CDN URL でも）の除去 — ので、エディタが下線を引くものがそのまま CI に出る:

```bash
npm i -D @wcstack/typescript typescript@6 @volar/typescript@~2.4.0 @volar/language-core@~2.4.0
npx wcs-tsc --noEmit                 # または npx wcs-tsc -p tsconfig.json --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<{ count: number; … }>'. Did you mean 'count'?
```

仕組みは vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクト自身の `typescript/lib/tsc.js` にパッチを当て、`.html` を受け付けてプラグイン経由で program を組む。それ以外の tsc 引数はそのまま素通しで、exit code も tsc のもの。

- **ブラウザが走らせるとおり、JavaScript として。** 4.26から、スクリプトは JavaScript として検査する。検査はプラグインの `// @ts-check` が、`checkJs` によらず有効にする。JSDoc の型が効く（`/** @type {Item[]} */ items: []`・`/** @param {number} n */`・`/** @typedef {import("./api").Item} Item */`）。TypeScript の構文（型の注釈・`as`・`!`・`import type`）は、ブラウザが `SyntaxError` を投げるのと同じく、その場所で報告される（TS8010・TS8016・TS8006）。構文のエラーがあると、直すまで tsc は型のエラーを報告しない。4.25 までは TypeScript として読んでいた: JSDoc は無視され、TypeScript の構文は通った。JSDoc のコメントは行の頭から書く: 同じ行の `{` や `,` の後ろのものを、TypeScript は付けない。
- **プロジェクト側の設定。** `tsconfig.json` がページに届く（それを覆う `include`、または `include` 無し）こと、ES2015 以降を対象にする（`target` か `lib`）こと。4.26 から `noImplicitThis`・`allowJs`・`checkJs` は要らない（4.25 までは要った）。`wcs-tsc` は設定を監査し、不足があれば標準エラーに `wcs-tsc: warning: …` を 1 行出す — tsconfig のディレクトリの下にインラインの `<wcs-state>` を持つページがあるのに、どれもプログラムに入っていないときも、そのページを名指す。終了コードは tsc のもの。`--wcs-defaults` は、元の設定を extends して `include: "**/*.html"`（と `target`）を足した一時 config で実行する（終了時に削除）。全部を検査するには `strict`（少なくとも `noImplicitAny`）を使う: それが無いと JavaScript のオブジェクトリテラルは開いていて、配列の中のオブジェクトのフィールドの綴り違い（`this.items[0].nmae`）は報告されない。`this.coutn` は報告される。
- **`$on` と `$command`。** `defineState` と同じ（4.26）: `$on` のハンドラの引数に型が付き — `state`（state。メソッドは `any`）、`event`（`CustomEvent`。`detail` は `any`）、添字（`number`）、`this` は `void` — `this.$command` は `$commandTokens` の名前に絞られる。
- **CDN import。** buildless なページは `https://esm.run/...` から import するが、tsc はそれを解決できない。既定（`--url-imports=any`）では全ての `http(s)://` モジュールが `any` に型付き、`--url-imports=error` なら TS2307 で落ちる。`@wcstack/state` の URL import はどちらでも剥がされてプリアンブルが型を与える。
- **1 ページに複数の `<wcs-state>`。** tsc は 1 ファイル 1 サービススクリプトしか扱えないので、ブロックを 1 本の JavaScript の仮想モジュールに合成する: import は先頭に巻き上げ、各ブロックは自分のスコープ（`{ const __wcs_state_N = defineState({ … }); }`）に入り、診断は HTML へ写像される。インライン state の無いページは空のモジュール — マークアップが TypeScript として読まれることはない。
- **getter。** 本体が `this` を読む getter は、検査するコードの中で戻り値の型を `any` にする（4.6.2 から。4.26 からは `/** @returns {any} */` の JSDoc）。自分の JSDoc に `@returns` / `@type` がある getter はそれを保つ。だから本体はメソッドと同じく state の `this` で検査される。そうしないと、getter の型の推論が state に戻ってきて、その本体の `this` が `any` のままになる — `get first() { return this.items[0].nmae; }` は報告されなかった（[define-state.ja.md](../packages/state/docs/define-state.ja.md#戻り値の型が推論される-getter)）。
- **TypeScript 7** には `wcs-tsc` が動かす JavaScript のコンパイラ API が無い。7 で `.html` を読む方法は content mapper（TypeScript 7.1）で、設計は [typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md)。それが出るまで、`wcs-tsc` には `typescript@6` を使う。
- peer: `typescript`（必須。5 か 6 — TypeScript 7 は `typescript/lib/tsc.js` も、`typescript` のコンパイラ API も公開しない）、`@volar/typescript` + `@volar/language-core`（optional — このコマンドだけが必要とし、プロジェクト側から先に解決する）。パッケージのランタイム依存はゼロのまま。
- このリポジトリの CI は examples の全ページに対して `wcs-tsc` を experimental・非ゲートの job として 1 リリース分回し、偽陽性ゼロを確認できたらゲート化する（[app-testing-and-typescript-impl-plan.md](./app-testing-and-typescript-impl-plan.md) §7-6）。
