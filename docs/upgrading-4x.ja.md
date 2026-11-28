# 4.x の中での更新

**English**: [upgrading-4x.md](./upgrading-4x.md)

この手引きは、4.x のリリースで動いているアプリを、後の 4.x のリリースへ上げる人のためのものです。メジャーの中では、semver の対象は互換を保ってしか変わりません（[バージョニングと破壊的変更](../README.ja.md#バージョニングと破壊的変更)）。4.x の中の更新で変わるのは、lint とコンソールが報告するもの、欠陥だった振る舞い — ページがそのいくつかに頼っていたことはありえます — そして、アプリがその欠陥のために書いた回避策です。3.x からは、先に [3.x → 4.0 移行ガイド](./migration-v4.ja.md) を読んでください。

この手引きは継ぎ目アプリ `homeroom` から来ています: 4.2.0 で作り、10 個の回避策をそれぞれコードに印を付けて書いたクラスのお知らせ板を、2 週間後に CHANGELOG・リリースノート・README・AI の作成スキルだけで 4.10.1 へ上げたもの（[seam-apps.ja.md](./seam-apps.ja.md)）。版を変えただけで変わった検査は 1 つ — 新しい lint の警告が `--strict` を落とした — でした。変わった 2 つのことは、どちらも CHANGELOG の「Upgrading」の節にありました。大きな部分はそこにありませんでした: 10 個の回避策のうち 7 個が要らなくなっていて、それは 5 つのリリースにまたがって Added か Fixed にだけ書かれていました。そのうち 2 個は 4.10.1 で害をなしました — スキップリンクのハンドラはルーターのページ内の移動を打ち消し、それでもテストはすべて通り、テストの設定の小細工は、テストの 1 つが URL を変えたとたんにテストを壊しました。

## 更新のしかた

1. **版を変える。それ以外は変えない。** `@wcstack/*` のパッケージはすべて同じ版へ上げます: `<script>` の行と import map（`https://esm.run/@wcstack/state@4.10.1/auto`、`https://cdn.jsdelivr.net/npm/@wcstack/state@4.10.1/dist/auto.min.js`）、自分のモジュールの中のパッケージの `import()`、そして `package.json` — `@wcstack/lint`・`@wcstack/testing`・`@wcstack/server`・`@wcstack/typescript` も。プロジェクトを `@wcstack/` と古い版の文字列で検索します: 取り残した行は、何も言わずに古い版のまま動き続けます（[1 ページの中で版が混ざる](#1-ページの中で版が混ざる)）。
2. **検査を走らせる**: lint、単体テスト、ブラウザのテスト、主な流れのコンソール。
3. **変わるものを読む**: 2 つの版の間の各リリースの — 下の各リリースの一覧で、CHANGELOG の項へつながっています。ほとんどは lint かコンソールの新しい警告です。動いているページのすることを変えるものは少しです。
4. **回避策を見直す**: 下の各リリースの表と突き合わせます。リリースが直した欠陥のための回避策は、よくて死んだコードで、直したものと争うものもあります。1 つずつ外し、それぞれ、それを確かめる検査とともに外します。回避策に向けて書いたテストは、回避策がなくても別の理由で通ることがあります: `homeroom` のスキップリンクのテストは URL がページに留まることを確かめていて、古いハンドラがあってもなくてもそうでした。

### ツールはページの版にそろえる

- `@wcstack/lint` は、自分のリリースの規則とフィルタの表でページを検査します。古い lint は新しい書き方をエラーと報告し — 4.9 の lint は 4.10.0 のタイムゾーンの引数（`datetime(ja-JP,short,Asia/Tokyo)`）を `wcs/filter-arity` と言う — 新しい lint が検査するものを見ません。新しい lint は、古いページがすでに持っていたものを見つけます: 誰も触っていないページの、4.10.0 の `wcs/live-region-inserted`。lint の指摘は semver の対象外で、ランタイムのすることに従います（4.4.0）。
- VS Code 拡張は独自に版を付け、作られたリリースの lint の規則を運びます（[拡張の changelog](../packages/vscode-wcs/CHANGELOG.md)）。
- `@wcstack/testing` と `@wcstack/server` はページと一緒に動かします。`mount(html, { resolveModule })` には `@wcstack/testing` 4.9 が要ります: 古い `mount()` はこのオプションを無視し、テストは Node のモジュールローダーのエラー（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）で落ちます。そのエラーは版を名指しません。

### サーバー描画

- `@wcstack/server` と同じ minor のクライアントを一緒に配備します。クライアントは `<wcs-ssr version>` を major.minor で比べ、別の minor のスナップショットを捨てます: ページはクライアントで描き直されます。
- 4.3.0 から `@wcstack/server` は自分と同じ版ちょうどの `@wcstack/state` に依存するので、固定したサーバーの版が、描くエンジンの版です。
- 4.4.0 から、新しい minor のページを計画できないクライアントは、ページに触る前に失敗し、サーバーの HTML は読めるまま残ります。4.3 までのクライアントは、先にサーバーの行を取り去ります: サーバーの minor のクライアントを配ってください。

### `integrity` で固定した版

- ダイジェストは 1 つの版のバイト列に対するものです: URL とその `integrity` は一緒に変えます。ダイジェストはリリースから取ります — GitHub Release の表か、その `sri.json`（[sri.ja.md](./sri.ja.md) §2）。CDN からは取りません。
- 4.7.0 から `sri.json` は `@wcstack/state` の `dist/split` のすべてのファイルを持ち（`packages["@wcstack/state"].split`）、リリースノートは import map の `integrity` のかたまりを持ちます。更新のたびにかたまりをまるごと置き換えます: チャンクの名前は 1 つのビルドのもので、別のビルドの一覧は、ページが動いたまま、どのチャンクも検査しないままにします（[sri.ja.md](./sri.ja.md) §5.1）。
- 古いダイジェストはスクリプトを止めます。ブラウザのコンソールはファイルを名指しますが、wcstack からはそれを言うものが何も動きません。ルーターが止められたページは、静的なマークアップだけを見せます。
- `esm.run` の URL は `integrity` を持てません（[sri.ja.md](./sri.ja.md) §3）。

### 1 ページの中で版が混ざる

リリースのパッケージは、1 つの版でそろって出ます。4.10.1 までは、コアと照らし合わせるのは分割エントリの追加機能だけで（下）、それ以外は、版が混ざっていてもページの上で何も言いません:

- **古い版に取り残したパッケージ 1 つ**は動きますが、新しいページがそれに求めるものが欠けていることがあります。4.8 の `@wcstack/upload` は `<wcs-upload-header>`（4.9.0）を定義しません: タグはただの要素のままで、アップロードはヘッダなしで出ます。
- **同じパッケージを 2 つの版で 2 回読む**: 先に評価された方がタグを定義し、もう一方は何もしません。新しい `<script>` より前に置いた古い `<script>` は、古い版を動かします。
- **版を固定しない行**（`https://esm.run/@wcstack/fetch/auto`）は npm の `latest` に従い、転送先の URL も版を名指しません。固定したページにこれを写すと、版が混ざります。
- **`@wcstack/state` の分割エントリ**は、4.7.0 から別のエンジンのコピーの追加機能を拒みます（`[wcs/feature-foreign]`）。4.6 までのコアはそれを受け入れ、追加機能は何もしません。
- **開いたままのタブ**は読み込んだものを持ち続け、残り — ルートの追加機能、autoloader が読むコンポーネント、遅延の `import()` — を、配備の後はその URL が名指すものから読みます。自分で配るファイルは URL に版を入れ、古い版をサーバーに残します（[sri.ja.md](./sri.ja.md) §7）。

### 戻す

- 同じやり方で戻します: すべてのパッケージを一緒に古い版へ、lint とテストの補助も、サーバーとクライアントも一緒に。
- 新しいリリースが加えたものを使うコードは、古いリリースでは動かず、そのほとんどは何も言わずに失敗します: `storage-key`（4.6.0）は 4.5 までは属性ではないので、要素はキーを持たず何も保存しません。`<wcs-upload-header>`（4.9.0）はただの要素なので、アップロードはヘッダを持ちません。真偽値に束ねた `leaveConfirm`（4.9.0）は `confirm("true")` / `confirm("false")` と尋ねます。`date` / `time` / `datetime` の 3 番目のタイムゾーン（4.10.0）は、4.9 までは state を止めます（`[wcs/filter-arity]`）。スキップリンク `<a href="#main">`（4.10.0）は、`<base href>` の下ではホームのルートへ行きます。回避策は版と一緒に戻します。
- `<wcs-storage>` が保存したものは、どちらの版でも読めます: 値の保存のしかたを変えた 4.x のリリースはありません。

## リリースごと

各リリースは、動いているページに何が変わるかを挙げ、続いて、そのリリースが要らなくした回避策を挙げます: 前のリリースまでの症状、回避策、いまどうするか。回避策は継ぎ目アプリ（[seam-apps.ja.md](./seam-apps.ja.md)）と `homeroom` の更新から来ています。各リリースの CHANGELOG の項に、すべての変更があります（英語）。

### 4.0.1 – 4.0.4

2026-10-12 – 13 — [4.0.1](../CHANGELOG.md#401--2026-10-12)、[4.0.2](../CHANGELOG.md#402--2026-10-12)、[4.0.3](../CHANGELOG.md#403--2026-10-12)、[4.0.4](../CHANGELOG.md#404--2026-10-13)

- `@wcstack/state`（4.0.1）: 名前のない `class:` と `attr:` は、読み込みのときに `[wcs/binding-syntax]` で拒まれる。何もしていなかった。`class.NAME:` / `attr.NAME:` か、`className:` と書く。
- `@wcstack/lint`: `wcs/filter-unknown` がエラー（4.0.1）。`wcs/input-nested-write` と `wcs/storage-init-seed` が新しい警告（4.0.2）。`wcs/storage-seed-clobber` がアクセサの組を、`wcs/input-nested-write` が `<wcs-fetch>` の `body` を扱い、`wcs/base-href-missing` と `wcs/script-order` が版を固定した URL を見るので、固定したページが初めてこれらに出会うことがある（4.0.3）。`wcs/router-outlet-misplaced` が新しい警告（4.0.4）。
- `@wcstack/router`（4.0.4）: ルーターが使わない `<wcs-outlet>` を警告する（`[wcs/router-outlet-misplaced]`）。

要らなくなった回避策はありません。README の例が 1 つ誤っていました: fetch の README の POST はフォームのオブジェクトを束ね（`body: newUser`）、2 回目は本文を送りませんでした。本文は要求を始めるハンドラで新しく作ります（4.0.3）。

### 4.1.0

2026-10-13 — [CHANGELOG](../CHANGELOG.md#410--2026-10-13)

- `@wcstack/router`: ガードのリダイレクトは履歴の項目を置き換える（戻るでガードされた URL へ戻り、またリダイレクトされていた）。`<wcs-guard-handler>` は `guard=""` なしで最初のルートをガードする。ルートの `guard` 属性は、偽の結果のときのリダイレクト先（既定は `/`）。設計どおりのリダイレクトはログに出ず、互いにリダイレクトし続けるガードは 10 回でエラーとともに止まる。
- `@wcstack/router`: `data`・`params`・`route-name`・`search` はルートの中身を置く前に state に届き、`path` は後に届く。
- `@wcstack/state`: `$watch` は、束縛が付いたときに要素がすでに持っていた値 — ルーターの最初の params、開いている `<wcs-sse>` の `connected` — で、監視が始まるときに 1 回発火する。発火するかどうかは、ページの読み込みの速さ次第だった。
- `@wcstack/state` / `@wcstack/view-transition`: 構造を変えるパス（一覧の行、`if` の枝）だけが view transition の中で動く。値だけを更新するパスはすぐに当たる。
- `@wcstack/fetch`: `value` 属性のない `<wcs-fetch-header>` は送られない（空で送られていた）。
- `@wcstack/signals`: `h()` の `on…` のどのキーの関数もリスナー。小文字の `onclick` は描画のときに走っていた。
- `@wcstack/lint`: `wcs/storage-seed-clobber` はリテラルの種をすべてエラーで報告し、`wcs/on-handler-this` が新しいエラー — `--errors-only` が落ちうる。

| 症状（4.0.4 まで） | 回避策 | いま |
|---|---|---|
| ルーターや開いている `<wcs-sse>` が読み込みのときにすでに持っていた値で `$watch` が発火しなかった | 同じ仕事を `$connectedCallback` にも書く（router-admin、state-collab-board） | 写しを外す: 監視が始まるときに 1 回発火する。監視と同じことをする写しは、いまは読み込みのときに 2 回目を走る。4.2.0 から、そうした値を読むルートの getter も発火する。 |
| `<wcs-view-transition>` があると、束ねた入力欄の 1 打鍵ごとにページ全体の遷移が始まり、その後のクリックが失われた | フォームのあるページでタグをルーターに絞る（`for="router"`、router-admin） | これだけのために絞ったのなら外す: 値の更新はすぐに当たる。 |
| 保存していない変更があるとき、離れる前に尋ねる手段がなかった | ページ自身の `navigate` リスナー（router-admin） | `<wcs-router data-wcs="leaveConfirm: …">` を、保存していない変更がある間はメッセージに束ねる（4.9.0 からは真偽値も）。残したリスナーがナビゲーションを取り消しても、ルーターはもう `InvalidStateError` を投げない。 |
| `<wcs-link>` は自分のパスちょうどでしか active にならなかった | 区画のリンクの印をページが計算する（router-admin） | `<wcs-link match="prefix">`: 下のパスでも active で、そこでは `aria-current="true"`。 |
| `<wcs-fetch-header>` の `value:` が空のヘッダを送った | 代わりに属性を束ねる（`attr.value:`） | `value:` で設定できる。`null` は属性を外し、属性のないヘッダは送られない。 |
| オンライン / オフラインの出力がなかった | `window` の `online` / `offline` リスナー（state-collab-board） | `<wcs-network data-wcs="offline: offline">`。 |

### 4.1.1

2026-10-14 — [CHANGELOG](../CHANGELOG.md#411--2026-10-14)

- `@wcstack/lint` と `@wcstack/typescript` が `<wcs-network>` の `offline` を知る: 4.1.0 のものは、これを `wcs/tag-member-unknown`（エラー）と報告していた。
- `@wcstack/router`: ガードがリダイレクトするページへの `navigateUrl` / `replaceUrl` が `navigate failed: AbortError` をログに出さない。
- `@wcstack/lint`: `wcs/on-handler-this` は `this` の別名（`const state = this`）も報告する。

要らなくなった回避策はありません。

### 4.2.0

2026-10-17 — [CHANGELOG](../CHANGELOG.md#420--2026-10-17)

- `@wcstack/router`: `leaveConfirm` は、ページを離れ、ページが取り消せるナビゲーション — `basename` の外へのリンク（言語の切り替え）、別のサイトへのリンク、フォームの送信 — の前にも尋ねる（Navigation API のあるところで）。受け入れると、ブラウザはもう尋ねない。
- `@wcstack/state`: ルートの getter の `$watch` は、要素が持ち込んだ最初の値で、監視が始まるときに 1 回、`prev` を `undefined` として発火する。
- `@wcstack/signals`: `h()` がまだ定義されていないカスタム要素に渡すオブジェクトや配列は持っておかれ、定義されたときに代入される。属性 `[object Object]` として書かれていた。
- `@wcstack/lint`: 別名・`Object.assign`・`$on` ハンドラの state を通したその場の変更がエラー（`wcs/nested-assign` / `wcs/array-*` のコードで）。`wcs/submit-without-prevent`・`wcs/route-bare-mustache`・`wcs/layout-slot-missing`・`wcs/signals-dual-entry` が新しい警告で、`--strict` を落とす。`wcs/getter-untracked-read` は `location` を読む getter を報告する。
- `@wcstack/router` のコンソール: 既定の `<slot>` のないレイアウトのテンプレートに `[wcs/layout-slot-missing]`、レイアウトのテンプレートが持ち込むアウトレットに `[wcs/router-outlet-misplaced]`。

| 症状（4.1.1 まで） | 回避策 | いま |
|---|---|---|
| 「Oct 13, 2026」や通貨の金額を出すフィルタがなかった | getter の中の `Intl.DateTimeFormat` / `Intl.NumberFormat`（router-admin） | `date(en-US,medium)`（`date` / `time` / `datetime` の 2 番目のスタイル）と `currency(JPY)`。getter もそのまま動く。複数形は getter に残る（`Intl.PluralRules`）。 |
| signals: `h()` の後に定義されたカスタム要素へのオブジェクトの prop が `[object Object]` として届いた | どの `h()` が作るより前にコンポーネントのモジュールを import する（signals-shop） | どちらの順でも動く。 |

### 4.3.0

2026-10-18 — [CHANGELOG](../CHANGELOG.md#430--2026-10-18)

- `@wcstack/fetch`: 空になって戻ってきた url をもう一度 fetch する（`url` A → `null` → A）。離れてまた入ったルートは、データをもう一度読み込む。
- `@wcstack/router`: `<wcs-guard-handler>` は自分が中にいる `<wcs-route>` をガードし（最後に解析したルートをガードしていた）、ルートの親は自分が中にいる `<wcs-route>`: 要素の中で兄弟のルートの後にあるルートや、`<wcs-layout>` の中で別のルートの後にあるルートは、書かれたとおりのパスを持つ。どのルートの外にもあるガードや、`<script type="module">` のないガードは `console.error` で報告される（`[wcs/guard-handler-ignored]`）。外にあっても同じ階層のルートの後にあるものは、そのルートをガードし続ける — 中へ移す。
- `@wcstack/lint`: 8 つの規則がエラー — `wcs/tag-member-unknown`（`wcs-*` タグの `hidden:` のような DOM のプロパティも扱うようになった）、`wcs/getter-cycle`、`wcs/index-arity`、`wcs/token-misconfigured`、`wcs/token-undeclared`（`command.` について）、`wcs/recursion-unsupported`、`wcs/filter-arg-type`、`wcs/input-nested-write`。通っていたページで `--errors-only` が落ちうる。`wcs/filter-input-type` は `lt` / `le` / `gt` / `ge` に渡す文字列を報告し、`wcs/script-order` は info。
- コンソールの警告が増える: `[wcs/fetch-request-superseded]`、`[wcs/fetch-auto-unsafe]`、`[wcs/infinite-scroll-target]`、`[wcs/command-not-ready]`（`<wcs-ws>`・`<wcs-broadcast>`・`<wcs-worker>`・`<wcs-recorder>`）、`[wcs/storage-type-invalid]`、ルーターの `[wcs/base-href-missing]`。
- SSR: `@wcstack/server` は自分と同じ版ちょうどの `@wcstack/state` に依存し、描画は束縛が始めた要求を `timeoutMs` の中で待つ（時間切れでは `[wcs/ssr-pending-timeout]`）。読み手がハイドレーションの前に打ったものは保たれ、`input` と `change` とともに返されるので、双方向の束縛がそれを state に書く。

| 症状（4.2.0 まで） | 回避策 | いま |
|---|---|---|
| 離れてまた入ったルートが古いデータを見せたままか、失敗の後「読み込み中…」のままだった: 空の後の同じ url は何も送らなかった | 読み込みの `<wcs-fetch>` に `manual` を付け、その url の `$watch` が `fetch` コマンドを emit する（homeroom） | 読み込みの `manual` と監視を外す。同じ url をもう一度送るため — 再試行、保存の後の読み直し — の `fetch` コマンドや `trigger` は残す。データを変える要素の `manual` は残す: url の監視がそれを送ってしまう（`[wcs/fetch-auto-unsafe]`）。 |
| SSR: `for:` の行や `if:` の枝の `<wcs-link>` が空で配られ、ハイドレーションの後に `Invalid URL` を投げた | 行の中のただの `<a data-wcs="attr.href: …">`（ssr-news） | 行の中の `<wcs-link>`。ただのリンクもそのまま動く。 |
| SSR: 束縛が `url` を書く `<wcs-fetch>` を描画が待たず、「読み込み中…」を配った | ルーターを待ってから `$connectedCallback` でデータを読む（ssr-news） | 束縛に url を書かせる。描画は要求を待つ。 |
| SSR: `<wcs-state src>` をサーバーで描けなかった | nonce 付きのインラインの state（ssr-news） | `renderToString(html, { resolveModule })`。 |
| SSR: 厳しい `style-src` が、`<wcs-link>` と `<wcs-head>` がサーバーで書く `style` 属性を拒んだ | ポリシーの `style-src-attr`（ssr-news） | この 2 つのためだったのなら外す: サーバーでは書かない。サーバーで bootstrap した `<wcs-fetch>` はまだ書く。 |

### 4.4.0

2026-10-18 — [CHANGELOG](../CHANGELOG.md#440--2026-10-18)

- `@wcstack/lint`: スクリプトの規則が `<wcs-state src>` で読む state も検査し、そこでも `wcs/nested-assign`・`wcs/array-mutation`・`wcs/array-index-assign`・`wcs/on-handler-this` がエラー。新しいエラー: `wcs/path-readonly`、スクリプトの中の `wcs/token-undeclared`、ページが定義するカスタム要素の `wcs/tag-member-unknown`、`stateSchema` があるときの `wcs/read-path-missing`。`--strict` を落とす新しい警告: `wcs/command-token-unbound`、`wcs/write-path-missing`、`wcs/read-path-missing`、時計を読む getter の `wcs/getter-untracked-read`、近いパスの隣の `wcs/updated-callback-unbound`。
- `@wcstack/lint`: トップレベルにスプレッドのある state（`export default { ...defaults(), … }`）のパスは `stateSchema` とだけ照合する。それがなければ、`wcs/path-dynamic-unknown`（info）がそう言う。
- `@wcstack/state` のコンソール（diagnostics 追加機能。`/auto` と `.` に入っている）: `[wcs/read-path-missing]`、`[wcs/post-update-path-missing]`、`[wcs/write-path-missing]`、`[wcs/command-token-unbound]`（誰も購読していない間にわざと emit したトークンも警告する）、`[wcs/delegated-current-target]`。
- `@wcstack/typescript`: `wcs-schema` は、キーを並べられないスプレッドに開いたスキーマを書く。`wcs-schema check` はその差を報告する。
- SSR: サーバーとクライアントを 4.4 で一緒に配備する。

| 症状（4.3.0 まで） | 回避策 | いま |
|---|---|---|
| トップレベルのスプレッドのある state で、スプレッドが持ち込むキーがすべて `wcs/binding-path-missing` の誤報になり、`wcs-schema` はその state でスタックを使い果たした | 手で書いた `stateSchema`（確定申告の下書き） | スキーマがなければそのパスは検査されず、lint はそれを 1 回言う。検査し続けるにはスキーマを残す — 手で書く代わりに、`wcs-schema` で state の JSDoc か TypeScript の型から作る。 |

### 4.5.0

2026-10-20 — [CHANGELOG](../CHANGELOG.md#450--2026-10-20)

- I/O ノード: 切断は、自分がした戻しのイベントを出す — `loading: false`、`<wcs-camera>` の `active`、`<wcs-recorder>` の `recording` / `paused`、`<wcs-speak>` と `<wcs-listen>` の状態、`<wcs-ws>` の `connected` / `loading` / `readyState`、`<wcs-broadcast>` と `<wcs-worker>` の `error`（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §22）。
- `@wcstack/camera`: 切断で途切れた録画はクリップとして届く。`mime-type` がなくても、`mimeType` とクリップは録画を始めたときの型を持つ。
- `"granted"` や `"denied"` だったところが `"unsupported"`: 安全でないオリジンと、Permissions-Policy が切った機能で、`<wcs-permission>` と取得側の `permission` から。その `errorInfo` は `capability-missing`。Geolocation API がないときの `<wcs-geo>` の `errorInfo` は `capability-missing`（`position-unavailable` だった）。
- コンソールの警告が増える: 拒まれた `<wcs-upload>`、url のない `<wcs-fetch>` の `trigger`、許可のない `notify()` に `[wcs/command-not-ready]`。`[wcs/storage-unserializable]`、`[wcs/speech-echo]`、`[wcs/camera-keep-alive-missing]`。
- `@wcstack/lint`: `wcs/handle-bound-as-value` が新しい警告で、`--strict` を落とす。
- SSR: サーバーとクライアントを 4.5 で一緒に配備する。

| 症状（4.4.0 まで） | 回避策 | いま |
|---|---|---|
| `<wcs-camera>` / `<wcs-recorder>` のあるルートを離れると、ページはカメラが点いていると言ったままだった | `routeName` の `$watch` が `active`・`recording` などを `false` に書き戻す（state-field-report） | 外す: 要素が、切断で変えたものを出す。 |
| Permissions-Policy や安全でないオリジンが、利用者の拒否と同じに見えた | ページが `document.permissionsPolicy` と `isSecureContext` を自分で読む（state-field-report） | `permission` が `"unsupported"`。試すと、`errorInfo` が `capability-missing` で、理由が `error` に入って失敗する。 |
| `mime-type` なしで録ったクリップが型を持たなかった | `mime-type="video/webm"` の強制と、アップロードする `File` の代わりの型（state-field-report） | `mime-type` を書かない。クリップの `Blob` が型を持つ。 |
| `'unsafe-inline'` のない `style-src` の下で、カメラのプレビューのレイアウトが崩れた | それをやり直す `wcs-camera::part(video)` の規則（state-field-report） | レイアウトをやり直すだけなら外す: スタイルは構築済みのスタイルシート。 |
| モジュールの定数を map する getter（`PERMS.map(…)`）の行が `wcs/binding-path-missing` の誤報になった | それを黙らせるためだけに作った `stateSchema`（state-field-report） | そのためには要らない。型とパスを照合したいならスキーマを残す。 |

### 4.6.0

2026-10-24 — [CHANGELOG](../CHANGELOG.md#460--2026-10-24)

- `@wcstack/upload`: `url` より前に `files` を受け取った自動の `<wcs-upload>` は、url が来たときにアップロードする。わざとファイルを先に置き、何も送られないつもりだったページは、いまはアップロードする。
- コンソールの警告が増える: `[wcs/post-uncloneable]`、`[wcs/input-as-attribute]`（すべての I/O ノード）、`[wcs/fetch-helper-undefined]`、キーのない `<wcs-storage>` に `[wcs/command-not-ready]`。
- `@wcstack/lint`: `.js`・`.ts`・`.jsx`・`.tsx`・`.vue`・`.svelte` のファイルは読まず、件数の後に名前を出す（`not read:`）。検査するものがないページも名前を出す。終了コードは変わらない。
- `exports["./auto"]` はすべてのパッケージでオブジェクト（`{ types, import }`。`wcstack` では `default`）。文字列として読んでいたスクリプトは `.import` を読む。
- SSR: サーバーとクライアントを 4.6 で一緒に配備する。

| 症状（4.5.0 まで） | 回避策 | いま |
|---|---|---|
| React と Vue は `key` を自分のものにするので、`<wcs-storage key="…">` はキーのない要素になった | ref の中の `el.key = …`（fw-inventory） | マークアップの `storage-key="…"`。4.5 へ戻すと知らない属性になり、何も保存されない。 |
| React 19 は props を書いた順に当てる: `<wcs-upload files={files} url="…">` は何も送らなかった | `files` より前に `url` を書く（fw-inventory） | どちらの順でも動く。 |
| `import("@wcstack/sse/auto")` が型検査で落ちた（`TS7016`） | 自分で書いた宣言か、`// @ts-expect-error` | 外す: すべての `./auto` に `dist/auto.d.ts` がある。そこに残した `@ts-expect-error` はそれ自体がエラー（TS2578）。 |

### 4.6.1 と 4.6.2

2026-10-24 — [4.6.1](../CHANGELOG.md#461--2026-10-24)、[4.6.2](../CHANGELOG.md#462--2026-10-24)

- `@wcstack/typescript`（4.6.1）: peer は `typescript >=5.0 <7` なので、TypeScript 7 のプロジェクトは `--force` なしでは入れられない。`typescript@6` を使う。
- `wcs-tsc` と VS Code 拡張（4.6.2）は、`this` を読む getter の本体を検査する: 通っていたページが getter の中のエラーを報告されることがある。

要らなくなった回避策はありません。

### 4.7.0

2026-10-25 — [CHANGELOG](../CHANGELOG.md#470--2026-10-25)

- `@wcstack/state`: エンジンが報告するエラーは `console.error` ではなく `reportError()` を通る: `window.onerror` と `error` リスナーがそれを受け、コンソールは捕捉されないエラーとして出し、Playwright の `pageerror` がそれを見る。happy-dom・Node・`@wcstack/server` では何も変わらない。
- `@wcstack/state`: 別のエンジンのコピーの追加機能は state を失敗させる（`[wcs/feature-foreign]`）。
- `@wcstack/state`（`formats`）: `date`・`time`・`datetime`・`ymd`・`hms` は `undefined` / `null` に何も描かない。
- `@wcstack/router`: `<script type="module">` のない `<wcs-guard-handler>` はそのルートを閉じる — そこへのナビゲーションはすべて `guard` のパス（既定は `/`）へ行く。HTML を処理するバンドラ（Vite）は、そうしたスクリプトを取り去る。
- `@wcstack/router`: ページが求めた再読み込み（`location.reload()`・`history.go(0)`・`navigation.reload()`）は文書を読み直す。
- `@wcstack/lint`: 読めない `<wcs-state src>` に `wcs/state-src-unread`（info）。

| 症状（4.6.2 まで） | 回避策 | いま |
|---|---|---|
| ルーターの下で `location.reload()` が何もしなかった | 再読み込みの前にルーターをページから外す（prod-booking） | `location.reload()` を呼ぶ。 |
| どの `@components/` の名前空間にも入らないカスタム要素 — 別のライブラリのタグ、まだ定義されていない `<wcs-state>` / `<wcs-link>` — が `No matching namespace found` で自動読み込みを止め、最初の走査ではページのコンポーネントが 1 つも読み込まれなかった | autoloader のスクリプトを最後に置く、または `<wcs-state>` が定義されてから `<wcs-autoloader>` を加える（prod-booking、homeroom） | autoloader は好きなところに置く。4.6 までは、このエラーはコンポーネントが 1 つも読み込まれないことも意味していた。 |
| 後から来る日付（最初は `null`）で日付のフィルタが失敗した | 日付の束縛を囲む `if:`（prod-booking） | 外す: ない値は何も描かない。別の型の値はまだ拒まれる。 |
| エンジンのエラーは `console.error` にしか行かなかった: `window.onerror` のエラー報告は、ページが初期化に失敗したときでさえ何も聞かなかった | `console.error` の包み、`reportError()` を呼ぶ `$errorCallback`、`connectedCallbackPromise` へのフック（homeroom、prod-booking） | 外す: エンジンが報告するエラーはすべて `reportError()` に届く。**`$errorCallback` は束縛の失敗をそこから取り上げる**: あると、失敗した束縛はコールバックにだけ行く。メッセージを state に書くもの — 4.2 のスキルが教えた形 — は、エラー報告を束縛の失敗について盲目にする。`reportError(error)` も呼ぶときだけ残す。`console.error` の包みは、もうエンジンのエラーを見ない。 |
| 分割エントリに公開されたダイジェストがなかった | npm の tarball から手で計算した import map の `integrity` の一覧 | リリースノートからかたまりを写すか、`sri.json` から取る。 |

### 4.8.0

2026-10-26 — [CHANGELOG](../CHANGELOG.md#480--2026-10-26)

- I/O ノード: 要素が接続のときに始める仕事は、1 マイクロタスク後に、その時点の入力で始まる（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §23）。17 のパッケージ。要素を追加して同じタスクでその状態を読むコード（`readyState`、`running`、タイマーの `immediate` の刻み）は、マイクロタスクを 1 つ待つ。
- `@wcstack/websocket`: 開いている `<wcs-ws>` は、ページが back/forward cache に入りうる `pagehide` で閉じ、戻ったときにつなぎ直す。その間に届いたものは再送されない: `connected` で同期し直す。
- I/O ノード: `[wcs/command-not-ready]` は要素ごとに 1 回ではなく、不調 1 回につき 1 回。`console.warn` を数えるテストは、より多くを見ることがある。許可のない `<wcs-idle>` の `start()` もそれを言う。

| 症状（4.7.0 まで） | 回避策 | いま |
|---|---|---|
| 閉じられずに死んだ接続（スリープ、NAT、プロキシ）が `connected: true` のままだった | ページ自身の見張り: 最後のメッセージの時刻、ping、沈黙の後の close と開き直し（shift-desk） | `<wcs-sse>` / `<wcs-ws>` の `stale-after="<ms>"`。サーバーはそれより頻繁に何かを送る必要がある。 |
| 開いている `<wcs-ws>` がページを back/forward cache から締め出した | `pagehide` でソケットを閉じ、`pageshow` で開き直す（shift-desk） | 外す: 要素が両方をする。 |
| `<wcs-head>` の束ねた子（束ねた `<title>`）がナビゲーションのたびにノードを残した | 静的な `<title>` と、`$watch` から設定する `document.title`（shift-desk） | `<wcs-head>` の中の `<title>` をまた束ねる。 |

README の例が 2 つ誤っていました: notification と speech の README は存在しない `debounce` フィルタを使っていて、state を失敗させます（`[wcs/filter-unknown]`）— `<wcs-debounce>` を使います。idle の README のクイックスタートは出力の `active` を種付きで束ね、読み込みのたびに「Away」を見せていました — `userState` を束ねます。

### 4.9.0

2026-10-28 — [CHANGELOG](../CHANGELOG.md#490--2026-10-28)

- `@wcstack/lint`: ページの束縛が getter の読むパスを書くところでは、`wcs/getter-untracked-read` はエラー（`...: monthFetch` の下の `this.monthFetch.value`）— `--errors-only` が落ちうる。パスそのものを読む（`this["monthFetch.value"]`）。
- `@wcstack/testing`: `mount()` は、読み込むもののない `<wcs-state>` を拒む。いつまでも待っていた。
- `@wcstack/router`: 真偽値の `leaveConfirm` — `true` は英語の既定のメッセージで尋ね、`false` は何も尋ねない（「true」「false」と尋ねていた）。
- `@wcstack/state` のコンソール: `[wcs/on-handler-this]` と `[wcs/second-root]`。

| 症状（4.8.0 まで） | 回避策 | いま |
|---|---|---|
| `<wcs-upload>` は要求のヘッダを送れず、トークンを求める API には届かなかった | CDN から `UploadCore` を import し、state から動かす（family-ledger、homeroom） | `<wcs-upload>` の中の `<wcs-upload-header name="Authorization" data-wcs="value: authHeader">`。upload のパッケージはページの版で: 古いものではタグはただの要素のままで、アップロードはヘッダなしで出る。 |
| ブラウザが諦めた SSE のストリーム（HTTP のエラー、`CLOSED`）が閉じたままだった | `errorInfo.recoverable === false` で待ってから開き直すタイマー（state-collab-board、shift-desk、family-ledger） | `auto-reconnect`（`reconnect-interval`・`max-reconnects`）。`connected` での追いつきは残す。url の中のトークンは更新しない。 |
| 2 回目の `DELETE` が `204` で答えられても、`status` は何も発火しなかった（同じ値） | `loading` が `true` → `false` になることで要求の終わりを知る（family-ledger） | 応答のイベント、`eventToken.value` ＋ `$on`（`detail` は `{ value, status, objectURL }`、応答ごと）。4.9 から fetch の README がそう書いている。`loading` の切り替わりもそのまま動く。 |
| `mount()` が `<wcs-state src>` を読み込めず（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）、モジュールのオブジェクトがマウントの間で共有された | インラインのスクリプトの中の state の写し（family-ledger）、テストの設定の `file:` の文書 URL、マウントごとに新しい `src="./state.js?v=n"`（homeroom） | `mount(html, { resolveModule })`: URL をファイルに対応させ、マウントのたびにモジュールを読み直す。**`file:` の文書 URL は害をなす**: テストが文書の URL を変える（`history.replaceState`）と、続くテストは `src` をその URL に対して解決し、state を読み込めない。 |
| メソッドの中で `map` で代入した行と、`{}` を種にしたキーに代入したオブジェクトリテラルのキーが `wcs/binding-path-missing` の誤報になった | JSDoc の `@type`（family-ledger）、種にすべてのキーを書く（homeroom） | そのためには要らない。リテラルの中のスプレッド（`{ ...EMPTY }`）はまだたどらない: そこには JSDoc か、キーを書いた種を残す。 |

### 4.10.0

2026-10-30 — [CHANGELOG](../CHANGELOG.md#4100--2026-10-30)

- `@wcstack/state`: `<wcs-view-transition>` があると、`$watch` と `$stream` の再開は遷移が当てる束縛の後に走り（束縛 → `$renderedCallback` → `$watch` → `$stream` の再開。タグがないときと同じ）、それらが書いたものは同じ遷移の中で当たる。4.9 までは、タグの下では `$watch` が先に走った。
- `@wcstack/router`: `to` にクエリのある `<wcs-link>` は、そのクエリでだけ `active` / `aria-current="page"`。クエリのない `to` は変わらない。
- `@wcstack/router`: フラグメントだけのリンク（`href="#main"`、`href="#"`）は今のページに留まり、その対象にフォーカスする。`<base href>` の下ではそのルートへ移っていた。`href="#"` でホームへ行くことに頼っていたページは、ホームへリンクする（`<wcs-link to="/">`）。
- `@wcstack/state`: `/` を含む、または `UTC` の単独の引数は、`date` / `time` / `datetime` のタイムゾーン。この 3 つは 0〜3 個の引数を取り、lint の `wcs/filter-arity` が従う。
- `@wcstack/lint`: `wcs/live-region-inserted` が新しい警告で、`--strict` を落とす: テキストと一緒に挿入されるステータスの領域で、スクリーンリーダーは読み上げない。

| 症状（4.9.0 まで） | 回避策 | いま |
|---|---|---|
| `<wcs-view-transition>` があると、`$watch` から移るログインがログインのフォームへ戻り、`$watch` は欄が invalid になる前にフォーカスを動かした | 移動とフォーカスを `$renderedCallback` へ移す（city-library） | `$watch` に戻す。 |
| `<base href>` の下で、スキップリンク `<a href="#main">` が読み手をホームのルートへ連れて行った | `#main` にフォーカスする `onclick#prevent:` のハンドラ（homeroom）、またはルーターのパスから組んだ `href`（city-library） | ただの `<a href="#main">`。**`#prevent` のハンドラを残すと害をなす**: ルーターのページ内の移動を打ち消すので、URL に `#main` が付かず、履歴の項目もできない。それでもフォーカスは動き、フォーカスのテストは通る。 |
| `if:` / `for:` のテンプレートの中の `<wcs-link match="…">` が、state がテンプレートの中身を組むときに、捕捉されない `wcs-link is not connected to a router.` を報告した | ヘッダをテンプレートの外に置き、`hidden:` で見せる（homeroom） | `if:` のテンプレートに戻す。 |
| クエリのある `<wcs-link>`（ページ送り、タブ）がどこでも現在のページだった | `attr.aria-current:` と `class.…:` を束ねたただの `<a>`（homeroom、city-library） | クエリのあるリンクは `<wcs-link>`。4.10.1 からは等しいクエリでだけ現在のページで、`match="prefix"` はパラメータの多いものを `"true"` にする。クエリのない `to` は今もパスだけを比べるので、ほかのクエリで現在のページになってはいけない「すべて」のタブやパラメータのない 1 ページ目のリンクは、ただの `<a>` のまま。 |
| `date` / `time` / `datetime` は読み手のタイムゾーンで書いた | getter の中の `Intl.DateTimeFormat(…, { timeZone })`（city-library） | 3 番目のゾーン: `time(ja-JP,short,Asia/Tokyo)`。4.9 の lint と state では使えない: lint は `wcs/filter-arity` と言い、state は止まる。 |
| diagnostics 追加機能が、ルーターの `searchParams` の下のキー（`if: query.next`）と、後から埋める空の `{}` の種の下のキーに `[wcs/binding-path-missing]` を警告した | `this["query.next"]` を読む getter（city-library）、すべてのキーを書いた種（family-ledger） | `if: query.next` と、`{}` の種。 |
| ルートでない `<base>` の下で、lint がルートからの `<wcs-state src>` を読めなかった | 相対の `src` が state に届くようにページを置く（`src="../app.js"` の `public/site/index.html`、city-library） | `src="/app.js"` と `wcs-validate --root=public`。 |

### 4.10.1

2026-10-31 — [CHANGELOG](../CHANGELOG.md#4101--2026-10-31)

- `@wcstack/router`: `to` にクエリのある `<wcs-link>` は、URL のクエリが `to` のものと等しいときだけ `aria-current="page"`。URL のパラメータが多いところでも印を残すには `match="prefix"` を加える（`aria-current="true"` になる）。
- `@wcstack/view-transition`: ページが最初のフレームを描く前には遷移を始めない。読み込みの直後に `document.startViewTransition` の呼び出しを数えるテストは、先にフレームを 1 つ待つ。
- `@wcstack/router`（文書化）: `<wcs-view-transition>` があると、`path` は `data`・`params`・`routeName`・`searchParams` の 1 フレーム後に来る。そのフレームに別の理由（応答、タイマー）で走るコードは、`path` ではなく `routeName` / `params` / `searchParams` か `location` を読む。

要らなくなった回避策はありません。

### 4.11.0

2026-11-01 — [CHANGELOG](../CHANGELOG.md#4110--2026-11-01)

- `@wcstack/state`: diagnostics 追加機能は、ページの準備ができて 5 秒たってもまだ定義されていない束縛付きのカスタム要素を、タグごとに 1 回 `[wcs/element-undefined]` と警告し、配列でも null でもない値の `for:` を `[wcs/binding-type-expectation]` と警告する。
- すべてのパッケージ: 別の版のパッケージの 2 つ目の写しは、1 回 `[wcs/package-twice]` と警告する。先に評価された写しが今までどおり動く。パッケージはそれぞれ 1 回だけ、wcstack の行はすべて同じ版で読み込む。
- `@wcstack/lint`: `wcs/tag-package-missing`（ページが読み込まないパッケージの `wcs-*` タグ）と `wcs/lint-version-behind`（ページが lint より新しい minor を固定している）が新しい警告で、`--strict` を落とす。
- `@wcstack/router`: `?` で終わる `to` — `to="/notices?"` と、クエリだけの `to="?"` — は、URL にクエリが無いときだけ現在のページ。4.10 まではパスだけを比べていた。
- `@wcstack/testing`: `mount()`・`fire()`・`installDom()` は、持たない選択肢で throw する。`fire(el, "keydown", { key: "Enter" })` はキーを付けていなかった。`KeyboardEvent` は自分で dispatch する。
- `@wcstack/websocket`: 接続中に外された `<wcs-ws>` は、開いてからソケットを閉じ、ブラウザは何もログに出さない。
- `@wcstack/server`: `happy-dom` ^21.0.4（high の勧告が無い版）。

| 症状（4.10.1 まで） | 回避策 | いま |
|---|---|---|
| lint はオブジェクトリテラルの中のスプレッドをたどらず、その下のすべてのキーに `wcs/binding-path-missing` を出した（`draft: { ...EMPTY_DRAFT }`） | すべてのキーを書いたリテラルの種（homeroom） | `{ ...EMPTY_DRAFT }`。 |
| 接続中に外された `<wcs-ws>` で、Chromium が「WebSocket is closed before the connection is established.」をログに出した | `<wcs-ws>` をページの階層に置き、開いてから state で閉じる（homeroom） | ルートの中に戻す。 |
| 「すべて」のタブやパラメータの無い 1 ページ目のリンク（`to="/notices"`）が、どのクエリでも現在のページだった | 自分の `aria-current` を持つただの `<a>`（homeroom のページ送り） | `to="/notices?"`。URL にクエリが無いときだけ現在のページ。ページ送りのある一覧の「すべて」のタブには、4.12 の `query-keys` が要る。 |

### 4.11.2

2026-11-01 — [CHANGELOG](../CHANGELOG.md#4112--2026-11-01)。4.11.1 は 2 つのパッケージしか npm に届かず、欠番にした。

- `@wcstack/router`: ルートの差し替えは、当てる時点で画面に出ているルートと比べる。`<wcs-view-transition>` の下で戻るの 1 フレーム以内に進むと、進んだ先の URL の下に戻った先のページが残っていた。
- `@wcstack/router`: ガードを待つ間に追い越されたナビゲーション — データを読み込む間に押した別のリンク — は、何も置かず、どこへもリダイレクトしない。4.11.0 までは、後のナビゲーションの URL の下に 2 つのルートが両方出て、拒否するガードは利用者が別の場所へ向かった後でリダイレクトしていた。

| 症状（4.11.0 まで） | 回避策 | いま |
|---|---|---|
| `<wcs-view-transition>` の下で、戻ってすぐ進むと、戻った先のページが画面に残った | 戻った先のページを待ってから進むテスト（homeroom の spec） | すぐ進む。 |

### 4.12.0

2026-11-01 — [CHANGELOG](../CHANGELOG.md#4120--2026-11-01)

- `@wcstack/router`: `<wcs-link query-keys>` は、リンクが比べるクエリのキーを名指す。これがあると、URL のクエリがそれらのキーに同じ値を持つところでも、リンクは現在（`aria-current="true"`）になる。これの無いリンクは変わらない。

| 症状（4.11.2 まで） | 回避策 | いま |
|---|---|---|
| ページ送りのある一覧で、「すべて」のタブ `to="/notices?"` は 1 ページ目でしか現在にならず、`match="prefix"` ではどの区分でも現在になった | state から `attr.aria-current:` を束ねたただの `<a>` のタブ（homeroom） | `<wcs-link to="/notices?" query-keys="cat">` と `<wcs-link to="/notices?cat=event" query-keys="cat">`。それぞれ自分の区分のどのページでも現在で、現在のタブは 1 つ。 |

### 4.13.0

2026-11-02 — [CHANGELOG](../CHANGELOG.md#4130--2026-11-02)

- `@wcstack/state`: 2 行の入れ替えの描画が速くなった。DOM と、入れ替えで動かす行は 4.12.0 と同じ。

要らなくなった回避策はありません。

### 4.14.0

2026-11-02 — [CHANGELOG](../CHANGELOG.md#4140--2026-11-02)

- `@wcstack/state`: ブラウザに `moveBefore()` があるとき（Chromium 133 以降、Firefox 144 以降）、並べ替えで動かした行はフォーカス、iframe の中のページ、実行中の CSS アニメーションを保つ（3.x と同じ）。フォーカスのある input は、行が動いてもフォーカスを保つ（Chromium は `blur` と `focusout` を出し、Firefox はイベント無しにフォーカスを外していた）。クラスが `connectedMoveCallback` を定義しているカスタム要素は、`disconnectedCallback` と `connectedCallback` の代わりにそれを受ける。

要らなくなった回避策はありません。

### 4.15.0

2026-11-03 — [CHANGELOG](../CHANGELOG.md#4150--2026-11-03)

- `@wcstack/fetch`・`upload`・`credential`・`eyedropper`・`contacts`・`share`: 開いたままのページが、終わった要求をすべて覚えておくことはなくなった（10 万回の fetch で 10 万件だった）。
- `@wcstack/router`: `@wcstack/state` を読まないページが、来ない binder のために、表示したルートをすべて（`<wcs-head>` は複製をすべて）持ち続けることはなくなった。
- `@wcstack/lint`: `wcs/link-query-key-ignored`（`query-keys` が `to` の付けるキーをどれも名指さない `<wcs-link>`）が新しい warning で、`--strict` では落ちる。

要らなくなった回避策はありません。

### 4.16.0

2026-11-04 — [CHANGELOG](../CHANGELOG.md#4160--2026-11-04)

- `@wcstack/state`: `$update(path, indexes, fn)` は 1 つのアドレスを今の値から書き換える。添字は `*` 1 本につき 1 つ、`fn(current, ...indexes)` はその行の文脈で走り、末尾より先の添字は `fn` を呼ぶ前に throw する（state の README、「`$update`」）。
- `@wcstack/state`: `$setAll` の mapper は書き込む行の文脈で走る。行のイベントハンドラから呼ぶと、その中の `this.$1` と相対のパスはクリックされた行ではなく書き込む行を読む。クリックされた行を読むつもりだった mapper は、呼ぶ前にその値を変数に読んでおく。
- `@wcstack/lint`: `wcs/write-path-missing` がスクリプトの書く入れ子のパス（`this["items.*.nmae"] = …`・`$setAll` / `$update`）を、`wcs/read-path-missing` が `` this[`items.${i}.nmae`] `` を確かめる。どちらも warning で、`--strict` では落ちる。

要らなくなった回避策: `$setAll` の mapper が自分の行のほかのフィールドを `$resolve(path, [i])` で読んでいた。今はその中の `this["items.*.price"]` がその行のものになる。

### 4.17.0

2026-11-07 — [CHANGELOG](../CHANGELOG.md#4170--2026-11-07)

- `@wcstack/lint`: `wcs/getter-write`、setter の無い getter へのスクリプトの書き込みへの `wcs/path-readonly`、自分のパスに書く setter への `wcs/setter-cycle` は error — どれもランタイムがその場所で投げるので、報告されるページはそこですでに壊れていた。互いに書く setter への `wcs/setter-cycle` と `wcs/setter-unobserved` は warning で、`--strict` では落ちる。
- `@wcstack/state` のコンソール: `[wcs/getter-write]` が `This state is readonly.` の代わりにパスと getter を名指す。`[wcs/setter-cycle]` はスタックが溢れていたところで投げる。`[wcs/setter-unobserved]` と `[wcs/input-undefined]` は 1 回警告する。`#2` と `#38` は lint の code を持つ（`#38` はタグも名指す）。前の文面に合わせていたテストは新しい文面に合わせる。
- `@wcstack/audio`: リミッターは -6 dBFS の天井になり、`volume` は 0〜1 に丸めるので、大きな音のパッチは静かになる（README の 8 声のパッチは単音で約 10 dB、-18 dBFS より小さいパッチは約 1.75 dB）— パッチの中のゲインを上げる。`AudioContext` は最初の操作で作る: 操作の前に context を当てにしていたテストは、先にクリックするか `resume()` を呼ぶ。鳴っている音を切る作り直しは `[wcs/audio-voices-cut]` と警告する。
- `@wcstack/midi`: 切断（ルートを出る）と `close()` は `devices: []` を知らせる。戻された要素は許可がまだ granted なら要求し直す。Web MIDI の無いところでは接続の時点で `permission` が `unsupported`。

要らなくなった回避策: getter の行の型を `@type` でなく `@returns` で書く、`Array.from(…)` / `[...Array(n).keys()].map(…)` の行を定数への `.map` に書き換える、名前空間の import の定数を名前でもう一度 import する — どれも `wcs/binding-path-missing` や `wcs/path-dynamic-unknown` の誤報を黙らせるためだけのもの。ルートに入るたびに MIDI を要求し直すページの処理。

### 4.18.0

2026-11-08 — [CHANGELOG](../CHANGELOG.md#4180--2026-11-08)

- `@wcstack/signals`: 所有者を片付けるとき、`h()` は文書にある要素からだけリスナーを外す。文書から外れた要素（消えた `For` の行、作り直したサブツリー、切り離された `SignalsElement` の中身）はリスナーごと回収される。行を消した後に `removeEventListener` を数えていたテストは 0 を見る。そういう要素を持ち続けてスクリプトからイベントを送れば、ハンドラは呼ばれる。値が文字のリアクティブな子の隣には目印のコメントが無いので、`childNodes` を数えていたテストは 1 つ少なく見る。
- `@wcstack/audio`: 最初の操作を待っていたグラフは、その操作の `pointerdown` の中でなく、操作が終わってから（クリックの後に）組む。`noteOn()` と `resume()` はこれまでどおりその場で組む。何も鳴らさないクリックの直後にルートの context を読んでいたテストは、組まれるのを待つ。

要らなくなった回避策: 4.17.0 で、ページで最初のクリックが押した要素に届くように、`running` に結んだ「音を出すには押してください」のヒントをレイアウトから外す、またはクリックの後で消すこと。

### 4.19.0

2026-11-08 — [CHANGELOG](../CHANGELOG.md#4190--2026-11-08)

- `@wcstack/signals`: 新しい `delegateEvents()`（opt-in のイベントの委譲）を呼ばないページには何も変わらない。呼ぶページは、委譲したハンドラはイベントが文書に届いたとき — 間の要素のリスナーの後 — に呼ばれ、文書の外の要素では呼ばれないことを知っておく。付けていない要素に `el.click()` するテストでは呼ばれない（signals の README の「イベントの委譲」）。

要らなくなった回避策はありません。

### 4.20.0

2026-11-09 — [CHANGELOG](../CHANGELOG.md#4200--2026-11-09)

- `@wcstack/state`: 1 つのモジュールを指す `<wcs-state src="x.js">` は、それぞれがモジュールを評価する — 文書の 1 つ目はこれまでどおりページのほかのスクリプトと同じモジュールを受け取り、2 つ目からは別の断片（`x.js#2`）を付けて import するので、モジュールのトップレベルのコードはその数だけもう一度走る。DCC やコンポーネントのインスタンスは 1 つの状態のオブジェクトを共有しなくなった。状態のモジュールのトップレベルに副作用を置かない。
- `@wcstack/state`: `toFixed`・`round`・`floor`・`ceil`・`percent`・`locale`・`currency` は `undefined` / `null` を素通しする。値が無いときの `requires a number value` を期待していたテストは、その値をそのまま受け取る。
- `@wcstack/state`: binder（`globalThis[Symbol.for("wcstack.binder")]`）は full の入口で版 2 になり、`release(subtree)` を持つ（release add-on）。`/core` のページは `@wcstack/state/features/release` を入れる。`version === 1` と比べていた呼び手は、プロトコルのとおりに読む: 版 1 以降はすべて互換。
- `@wcstack/state` のコンソール: `[wcs/inserted-unbound]` と `[wcs/rendered-copy]` が新しい警告。`#43` は inline の状態の import が解決できないとき `blob:` の基底を言う。
- `@wcstack/lint`: `wcs/link-router-missing` と、文書の `<head>` の `{{ }}` やコメントの束縛（`wcs/template-syntax`）は warning で、`--strict` では落ちる。`wcs/state-absent` は info。`enableMustache: false` のもとでは `{{ }}` について何も言わず、コメントの束縛ごとの info は無くなった。getter やキーの JSDoc の `Record<string, T>` は下のパスを検査しない — そして `wcs/type-annotation` ではオブジェクトとして数えるので、`null` の初期値への `@type {Record<string, number>}` は `{a: number}` と同じく警告する。

要らなくなった回避策: ページやインスタンスごとに新しい状態にするため、状態のモジュールを factory として export し、inline のモジュールで作る（factory のモジュールを import map に載せる）。htmx が入れ替えるページで volume を使わない。値が無いことのある `locale` の前の `|coalesce(0)`。getter の `Record<string, T>` のパスを黙らせるためだけに生成した `stateSchema`。Windows の npm の scripts がパターンをそのまま渡すので、`wcs-validate` に渡すファイルを並べるスクリプト。

### 4.21.0

2026-11-10 — [CHANGELOG](../CHANGELOG.md#4210--2026-11-10)

- `@wcstack/lint`: `wcs/submit-without-prevent` と `wcs/tag-package-missing` は error になった。どちらかがあっても `wcs-validate --errors-only` を通っていたページは、今は落ちる。
- `@wcstack/lint`: `wcs/session-read-at-module-top` が新しい規則。`<wcs-guard-handler>` のモジュールの最上位で `localStorage` / `sessionStorage` / `document.cookie` を読むと error になる。state のモジュールの最上位なら warning で、わざと保存値から初期値を読む形にも出る: そのキーは `<wcs-storage>` で結ぶか、値を使うメソッドの中で読む。
- `@wcstack/lint`: `wcs/event-token-unbound`（warning）が新しい規則。`$eventTokens` の名前のうち、どの `eventToken.` 束縛も出さないものを報告する。
- `@wcstack/lint`: その場で変えたリストの行は、フィールドごとに「無い」と報告しなくなった。
- `@wcstack/state` のコンソール: `[wcs/binding-path-missing]` は、getter が返すリストの行のフィールドを言うことがある（近い名前があるとき）。空で始まったリストの下のパスも、行が届いた後なら言うことがある。
- `@wcstack/devtools`: ランタイムが失敗を記録すると、閉じたバッジに赤い数が出る。ヘッダーには失敗だけを出すボタンがあり、Wiring のペインは、ランタイムが解決しないと報告したパスに印を付ける。

要らなくなった回避策: 送信するフォームや、パッケージを読み込んでいないタグを見るためだけに、`--errors-only` を付けずに `wcs-validate` をもう 1 回走らせること（どちらも今は error）。

### 4.22.0

2026-11-12 — [CHANGELOG](../CHANGELOG.md#4220--2026-11-12)

- `@wcstack/state`: 行について評価されるスクリプトでは、`.` で始まるパスがその行からの相対パスになった: `get "users.*.fullName"()` の中の `this[".firstName"]` は `this["users.*.firstName"]`。このキーは今まで黙って `undefined` を返していたので、動いているページは変わらない。行の無いところ（トップレベルのアクセサ、行の外から呼んだメソッド）では `#1402` を throw する。
- `@wcstack/state`: パスをカンマで並べたアクセサのキーは、そのそれぞれにアクセサを宣言する（`get "users.*.fullName,employees.*.fullName"()`）。区切りはカンマだけ: 空白があると、`diagnostics` アドオンが `[wcs/accessor-list-syntax]` で初期化を失敗させる。
- `@wcstack/state` のコンソール: `[wcs/accessor-list-path]` が新しい警告。複数のリストに宣言したアクセサの本体が、そのうち 1 つのリストの行をフルパスで書いているときに、書くべき相対パスと一緒に言う。
- `@wcstack/lint`: `wcs/accessor-list-syntax` と `wcs/accessor-list-path` が新しい規則で、どちらも error。`wcs/wildcard-rank` は、キーに `*` の無いアクセサの中の相対パスと、`$resolve`・`$setAll`・`$update` に渡した相対パスでは error。
- `@wcstack/lint`: 行のアクセサの中の相対パスは、行の下のパスとして検査する。メソッドの中の相対パスは検査しない。

要らなくなった回避策: 同じアクセサの本体をリストごとに書くこと、絞り込んだ写しの行のために行のアクセサをもう一度書くこと（`get "users.*.fullName"()` の横の `get "shown.*.fullName"()`）。

### 4.23.0

2026-11-15 — [CHANGELOG](../CHANGELOG.md#4230--2026-11-15)

- `@wcstack/state`（`.`・`/auto`・`wcstack/auto` のバンドル）: 新しい `forms` アドオン。IME で変換中の欄には state が書かず、変換が終わってから当てる。分割のページは `@wcstack/state/features/forms` を入れる。
- `@wcstack/state`: state が最後に見た値と違う値を持つ欄を、`change` のときと、フォームの `submit` のハンドラが走る前に state に知らせる — 欄の上で出す、バブルしない `input`（と `change`）。欄そのものに付けたリスナーは、イベントを 1 回多く聞く。
- `@wcstack/state`: reset（`<button type="reset">`・`form.reset()`）の後、state はフォームの束ねたコントロールの reset 後の値になる。reset で欄だけを空にし、state には値を残すつもりだったページは、別の方法で欄を空にする。
- I/O ノード: 置かれた場所に仕事がよらない 34 個のノード（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §25）では、`moveBefore()` での移動が切断でなくなった: 並べ替えで動く行の中（Chromium 133 以降、Firefox 144 以降）で、要求・接続・タイマーは続く。並べ替えで `<wcs-fetch>` が送り直すこと、`<wcs-timer>` が始め直すことに頼っていたページは、自分でそうする。
- `@wcstack/router`: 遅いガードがページの読み込みをリダイレクトした先のルートを束縛する。import を解決できないガードには、ガードが `blob:` のモジュールであることを言う。
- コンソール: `[wcs/form-control-one-way]`（`@wcstack/state` の diagnostics）と `[wcs/fetch-body-gone]`（`@wcstack/fetch`）が新しい警告。
- `@wcstack/lint`: `wcs/radio-name-shared`・`wcs/number-written-as-string`・`wcs/two-way-output-filter` が新しい warning: その形のあるページは `--strict` で落ちる。lint が値を読めないキーは、パスごとの `wcs/binding-path-missing` の代わりに、`wcs/path-dynamic-unknown`（info）を 1 回出す。`attr.aria-invalid: flag` などの ARIA の状態には、もう警告しない。

要らなくなった回避策: 変換を守るために、打った文字を正規化する欄を片方向に束ねてハンドラから書くこと（setter で足りる。整形しながらキャレットを保つなら、今もハンドラ）。別のタブの下書きを当てるときに、変換中の欄を飛ばすコード。パスワード管理のために、欄を state に写す `change` のリスナー。`type="reset"` が state を残すためだけに書いた、空にするメソッド。`team: init.team` で lint が全部のパスを報告するために、リテラルで書き出した state の種。ガードがリダイレクトした先が束縛されないために、ページの中で確かめていた最初のルート。動く行の外に置いたアップロードと fetch は、Chromium と Firefox では要らなくなり、Safari では今も要る。

### 4.24.0

2026-11-15 — [CHANGELOG](../CHANGELOG.md#4240--2026-11-15)

- `@wcstack/fetch`: `<wcs-infinite-scroll>` が target を実行する時機が増えた（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §26）。番兵が画面にあるとき: 何も飛んでいない間に target の `url` が書かれた・変わったとき、要求が終わってその間に `url` が変わっていたとき（または要求が中断されたとき）、要求が行を足して終わり `url` が進んだとき。背の高いウィンドウの一覧は自分で埋まり、番兵が画面にあるまま変わった `url` はスクロールなしで取りに行く。そこから同じ `url` を 2 度は実行せず、行を足さなかった応答で終わる。
- `@wcstack/fetch`: `<wcs-fetch>` の `fetch(url, init)` は、最初の引数の文字列をその要求の url として使う（`init`: `method`・`headers`・`body`）。それまでの `fetch()` は引数を無視した: 自分の `url` を持つ要素に url を渡していたコマンドトークンは、渡したものを取りに行くようになる。
- `@wcstack/fetch`・`@wcstack/intersection`: `root` は、`<wcs-infinite-scroll>` でも `<wcs-intersect>` でも id とセレクタの両方を受ける。何も指していなかった値は今も viewport。もう一方の書き方で見つかる値は、その要素を指すようになる。
- `@wcstack/state`: `for:` の行や `if:` のブロックで、同じ親の下でカスタム要素の後ろにある要素は、委譲ハンドラを要素自身に持つ。`<wcs-link>` の後ろのボタンは自分のハンドラが動く。それまでは動かないか、次のボタンのものが動いた。
- `@wcstack/state`: setter が書くパスの `$watch` は、要素がその setter 越しに渡した値で、起動時に 1 回発火する。
- `@wcstack/router`: `to` は `<wcs-link>` のプロパティになった: `data-wcs="to: .href"` は `attr.to:` と同じに動く。
- コンソール: `[wcs/body-binding]`（`@wcstack/state` の diagnostics）、`[wcs/infinite-scroll-root]` と `[wcs/root-margin-unit]`（`@wcstack/fetch`）、`[wcs/intersect-root]` と `[wcs/root-margin-unit]`（`@wcstack/intersection`）が新しい警告。単位の無い `root-margin` は、`<wcs-infinite-scroll>` から例外として出なくなった。
- `@wcstack/lint`: `wcs/body-binding` と `wcs/link-handler` が新しい **error** — `<body>` / `<html>` の `data-wcs`、`<wcs-link>` の `on*:`: どちらの束縛も、もともと何もしていなかった。それを持つページは `--errors-only` で落ちるようになる。`wcs/root-margin-unit` が新しい warning。`wcs/delegated-current-target` は入れ子の関数の中の読みも、`wcs/getter-untracked-read` はウィンドウや文書を読む getter も報告する。1 つの JSDoc コメントの `@typedef` をすべて読む。

要らなくなった回避策: `<wcs-infinite-scroll>` が実行する `<wcs-fetch>` の、1 ページ目の静的な `url` と、`$connectedCallback` から頼む最初のページ。番兵をウィンドウの外へ押し出すために大きくした行やページ。`<wcs-infinite-scroll>` が短いページで止まるためだけに使った `<wcs-intersect>` と `reobserve()`。url を先に書き、その `$watch` から `fetch` コマンドを emit すること。隣のボタンが応えないために、行の中で `<wcs-link>` の代わりに使った素の `<a>`。要素が起動時に渡す値を `$connectedCallback` でもう一度当てること。

### 4.24.1

2026-11-15 — [CHANGELOG](../CHANGELOG.md#4241--2026-11-15)

- `@wcstack/fetch`: `<wcs-infinite-scroll>` は、ページが届く瞬間に利用者がスクロールしていても、ウィンドウに要らないページを取りに行かなくなった（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §26.1）。4.24.0 では、そのとき 1 ページ先を読んでいた — Chromium で、たいていの場合。ページの側で変えることは無い。スクロールの間の要求を数えるテストは、1 回少なく数えることがある。

### 4.24.2

2026-11-16 — [CHANGELOG](../CHANGELOG.md#4242--2026-11-16)

- `@wcstack/router`: `params` と `typedParams` は、パーセントデコードされた値になった: `/users/%E2%82%AC` で `params.id` は `"€"`（以前は `"%E2%82%AC"`）。パラメータを自分で `decodeURIComponent()` しているなら外す — 二重にデコードすると、`%` を含む値で例外になる。エンコードされたスラッシュは値の中の `/` になり、`params['*']` は残りのセグメントをそれぞれデコードして `/` でつないだもの。`path` と、ガードの `toPath` / `fromPath` は URL の形のまま（router の README §3.6）。
- `@wcstack/router`: ルートの `path` の静的セグメントは、書かれた文字そのもの。`path="/v1.0"` は `/v1x0` に一致しなくなった。正規表現として効くことに頼っていた `path`（`path="/(en|ja)"`、`path="/v\d+"`）は、その文字列にだけ一致する: パラメータか catch-all にして、値を見る。
- `@wcstack/router`: `path` に ASCII でない文字や空白のあるルートは、その URL に一致する。そのパスへの `<wcs-link>` は、そこで現在のページになる。そういう URL で fallback のルートが出ていた所は、そのルートが出る。
- `@wcstack/router`: Navigation API の無い環境で、`navigate("/users/€")` の後の `path` は URL の形（`/users/%E2%82%AC`）になった。その URL を読み込んだときと同じ。

要らなくなった回避策: 読める文字で書くとどこにも一致しないために、パーセントエンコードして書いた、または ASCII に限ったルートのパス。手でデコードしていたパラメータ。`.`・`+`・括弧を避けたルートのパス。

### 4.25.0

2026-11-17 — [CHANGELOG](../CHANGELOG.md#4250--2026-11-17)

- `@wcstack/tilt`: 断られた `requestPermission()` —— iPhone で、タップからでない呼び出しは、問いを出さずに断られる —— は、`permissionState` を元のままにし、`error` を立て、`errorInfo.recoverable` を `true` にする。`"denied"` は利用者の答えだけ。読み込み時の呼び出しの後の `"denied"` を「ボタンを出す」と読んでいたページは、`permissionState !== "granted"` を読む。`DeviceOrientationEvent` がそもそも無い所では、`requestPermission()` と `start()` が `error`（`capability-missing`）を立てる。`requestPermission()` はそれまで `"granted"` と答えていた。
- `@wcstack/contacts`: 選ばずに閉じたピッカーは `cancelled` を立て、`value` は元のまま（それまでは `value: []` を書いた）。`select()` は `null` で解決する。
- `@wcstack/credential`: `PasswordCredential` の無いブラウザ（Firefox、Safari）では、`password` か `federated` を求める `get()` と、すべての `store()` が、ブラウザを呼ばずに `capability-missing` で終わる（それまでは `credential-failed`）。`store({ id, password })` は `PasswordCredential` を作る。`preventSilentAccess` がコマンドになった。
- `@wcstack/accelerometer`・`@wcstack/gyroscope`: センサーのクラスは無いが `devicemotion` はあるブラウザ —— iPhone や iPad の Safari、Firefox —— では、`start()` が `devicemotion` を読む（それまでは `unsupported`）。iPhone の動きの問いのために `requestPermission` / `permissionState` を持つ。デスクトップの Firefox はイベントがあってセンサーが無い: エラーも値も無く、`supported` は `true`。
- `<wcs-fullscreen>`・`<wcs-pointer-lock>`・`<wcs-pip>`: 切断は `active: false` を出す（state は `true` のままだった）。移動した要素は `false`、次に `true` を報告する。Firefox が断ったポインターの捕捉は `error` を立てる。
- `@wcstack/websocket`: `close()` は、数でない最初の引数を（`reason` と一緒に）無視する。`@wcstack/idle`: `start()` は数でないものを無視する。どちらも、`on…: $command.x` の束縛が最初に渡すイベントを、その値として受け取っていた。
- 画面とセンサーの 13 要素の `wcBindable.properties` に `supported`、`<wcs-tilt>` に `heading`、`<wcs-accelerometer>` / `<wcs-gyroscope>` に `permissionState`、`<wcs-permission>` に `unsupportedReason` が加わった: スプレッド（`...: path`）はそれらを受け取る。
- コンソール: `[wcs/io-error-unobserved]`（`@wcstack/state` の diagnostics: 状態が束ねる要素が失敗を報告し、それを誰も読まない）と `[wcs/frequency-invalid]`（センサー 4 つ）が新しい警告。`<wcs-permission name="ambient-light-sensor">` で、Chromium が `Unrecognized feature: 'ambient-light-sensor'` を出さなくなった。
- `@wcstack/lint`: `wcs/command-event-argument`・`wcs/frequency-invalid`・`wcs/output-path-written`・`wcs/target-selector` が新しい警告。`wcs/path-readonly`（**error**）は、setter の無い getter に束ねた要素の出力 —— 実行時はそのページを拒んでいた —— と、そう束ねた、`#ro` の無いカスタム要素の双方向のメンバーを報告する（`get total()` に対する `<wcs-storage data-wcs="value: total">`: `value#ro:` か、`#init=element` のアクセサの組を書く）。`wcs/token-undeclared`（**error**）は、`$commandTokens` / `$eventTokens` がそもそも無い state で使ったトークンと、`$eventTokens` に無い `$on` の項目を報告する。これらを持ち、`--errors-only` を通っていたページは、今は通らない。

要らなくなった回避策: ページ自身の `devicemotion` のリスナーと、`DeviceMotionEvent.requestPermission()` の呼び出し。北を出すための `deviceorientationabsolute` / `webkitCompassHeading` のリスナー。`error` が `null` でない `"denied"` を「まだ問うていない」と読むこと。ボタンを出すかを決める手書きの機能検出（`supported`）。ページ自身による `document.permissionsPolicy` の読み取り（`unsupportedReason`）。手で呼ぶ `navigator.credentials.preventSilentAccess()` と、ページが作る `new PasswordCredential(…)`。`<wcs-contacts>` の空の配列を「閉じた」と扱うこと。`<wcs-permission name="ambient-light-sensor">` を囲む `if:`。失敗したセンサーを始め直すために `start` の前に出す `stop`。storage の README の「任意のタイミングで保存する」の例は書き直した: 4.24 まで載せていた形（getter に束ねた `trigger:` と `manual`）は、変更のたびに `[wcs/path-readonly]` を記録し、保存したものを戻さなかった。

### 4.26.0

2026-11-19 — [CHANGELOG](../CHANGELOG.md#4260--2026-11-19)

- `@wcstack/debounce`: `<wcs-debounce>` / `<wcs-throttle>` の `value` は `null` で始まる（`undefined` だった。読み込みの直後に、束ねたスロットへ `undefined` を書いていた）。
- `@wcstack/sse`・`@wcstack/websocket`: `url` を消す（`null`・`""`・属性を外す）と接続を閉じる。`manual` の要素も。それまでは開いたままだった。`url` を消すのと並べて呼んでいた `close()` は要らない。
- `@wcstack/sse`: `<wcs-sse>` は `beforeunload` でストリームを閉じ、文書が残れば開き直す。`pagehide` / `pageshow` は `<wcs-ws>` と同じ。ページ自身の、ストリームを閉じる `beforeunload` のリスナーは外す: WebKit のルーターの下では、最初の遷移でストリームを閉じたままにした。WebKit では、ルーターの遷移ごとに `connected` が `false` → `true` と動く。
- `@wcstack/fetch`: `fetch(url, init)` は `URL` を受け取る。文字列・イベント・`null`・`undefined` のどれでもない値は警告する（`[wcs/fetch-url-argument]`）。成功した `204` / `205` は `HEAD` と同じに読む: 本文なし、`value` は `null`、エラーなし —— JSON と名乗る `204` はネットワークの失敗になっていた。
- `@wcstack/state`（diagnostics）: `this.$command.<宣言に無い名前>` は、束縛と同じエラーを近い名前つきで投げる（それまでは `undefined` で、`.emit()` が名指さない `TypeError` を投げた。`?.emit()` は何もしなかったが、今は投げる）。読めないページ内の state は、Content-Security-Policy の問題でなく TypeScript の構文として説明する。
- `wcs-tsc` と VS Code の拡張は、ページ内の `<wcs-state>` のスクリプトを JavaScript として検査する: JSDoc の型が効き、TypeScript の構文はその場所でエラーになる。`allowJs`・`checkJs`・`noImplicitThis` は要らない。
- `@wcstack/state/define`: `$on` のハンドラの引数に型が付く（ハンドラの中の `this` はエラー）。`this.$command` は `$commandTokens` の名前を持つ。
- `@wcstack/lint`: 戻り値の型を書いた `.ts` の state の getter とメソッドを読み、スクリプトの規則がそれを検査する —— そこに新しいエラーが出うる。誤報は消える。`.ts` のモジュールの要素を検査する（`wcs/tag-member-unknown`、error）。新しい警告 `wcs/filter-arg-enum` と `wcs/drift-state-key`。`wcs/filter-input-type` は行とスキーマの型も見る。`wcs-schema emit` が書いた（`stateSource` のある）manifest は、ルートの `<wcs-state src>` がそのファイルであるページにだけ当たる。4.25 の manifest は作り直すと絞られる。
- `@wcstack/server`: 表の中の `<template>` を描ける（`[wcs/wildcard-rank]` を投げていた）。新しい `setInnerHTML`。`@wcstack/testing`: 同じ表を mount できる。`app.state<S>()` に型が付く。`@wcstack/typescript/vite`: `wcstack()` が `<wcs-state src="./state.ts">` を Vite でビルドする。

要らなくなった回避策: ページ自身の Vite のプラグインと、ページ内の state とガードのスクリプトの `vite-ignore`。lint のために `: void` を書かないメソッド。JSDoc を書かず、形をリテラルで写したページ内の state。manifest の発見の外に置いて手で渡すスキーマ。手書きのインターフェースを通して転送する `$on` のハンドラと、`this.$command.x!`。`<wcs-sse>` を囲むページ自身の unload のリスナーと、サインアウトでの `close()`。`<wcs-debounce>` のスロットの `$watch` での `undefined` への `typeof` の防御。ページに表があるときの、単体テストの `<ul>`。`204` のための `response-type="text"`。

### 4.27.0

2026-11-23 — [CHANGELOG](../CHANGELOG.md#4270--2026-11-23)

- `@wcstack/state`・`@wcstack/signals`: 束縛はその要素自身のイベントだけを聞く。入れ子にした要素から bubble してきた同じ名前のイベントは、外側の要素の `eventToken.*`・出力の束縛・`bindNode` のシグナルに届かない。それまでは、内側の要素の `detail` が届いていた。
- `@wcstack/state`（`forms` 後付け）: state がフォームを束ねる前、送信を止めるフォームをブラウザが送ることはなく、その間の送信は束ねた後にやり直す。束ねる前に打った値は残り、state に伝わる。それまでは state の値で消えていた。

要らなくなった回避策: state が束ねるまでマークアップで `disabled` にしておく送信ボタン。同じ種類の要素を入れ子に持つ要素のハンドラでの `event.target` の確認。

### 4.28.0

2026-11-23 — [CHANGELOG](../CHANGELOG.md#4280--2026-11-23)

- `@wcstack/state`（`scopes` 後付け）: マウントの 1 つのキーの `#ro` は、中にマウントしたコンポーネントにも効く。`state.view#ro: view` で渡され、`view` をさらに渡すと、内側のコンポーネントの `view` の下への書き込みは `[wcs/mount-readonly]` を投げ、その双方向束縛は書き戻さない。それまではページのデータに着いていた。それに頼っていたページは `#ro` を外すか、ホストで書く。
- `@wcstack/state`（`scopes`）: DCC の `$connectedCallback` は、ページが最初に渡した値を見る（それまでは既定値を見ていた。値はコールバックの後・watch の始まる前に着いていた）。
- `@wcstack/state`（`scopes`）: まだ接ぎ木されていないボリュームのマウントパスの下への、要素の書き込みは、接ぎ木まで預かる。それまでは `Path "…" does not exist` を投げ、ページを束ねている間の書き込みはルートごと失敗させた。
- コンソール: `[wcs/binding-path-missing]` / `[wcs/read-path-missing]` は、マウントしたコンポーネントが名指すパスも、先頭のキーがコンポーネントにもホストにも無いときに報告する（`… in <plot-tile> — its host's "…" — …`）。キーごとに 1 度。`[wcs/dcc-attribute]` は、属性で書いた DCC の入力を報告する。出なくなったもの: ボリュームがルートより先に読み込まれたときのマウントパスと、渡された木に書くマウントしたコンポーネントへの `[wcs/write-path-missing]`。コンポーネントのファイルが届く途中の、その公開 getter への `[wcs/binding-path-missing]`。
- `@wcstack/autoloader`: ローダーを名指さない eager のキーは、対応付けたファイルに postfix が合うローダーを得る（それまではキーと比べていたので、いつも既定のローダーだった）。postfix つきのローダーを登録し、その拡張子の eager のファイルが既定のローダーへ行くことに頼っていたページは、キーでローダーを名指す（`|vanilla`）。`.html` のファイルに対応付けた eager のキーは、新しい `dcc` ローダーへ行く。
- `@wcstack/router`: フォールバックの経路（Navigation API なし）で、離れるルートの中身にある `<wcs-link>` のクリックが投げなくなった。
- `@wcstack/testing`: `mount()` は `<template shadowrootmode>` を shadow root にし、ページの DCC を待つ。`installDom()` の restore は先に window を閉じる。`@wcstack/typescript`: `wcs-schema emit --mount` はマウントを記録し（`stateMounts`）、ボリュームのある木でルートの `check` が通る —— 前の版で merge した manifest は、ボリュームをそれぞれもう一度 emit する。

要らなくなった回避策: DCC のファイルを fetch して `setHTMLUnsafe()` で読むページ自身のローダーと、すべての eager のキーの `|loader`。ルートのキーに束ねて `$watch` でボリュームと写し合う I/O の要素。ブラウザのテストで許していたマウントパスの `[wcs/write-path-missing]` と、「ボリュームがそろった」を待つポーリング（ボリュームの `connectedCallbackPromise` は接ぎ木の後に解決する）。`$watch` が最初の値を逃すので、キャッシュつきの getter でリストを導く DCC。ルートの中で `<wcs-link>` の代わりにルーターに頼む素のリンク。単体テストで `mount()` の前に手で入れる DCC の定義。ボリュームだけに走らせる `wcs-schema check`。

### 4.29.0

2026-11-25 — [CHANGELOG](../CHANGELOG.md#4290--2026-11-25)

実行時は何も変わらない: このリリースは lint（`@wcstack/lint` と、VS Code の拡張 2.22.0）。

- **部品を使うページは、部品を通して検査される**。通っていたページが落ちることがある。
  - 宣言的カスタムコンポーネント: 定義のマークアップは定義の state に、ページのマークアップはページの state に対して検査する（これまではキーが 1 つの集合だった）。`wcs/tag-member-unknown`（error）は部品が宣言していないメンバー（`<my-pager data-wcs="totl: n">`）を、`wcs/dcc-declaration`（error）は実行時が拒む定義を、`wcs/dcc-attribute`（warning）は属性で書いた入力を報告する。定義は、ページの中か、import map が autoloader の `dcc` ローダーに名指すファイルから読む。
  - クラスの部品（`bind-component`）: メソッドの `wcs/nested-assign` と `wcs/array-mutation`（error）を、部品のファイルの位置で報告する。テンプレートのパスで、先頭のキーが部品のものでも、渡されたものでも、マウント先のオブジェクトのものでもないときは `wcs/binding-path-missing`（warning）。部品が公開する getter をページが読んでも、報告しなくなった。
- `wcs/radio-before-value`（warning）: `radio:` / `checkbox:` を、その要素に値を与える束縛より前に書いた。最初の描画でどのラジオも選ばれない。値を先に書く（`attr.value: .value; radio: theme`）。

要らなくなった回避策: lint にページを通すために、ページのデータの JSDoc の型に、部品が公開する getter を省略できるキーとして手で宣言すること。

### 4.30.0

2026-11-26 — [CHANGELOG](../CHANGELOG.md#4300--2026-11-26)

- `@wcstack/state`: **`$listKeys` を宣言した一覧への代入が、行の項目だけが変わったときも、その一覧を読む getter に届く。** `this.cards.filter((c) => c.status === "done")` のような getter が取り直しに追従する（状態の変わったカードが元の列から消えてどの列にも入らなかった）。一覧への `$watch` も、そういう代入で鳴る。
- `@wcstack/state`（diagnostics の後付け）: 該当するものがあるページのコンソールに、新しい警告が 3 つ出ることがある —— `[wcs/attribute-mustache]`（属性値の中の `{{ }}`）、`[wcs/structural-element]`（`<template>` でない要素の `if:` / `for:`）、`[wcs/style-object]`（`style:` にオブジェクト）。右辺が式の束縛には、近い名前の代わりに「式はパスではない」と言う。
- `@wcstack/lint`（と VS Code の拡張 2.23.0）: **新しい規則で、通っていたページが落ちることがある。** error: `wcs/binding-expression`・`wcs/structural-element`・`wcs/collection-mutation`・`wcs/inline-import`。warning: `wcs/attribute-mustache`・`wcs/row-id-shared`・`wcs/event-name-case`・`wcs/key-binding`。束縛に書いた式は、これまでパスの warning か、無言だった。
- `@wcstack/lint --strict`: **lint がまるごと読めなかった state があると落ちる** —— 見つけられない `<wcs-state src>`（`/` から始まるパスには `--root` が要る）、先頭に `...spread` のある state（`stateSchema` を渡す）。
- `@wcstack/sse`: WebKit で、router の `<wcs-link>` のたびにストリームを閉じて開き直すのをやめた（ページを読み込んで最初のリンクでは、今までどおり 1 回つなぎ直す）。
- `@wcstack/router`: `<wcs-link current="page">` で、active のリンクの `aria-current` の値を選べる。

要らなくなった回避策: WebKit の router の下で `<wcs-sse>` の代わりに自前の `EventSource` を持つこと。下のパスでも「現在のページ」になるナビのリンクを、素の `<a>` とクリックのハンドラで書くこと。`$listKeys` の一覧の上の getter を取り直しに追従させるためだけに、行を `$getAll` で読むこと。

### 4.31.0

2026-11-27 — [CHANGELOG](../CHANGELOG.md#4310--2026-11-27)

- `@wcstack/lint`（と VS Code の拡張 2.24.0）: **新しい報告で、`--strict` を通っていたページが落ちることがある。** `stateSchema` があるとき、schema が何も言わない所（`items: {}` — 空で始まる一覧に `wcs-schema` が書くもの、`null` の型、`any`）のパスは、schema が無いときと同じに検査する — 無言だった所が warning になる。`wcs/getter-untracked-read` は、一覧の行を読む getter（`this.incomes.reduce((t, row) => t + row.amount, 0)`）を、その項目がパスで書かれるとき報告する: ページの束縛が書けば error、ほかは warning。無いトップレベルの名前にも「もしかして」が付く。
- `@wcstack/typescript`: `wcs-schema emit` は `enum` の値と `anyOf` の要素を決まった順で書く — 次の emit でその配列が 1 回だけ書き換わる。`check` は並びを無視するので、前の emit が書いた manifest もそのまま通る。複数のパスへ宣言したアクセサ（`get "a.*.x,b.*.x"()`）が schema に載り、行に型の無い一覧は警告で名指す。
- `@wcstack/testing`: **`<wcs-state>` のあるページで、`bootstrap` に並べた登録がそのタグを定義しなければ、`mount()` が reject する** —— 並べると既定の `[bootstrapState]` を置き換える。ページは文書の外で組み立ててから入れるので、要素は子のそろった形で接続する。
- `@wcstack/router`: 文書にルーターがまだ無いときに接続した `<wcs-link>` は、1 マイクロタスク待ってから `<a>` を作る。`href` はロケーションの変化のたびに作り直す。

要らなくなった回避策: happy-dom の `mount()` で組み立てられるようにするためだけに `<wcs-link>` を `<wcs-router>` の後ろに置くこと、`<a>` に文字が無いのでリンクを `wcs-link[to="…"] + a` で探すテスト。生成した schema で行の検査を保つためだけに一覧に付けた JSDoc の型（付けたままにする: 付いていれば綴り違いは warning でなく error になる）。

### 4.32.0

2026-11-28 — [CHANGELOG](../CHANGELOG.md#4320--2026-11-28)

- `@wcstack/router`: **ページは、離れる前に自分のダイアログで尋ねられる。** `leaveHold: dirty` が別のルートへのナビゲーション —— リンク、戻る / 進む、`navigateUrl` —— を止め、`leaving` が行き先を言い、router のコマンド `proceed()` / `stay()` が答える（router の README「ページ自身の「離れますか」」）。ページを離れるナビゲーションは `leaveConfirm` のまま。Navigation API の無いブラウザでは、戻る / 進むは止めない。
- `@wcstack/sse`: WebKit で、ページを読み込んで最初の `<wcs-link>` でもストリームをつなぎ直さない —— 同じ文書の遷移で閉じることはもう無い。前に `navigate` の無い `beforeunload` では、ストリームを 1 タスク後に閉じる。
- `@wcstack/lint`（と VS Code の拡張 2.25.0）: 生成した schema を持つアプリ 2 つを 1 回の実行で検査できる —— 違う state のファイルを名指す `stateSchema` 2 つは、それぞれそのファイルを読むページに当たる（これまでは `wcs/manifest-state-collision` の error で、どちらも使われなかった）。両方のページに、無かった報告が出ることがある。

要らなくなった回避策: ページの中の「離れますか」のための、ほかのすべてのルートの同じ guard、手作りのナビのリンク、`history.go(1)` で取り消す戻る。WebKit の最初のリンクのつなぎ直しでイベントを落とさないための、ページ自身の `EventSource`。2 つのアプリを一緒に検査するときの、コミットしない生成 manifest やアプリごとの lint の実行。

## 4.32.0 でもまだ要るもの

- 別のライブラリが入れるマークアップ（htmx の入れ替え、Turbo のフレーム）は入れた側が binder に渡し、捨てるときに手放す。描いたページを戻す履歴のキャッシュは、アイランドのあるページでは切る（[islands.ja.md](./islands.ja.md)）。
- Firefox には scoped custom element registry が無い: 自分の wcstack を動かしているページに置くウィジェットは、そこで何をするかを決める（[islands.ja.md](./islands.ja.md)）。
- lint が部品を読むのは、そのファイルを見つけられるときだけ: 部品を `/` から名指すページ（`"@components/x-card": "/parts/x-card.js"`）は `--root=<サイトのディレクトリ>` を付けて lint する。root を持たないエディタは、そういう部品には何も言わない。state がオブジェクトリテラルでない部品は読まず、部品のメソッドが読むパスも検査しない（lint の README、「部品で組み立てたページに言うこと」）: 残りは単体テストで見る。
- ページの state はルートより長生きする: 選択・検索の文字・最後に表示したレコードは、戻ってきたときにも残っていて、誰もそれを知らせない。ページが忘れるべきものは、router の `routeName` への `$watch` で戻す（router の README「state はルートより長生きします」、[coming-from-react.ja.md](./coming-from-react.ja.md)）。
- 1 つの行の項目への書き込み（`this["todos.0.done"] = v`、行の中の双方向の `checked: .done`）は、その項目を行オブジェクトから読む getter（`this.todos.filter((t) => !t.done)`）を評価し直さない: 一覧を代入するか、項目を `$getAll("todos.*.done", [])` で読む（state の README「`$listKeys`」）。項目がパスで書かれていれば、lint が言う（`wcs/getter-untracked-read`）。
- ボリュームはルートを読まない。ルートの `$connectedCallback` と `$watch` は、後から届くボリュームのキーやメソッドがそろう前に走る: ボリュームに要るものは渡し、その `connectedCallbackPromise` を待つ（state の README、「追加の状態をマウントする」）。
- DCC は、プロパティで値を丸ごと受け取る: ページと共有するオブジェクトや配列の中の項目への書き込みは、相手側の行には届かない。入力の `$watch` は最初の値では走らない —— `$connectedCallback` でも読む（state の README、「DCC に渡すもの」）。
- ページ内の state を import している最中にページを離れるブラウザのテストは、Firefox と WebKit で `<wcs-state> failed to initialize` を見ることがある: import が unload で打ち切られただけで、ページは壊れていない。

- `to` にクエリが無く、`query-keys` も無い `<wcs-link>` は、パスだけを比べる（router の README、「Active state」）。
- 重複するクエリのキー（`?tag=a&tag=b`）は 2 通りに読まれる: `searchParams` は最後の値を持ち、`<wcs-link>` はすべての値を比べる。state がキーを `searchParams` から読むなら、リンクでもそのキーに値を 1 つにする（router の README、「Active state」）。
- まだ定義されていないカスタム要素へのプロパティの束縛 — `textContent:` も — は、その定義を待つ（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §4.1）。コンポーネントが読み込まれる前に見せたいテキストは、子の要素に入れる。4.11 から、定義が来ないときは diagnostics が警告し（`[wcs/element-undefined]`）、lint はページが読み込まないパッケージの `wcs-*` タグを告げる（`wcs/tag-package-missing`）。
- Safari には `moveBefore()` が無い: そこでは並べ替えで動かした行は今もフォーカスを失い（state の README、「ループ (`for`)」）、行の中の I/O ノードは要求や接続を失う（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §25）。リストがその場に残した行は、どのブラウザでも両方を保つ。
- Enter で動く `keydown` のハンドラは、IME の変換を自分で確かめる（`e.isComposing || e.keyCode === 229`）。ページの自作のフォーム部品は、自分で reset し、`value` を両方向に宣言する（[forms.ja.md](./forms.ja.md)）。
- state がフォームを束ねる前の守りは、shadow root の中のフォームには効かない。サーバー描画のページのフォームは、スクリプトが走る前から使える: フォーム自身の `method` と `action` を持たせる（state の README の「フォーム」）。
- 絞り込みを変える一覧は、取りに行っているページを中断する（`command.abort:`）: `manual` の `<wcs-fetch>` は `url` が変わっても中断せず、前の絞り込みの行が新しい一覧に入る（[long-lists.ja.md](./long-lists.ja.md)）。
- ページ自身のスクリプトが `for:` の行に差し込んだノードは、その後ろの要素の委譲ハンドラをずらす: それらは `on*#direct:` で束ねる（state の README、「委譲されるイベント」）。
- 一覧の行へ戻るページ自身のリンクは、行のフラグメントへ行く（`navigateUrl = "/#photo-" + id`）: `$watch` からの `scrollIntoView()` は、push のナビゲーションが終わるときに打ち消される（router の README）。
- ルートのガードはページの中の JavaScript: `src=` の形が無いので TypeScript で書けず、型の検査も通らない。小さく保つ（セッションを読み、パスか `true` を返す）。
- ページの可視性を報告する要素は無い: 隠れたタブでセンサーを止めるページは、自分で `visibilitychange` を聞く（[long-lived-pages.ja.md](./long-lived-pages.ja.md)）。センサーの要素は、端末にそのセンサーがあるかを言わない: `start` の少し後に値が来なければ、無いと扱う。
- iPhone の Safari は、動きと向きの答えを、問われたときだけページに教え、タップからしか問わない: 再読み込みの後 `permissionState` はまた `"unknown"` になり、覚えておきたいページは自分でメモを持つ。向きの固定が効くかは、全画面で試すまで分からない。Safari には `lock()` が無い（[device-apis.ja.md](./device-apis.ja.md)）。
