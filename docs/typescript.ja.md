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

## 3. 型付きの要素取得: `HTMLElementTagNameMap` — *予定（Phase 3）*

各コンポーネントパッケージが既定タグ名で `HTMLElementTagNameMap` を拡張し、`document.querySelector("wcs-fetch")` が `WcsFetch` になる。拡張はパッケージ自身の `.d.ts` に置かれ、パッケージの型がプログラムに載って初めて効く — `import "@wcstack/fetch"`（副作用 import）か `tsconfig.json` の `types`。`https://esm.run/@wcstack/fetch/auto` を読むだけのページには何も起きない。

## 4. インライン state スクリプトの型検査: `wcs-tsc` — *予定（Phase 5）*

`wcs-tsc`（同じく `@wcstack/typescript`）は `.html` に対して `tsc` を回し、各 `<wcs-state>` のインライン `<script type="module">` を VS Code 拡張と同じ仮想コードプラグインで写像する。`this.coutn++` は `file.html:line:col TS2339` で CI を落とす。`tsconfig.json` に `"include": ["**/*.html"]` が必要で、`@volar/typescript` は optional peer。
