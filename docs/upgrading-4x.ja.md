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

## 4.13.0 でもまだ要るもの

- `to` にクエリが無く、`query-keys` も無い `<wcs-link>` は、パスだけを比べる（router の README、「Active state」）。
- まだ定義されていないカスタム要素へのプロパティの束縛 — `textContent:` も — は、その定義を待つ（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §4.1）。コンポーネントが読み込まれる前に見せたいテキストは、子の要素に入れる。4.11 から、定義が来ないときは diagnostics が警告し（`[wcs/element-undefined]`）、lint はページが読み込まないパッケージの `wcs-*` タグを告げる（`wcs/tag-package-missing`）。
