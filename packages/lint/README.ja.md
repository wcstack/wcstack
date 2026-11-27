# @wcstack/lint

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

[wcstack](https://github.com/wcstack/wcstack) の静的契約検査 CLI。HTML の `data-wcs` バインディングと `wcstack.manifest.json`（sidecar）を headless に検査します。WcStack IntelliSense（VS Code 拡張）と**同一の validator core** を使うため、IDE と CLI の diagnostic code / range は完全に一致します。

[English README is here](./README.md)

## 使い方

インストール不要で一行:

```bash
npx @wcstack/lint --errors-only index.html wcstack.manifest.json
```

またはインストールして `wcs-validate` コマンドとして:

```bash
npm i -D @wcstack/lint
npx wcs-validate --errors-only src/**/*.html
```

4.20 から、シェルが展開しなかったパターンは CLI が自分で展開します: 在るファイルを名指さず、`*`・`**`・`?`・`[…]`・`{a,b}` を持つ引数をファイルに当てます。当て方はシェルと同じで、`*` は 1 つのディレクトリの中だけ・`.` で始まる名前には当たらず、`**` はディレクトリをまたぎますが `node_modules` と `.` で始まるディレクトリには入りません。cmd.exe と PowerShell はパターンをそのまま渡し、npm は Windows ではパッケージの scripts を cmd.exe で走らせるので、4.19 までは npm script の `wcs-validate templates/*.html` がそこで `cannot read templates/*.html` で失敗していました。何にも当たらないパターンは error です（`no file matches <パターン>`、exit code `2`）。どのシェルでも CLI に展開させるには、パターンを引用符で囲んでください（`"src/**/*.html"`）: `globstar` の無い POSIX シェルは `**` を `*` と読みます。

`.manifest.json` で終わるファイルは sidecar manifest として、それ以外は `data-wcs` バインディングを含む HTML として検査されます。ただし framework のコンポーネントと script のファイル（`.js`・`.ts`・`.jsx`・`.tsx`・`.vue`・`.svelte`）は読みません（4.6 から。以前は HTML として読み、問題なしと報告していました）。

`<wcs-state src="...">` で参照される外部 state（`.json` / `.js` / `.ts`）は HTML ファイルからの相対パスで解決され、パス検証の対象になります。URL は読み込まず、/ から始まるパスは `--root`（下記）のときだけ読み、読めないファイルはスキップされ、解決できないパスは warning のままです。なお外部 state が**解決できた**ページには通常の検証面が全て適用されるため、error severity の検出（例: 配列でない値への `for:`）が「これまでパス未解決で沈黙していたビルド」を新たに落とすことがあります。4.4 から、`.js` / `.ts` の state にはスクリプトの規則（`wcs/nested-assign`・`wcs/array-mutation`・`wcs/on-handler-this`・`wcs/updated-callback-unbound` など）もかかります: ファイルの中の指摘はそのファイルで報告し（`state.js:12:5 error wcs/nested-assign …`）、何ページから読まれても 1 回だけ数え、IDE はページの `src` の値の上に出します。4.3 までは、外部 state ではパスだけを検査していました。4.10 から、名前で書いたキー — 短縮プロパティ（`export default { lang, t }`。`examples/router-i18n` の辞書のボリューム `<wcs-state mount="i18n" src="./i18n/state.js">`）や `items: ITEMS` — は、その名前が束縛する値の形を持ちます: モジュールの `const` か、相対パスからの import（import するファイルからの相対で読み、再 export の先も辿ります）。4.17 からは名前空間の import のメンバーも同じです（`import * as M from "./lib/music.js"` の `sound: M.DEFAULT_SOUND`）。4.9 までは短縮プロパティのキーをまったく読まなかったので、`i18n.t.*` の束縛はすべて `wcs/binding-path-missing` の誤報でした。値を計算する名前（実行時にロケールの辞書を合わせた辞書）や辿れない名前（素の指定子・URL・無いファイル）のキーは、その下のパスを検査せず、ページがその下を束ねていればキーの上で 1 回だけそう言います（`wcs/path-dynamic-unknown`、info）。キーか宣言に JSDoc の `@type {typeof import("./en.js").default}` を付けると、そのファイルのリテラルで検査します。

4.20 から、`{{ }}` はランタイムが束ねる場所でだけ束縛として読みます: テキストの中 — 属性の値（`aria-current="{{ x }}"`）や HTML コメントの中ではなく — で、文書の `<head>` の外（`<wcs-state>` は `<head>` を束ねません。そこの `{{ }}` やコメント束縛は `wcs/template-syntax` の warning です）。ページの state が `$behavior: { enableMustache: false }` を宣言していれば、`{{ }}` はどれも束縛として読みません — アイランドの横の CMS やサーバーのテンプレートの中括弧 — が、コメント束縛は検査します。設定は state のある場所で読みます: インライン・`json=`・`state=`・lint が読める `src=` のファイル（/ から始まるパスは `--root` のとき）。読めない state なら、`{{ }}` は従来どおり検査します。4.19 までは、そうした中括弧ごとに `wcs/binding-path-missing` の誤報と FOUC の info が出て、コメント束縛は 1 つずつ `wcs-text バインディング: …` の info を出していました（4.20 はもう出しません）。

```
wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--root=<dir>] [--errors-only] [--strict] <file> [<file> ...]
```

| オプション | 説明 |
|---|---|
| `--attr=<name>` | バインド属性名（既定 `data-wcs`） |
| `--state-tag=<name>` | state カスタム要素のタグ名（既定 `wcs-state`） |
| `--lang=ja\|en` | 診断メッセージの言語。未指定時は環境ロケール（`LC_ALL` / `LC_MESSAGES` / `LANG` → OS ロケール）に従う。code / range は言語に依らず不変 |
| `--root=<dir>`（`--root <dir>` も） | 4.10 から: サイトのルートのディレクトリ。/ から始まるパスをその下で読む — `<base href="/ja/">` の下の `<wcs-state src="/app.js">`（`docs/csp.md` と `examples/router-i18n` の形）や、state のファイルの `/…` からの import は `<dir>/app.js` として読む。ディレクトリの外へ出るもの（`/../x.js`）は読まない。無ければ / から始まるパスは読まない（`wcs/state-src-unread`、info）。そうしたファイルの指摘はディレクトリの下のパスで出す（`public/app.js:12:5 …`） |
| `--errors-only`（別名 `--quiet`） | error severity の行だけ表示。warning / info の件数と exit code は不変 |
| `--strict` | warning severity の診断でも exit `1` にする。severity 自体は不変（IDE の表示と同じ）で、exit code の閾値だけを error → warning に下げる。summary 行の末尾に `(strict)` が付く。パスの typo（`wcs/binding-path-missing` は warning）で CI を落としたいときに使う — ただし先に `<wcs-state src>` を全て解決可能にしておくこと（解決できない外部 state が残す warning でも落ちるようになる）。`--errors-only` と併用可: 表示は error のみのまま、exit code は warning を反映する。4.30 から、state をまるごと読めなかったと言う info（`wcs/state-src-unread` と、state の先頭の `...spread` の `wcs/path-dynamic-unknown`）も warning と同じく数え、`--errors-only` でも表示する |

## 出力と exit code

診断は安定した順序で 1 行ずつ出力されます:

```
index.html:12:8 warning wcs/path-nonexistent Path "user.nam" does not exist ...
app.manifest.json:1:3 error wcs/manifest-broken Broken manifest JSON: ...

1 error(s), 1 warning(s), 0 info
```

| exit code | 意味 |
|---|---|
| `0` | error severity の診断なし（warning / info はあってもよい）。`--strict` 時は error も warning もなし |
| `1` | error severity の診断が 1 件以上。`--strict` 時は error または warning が 1 件以上 |
| `2` | usage エラー、またはファイル読み取り失敗。4.20 からは、何にも当たらないパターンも |

件数の後に、件数が何も語らないファイルを 2 つの注が挙げます（4.6 から。`--errors-only` でも出し、exit code は変えません）:

```
0 error(s), 0 warning(s), 0 info
not read: src/App.tsx — wcs-validate reads HTML pages (data-wcs, <wcs-*> tags), not a framework's components or script files
nothing to check: index.html — no data-wcs binding, <wcs-*> tag or wcstack script in them
```

`<wcs-*>` の要素を使う framework のアプリ（React・Vue）にはどちらも無く、ページはルートの要素を持つだけで、コンポーネントは読まれません。exit code `0` は、そのようなアプリを検査したという意味ではありません。代わりに見るべきことは [framework 統合の手引き](../../docs/framework-adapter-integration.ja.md) にあります。

4.20 から、束縛 — `data-wcs` 属性かコメント束縛 — があるのに `<wcs-state>` の無いファイルには、最初の束縛の上に `wcs/state-absent` の info を 1 つ出します: CMS の部分テンプレート・ファイルに分けたルートの中身・state をスクリプトで作るページには、パスを照らす state が無いので、パスは検査していません。4.19 までは、そうしたファイルは何も出さず `nothing to check:` にも載らなかったので、検査済みに見え、打ち間違い（`booking.totl`）が通っていました。state のあるページを検査するか、パスを `stateSchema`（下記）に宣言してください（宣言すれば出ません）。テキストの束縛が `{{ }}` だけのファイルは報告しません（中括弧だけでは、ほかのテンプレートエンジンのものかもしれません）。

## state の契約を宣言する（`stateSchema`）

契約が無いと、validator が解決できないパスは **warning**（`wcs/binding-path-missing`）に留まります: インラインスクリプトが静的に読めなくても `count` は実行時には存在するかもしれないからです。`[]` で始まるリストの行のフィールドは、行を足す・置き換える代入式の行リテラルから読みます。4.9 から、`map` で行を作り直す代入 — `this.rows = [...this.items].map((c) => ({ id: c.id, label: c.name }))`・`.filter(…).map((c) => { return { … }; })` — も、そうする getter と同じく読み、`{}` を種にしたキーへ代入したオブジェクトリテラルのキーも読みます（`this.fieldErrors = { date: "…" }` で `fieldErrors.date`。リテラルの中の spread は追いません）。4.17 から、`Array.from({ length: n }, (_, i) => ({ … }))`・`Array.from(source, (x) => ({ … }))` の mapper と、`[...Array(n).keys()]` に続く `map` も、getter でも代入でも同じに行の形を言います。4.16 まではその行の下の束縛がどれも `wcs/binding-path-missing` の誤報でした。4.11 から、モジュールの定数を spread する種 — `const EMPTY_DRAFT = { title: "", body: "" }` と `draft: { ...EMPTY_DRAFT }`、読めるファイルから import した定数も — は、そのリテラルのキーを持ちます（入れ子のものも。同じ名前は後に書いた方が勝ちます — オブジェクトを作るときと同じ）。リストの種の最初の行（`[{ ...ROW, id: 0 }]`）も同じです。4.17 からは、読めるファイルの名前空間の import のメンバー（`import * as M from "./lib/music.js"` の `sound: { ...M.DEFAULT_SOUND }`）も同じです。4.16 まではそのキーの下を検査しませんでした。4.10 まではそのキーの下の束縛がすべて `wcs/binding-path-missing` の誤報で、打ち間違い（`draft.titel`）も同じ警告でした。読めない spread — 呼び出し・`let`・読めない import — があれば、そのキーの下は検査せず、ページがその下を束ねていればキーの上で 1 回だけそう言います（`wcs/path-dynamic-unknown`、info）。外から届くリスト（`<wcs-fetch>` や `<wcs-storage>` が埋めるまで `null`）にはそのリテラルが無いので、プロパティの直前の JSDoc `@type` で形を宣言してください（`/** @type {{ id: number, name: string }[] | null} */ catalog: null`）。同じスクリプトの `@typedef` で行の型に名前を付け、`@type {Product[] | null}` と書いてもかまいません。本体から結果を読めない getter（`get keyRows() { return buildRows(this.sound); }`）も、getter の直前に同じように宣言します: getter は `@returns` か `@type` を結果の型として受けます（`/** @returns {{ label: string }[]} */ get keyRows() { … }`）— TypeScript と同じです。getter の `@type` は 4.17 から効きます。4.16 までは `@returns` だけが効き、getter の `@type` は何も言わずに無視されていました。4.20 から、そうした型の索引シグネチャ — `Record<string, T>`・`{ [key: string]: T }`・Closure の `Object<string, T>` — は、getter の `@returns` / `@type` でもキーの `@type` でも、その下のパスを開いたままにします（`stateSchema` の開いたオブジェクトと同じ）: `/** @returns {Record<string, boolean>} */ get soldOut()` と `class.full: soldOut.e12` は報告しません。4.19 まではそうした束縛のそれぞれが `wcs/binding-path-missing` の誤報でした。`Record<"open" | "closed", T>` はフィールド `open` と `closed` を持ちます。HTML と同じ（または上の）ディレクトリに `application` sidecar を置くと、同じ typo が **error** になります:

```json
{
  "schemaVersion": 2,
  "kind": "application",
  "manifestExtensions": {
    "wcstack.application": {
      "version": 2,
      "stateSchema": {
        "type": "object",
        "properties": {
          "count": { "type": "number" },
          "users": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" } } } }
        }
      }
    }
  }
}
```

- **発見**: HTML ファイルから上へ辿って最も近い `wcstack.manifest.json` が自動で使われます — コマンドラインに渡す必要はありません。`application` artifact を含む `*.manifest.json` を引数に渡した場合は、その実行全体で発見を置き換えます。そのうち 2 つが両方 `stateSchema` を宣言すると `wcs/manifest-state-collision`（error）で、どちらも使われません —— ただし 4.32（未リリース）から、それぞれが違う state のファイル（`stateSource`、下）を名指すときは衝突せず、各ページには、ルートの `<wcs-state src>` が読むファイルの schema が当たります。生成した schema を持つアプリ 2 つを 1 回の実行で検査できます。VS Code 拡張も同じファイルを発見するので IDE と CLI の結果は一致します。
- **schema を当てるページ**（4.26 から）: schema を作った state のファイルを記した manifest — `wcstack.application.stateSource`、manifest からの相対で、`wcs-schema emit` が書きます — は、そのファイルを root の `<wcs-state src>` で読むページだけの契約です（同じパスの `.js` と `.ts`、`.mjs` と `.mts` は同じファイル）。state がインラインのページや別のファイルのページは、発見した manifest でも引数に渡した manifest でも、manifest が無いものとして検査します。4.25 までは、アプリの schema をその下のすべてのページに当てていたので、アプリの隣で自前のインラインの state を持つページの正しいパスが `wcs/path-nonexistent` の error になっていました。`stateSource` の無い manifest（手書き・それより前の `wcs-schema` が作ったもの）は、これまでどおりすべてのページに当てます。
- **効果**: `stateSchema` を宣言すると、schema 上に確定的に存在しないバインドパスは `wcs/path-nonexistent`（**error**・exit `1`）、`for:` に非配列は `wcs/path-type-mismatch`（**error**）になります。schema が開いたままの箇所（素の `{}`）は schema が無いときと同じに検査し（4.31 から。以前は沈黙した）、インラインスクリプトのメソッド / getter / `$listKeys` は引き続き存在扱いです。`stateSchema` が無ければ従来どおりです。
- **契約が要るとき**: validator が全体を読めない state は、契約が無いとパスをまったく検査できません。よくあるのはトップレベルの spread です — `export default { ...defaults(), get total() { … } }` は静的には見えないキーを持ち込むので、その state のパスは検査しません。4.4 から、spread の上で 1 回だけそう言います（`wcs/path-dynamic-unknown`、info）。`stateSchema` があれば束縛を —— 4.4 から getter の中で読むパス（`wcs/read-path-missing`）も —— それで検査します。読めない `<wcs-state src>` — / から始まるパス・URL・無いファイル — の state も検査できません。4.7 から、それを属性の上で 1 回だけ言います（`wcs/state-src-unread`、info）。4.6 までは何も言いませんでした。`src` はページからの相対パスで読むので、ファイルはサーバーと同じ並びに置き、/ から始まるパスには 4.10 から `--root=<dir>` を渡してください。
- **schema の出どころ**: 手で書く（受け付けるのは JSON-Schema サブセット `type / properties / required / items / enum / const / anyOf / $defs / $ref` のみ）か、TypeScript の state ファイル（または JSDoc で型を付けた JavaScript のファイル）から `wcs-schema`（`@wcstack/typescript`）で生成します。manifest は派生物なので、CI では `wcs-schema check` で同期を保ってください。

## ページの wcstack のスクリプトと lint の版

4.11 から、2 つの検査がページの読み込む wcstack のスクリプトを見ます。4.20 から 3 つ目が加わります。4.21 から `wcs/tag-package-missing` は error なので、`--errors-only` でも落ちます（4.20 までは warning で、`--errors-only` に隠れていました）。残りの 2 つは warning なので、`--strict` では落ち、`--errors-only` では落ちません。

- **`wcs/tag-package-missing`** — wcstack を自分で読み込むページが、あるパッケージの `wcs-*` のタグ（`<wcs-upload>` やそのヘルパー `<wcs-upload-header>`、`<wcs-state>`・`<wcs-router>` など）を書くのに、そのパッケージのスクリプトを読み込んでいない。要素は定義されず、束縛は待ち続けて何も起きず、コンソールにも何も出ません。パッケージごとに 1 回、最初のタグに、読み込む `/auto` を挙げて報告します。読み込んだと数えるのは、`<script src>`・import map の項目・インラインのスクリプトの import か文字列が `@wcstack/<pkg>`（版・CDN・ローカルのパスを問わない）か一括バンドル `wcstack`（state・router・fetch・storage・autoloader）を名指すものです。ローカルのスクリプト（`./app.js`）は、それが import する相対のモジュールとともに読み、名指すものを数えます。wcstack を自分で読み込まないページ（断片・バンドラのページ）、autoloader がいて `@components/` の import map が覆うタグ、読めないローカルのスクリプトがあるページでは報告しません。
- **`wcs/link-router-missing`**（4.20 から） — router（か一括バンドル `wcstack`）を読み込むのに `<wcs-router>` の無いページの `<wcs-link to="/…">`。リンクは接続した時点で `[@wcstack/router] wcs-link is not connected to a router.` を投げ、隠れたまま（`display: none`）になります。router の無いページ — サーバーが描き、アイランドを置いたページ — では `<a href>` と書くか、`<wcs-router>` を置いてください。ページに 1 回、最初のそうしたリンクに報告します。見るのは `wcs/tag-package-missing` と同じページ（wcstack を自分で読み込むページ）だけです: 断片 — ルートの中身・router のページが取り込むレイアウトのファイル — は wcstack のスクリプトを読み込まないので報告せず、HTML コメントの外のどこかで `wcs-router` を名指すページ（`<template>` の中の `<wcs-router>`・それを作るスクリプトも）、router が無くても描かれる URL やクエリ（`?page=2`）の `to` も報告しません。
- **`wcs/lint-version-behind`** — ページの URL が、この lint より新しい minor を固定している: `@wcstack/state@4.11.0` を `@wcstack/lint@4.10.1` で検査する。lint が持つのは自分の版の規則なので（`@wcstack/state` と lockstep で出ます）、新しい minor で加わったものは検査されず、新しい minor の正しい書き方を error にもします（4.2.0 の lint は 4.10 の `datetime(ja-JP,short,Asia/Tokyo)` を `wcs/filter-arity` にします）。ページに 1 回、いちばん新しい固定に、`@wcstack/lint` をその版に上げるよう言います — `package.json` の lint はページが固定する版に揃えてください。版の無い URL・major だけの固定（`@4`）・lint の方が新しいときは報告しません。

## ページを直す保守担当に言うこと

4.21 から、継ぎ目アプリ ledger-repair — 目録の誤りを 10 件入れた家計簿を、外の保守担当がコンソール・この lint・DevTools のオーバーレイ・文書で直した — から:

- **`wcs/submit-without-prevent` と `wcs/tag-package-missing` は error です。** 報告するところでは必ず不具合です — フォームも自分を送る（router があれば GET がパスワードを URL に載せる）、要素がけっして定義されない — が、warning だったので `--errors-only` に隠れていました。`wcs/binding-path-missing` は warning のままです: `stateSchema` が無いと、値が外から届くこともあるためです。
- **`wcs/session-read-at-module-top`** — `<wcs-guard-handler>` のモジュール（error）や `<wcs-state>` のモジュール（インライン・`src=`。warning）のトップレベルでの `localStorage` / `sessionStorage` / `document.cookie` の読み。router はガードのモジュールを 1 回だけ評価し、export した関数を遷移のたびに走らせるので、関数の外でセッションを読むガードは、ページを読み込んだ時点のセッションを持ち続けます: ログインの後も、守られたページはすべて /login へ戻り、何も知らせませんでした。関数の中で読んでください。関数の中（そこから呼ぶ補助関数・getter・メソッド）の読みは報告しません。
- **`wcs/event-token-unbound`**（warning） — `wcs/command-token-unbound` の逆: `$eventTokens` に宣言したのに、ページのどの `eventToken.<メンバー>: <名前>` 束縛も出さない名前。`$on` のハンドラは走りません（ページは束縛を外して `deleteFetch.status` を watch していましたが、2 回目の 204 ではそれは変わりません）。lint の見ない束縛が出しうるページ — `<wcs-layout src>` のあるページ、`eventToken.` の束縛を書くスクリプトのあるページ — では報告しません。
- 行に無いフィールドの近くに行のフィールドがあれば名指します — `パス ".amountLabl" は状態定義に存在しません（展開: rows.*.amountLabl）。もしかして: "amountLabel"`。行の形はどこから読んだものでもかまいません: データのリスト・getter の map のリテラル・JSDoc の型。
- 配列と分からない値（`budgetErrors: {}` と `this.budgetErrors[id] = …`）への `wcs/array-index-assign` は、「配列の添字」ではなくオブジェクトのキーへの代入として言います。
- スクリプトがその場で変えるリスト（`this.budgetRows.splice(0, n, ...rows)` — `wcs/array-mutation` が報告する）の行は、リテラルや JSDoc の型からフィールドが読めなければ検査しません。4.20 までは、そうした行のフィールドがどれも `wcs/binding-path-missing` の誤報で、本物の打ち間違いと同じ code でした。

## 入力の重いフォームに言うこと

4.23 から、継ぎ目アプリ ekiden-entry — 駅伝の申し込みウィザード。IME・オートフィル・行の中の入力・フォーム連携のカスタム要素と、入力の重いページ — から。そのページで lint は、仕込んだ誤り 21 件に何も言わず、読めない state について偽の warning を 91 件出していました:

- **値を読めないキーの下は「分からない」で、「存在しない」ではありません。** `const init = emptyEntry()` の `team: init.team`、`errs: emptyErrs()`、条件式、`[1, 2].map(…)`、`[newRunner()]` の行: そうしたキーの下のパスは検査せず、キーの上の `wcs/path-dynamic-unknown`（info）が 1 回だけそう言います — その下に束ねたパスの数（キーの `for:` の行の `.name` も数えます）と、検査させる方法（キーの JSDoc の `@type` か `stateSchema`）付きで。4.22 までは、そのパスが 1 件ずつ `wcs/binding-path-missing` の誤報で、本物の打ち間違いと同じ code でした。オブジェクトリテラルを束縛する `const` のメンバー（`team: DEFAULTS.team`。モジュールの中のものも import したものも）は読み、その下のパスを検査します。
- **`wcs/radio-name-shared`**（warning） — `for:` の行の中の、`name` をリテラルで書いた、行の値を束ねたラジオ（`<input type="radio" name="sex" data-wcs="radio: .sex">`）。どの行のラジオも同じ name になるので、ブラウザは全部の行を 1 つのグループにします: ページ全体で 1 つしか選ばれた状態にならず、表示は最初の描画から行ごとの値と食い違います。行ごとに違う name を束ねる（`attr.name: .<行のフィールド>`）か、name を外してください — `radio:` は name が無くても、同じパスに束ねたラジオを選択に合わせます。name を束ねてあるとき、行のものでないパス（`value: .id; radio: selectedId` — 行をまたぐ 1 つの選択）、行ごとに `<form>` があるときは報告しません。
- **`wcs/radio-before-value`**（warning） — `radio:` / `checkbox:` を、その要素に値を与える束縛より前に書いた（`<input type="radio" data-wcs="radio: theme; attr.value: .value">`）。束縛は書いた順に当たり、`radio:` は当たるときに要素の `value` を比べるので、まだブラウザの既定の `"on"` と比べる: 最初の描画ではどのラジオも選ばれず、実行時は何も言わない（後から state に書くと正しいものが選ばれるので、値がページを描いた後に届く所では隠れる）。値を先に書く: `attr.value: .value; radio: theme`。値の束縛が前にあるとき・値がマークアップのリテラルだけのとき（`value="red"`）は黙る。4.29 から。
- **`wcs/number-written-as-string`**（warning） — 書き戻すときに変換しない双方向の `value:` が、state が数値で持つパスを指す: `count: 0` と `<input type="number" data-wcs="value: count">`（JSDoc の `@type {number}`・`stateSchema`・行のフィールド `value: .qty` も）。要素の `value` は文字列なので、5 と入力した後の state は `"5"` で、`count + 1` は `"51"` になります。`valueAsNumber: count` か、左辺の入力フィルタ `value|number: count`（`|int`・`|float`）と書いてください。
- **`wcs/two-way-output-filter`**（warning） — 双方向の `value:` / `valueAsNumber:` の出力フィルタ（`value: code|upper`・`value: price|locale`）。打つ欄では、フィルタが 1 打鍵ごとに state の値を整形して欄へ書き直します: 入力中の欄が書き換わり（キャレットは末尾へ飛び、IME の変換は途切れます）、state が受け取るのも欄の整形済みの文字です — 出力フィルタは書き戻しで元に戻りません。整形した文字は別の要素に表示する、欄の確定で書き戻して setter で整形する（`value#onchange:`）、または一方向にしてください（`value#ro:`）。確定した値を書き戻す束縛（`#onchange`・`<select>`・スライダー）は、出力を元に戻す入力フィルタが無いときだけ報告します: `value#onchange|number: price|toFixed(2)` は報告しません。要素の書いた文字をそのまま返すフィルタ（`string`・`nullIfEmpty`・`coalesce(…)`・`defaults('')`）も報告しません。
- **`attr.*` に束ねた boolean**（`wcs/binding-type-expectation`）には、起きることを言います: ランタイムは `String(value)` — `"true"` / `"false"` — を書き、属性を外すのは `null` / `undefined` だけです。その語が属性の値であるもの — ARIA の状態（`attr.aria-invalid: flag|truthy`）・`contenteditable`・`draggable`・`spellcheck` — は、もう報告しません（`"attr.aria-invalid" には文字列型が必要です` は誤報でした）。ネイティブ要素の論理属性（`attr.disabled: flag`）には、`disabled="false"` でも無効のままであることと、代わりに束ねるプロパティ（`disabled: flag`）を言います。ほかの属性（`attr.data-open: flag`）には、文字として書かれて外れないことと、false の間は外す `|defaults(null)`・文字が意図のときの `|string` を言います。

新しい 3 つの規則は warning です: `--strict` では失敗し、`--errors-only` には出ません。

## 長いリストのページに言うこと

4.24 から、継ぎ目アプリ town-archive — 写真 12,000 枚のアーカイブ。長いリストと無限スクロールのページ — から。そのページの誤りのうち、この lint が言わなかったもの:

- **`wcs/body-binding`**（error） — `<body>` / `<html>` に書いた `data-wcs`（`<body data-wcs="onkeydown: onKey; class.dark: dark">`）。`<wcs-state>` が束ねるのは `<body>` の中で、`<body>` と `<html>` そのものは束ねないので、そこに書いた束縛は何もしません: ハンドラは走らず、`class.` も `attr.` も書かれません。束縛を `<body>` の中の要素（包む要素・`<main>`）へ移すか、値を `$connectedCallback` や `$watch` のハンドラから書いてください（`document.documentElement.lang = …`）。
- **`wcs/link-handler`**（error） — `<wcs-link>` の束縛に書いた `on*:`（`<wcs-link data-wcs="attr.to: .href; onclick: openPhoto">`）。リンクのホストは `display: none` で、利用者がクリックするのはリンクが自分の隣に作る `<a>` なので、ハンドラは走りません。ハンドラはリンクの中の要素（子は `<a>` の中へ移ります）か、リンクを囲む要素に書いてください。ハンドラから遷移するなら、router の `navigateUrl` に書きます。
- **`wcs/root-margin-unit`**（warning） — `<wcs-intersect>` / `<wcs-infinite-scroll>` の、ブラウザが拒むリテラルの `root-margin`: `root-margin="200"`・`"0 0 900 0"`。`IntersectionObserver` が受けるのは 1〜4 個の値で、それぞれ `px` か `%` の付いた数値です — `0` にも単位が要るので、`"0 0 900px 0"` も拒まれます（`rootMargin must be specified in pixels or percent`）。そのとき `<wcs-intersect>` は何も監視せず（`observing` は `false` のまま）、`<wcs-infinite-scroll>` は次のページを読み込みません。文面は `px` を足した書き方（`root-margin="0px 0px 900px 0px"`）を言います。束ねた `rootMargin:` は検査しません。
- **`wcs/getter-untracked-read`** は、ウィンドウと文書を読む getter も報告します: `innerWidth` / `innerHeight` / `outerWidth` / `outerHeight`、`devicePixelRatio`、`scrollX` / `scrollY` / `pageXOffset` / `pageYOffset`、`matchMedia(…)` の呼び出し、`navigator.onLine`、`document.documentElement` / `document.body` / `document.scrollingElement` の `clientWidth` / `clientHeight` / `scrollTop` / `scrollLeft`、`document.visibilityState` / `document.hidden` — `window.` / `globalThis.` の有無によりません。どれも state ではないので、キャッシュされた getter は最初の値を持ち続けます（`innerWidth` から列数を決める getter は、リサイズしても変わりません）。文面は代わりに束ねるものを言います: `<wcs-resize>` の `width` / `height`、`<wcs-media-query>` の `matched`（`matchMedia`・ブレークポイント・解像度のしきい値）、`<wcs-network>` の `offline`。スクロール位置とページの可視性を出す要素は無いので、値を state に置いてイベントハンドラから書いてください。getter やモジュールが束縛する名前（`const innerWidth = …`・引数）と、state の同名のキー（`this.innerWidth`）は報告しません。
- **`wcs/delegated-current-target`** は、ハンドラに入れ子にした関数の中も読みます: `openPhoto(event) { return this.photos.find((p) => String(p.id) === event.currentTarget.closest(".card").dataset.id); }` を、ハンドラの本体での読みと同じに報告します。引数を影にする関数と、`setTimeout`・`requestAnimationFrame`・`.then(…)`・`addEventListener` に渡した関数・オブジェクトに置いた関数（`img.onload = () => …`）は報告しません: その関数は dispatch の後に走り、`currentTarget` はどちらにしても `null` です。
- **JSDoc の 1 つのブロックの `@typedef` をすべて読みます。** 4.23 までは先頭の 1 つだけを読み（1 つのコメントに `/** @typedef {…} Photo` と `@typedef {…} Area */`）、2 つ目の型のリスト（`/** @type {Area[]} */ areas: []`）は、行のフィールドごとに `wcs/binding-path-missing` の誤報になりました。

新しい 2 つの error は `--errors-only` にも出ます。新しい warning は `--strict` で失敗します。

## 画面とセンサーの要素のページに言うこと

4.25 から、継ぎ目アプリ stamp-rally — 画面とセンサーの要素のスタンプラリー: 全画面・画面の向き・傾きとセンサー・共有・連絡先・資格情報・スリープの抑止 — から。作者がわざとした 20 の間違いのどれにも、この lint はそれとして報告しませんでした。いま言うこと:

- **`wcs/path-readonly`**（error）は、カスタム要素が書くメンバーを setter の無い getter に束ねた形も報告します — `<wcs-wakelock data-wcs="held: keepAwake">` と `get keepAwake() { … }`。出力だけのメンバーは束ねた時点で書かれるので、state の初期化が失敗し、ページ全体が動きません（`[wcs/path-readonly] "keepAwake" is a getter without a setter`）。lint は 0 件でした。判定はランタイムの配線と同じです: `#ro` でも変わらず、`#init=none` なら要素が値を知らせるたびに失敗し、要素が何も書かないのは `#ro,init=none` だけです。入力でもあるメンバー（`<wcs-storage>` の `value`・`trigger`）は、要素が値を知らせるたび — 要素に渡すだけの getter は `value#ro:` で一方向に束ねます — と、`#init=element` の束ねた時点に書かれます。spread が束ねるメンバーも同じに読みます。組み込みの `wcs-*` タグと、ページがリテラルの `static wcBindable` で定義する要素が対象です。
- **`wcs/token-undeclared`** は、`$commandTokens` / `$eventTokens` そのものが無い state のトークンも報告します — トークンが 1 つも無い、いちばん確かな場合で、lint が黙っていた場合です（宣言を写し忘れた Quick Start）: `command.select: $command.select`（error — state の初期化が失敗する）、スクリプトの `this.$command.select.emit(…)`（error）、`on*: $command.x` と `eventToken.<member>: name`（warning — イベントのたびに報告される）。`$eventTokens` に無い `$on` のエントリも error です: ランタイムは state の読み込みを拒みます。「無い」と言うのは、宣言を全部読める state だけです — トップレベルに spread の無い `export default { … }` か JSON で、キーが無いか空のリストのとき。未宣言の `on*: $command.x` はこの code になりました（以前は `wcs/binding-path-missing`）。
- **`wcs/command-event-argument`**（warning） — データを取るコマンドに直結した `on*: $command.x`: `<button data-wcs="onclick: $command.share">` と `<wcs-share data-wcs="command.share: $command.share">`。イベントから emit したトークンはイベントを第 1 引数として運び、コマンドはそれで呼ばれます: `<wcs-screen-orientation>` の `lock(event)` と `<wcs-share>` の `share(event)` はブラウザの TypeError が `error` に出るだけ、`<wcs-credential>` の `get(event)` は何も言わず `null` になります。state のメソッドから emit してください: `onclick: share` と `share() { this.$command.share.emit({ … }) }`。組み込みタグの、メソッドが引数を宣言するコマンドが対象です。引数の無いコマンド（`start`・`requestFullscreen` — ボタンへの直結が短い書き方）、受け取る種類でない第 1 引数を無視する 4 つ — `<wcs-fetch>` の `fetch`・`<wcs-ws>` の `close`・`<wcs-idle>` の `start`・`<wcs-notify>` の `close` — 、ネイティブ要素のコマンドには出しません。
- **`wcs/frequency-invalid`**（warning） — `<wcs-accelerometer>` / `<wcs-gyroscope>` / `<wcs-magnetometer>` / `<wcs-ambient-light-sensor>` の、正の数値でないリテラルの `frequency`: `frequency="60hz"`・`"0"`・`"-5"`。要素はそれを「指定なし」として読み、センサーはブラウザの既定の頻度で黙って動きます。文面は、値の先頭の数値（`frequency="60"`）を言います。束ねた `frequency:` は検査しません。
- **`wcs/target-selector`**（warning） — `<wcs-fullscreen>` / `<wcs-pip>` / `<wcs-pointer-lock>` / `<wcs-intersect>` / `<wcs-resize>` の、裸の語で書いたリテラルの `target` で、文書にその id の要素があり、そのタグ名の要素が無いもの: `target="viewer"` は `<viewer>` 要素を選ぶ CSS セレクタで、`#viewer` のつもりです。コマンドは失敗し、それを知らせるのは要素の `error` だけです。監視の 2 つは何も監視しません。
- **`wcs/output-path-written`**（warning） — 要素の出力に束ねたパスへ、スクリプトが `true` を代入する: `<wcs-fullscreen data-wcs="active: viewerFs">` と `this.viewerFs = true`。出力は要素が書くものなので、全画面にはなりません — そしてその値を表示するもの（`class.fullscreen: viewerFs`・ボタンのラベル）は、そうなったと言います。要素にはコマンドで頼んでください。わざと狭い規則です: `= true` だけ（使い終えた出力を `false` や `null` に戻すのは普通の書き方）で、カスタム要素の入力やネイティブ要素の双方向の束縛（`checked: flag`）にも束ねたパスには言いません。
- **要素の出力が書くスロットは「分からない」であって「無い」ではありません。** `picked: null` と `<wcs-contacts data-wcs="value: picked">`、`users: []` と `<wcs-fetch data-wcs="value: users">`、spread が書く `<パス>.value`: スロットの中身は要素が渡すものなので、その下に束ねたパス（`picked.0.name.0`・行の `.name`）は検査せず、キーの上の `wcs/path-dynamic-unknown`（info）1 件がそう言います。以前は 1 件ずつ `wcs/binding-path-missing` でした。キーに JSDoc の `@type` を付ければ検査します。
- **`wcs/input-nested-write`** は、代わりに束ねる形を言います: アクセサペア（`value#init=element: <getter>`）か、一方向の `value#ro: <getter>`。setter も `#ro` も無い getter は保存はしますが、要素が知らせる値の書き戻しを拒まれます。

広がった `wcs/path-readonly` と `wcs/token-undeclared` の error は `--errors-only` にも出ます。新しい 4 つの warning は `--strict` で失敗します。

## TypeScript で書くチームに言うこと

4.26 から、継ぎ目アプリ lending-desk — TypeScript で書くチームの備品の貸出窓口: `.ts` の state、生成した `stateSchema`、`.ts` のモジュールで定義する要素、1 つの共有ファイルに置いた API の型。そのページは、比較の綴り違いのステータス、ステッパーに無いメンバーへの束縛、読むものの半分しか追跡しない getter、manifest には残っている 3 つの改名したキーなどを抱えたまま、この lint を 0 error・0 warning で通っていました。そこへ行き着くために、ハンドラの戻りの型も外していました。いま言うこと:

- **`.ts` の state の戻りの型を読みます。** `get total(): number {`・`submit(e: Event): void {`・`$watch` の `count(cur: number): void {` — オブジェクト型・合併・`Promise<…>`・型引数・型述語も — でメンバーが隠れなくなりました。4.25 までは、そのメンバーを読まず: ページに束ねた getter やメソッドは `wcs/binding-path-missing`（`stateSchema` があれば `wcs/path-nonexistent` — メソッドは schema に無い）、ハンドラの引数の `cur:` は `$watch` のキー（`wcs/watch-path-missing "cur"`）になり、スクリプトの規則（`wcs/getter-untracked-read`・`wcs/nested-assign`・`wcs/array-mutation` …）は型付きの getter を飛ばしていました。TypeScript の構文のある本体（`x as T`・`y!`・型付きの局所変数）・state が import する `.ts` のモジュール・ページの `.ts` のモジュールは、Node の `module.stripTypeScriptTypes` で型を消して読みます（Node 22.13 以降。それより古い Node では従来どおり検査しません）。パッケージは足していません: `@wcstack/lint` は依存ゼロのままです。
- **`wcs/tag-member-unknown` は TypeScript で定義した要素も読みます。** `<script type="module" src="./main.ts">` とそれが import する `.ts`（`./x.js` の import は `.js` が無ければ `./x.ts`、拡張子の無い import は `./x.ts` → `./x.js`）: `static wcBindable = { … } as const satisfies Decl` もリテラルです。4.25 までは `.js` / `.mjs` のモジュールだけを読んでいたので、`max` を宣言するステッパーへの `maximum:` が通り、ステッパーは上限を持ちませんでした。
- **`wcs/filter-arg-enum`**（warning） — 比べる値が決して取らないリテラルを引数にした比較のフィルタ（`eq` / `ne`）: 型が `"pending" | "approved" | "denied"` のときの `class.st-approved: .status|eq('aproved')`（`stateSchema` の `enum` / `const` / `anyOf` の const、JSDoc のリテラルの合併 — `@typedef` や import した型を通しても）。`eq` は決して真にならず（`ne` はいつも真）、バッジの色は黙って出ません。取りうる値と綴りの近い値を挙げます。パスに最初にかけたフィルタだけを見ます。
- **`wcs/filter-input-type` は、持っている型を使います。** 行のパス（`for: rows` の中の `.label|toFixed(0)`）は、展開した行のフィールドの型 — リテラルの行・JSDoc の型・`stateSchema`（getter も: schema が string と言う `.depositLabel|toFixed(0)`）— で読みます。日付のフィルタ（`date`・`time`・`datetime`・`ymd`・`hms`）はランタイムと同じく `Date` だけを受けます（null 以外はランタイムが throw する）: ISO の文字列への `.at|date` を報告します。4.25 までは、リテラルの種を持つ書き切ったパスだけを検査していました。
- **別モジュールの JSDoc の型を読みます。** `/** @type {import("./api.ts").Reservation[]} */`・getter の `@returns {import("./api.ts").Reservation[]}`・`@typedef {import("./api").Reservation} Reservation`: 型をそのファイル — `.ts` / `.d.ts` の `interface` と `type`、`.js` の `@typedef` — から読み、その下に束ねた行を検査します。読めない型（ファイルが無い・名前が無い）のキーの下は検査せず、1 回だけそう言います（`wcs/path-dynamic-unknown`、info）— 分からないのであって、無いのではありません。4.25 までは、そのリストの下に束ねたフィールドが 1 件ずつ偽の `wcs/binding-path-missing` でした。
- **`[]` に落ちる getter の行を「無い」と言いません。** `get pickups() { return this.counter ? this.counter.pickups : []; }`（`X ?? []`・`X || []`・早い `return []` も）で `X` の形が分からないとき、行は分からないものとし、getter の上で 1 回言います（`wcs/path-dynamic-unknown`）。4.25 までは `[]` が行のフィールドをすべて `wcs/binding-path-missing` にしていました。行の分かるリスト（`this.items ?? []`）はこれまでどおり検査します。
- **`wcs/watch-path-missing` は `stateSchema` を見ます。** 束縛と同じく、schema が持つキーは報告せず、確かに持たないキーだけを報告します。
- **`wcs/drift-state-key`**（warning） — このページに当てた `stateSchema` と root の state のスクリプトの、トップレベルのキーの食い違い: `.ts` で `get displayName()` に名前を変え、manifest にはまだ `headerName` がある。古い schema はスクリプトに勝ち — 古い名前に残った束縛が通り（0 error・0 warning）、その後に足したキーは `wcs/path-nonexistent` でした。`<wcs-state>` の開始タグの上で 1 回、両側のキーを挙げ、作り直しの `wcs-schema emit` を案内します — CI ではこの lint の前に `wcs-schema check` を走らせてください。両側が分かるときだけ: 読み切れる root の state のスクリプト（トップレベルの spread・計算したキー・`$stream` / `$scan` が無い）と schema のトップレベルの properties。ボリュームのマウントの根は数えません。
- **schema はその state のページに当てます** — 上の「schema を当てるページ」。

`--errors-only` には TypeScript で新たに見つかる error（`.ts` のモジュールで定義した要素の `wcs/tag-member-unknown`・型付きの getter の `wcs/getter-untracked-read` …）が出ます。`--strict` は新しい 2 つの warning と、広がった `wcs/filter-input-type` でも失敗します。

## 部品で組み立てたページに言うこと

4.29 から。継ぎ目アプリ garden-plots — 市の共通部品で組み立てた画面: デザイナーの部品は HTML だけ（宣言的カスタムコンポーネント）、開発者の部品はページのデータにマウントするクラス。4.28 までの lint は部品を何も知らず、作者がわざとした 45 通りの間違いのうち捕まえたのは 2 つでした。

**宣言的カスタムコンポーネント（DCC）**（`<my-pager data-wc-definition><template shadowrootmode="open"> … <wcs-state> … </wcs-state></template></my-pager>`）:

- **定義は、それ自身の範囲です。** テンプレートの中のマークアップは定義の `<wcs-state>` に対して、ページのマークアップはページの state に対して検査します。4.28 までは両方のキーが 1 つの集合で、部品だけが持つキーへのページの束縛も、ページだけが持つキーへの部品の束縛も通っていました。部品のファイル（`parts/my-pager.html`）も、コマンドラインで名指せば同じに検査します。
- **`wcs/dcc-declaration`**（error） — 実行時がタグを定義するときに拒む定義。条件は実行時と同じです: リストでない `$bindables` / `$commands`、空・`$` で始まる・2 回書いた・state のメンバーでない項目、`$bindables` のメソッド、`$commands` の値、定義の中の `<wcs-state bind-component>`、定義自身の 2 つ目の `<wcs-state>`。拒まれた定義は何も定義しないので、どのページのどのインスタンスも未知の要素のままです。確かなときだけ言います: リテラルでないリスト、`export default { … }` のリテラルでない state、lint が読めない state のファイルには触れません。
- **`wcs/tag-member-unknown`**（error）が DCC も見ます: `<my-pager data-wcs="totl: n">` や `command.nxt:` を、部品の `$bindables` と `$commands` に突き合わせ、近い名前を添えます。定義は、ページが言う場所から読みます — ページの中、または import map が autoloader の `dcc` ローダーに名指すファイル: `.html` で終わるか `|dcc` と書いた eager のキー、`|dcc/` と書いた名前空間。lint が読めないファイルからは契約が出ず、そのタグの束縛は検査しません: `/` から始まるパスは `--root=<dir>` を渡したときだけ読みます。
- **`wcs/dcc-attribute`**（warning） — 部品の `$bindables` のメンバーを属性で書いたインスタンス（`<my-pager total="120">`）。DCC の入力はプロパティで、属性は読まれません: 部品は既定のままです。実行時も 4.28 から同じ code で警告します。タグと名前ごとに 1 回。


**クラスの部品**（テンプレートに `<wcs-state bind-component="state">`、インスタンスに `state = { … }` を持つ `class XCard extends HTMLElement`。`<x-card data-wcs="state: user">` でマウントする）:

- **クラスは、ページが言う場所から読みます** — import map が autoloader に名指すファイル（`"@components/x-card": "./parts/x-card.js"`、または名前空間: `"@components/x/": "./parts/"` と `<x-card>` → `./parts/card.js`）、またはページが読み込むモジュールのうち `customElements.define("x-card", XCard)` を呼ぶもの。部品のテンプレートの中でマウントしている部品も、そこから辿って読みます。`.ts` のファイルは型を消して読みます。
- **部品が公開する getter は、ページのパスです。** 部品の state の getter は、部品をマウントした所のパスで読めます — `user.display`、行にマウントしたなら行の中の `.display`。部品の中の部品も同じです。4.28 までは、それを読むページに「パスが存在しない」（`wcs/binding-path-missing`）と言い、回避策 — ページのデータの JSDoc の型に getter を手で宣言する — は、後の改名を隠していました。部品から無くなった getter は、ほかの無いパスと同じに報告します。
- **部品のメソッドは、ページと同じに検査します**: `this.tenant.name = v`（`wcs/nested-assign`）と `this.plots.push(p)`（`wcs/array-mutation`）は、部品でもエラーです。所見は部品のファイルの、その行に出ます。
- **部品のテンプレートのパスで、先頭のキーをどこも与えないもの**は `wcs/binding-path-missing`（warning）で、部品のファイルに出ます: そのキーが部品自身の state のものでなく、ページが渡してもおらず（`state.view:`）、マウント先のオブジェクトにも無いとき — テンプレートの `nmae`、ページが `state.veiw:` と書いた所の `view.x`、部品の中で読んだページのパス（`pageTitle`: 渡してください）。部品の中では、そういう読みはマウント先へ落ちて何も失敗しません。実行時は 4.28 から報告していて、これは同じ基準です。マウント先のオブジェクトは、形が分かるとき（種・JSDoc の型・スキーマ）だけ判定します: 空で始まるリストの行には何も言いません。先頭のキーより深い所は言いません。
- 確かなときだけ読みます: オブジェクトリテラルの `state = { … }`（フィールドか、コンストラクタの `this.state = { … }`）で、スプレッドも計算されたキーも無いもの。テンプレートは、モジュールの中の 1 つの文字列。lint が読めないファイル（`--root` なしの `/` から始まるパス）、呼び出しで作る state、見つからないクラスには、これまでどおり何も言いません。


## ほかのフレームワークの癖で書いたページに言うこと

4.30 から。継ぎ目アプリ street-reports — 初めての作者が React のアプリを wcstack に移した。React（JSX）の作者が持ち込む癖は何も言われずに動くか、lint が別のものとして言いました: 式は「存在しないパス」と言われ、束縛の右辺のテンプレートリテラルや引用符の文字列は何も言われませんでした。ランタイムが拒むか黙って落とすものは error、ほかは warning で、確かなことだけを言います。

- **`wcs/binding-expression`**（error） — 束縛の右辺はパスとフィルタで、式ではありません: `hidden: !loading`・`textContent: count + 1`・`class.active: status === 'new'`・`class.is-new: .status === 'new'`・`textContent: done ? '完了' : '未完了'`・`` attr.href: `/reports/${id}` ``・`textContent: '件数: ' + count`・`textContent: formatDate(reportedAt)`・`if: items.length > 0`・`{{ count + 1 }}`・`<!--@@: count + 1 -->`。式とは、右辺（最初の `|` より前）に空白か `` ! ? = < > + ( ) ' " ` & , `` のどれかがあるもの — パスはどれも持てません。メッセージは、形にフィルタがあればそれを示し（`!x` → `x|not`・`x > 0` → `x|gt(0)`・`x === 'new'` → `x|eq(new)`・`x + 1` → `x|add(1)`）、無ければ getter を勧めます。引数付きやアロー関数のイベントの束縛（`onclick: remove(.id)`・`onchange: () => toggleRow(.id)`）には、ハンドラはメソッドの名前で `(event, ...ループの添字)` で呼ばれると言います。1 つの文字列に 1 件: 同じ文字列のパスが無いという報告（`wcs/binding-path-missing`・`wcs/path-nonexistent`）は重ねません。引数付きのフィルタ・修飾子・行のパス・ワイルドカードと添字のパス・スプレッド・`else:`・`state.key:`・`command.x:`・`eventToken.x:` は式ではありません。`a || b` は既に error です（`wcs/binding-syntax`、空のフィルタ）。`<wcs-state>` の無いファイルの `{{ }}` はほかのテンプレートエンジンのもの（`{{#each}}`）で、読みません。
- **`wcs/attribute-mustache`**（warning） — 束縛属性以外の属性の値の `{{ }}`: `href="/reports/{{ id }}"`・`class="row {{ kind }}"`・`alt="{{ title }}"`・`<wcs-link to="/reports/{{ .id }}">`。`{{ }}` はテキストでしか読まれないので、属性には波括弧が残ります。属性を束ねてください（`attr.href: <パス>`。文字列を組み立てる getter を書いて）。ページを返す前にサーバーのテンプレートが埋めるのなら正しいので warning です。`<wcs-state>` のあるファイル（または DCC の定義）だけで、state が `$behavior: { enableMustache: false }` を宣言しているとき・`data-wcs-ignore` の中では言いません。属性ごとに 1 回。
- **`wcs/structural-element`**（error） — `<template>` でない要素の `data-wcs` に単独で書いた `if:` / `elseif:` / `else:` / `for:`（`<p data-wcs="if: open">`・`<li data-wcs="for: items">`）: ランタイムはその名前のプロパティを書くだけで、要素は常に表示され、一覧は 1 つの要素です。要素を `<template data-wcs="if: …">` の中に入れてください。ほかの束縛と並べたものは、これまでどおり `wcs/template-syntax` が言います。
- **`wcs/collection-mutation`**（error） — state のメソッド・setter・`$watch` と `$on` のハンドラ（`wcs/array-mutation` が見る所）で、state のリテラルでの初期値が `new Set(…)` / `new Map(…)` のキーへの `this.selected.add(id)`・`.delete(…)`・`.clear()`・`this.byId.set(k, v)`。state はそれを見ません。新しいものを代入する（`this.selected = new Set([...this.selected, id])`）か、配列 / オブジェクトで持ってください。メソッドがキーを代入し直すときは言いません。
- **`wcs/row-id-shared`**（warning） — `for:` の行の要素のリテラルの `id="…"` で、束縛（`attr.id:` / `id:`）が与えないもの: すべての行が同じ id になり、`<label for>` や `aria-labelledby` は最初の行にしか届きません。束ねてください（`attr.id: .domId` — 行のキーから組み立てる行の getter を書いて）。ループと id ごとに 1 回。行の中の `if:` の枝の下（1 行だけで描かれることがある）と shadow root の中では言いません。
- **`wcs/event-name-case`**（warning） — `onSubmit:`・`onClick:`・`onChange:`（JSX の綴り）: `Submit` という名前のイベントのリスナーが付き、それを送るものはありません。DOM のイベントなら `onsubmit:`。部品のコールバック（"prop"）は部品が送るイベントで、`eventToken.<メンバー>:` で束ねます。
- **`wcs/inline-import`**（error） — インラインの `<wcs-state>` や `<wcs-guard-handler>` のスクリプトの静的な `import … from "./x.js"`（`../`・`/`）: `blob:` URL から評価されるので、import は解決しません。`src=` のファイル・完全な URL・import map の名前を使ってください。完全な URL・裸の指定子・`src=` の state には言いません。
- **`wcs/key-binding`**（warning） — ネイティブ要素の `key:`（React の `key`）: `key` という名前のプロパティを書くだけで、何もしません。key は要りません — 行は行のオブジェクトで突き合わされ、取り直したデータで行を保つのは `$listKeys` です。カスタム要素の `key` は入力のことがある（`<wcs-storage>`）ので言いません。
- **`--strict` は読めなかった state を数えます。** `wcs/state-src-unread`（lint が読めない `<wcs-state src>`）と、state の先頭の `...spread` の `wcs/path-dynamic-unknown` —— どちらの後も、その state のパスは 1 つも検査されません —— は info のままですが、`--strict` では warning と同じく数えます（exit `1`）。lint が値を読めないキー（別のファイルから import した辞書、`team: init.team`）は、state の残りを検査したままにします: `--strict` が通す info のままです。そして、summary 行がその数を言い（`(strict; 2 unchecked counted as warnings)`）、その後に `strict:` の注記が続きます。4.29 までの `--strict` は、そうした state を検査しないまま exit `0` でした。

新しい error は `--errors-only` にも出ます。新しい warning は `--strict` で失敗します。

## 生成した schema と、行の合計を持つページに言うこと

4.31 から。外部の評価 — wcstack 4.28.0 でビルドなしの確定申告の下書きツールを 25 日で作る Advent Calendar の連載の記録から:

- **`stateSchema` を足しても検査は弱くなりません。** schema が何も言わない所 — 行に型の無い一覧（`items: {}`。空で始まる一覧に `wcs-schema` が書くもの）・`null` の型の値・`any` — のパスは、schema が無いときと同じに検査します（`wcs/binding-path-missing`、warning）。そうした一覧の下の綴り違い `.deductio` は、schema が無いと知らされ、足すと通っていました。`wcs-schema emit` も、そうした一覧を名指すようになりました。
- **`wcs/getter-untracked-read` は一覧の行も読みます。** getter が `this.incomes` を読み、行のオブジェクトから項目を読み — `this.incomes.reduce((t, row) => t + row.amount, 0)`・`this.todos.filter((t) => !t.done).length`、`filter` / `slice` / `toSorted` の後・`[...this.list]`・`for (const row of this.list)` も — その項目がパスで書かれるとき。追跡されるのは一覧だけなので、合計は行の追加と削除には付いてきて、金額を打ち替えると前の値のままです。ページの束縛が書くなら **error**（行の中の `valueAsNumber: .amount`・`checked: .done`・組み込みタグの出力）、lint が契約を持たないカスタム要素の `value:` / `checked:`（`<yen-input data-wcs="value: .amount">`）かスクリプト（`this["incomes.0.amount"] = …`・`$setAll`）が書くなら warning。その項目の書き込みが無ければ報告しません — 一覧を置き換えるページ・`#ro` の束縛・`<option data-wcs="value: .id">`。項目はパスで読んでください: `this.$getAll("incomes.*.amount", [])`。
- **無いパスにはどこでも「もしかして」。** トップレベルのキーや getter の綴り違い（`dependentsDeductio`）・オブジェクトのメンバー（`user.nmae`）にも、ランタイムと同じく近い名前を言います。これまでは行のフィールドだけでした。

新しい warning は `--strict` で落ち、新しい error は `--errors-only` でも出ます。

## 生成 → 検証 → 修正ループでの利用

安定した diagnostic code・`source:line:col` range・exit code 契約により、CI のゲートにも AI コード生成フローにもそのまま組み込めます: HTML を生成 → `npx @wcstack/lint --errors-only` → 診断を読んで修正 → exit code `0` になるまで再実行。このゲートが覆うのは `data-wcs` のページです: 出力が `not read:` や `nothing to check:` で終わるときは、そのファイルは検査されていません。

## VS Code 拡張との関係

このパッケージは薄い配布ラッパーです。[`wcstack-intellisense`](https://github.com/wcstack/wcstack/tree/main/packages/vscode-wcs) の validator core からビルドされた自己完結の CLI バンドルを同梱します（runtime dependencies ゼロ）。sidecar manifest は tooling 専用で、ランタイム挙動を変えることはありません。規範スキーマは [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md) を参照してください。

## License

MIT
