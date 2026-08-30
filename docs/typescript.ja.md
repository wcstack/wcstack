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

`@wcstack/state` が export する `defineState` は identity 関数で、メソッドと getter の中の `this` にドットパス参照込みで正しい型を与えることだけが仕事:

```ts
import { defineState } from "@wcstack/state";

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

`tsc` 単体で検査できるのはここまで — state ファイルだけ。HTML のことは何も知らない。

## 2. HTML に届ける: `wcs-schema` と sidecar の `stateSchema`

静的検証器（`@wcstack/lint` の `wcs-validate`・VS Code 拡張）は全ての `data-wcs` パスを state と照合する — ただし state を読むのは型チェッカーでなく正規表現アナライザ。`users: [] as { name: string }[]` では `users.*.name` が解決できず、typo は **warning**（`wcs/binding-path-missing`・exit 0）止まりで、正しいパスには偽警告が付く。

検証器には、生産者が居なかった型付き入力がある: `application` sidecar manifest の `stateSchema`（JSON-Schema サブセット・[wcstack-manifest-schema.md](./wcstack-manifest-schema.md) §4）。`@wcstack/typescript` がその生産者:

```bash
npm install -D @wcstack/typescript typescript
npx wcs-schema emit src/state.ts        # ./wcstack.manifest.json — TS 型から states.default.stateSchema
npx wcs-validate --strict index.html    # HTML と同じ / 上のディレクトリの manifest を自動発見
```

`stateSchema` が宣言されると、その state に対する検証器の挙動が変わる（規範 §6）:

- schema 上に確定的に存在しないパス → `wcs/path-nonexistent`・**error**
- `for:` に非配列 → `wcs/path-type-mismatch`・**error**
- 素の `{}` の下（`Date`・`Map`・`Record<string, T>`・生成器が記述できないもの）→ 沈黙
- インラインスクリプトのメソッド・getter・`$listKeys` は引き続き存在扱い。script と schema の両方が知るパスは schema の型が勝つ

VS Code 拡張も同じファイルを発見するので、IDE と CI は一致する。

manifest は**派生物** — 正本は型。CI で同期を保つ:

```bash
npx wcs-schema check src/state.ts && npx wcs-validate --strict index.html
```

`check` は乖離した JSON pointer を列挙して exit `1`。変換の詳細（union・リテラル・パス getter・深さの打ち切り）は [packages/typescript/README.ja.md](../packages/typescript/README.ja.md)。

罠:

- `--strict` は検証器が読めない `<wcs-state src>` 由来の warning でも落ちる — 先に全ての `src=` を HTML 相対で解決可能にしておく。
- `--merge` は指定した state の `stateSchema` を丸ごと置き換える。同じ state の手書き schema は残らない（sidecar 規範は暗黙 merge を禁じている）。手書きの schema は生成しない state のためのもの。
- 同名 state を 2 つの application manifest が宣言すると `wcs/manifest-state-collision`（error・勝者なし）。コマンドラインに manifest を明示するなら state 名ごとに 1 つ。

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

`wcs-tsc`（同じく `@wcstack/typescript`）は `.html` に対して `tsc` を回す。各 `<wcs-state>` のインライン `<script type="module">` は VS Code 拡張と**同じ** Volar 言語プラグインを通る — 型付き `this` のプリアンブル、素の `export default {}` の自動 `defineState` ラップ、`@wcstack/state` の import（bare **でも** CDN URL でも）の除去 — ので、エディタが下線を引くものがそのまま CI に出る:

```bash
npm i -D @wcstack/typescript typescript @volar/typescript@~2.4.0 @volar/language-core@~2.4.0
npx wcs-tsc --noEmit                 # または npx wcs-tsc -p tsconfig.json --noEmit
# index.html(9,14): error TS2551: Property 'coutn' does not exist on type '_WcsThis<{ count: number; … }>'. Did you mean 'count'?
```

仕組みは vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクト自身の `typescript/lib/tsc.js` にパッチを当て、`.html` を受け付けてプラグイン経由で program を組む。それ以外の tsc 引数はそのまま素通しで、exit code も tsc のもの。

- **プロジェクト側の設定。** `tsconfig.json` が HTML に届く必要がある: `**/*.html` を覆う `include`（または `include` 無し = 既定で覆う）に加え、`noImplicitThis`（型付き `this`）・`allowJs`・`checkJs`。`wcs-tsc` は設定を監査して不足を警告し、`--wcs-defaults` なら元の設定を extends して不足を足した一時 config で実行する（終了時に削除）。
- **CDN import。** buildless なページは `https://esm.run/...` から import するが、tsc はそれを解決できない。既定（`--url-imports=any`）では全ての `http(s)://` モジュールが `any` に型付き、`--url-imports=error` なら TS2307 で落ちる。`@wcstack/state` の URL import はどちらでも剥がされてプリアンブルが型を与える。
- **1 ページに複数の `<wcs-state>`。** tsc は 1 ファイル 1 サービススクリプトしか扱えないので、ブロックを 1 本の仮想モジュールに合成する: import は先頭に巻き上げ、各ブロックは自分のスコープ（`{ const __wcs_state_N = defineState({ … }); }`）に入り、診断は HTML へ写像される。インライン state の無いページは空のモジュール — マークアップが TypeScript として読まれることはない。
- peer: `typescript`（必須）、`@volar/typescript` + `@volar/language-core`（optional — このコマンドだけが必要とし、プロジェクト側から先に解決する）。パッケージのランタイム依存はゼロのまま。
- このリポジトリの CI は examples の全ページに対して `wcs-tsc` を experimental・非ゲートの job として 1 リリース分回し、偽陽性ゼロを確認できたらゲート化する（[app-testing-and-typescript-impl-plan.md](./app-testing-and-typescript-impl-plan.md) §7-6）。
