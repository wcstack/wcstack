# 継ぎ目アプリ: テストが見逃すものを見つけるアプリの作り方

**English**: [seam-apps.md](./seam-apps.md)

*継ぎ目アプリ*は、機能を見せるためではなく、欠陥を見つけるために書くアプリケーションです。この文書は、なぜ作るのか、何があれば見つかるのか、どう進めるのか、結果をどこに置くのかを述べます。最後の節は、これまでに作ったアプリの記録です。

## なぜ

サイトのショップのチュートリアル（16 ステップ。商品 1 つから、ルーティング・テスト・公開まで育つ 1 つのアプリ）から、2 日でパッチリリースが 4 回出ました。

| 版 | 書く中で見つけたもの | 型 |
|---|---|---|
| 4.0.1 | 名前の無い `class:` / `attr:` が受け付けられ、何もしなかった。getter で導いた一覧の行のフィールドを、lint がすべて「無い」と報告した — **`wcstack` の README の Todo アプリ自身**に 3 件出ていた。 | 間違った書き方が黙って通り、正しい書き方が指摘される |
| 4.0.2 | `<wcs-storage>` に束ねたパスの下への書き込みが保存されない。シードしたスロットが初回の訪問でシードを失う。 | 再読み込みの後に壊れる（無言） |
| 4.0.3 | `#init=element` なしで束ねたアクセサペアが保存値を上書きする。`<wcs-fetch>` の `body` は 1 回しか送られない — **fetch の README の POST の例**は 2 回目に本文を送らなかった。 | 2 回目か再読み込みの後に壊れる（無言） |
| 4.0.4 | router から離れた `<wcs-outlet>` は空のまま、ページは別の場所に描かれる — **`examples/router-i18n`** がそうなっていた。 | 動くが、作者の意図した場所ではない（無言） |

どれもクラッシュではありません。どれも **2 つのパッケージの間**（state × storage、state × fetch、router × ページのレイアウト）にあり、**時間が経って**初めて現れ（再読み込み、2 回目の送信、ディープリンク）、**黙っていました** — コンソールにも lint にも何も出ない。うち 3 件は、私たち自身の README か examples の中にありました。

リポジトリには、実ブラウザの e2e テスト付きの examples がすでに 40 ほどありました。それでも見つからなかった理由は 3 つです。

- **1 画面・1〜2 パッケージだから。** デモは機能を見せるもので、継ぎ目を越えることも、再読み込みを生き延びることもまれ。
- **作者が規則を知っているから。** パッケージのデモを書く人は、知らずに鋭い角を避けて通る。
- **テストが意図ではなく存在を見ているから。** `router-i18n` のテストはページの文字が出ることを見ていた。文字は出ていた — ページが置いた outlet ではなく、router が自前で作った outlet の中に。

チュートリアルはこの 3 つのどれでも違っていました。それを方法にしたのがこの文書です。

## 何があれば見つかるか

1. **育ち、生活する。** ステップごとにパッケージか機能を足して作り、実際の使用が持ち込むものを通る: 再読み込み、2 回目、ディープリンク、戻る・進む、2 つ目のタブ、遅い・失敗するネットワーク、切れたセッション。上の欠陥の多くは 2 回目にしか現れない。
2. **わざと継ぎ目を越える。** アプリは見せる機能ではなく、越える継ぎ目で選ぶ — 値をやり取りする 2 つのパッケージ、ページのレイアウトと出会うパッケージ、lint と出会う runtime。すでに作った形のアプリを重ねても、見つかるものは減る。
3. **公開文書だけから書く。** 作者は利用者が読めるもの — パッケージの README、ルートと `wcstack` の README、AI 向けのスキル、examples — を読み、`packages/*/src` は読まない。文書が答えないときは利用者と同じく推測し、その推測が発見になる。
4. **引っかかりをすべて記録する。** 作者が止まるたび — 動かない書き方、答えにならない一文、助けにならないメッセージ — を、読んだもの・書いたもの・起きたこと・期待したことと一緒に、引っかかりの記録に書く。
5. **よくある間違いをわざとする。** ありそうな間違いごとに、それを書いて、何かが知らせるかを見る: runtime、lint、型検査。黙って失敗する間違いは、アプリ自体が正しくても発見になる。
6. **存在ではなく意図を確かめる。** 何かの文字が出たことだけでなく、*どこに*描かれたか、再読み込みで*何が*残ったか、2 回目の要求が*何を*送ったか、ページが*どの* URL にいるかを確かめる。
7. **道具を一通り通す。** `wcs-validate`、state に型を付けるなら `wcs-tsc`、ヘッドレスのテストの `@wcstack/testing`、本番向けの版を固定して integrity を付けたページ — どれも継ぎ目である。

## 進め方

1. **ブリーフ。** アプリの筋書き、ステップ、各ステップが越える継ぎ目、通る生活の出来事、試す間違い、必要なサーバー API を書く（バックエンドは検査の対象ではないので、契約は先に決める）。下の候補は、ブリーフを短くしたもの。
2. **文書から作る。** 初めての作者が作る — 実際には、ブリーフと、読んでよいファイル（上の公開文書）と読まないファイル（`packages/*/src`、テスト、`docs/` の設計メモ）を渡したサブエージェント。利用者と同じく CDN の公開版でアプリを動かし、引っかかりの記録を付ける。
3. **意図を確かめる。** 実ブラウザでアプリを開き、生活の出来事を通る。それを意図を確かめる e2e の spec に書く（下のチェックリスト）。ページに `wcs-validate` をかける。**引っかかりの記録の主張は、分類する前に一つずつ自分で再現する** — 初めての作者の診断はどちら向きにも外れうる（`router-auth` では「同じパスの `if:` でも中身を守らない」は欠陥より広かった。守らないのは getter の `if:` だけだった）。
4. **間違える。** 間違いの一覧を通り、どれが知らされ、どれが黙っているかを記録する。
5. **分類する。** 引っかかりの記録と間違いの一つひとつは、次のどれかになる:
   - **runtime の欠陥** — パッケージが間違ったことをする;
   - **lint の穴** — 静的検査に見えるはずの間違いを見逃す;
   - **文書の穴** — 文書が言っていない、または間違っている（動かない例もここ）;
   - **設計の問い** — 設計どおりの挙動だが、設計そのものが引っかかりになっている。

   それぞれに結末を付ける: PR で直した、issue にした、決定を記録した（[router-outlet-placement.ja.md](./router-outlet-placement.ja.md) が記録したように）。
6. **新しい継ぎ目を越えるものを残す。** アプリは e2e の spec と一緒に `examples/` へ、発見は下の記録とアプリの README へ。修正は、いつもどおり変えるパッケージに自分のテストと一緒に入る — アプリはその回帰テストではない。

### 意図のチェックリスト

どのアプリにもすべての行が要るわけではないが、飛ばす行は選んで飛ばす:

- **どこに**: 中身が、ページが意図した要素に描かれている（文書のどこかに、ではなく）。
- **再読み込み**: アプリが再読み込みをまたいで持つべきものはあり、持つべきでないものは無い。
- **2 回目**: 2 回目の送信、同じルートへの 2 回目の遷移、2 つ目の品物の追加が、1 回目と同じに振る舞う。
- **ディープリンク**: URL を直接開いても（アプリのリンクを通らなくても）、同じページに同じデータで着く。
- **履歴**: 戻る・進むでページと URL とデータが戻り、消えているべきもの（ログアウトの後のページ）は見えない。
- **別のタブ**: 同じデータを開いた 2 つのタブが一致する、または意図して一致しない。
- **ネットワーク**: 遅い応答・失敗する応答（4xx / 5xx）・ネットワークが無いことのそれぞれで、筋の通った表示になり、回復もできる。
- **コンソール**: 正しいアプリではエラーも警告も無く、各間違いでは期待した警告が出る。

## 置き場所

**`examples/` に**、デモと並ぶパッケージ横断のアプリとして置き、e2e の spec を `e2e/tests/` に置く。

- `examples/` はすでに「2 つ以上のパッケージを組み合わせたアプリ」の置き場で、継ぎ目アプリはそれに当たる。共有のデモサーバー、ローカルの `dist` に切り替える `WCS_LOCAL=1`、example 自身のサーバーを立てる e2e の仕組み、CI の e2e ジョブ、リポジトリのすべてのページを読む `wcs-validate` ジョブが、新しい仕組み無しにそのまま効く。
- 別のトップレベルのディレクトリ（`apps/`）は、その仕組みを重複させ、デモを浅い層として残す。examples を意図のチェックリストの水準に引き上げるほうがよい。
- サイトのチュートリアルは教材のまま。継ぎ目アプリはそれより大きく、ステップを追って読ませるためのものではない。
- 別のリポジトリにすると、e2e がローカルの `dist` から切り離され、修正と、それを見つけたアプリを 1 つの PR で確かめられない。

そこに置かないもの: 初めての作者の生の試作（抜粋を発見に書く）と、間違いの変種（それぞれ、それを知らせるようにしたパッケージの単体テストか lint のテストになる）。

継ぎ目アプリは [examples/README.md](../examples/README.md) の専用の表に、越える継ぎ目と一緒に載せる。どの example とも同じく、パッケージは `esm.run`（npm の `latest`）から読むので、リリースのたびに動き続ける必要がある。e2e のジョブはローカルの `dist` で動かす。

## 候補と記録

| アプリ | 継ぎ目 | 生活の出来事 | 状態 |
|---|---|---|---|
| `router-auth` — 会員エリア: ログイン、保護されたページ、トークンの要る API からの注文履歴 | router のガード × state、`<wcs-fetch>` の 401 × 遷移、`<wcs-storage>` × ガード、ガードのローダー（`data`） | ログアウト中のディープリンク → ログイン → そのページへ戻る; ログイン中の再読み込み; 使用中のセッション切れ; ログアウト後の戻る; 別のタブでのログアウト | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-14）。発見は下 |
| `router-admin` — 管理画面: 入れ子のレイアウト、ページングと並べ替えを URL に持つサーバー側の一覧、サーバー検証付きの編集フォーム、ビュー遷移、2 言語 | `<wcs-layout>` × state、クエリ ⇄ state ⇄ fetch、フォームの双方向束縛 × fetch の `body`、`<wcs-view-transition>` × router × 一覧、basename の言語 | 名前順の 3 ページ目へのディープリンク; 編集して保存、もう一度保存; フィールドのエラー付きの 422; 編集ページでの再読み込み; 詳細からの戻る | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-14）。発見は下 |
| `state-collab-board` — 共有ボード: ほかの人の変更は SSE で届き、自分の変更はすぐ反映し、サーバーが拒めば巻き戻す | `<wcs-sse>` × state の一覧、`<wcs-fetch>` × 楽観的更新、`<wcs-network>` × state、再接続 × 再同期 | 2 つのブラウザ; 拒まれる変更; オフラインになって戻る; サーバーの再起動 | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-14）。発見は下 |
| `signals-shop` — チュートリアルのショップを `@wcstack/signals` で | signals × router、wc-bindable の橋を通した signals × `<wcs-fetch>` / `<wcs-storage>` | チュートリアルと同じ（再読み込み、ディープリンク、戻る、2 つ目のタブ） | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-14）。発見は下 |
| `ssr-news` — `@wcstack/server` で描くニュースサイト: 記事の一覧、コメント付きの記事のページ、読者の設定、セクションのレイアウト、本番の形（CSP、SRI、HTML のキャッシュ） | `@wcstack/server` × router × state、サーバーとハイドレーションでの `<wcs-fetch>`、SSR の下の `<wcs-link>` / `<wcs-head>` / `<wcs-layout>`、クライアントの版 × サーバーの版 | ディープリンクと再読み込み; JavaScript 無し; 遅いクライアントのバンドル（ハイドレーション前の入力）; サーバーの再起動; 別の minor のクライアント; 投稿の後の HTML のキャッシュ | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-18）。発見は下 |
| `state-field-report` — スマートフォンからの現場報告: クリップ・位置・口述のメモを、送信待ちを通して送る。本番の形で | `<wcs-permission>` × 取りに行く側（camera・geo・listen・notify）、`<wcs-camera>` × `<wcs-recorder>` × `<wcs-upload>`、ルートのノード × I/O ノードの切断、`<wcs-storage>` × 値とハンドルの混ざった下書き、`Permissions-Policy` / `<iframe>` × デバイスの要素すべて | 拒否してから許可する、録画中の権限の取り消し、録画中にタブを隠す、撮影のページを離れて戻る、アップロード中の再読み込み、アップロード中のオフライン、422 / 413 / 415 / 500、2 つのタブ、`<iframe>` の中のアプリ | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-20）。発見は下 |
| `fw-inventory` — 店の在庫の道具: React 19 の管理画面と Vue 3 の倉庫のパネル。`@wcstack/state` は使わない | I/O ノード × `@wc-bindable/react` / `vue`、React 19 の props × 要素の入力、フレームワークのリアクティビティ × structured clone、`key` × 要素、遅れた定義（autoloader・CDN・動的 import）× アダプター、Vite の開発サーバー × SSE | 続けて届くイベント、開発の proxy の背後でのサーバーの再起動、保存したフィルタでの再読み込み、片方が React でもう片方が Vue の 2 つのタブ、深いリンクと素早い移動、アップロードの取り消し・再送・拒否、最初の描画より後の定義、StrictMode、HMR | 2026-10-20 に作った。発見は下 |

### router-auth（2026-10-13）

初めての作者（公開文書だけを読むサブエージェント）は引っかかりを 23 件記録した。生活の出来事は最後には 7 つとも通ったが、うち 3 つは回避策を入れてから。再現して分類した結果:

| 分類 | 発見 | 結末 |
|---|---|---|
| runtime の欠陥 | state: getter の `if:` が、閉じる値で中身を適用した（フィルタが例外） | 修正 |
| runtime の欠陥 | router: ガードのリダイレクトが履歴を積み、「戻る」で守られた URL へ戻ってまたリダイレクトされた | 修正（置き換え） |
| runtime の欠陥 | router: 読み込み直後のガードのリダイレクトが文書ごと読み直した（navigate リスナより先に走った） | 修正 |
| runtime の欠陥 | router: `guard=""` の無い `<wcs-guard-handler>` は最初のルートを守らなかった（以降の遷移は守った） | 修正 — 決定: ハンドラだけでガードを有効にする |
| runtime の欠陥 | router: 新しいルートの中身が、前のルートの params でバインドされた | 修正 — 決定: 出力は中身の前、`path` は後 |
| runtime の欠陥 | fetch: `<wcs-fetch-header>` に `value` プロパティが無く、`value:` は空のヘッダを送った | 修正 |
| 設計の問い | router: 設計どおりのリダイレクトのたびに警告（二重のピリオド付き）。ガード同士のリダイレクトに上限が無い | 決定: 出さない。続けて 10 回で止めてエラー |
| lint の穴 | `wcs/storage-seed-clobber` が中身のあるシードを見逃し、しかも warning だった（スキルの `--errors-only` の関門を通った） | 修正 — 決定: どのリテラルのシードも、error で |
| 文書の穴 | ガードがセッションをどこから読むか、モジュールは一度だけ評価、`toPath` にクエリが無い、リダイレクトで `navigate()` が reject、state からのヘッダ、storage の README の sessionStorage の例と `undefined` / `null` の矛盾 | 修正 |
| lint の穴 | `this` で書いた `$on` のハンドラ。`#prevent` の無い `onsubmit:`（router があると、ネイティブの GET がパスワードを URL に入れる） | [残っていたもの](#残っていたもの2026-10-14)を参照 |
| 設計の問い | ルートへ戻ると、state が新しい `url` を書く前に、`<wcs-fetch>` が前の `url` でもう一度要求を出す | [残っていたもの](#残っていたもの2026-10-14)を参照 |

### router-admin・state-collab-board・signals-shop（2026-10-13）

試行の後、同じやり方で並行して作った。生活の出来事は最後にはすべて通り（10・6・17 項目）、引っかかりは 24・14・18 件。再現して分類した結果:

| アプリ | 分類 | 発見 | 結末 |
|---|---|---|---|
| router-admin | runtime の欠陥 | router: ページ自身が取り消したナビゲーション（未保存の確認）に `intercept()` を呼び、捕まらない `InvalidStateError` | 修正 |
| router-admin | 設計の問い | view-transition: drain のパスすべてが遷移の中で走り、束ねた入力欄の 1 打鍵ごとに遷移が始まり、その後のクリックが失われた（5 回中 5 回） | 決定: 一覧と分岐の変化だけを動かす。view-transition-design §7.2 を改訂 |
| router-admin | runtime の欠陥 | state: データに無いキーの下で宣言した getter（`get "box.label"()`）への束縛が、動いているのに「silently dropped」と警告した | 修正 |
| router-admin | 設計の問い | 未保存の変更があるページを出る前に聞く口が無い（作者は Navigation API を直接使った。Firefox には無い） | 決定: `<wcs-router leaveConfirm>` |
| router-admin | 設計の問い | `<wcs-link>` は完全一致のパスでしか active にならない | 決定: `match="prefix"` |
| router-admin・state-collab-board | 設計の問い | 要素がバインディングの時点で既に持っていた値（router の最初の params、開いている `<wcs-sse>`）では `$watch` が発火せず、発火するかどうかが読み込みの速さで変わった | 決定: watch が始まるときに 1 回発火する |
| state-collab-board・router-auth | lint の穴 | `this` で書いた `$on` のハンドラ（ランタイムは `handler(state, event)` と呼ぶ） | 修正: `wcs/on-handler-this`（error） |
| state-collab-board | 設計の問い | オンライン / オフラインの出力が無い（作者は `window` を聞いた） | 決定: `<wcs-network offline>` — `online` ではない: `on` で始まる `data-wcs` の名前はイベントの束縛になる。新しい出力をブラウザで確かめて見つけた |
| state-collab-board | 文書の穴 | `<wcs-fetch>` 1 つは一度に要求 1 本、フィールドのエラーは `error.body`、SSE の `Last-Event-ID` は `id:` 付きのイベントの後だけで HTTP のエラーの後は再試行されない、パッケージの README 69 個が I/O より先に `@wcstack/state` を読み込んでいた | 修正 |
| signals-shop | 設計の問い | key 付きの `For` の行は作ったときの item を持ち続け、置き換えの更新で古い行が出た（README 自身の例も） | 決定: `each` の第 3 引数 `current()`。行は使い回したまま（最初に提案した「作り直す」は、再取得のたびに全行を作り直すことになった） |
| signals-shop | 設計の問い | `h()` が小文字の `onclick` の関数を、リアクティブな prop として描画時に実行した | 決定: 関数を持つ `on…` キーはすべてリスナー（`onclick` → click、`onadd-to-cart` → add-to-cart） |
| signals-shop | lint の穴 | `wcs/base-href-missing` が import map で読み込んだ router を見逃した | 修正 |
| signals-shop | 文書の穴 | signals の README が 1.x のまま 1.25.0 を固定していた。signals × router / `<wcs-storage>` の書き方が無い。`@wcstack/testing` は `<wcs-state>` のページ向け | 修正 |
| 3 本とも | 未着手 | lint: `Object.assign` や別名を通したその場の変更、`wcs/getter-untracked-read` の証拠としての `$on` の書き込み、`location` を読む getter、ルート直下の裸の `{{ }}`、`#prevent` の無い `onsubmit:`。runtime: 既定の slot の無いレイアウトがページを黙って落とす、ルートへ戻ると `<wcs-fetch>` が古い `url` で要求し直す、`date` / `locale` で「Oct 13, 2026」や通貨を出せない。signals の開発モード: 何も追跡しない computed。チュートリアルのステップ 13 が state を先に読み込む | [残っていたもの](#残っていたもの2026-10-14)を参照 |

### examples/ への取り込み（2026-10-14）

4.1.0 の後、同じ作者たちがアプリを `examples/` へ移し、4.1.0 で要らなくなった回避策を外し、それぞれ e2e の spec を書いた（10・15・7・8 件、意図を確かめる）。そこでさらに見つかったもの:

| 分類 | 発見 | 結末 |
|---|---|---|
| リリースの欠陥 | 公開した `@wcstack/lint` / `@wcstack/typescript` 4.1.0 が `<wcs-network>` の新しい `offline` を知らなかった: `release.yml` が組み込みのタグの一覧を作り直す前に両方をビルドしていたので、新しいメンバーは 1 リリース遅れて lint に届いていた | 修正: リリースは一覧を作り直した後に両方をビルドし直す |
| runtime の欠陥 | router: ガードがリダイレクトするページへの `navigateUrl` / `replaceUrl` が `navigate failed: AbortError` を出した（ガードのループでは `Fallback navigation failed` が 10 個）— リダイレクトされたナビゲーションが `AbortError` で reject するのは設計どおり | 修正: `AbortError` は報告しない |
| lint の穴 | `wcs/on-handler-this` が別名（`const state = this`）を見逃した | 修正: `$on` のハンドラ自身の `this` はすべて |
| テストの欠陥 | e2e の確認が SSR のスナップショットの minor（`4.0.`）を固定していて、4.1.0 の後のすべての PR で落ちた | 修正 |
| 設計の問い | 言語の切り替えは本物のナビゲーション（言語は basename）なので、未保存の変更にはブラウザの `beforeunload` が出て、`leaveConfirm` の文言は出ない。`match="prefix"` は `/products/new` でも「Products」に印を付ける。要素が持ってきた最初の値で、getter の `$watch` は発火しない | [残っていたもの](#残っていたもの2026-10-14)を参照 |
| 未着手 | signals: `h()` の後で定義される要素へのオブジェクトの prop は属性になる、要素の定義前の `bindNode` は汎用のエラー。lint: `#prevent` の無い `onsubmit:`、`Object.assign` や別名を通したその場の変更、`wcs/getter-untracked-read` の証拠としての `$on` の書き込み、別ファイルの module をまたぐ `signals-dual-entry` | [残っていたもの](#残っていたもの2026-10-14)を参照 |

### 残っていたもの（2026-10-14）

上の表で未着手だったものの、4.1.1 の後の結末。設計の問いは著者が決めた（どれも推奨どおり）。

| 分類 | 発見 | 結末 |
|---|---|---|
| 設計の問い | 言語の切り替えは本物のナビゲーション（言語は basename）なので、未保存の変更にはブラウザの `beforeunload` が出て、`leaveConfirm` の文言は出なかった | 決定: Navigation API があれば、ページを離れる取り消せるナビゲーション（basename の外・別のサイト・フォームの送信）でも `leaveConfirm` が聞く。受け入れたらブラウザは聞き直さない（Chromium で確認: `navigate` が先に来て取り消せる） |
| 設計の問い | `match="prefix"` は `/products/new` で「Products」にも「New product」と並んで印を付ける | 決定: 設計どおり — セクション（`aria-current="true"`）とページ（`"page"`）。印を 1 つに見せるなら `[aria-current="page"]` でスタイルを書く、と router の README に書いた |
| 設計の問い | 要素が持ってきた最初の値で、getter の `$watch` が発火しなかった | 決定: その値のパスを読む根の getter も、watch が始まるときに 1 回発火する。`prev` は `undefined`（4.1.0 の規則を広げた） |
| 設計の問い | `date` / `locale` で「Oct 13, 2026」や通貨を出せなかった | 決定: `date` / `time` / `datetime` に書式（`date(en-US,medium)`）、新しい `currency(code, loc?)`。複数形は getter のまま（`Intl.PluralRules`） |
| runtime の欠陥 | 既定の `<slot>` の無いレイアウトのテンプレートは、入れ子のルートを黙って落とした。レイアウトのテンプレートが持ち込んだ outlet も警告されなかった | 修正: 実行時に `[wcs/layout-slot-missing]`、その outlet には `[wcs/router-outlet-misplaced]`。lint はマークアップからスロットを報告する |
| 設計の問い | ルートへ戻ると `<wcs-fetch>` が前の `url` で要求し直した | 4.1.0 で既に消えていた（params が中身より先に state に届く）。router-auth の e2e が要求の記録を確かめるようにした |
| runtime の欠陥 | `date` に ISO 文字列を渡したときの文言が、`textContent: iso|date` を「prop: iso」と呼んだ | 修正: 失敗したバインディングを書いたとおりの名前で呼び、要素を添える。型のエラーは受け取った型と直し方を言う |
| runtime の欠陥 | signals: `h()` の後で定義される要素へのオブジェクトの prop は `[object Object]` の属性になった。定義前の `bindNode` は汎用のエラー。何も追跡しない `computed` / effect に開発モードが黙っていた | 修正: オブジェクトは手元に持ち、要素が定義されたら setter で渡す（Chromium でも確認 — happy-dom は upgrade の代わりに要素を作り直す）。`bindNode` はタグがまだ定義されていないと言う。`UNTRACKED_COMPUTED` / `UNTRACKED_EFFECT` |
| lint の穴 | `#prevent` の無い `onsubmit:` | 修正: `wcs/submit-without-prevent`（warning） |
| lint の穴 | `Object.assign` や別名、`$on` の state を通したその場の変更 | 修正: `wcs/nested-assign` / `wcs/array-*`（error）で報告する。確かめる中で文書の穴も見つかった: 同じ配列を書き戻しても、`$postUpdate` しても、一覧の行は追加・削除・置き換えされない（行が合わせ直されるのは新しい配列だけ — 配列の破壊的操作の設計書の記録どおり）。state の README の「配列の書き込みは同じ参照でも必ず通る」は、そうなるように読めた。README に書いた |
| lint の穴 | `wcs/getter-untracked-read` の証拠としての `$on` の書き込み、`location` を読む getter | 修正: どちらも（`location` は `pathname` / `search` / `hash` / `href`。`protocol` / `host` は数えない — WebSocket の URL を作るために 2 つの example が読んでいる） |
| lint の穴 | ルート直下の裸の `{{ }}` | 修正: `wcs/route-bare-mustache`（warning）。レイアウトのテンプレートの直下も |
| lint の穴 | 別ファイルの module をまたぐ `signals-dual-entry` | ページから見える範囲で修正: 両方のエントリを割り当てる import map を warning にする（lint はほかのファイルを読まない）。fetch の pagination の signals の例が両方を割り当てていた |
| 文書の穴 | サイトのチュートリアルのステップ 13 が `@wcstack/state` を先に読み込む（スキルと examples に反する） | サイトで修正 |

### ssr-news（2026-10-18）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md)（minor のリリース 1 回を継ぎ目アプリ 1 本にする）の下での最初のアプリ。`@wcstack/server` で描くニュースサイト: 記事の一覧、コメント付きの記事のページ、読者の設定、セクションのレイアウト、本番の形（CSP、SRI、HTML のキャッシュ）。初めての作者は公開文書と公開版の 4.2.0 だけを使った。引っかかりを 27 件記録し、うち 7 件は重い（内容の誤り、入力の喪失、安全の穴、ページの破損 — どれも知らせなし）。わざと犯した間違いは 12 件で、うち 9 件は何も知らせなかった。生活の出来事は 2 つ失敗した: ハイドレーションの前に入力した文字が消え、古い minor のクライアントで記事のページが空になった。

ブラウザ側の主張は 2 つ目のサブエージェントが Chromium で公開版に対して再現し、サーバー側は手で再現した。分類した結果:

| 分類 | 発見 | 結末 |
|---|---|---|
| runtime の欠陥 | server: 描画の中で要素が始めた仕事が描画より長く生きた — 描画の後に失敗した `<wcs-fetch>` の要求、`<wcs-timer>` の刻みごと — 捕まらない `TypeError` で素の Node のサーバーが終わった | 修正（#469） |
| runtime の欠陥 | state: スナップショットを作るとき行を印の後ろへ動かし、行の中のカスタム要素を切断した。`for:` の行や `if:` の枝の中の `<wcs-link>` が空で配られ（題名も `<a>` も無い）、ハイドレーションの後に `Invalid URL` を投げた | 修正（#470）: 印を動かす。クライアントはリンクの子を `<a>` の中に読み、行を採用する |
| runtime の欠陥 | router: `to` が書かれる前に接続した `<wcs-link>` が投げて、表示されなかった — router を先に読む（推奨の順）ページの `attr.to:`。SSR が無くても | 修正（#470） |
| runtime の欠陥 | router: `<wcs-head>` が子をサーバーの `document.head`（直列化されない）へ移した。採用したルートの `<title>` がそのセッションの間変わらなかった | 修正（#470）: サーバーでは子を要素に残す |
| runtime の欠陥 | router: `<wcs-layout>` のルートへの深いリンクが、読み込むたびに `wcs-layout-outlet has no layout.` を投げた | 修正（#470）。レイアウトはクライアントで描き直す（採用しない）ままで、それがサーバーのノードを置き換えることを README に書いた |
| runtime の欠陥 | router: サーバーで、router の無いページや URL として読めない `to` の `<wcs-link>` が microtask の中で投げ、プロセスが終わった（行の修正の途中で見つけた） | 修正（#470）: 報告する |
| runtime の欠陥 | router: `<wcs-link>` と `<wcs-head>` がサーバーで `style` を書き、厳しい `style-src` が要素ごとに報告した | 修正（#470）。`<wcs-fetch>` はサーバーで fetch を起動したときに今も書く（子に、JavaScript の無い読者に見えてしまう本文を持ち得る） |
| runtime の欠陥 | fetch: `url` が A → `null` → A で 2 回目を送らなかった — 失敗の後も。出て入り直したページが再試行しなかった | 修正（#471） |
| runtime の欠陥 | state の diagnostics: 一部の行だけが持つフィールド（ページ自身が足す `pending` の行）を「silently dropped」と報告した（動いていた） | 修正（#471） |
| 無言の間違い | `url` で読み込み、`method` + `body` + `trigger` で投稿する 1 つの `<wcs-fetch>` が、以後の url の変化を本文の無い `POST` で送った | 修正（#471）: `[wcs/fetch-auto-unsafe]` |
| lint の穴 | lint 4.2.0 が `if:` に真偽値を求めた | 修正済み（#464） |
| 文書の穴 | ルートの README の SSR の例がそのままでは失敗した（`url` が無い）。サーバーで描く状態の読み込み方に `src` を挙げていた。「サーバーはすべての非同期処理を待つ」。サーバーを固定してもエンジンは固定されない（`@wcstack/state` に `^`）。サーバーの minor より古いクライアント。スナップショットが持つものをハイドレーションで取り直す `<wcs-fetch>`。ハイドレーションしたクライアントで `$connectedCallback` が走らない（そこでガードして読んだ `localStorage` が読者の履歴を失った）。実行環境のタイムゾーンでの日付 | 修正（#472） |
| 設計の問い | 束縛が始める要求（状態から `url` を受ける `<wcs-fetch>`）を描画が待たない: router-spa の雛形の形で「Loading…」が配られる | 決定: 待つ（`timeoutMs` の範囲で）— 上限を使い切ったら、警告してそれ抜きで描く。readiness プロトコルの `pendingPromise`（#476） |
| 設計の問い | `@wcstack/server` が `@wcstack/state` に `^` で依存する | 決定: ちょうどの版 — 実行時の依存はちょうどの版、peer は `^` のまま（#474） |
| 設計の問い | `<wcs-state src>` — 厳しい CSP の下で文書が勧める形 — をサーバーで描けない（Node のローダは `http:` の URL を読まない） | 決定: `renderToString({ resolveModule })` が URL をローカルのファイルへ写す。描画ごとに別のモジュール（#477） |
| 設計の問い | ハイドレーションの前に入力した文字が状態から上書きされる（フォーム部品の `value:`） | 決定: 読者の値を勝たせる — バインドの後で戻し、`input` / `change` を送るので、双方向のバインディングが状態へ書く（#475） |
| 設計の問い | `main` の README が npm の `latest` にまだ無い機能を書く（4.2.0 で「4.3 から」の `data-wcs-ignore` を読んで使い、無視された） | 決定: `4.3 (not released yet)` / `4.3（未リリース）` の印 — CI は印の無い未リリースの版を拒み、stable のリリースが自分の印を外す（#474） |
| 設計の問い | サーバーの minor より古いクライアントが、初期化に失敗する前にサーバーの行を取り除く | 4.4 で修正: クライアントは取り除く前に写しの上でページを計画し、サーバーの HTML をそのまま残して失敗する（#483）。4.3 までのクライアントは救えない（文書化、#472） |
| 残り | 作者のページで、router の params が状態に届く前に `$connectedCallback` が走った（そこでは再現、縮めたページでは再現しない）。`renderToString()` から HTTP の状態を得る手段が無い（テンプレートに書いた目印はどの出力にもある）。サーバーが `<title>` を自分で書く。ハイドレーションの後のフックが無い。設定がハイドレーションの後に跳ねる。クライアントが信じる古いスナップショットのキャッシュが読者自身のコメントを隠す。SRI の値がリリースごと | 記録 |
| 通過 | 状態として届けた利用者の内容は SSR・ハイドレーション・遷移を通してテキストのまま。コメントの中の `</script>` はスナップショットから抜け出さない | — |

著者は上の設計の問い 5 つを 2026-10-18 に推奨どおり決めた（[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.1）。前からの 6 つ目も: 要素の準備ができていないために拒まれた I/O のコマンドは、1 要素につき 1 回警告する（`[wcs/command-not-ready]`、#473）。

上の fetch のほかに何も知らせなかった間違い: `renderToString()` の前に利用者の内容をテンプレートへ連結する（サーバーがその中の `{{ }}` を描く — そうしたマークアップには `data-wcs-ignore`（#467）で印を付ける）。出力からコメントを取り除く（クライアントが値をマークアップとして読む）。`enable-ssr` の無い `<wcs-router>`、`url` の無い `renderToString()`（空の outlet、記事の URL でホームのページ — どれも状態 200）。公開するルートのガード（サーバーで描かれない）。サーバーで走ると思った `$watch`。どれも[誤りの目録](./mistake-catalogue.ja.md)の候補。

### ssr-news を examples/ に置く（2026-10-18）

4.3.0 の後で、アプリを `examples/ssr-news/` に移した。4.3.0 で要らなくなった回避策 — 行の中の素の `<a>`（`<wcs-link>` はサーバーで描かれるようになった）、router を待ってから `$connectedCallback` で記事を読むこと（束縛が始めた `<wcs-fetch>` を描画が待つようになった）、nonce 付きの inline の状態（`src` の状態が `resolveModule` で描ける）— を外し、意図を確かめる e2e の spec（13 件）を付けた。その中で見つけたもの:

| 分類 | 発見 | 結末 |
|---|---|---|
| runtime の欠陥 | state の diagnostics: どの行にも無い行フィールド — ページ自身の行だけが持つ `pending` の無い、サーバーのコメント — を、再読み込みの後で「silently dropped」と報告した（4.3 で直したのは、ほかの行にあるものが最初の行に無い場合だけだった） | 修正: 行フィールドが無いことは、近い名前（打ち間違いらしいもの）か、別の一覧の形の行 getter があるときだけ報告する |
| 設計の問い | コメントのフォームは `<wcs-layout>` のルートにあり、クライアントが描き直す（レイアウトは採用しない）: そこにハイドレーションの前に入力したものは失われる — 4.3 で残すようにしたのは、ページ直下の部品と採用されるルート | 未決: レイアウトのルートの採用（アプリの README の「Known limits」） |

### 外からの評価: 7GUIs（2026-10-18）

このリポジトリの継ぎ目アプリではない: AI の作者が、自分のリポジトリで 7GUIs の 7 課題を @wcstack/state 4.2.0 で作り、誤りを 34 件わざと入れて、それぞれ何が知らせたかを記録した — 手順 5 の方法。何も知らせなかったのが 10 件、lint だけが 8 件。実行時と lint は構造（パス・フィルタ・トークン・ネイティブコマンド）にはおおむね強く、無言のものは依存グラフの外（getter の中の `Date.now()`、`$postUpdate`）か、受け手がまだ無い間のコマンドの emit だった。設計の問いは著者が決めた（[v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.2）。

| 分類 | 発見 | 結末 |
|---|---|---|
| lint の穴 | 外部 state（`<wcs-state src>`）にスクリプトの規則が一切かからない — 同じスクリプトがインラインなら error 3・warning 1、`src="./state.js"` では 0 件。lint の README は逆のことを書いていた | 修正（#484）: スクリプトを要素の中に置いた形でもう一度検査し、ファイルの中の指摘はそのファイルで報告する |
| lint の穴 | `wcs/updated-callback-unbound` が、`for: rows` の中の `for: .cells` の中の `if: .editing` を、どこにも束縛されていないと報告した（Cells の `src` の state を検査して見つかった） | 修正（#484） |
| lint の穴 | setter の無い getter への双方向の束縛、どの `command.` 束縛も受けないコマンドトークン、`selectedId` に対する `this.selectedID`、`this.$command.<打ち間違い>`、getter の中の `Date.now()`、`paths.includes("labell")` | 修正（#485）: `wcs/path-readonly`・`wcs/command-token-unbound`・`wcs/write-path-missing` と、3 つの規則の拡張 |
| runtime の欠陥 | 解決しない `$postUpdate` のパスと、近い名前のある未宣言のキーへの書き込みが、何も言わずに何もしなかった | 修正（#486）: diagnostics の後付けが 1 回警告する |
| 文書の穴 | `$postUpdate` の `*` はすべての行ではなく今の行 | 修正（#486）: README に書いた。すべての行の形は 5.0 の議題 |
| 設計の問い | 購読者のいない間の emit は消える — 定義の遅れた要素（Timer）、同じ更新で描かれる `if:` の枝（Cells） | 決定: トークンごとに 1 回警告する（`[wcs/command-token-unbound]`） |
| 設計の問い | `event.currentTarget`（ルート）を読む委譲されたハンドラが、それに触れない TypeError で落ちる | 決定: そのハンドラが throw したら、diagnostics の後付けがハンドラごとに 1 回理由を言う（core のフック 33 B） |
| lint の穴 | lint がページで定義した自作要素の `static wcBindable` を読まず、その `eventToken.` / `command.` の名前の打ち間違いを実行時（code 付きで初期化に失敗し、近いメンバーは示さない）に任せていた | 修正: ページのスクリプトの字面の宣言と照合する |
| 残り | `for:` の 1 行だけに命令するには自作要素が要る（トークンは束ねたすべての行に届く） | 記録 |

### 外からの評価: 確定申告の下書きツール（2026-10-18）

このリポジトリの継ぎ目アプリではない: AI の作者が、自分のリポジトリで確定申告（事業所得のみ）の下書きツールを @wcstack/state 4.2.0・router・`<wcs-storage>` で作り — 値 1 つの入力 34 個、行の表 3 つ、getter 96 本 — state エンジンの評価を書いた。ドメインとの相性は良い（申告書は表計算で、パス getter はその式）とし、コストを 3 つ挙げた: エンジンの暗黙のルール、リリースの速さ、静的検査のために state を二度宣言すること。提案は 4 つ: state の定義から `stateSchema` を作る手段、getter の中のパスも lint で検査する、保存と復元を書き戻しの約束事ごと公式のレシピにする、major のペースを落とすか長期サポート版を設ける。

| 分類 | 発見 | 結末 |
|---|---|---|
| lint の穴 | getter が読むパスを検査しない: `this["dependents.*.incom"]`・`$getAll("incomes.*.amout", [])` の打ち間違いはテスト頼み | 修正（#489）: `wcs/read-path-missing` |
| runtime の欠陥 | そうした入れ子の読みは `undefined` になり、金額が黙って違う | 修正（#489）: diagnostics の後付けが、読んだ getter の名前を添えてパスごとに 1 回警告する |
| lint の欠陥 | 他のキーと並ぶトップレベルの spread で、spread が持ち込むキーがすべて `wcs/binding-path-missing` になった（誤報 79 件）— 作者は黙らせるために `stateSchema` 全体を手で書き、食い違わないことをテストで確かめていた | 修正（#489）: そうした state は文書どおり読めない state として扱う。`stateSchema` が無ければ spread の上で 1 回そう言う（`wcs/path-dynamic-unknown`、info） |
| 道具の欠陥 | `wcs-schema` がその state でスタックを使い切った（spread のある literal では、TypeScript のチェッカーが `this` を読む getter 1 本ごとに 1 段再帰する）。スタックを足すと、入力 34 個を error にする閉じた schema を書いた | 修正（#490）: bin は大きなスタックで動く。キーを挙げない型の spread は、警告付きの開いた schema にする。表から JSDoc の mapped type で型を付けると、手書きの manifest のキーがすべて生成される |
| 文書の穴 | アプリの保存と復元が立っている規則 — state が書いている最中に要素が返す値は書き込みではない — が storage の README のレシピにしか無く、作者は `$behavior` で切り替わるエンジンの挙動と受け取った | 修正: state の README に規則を書き（同期で同じ値。どの `$behavior` のキーでも変わらない。後のイベントやコピーは setter を走らせる）、storage のレシピからそこへリンクした |
| 文書の穴 | 4.0 は `for:` / `if:` の中身を挿入する前にバインドするので、その中のカスタム要素は `connectedCallback` の前に入力を受け取る。アプリの金額欄は 3.x から上げたとき、未採用の入力を失った | 修正: state の README（Inputs）と目録（文書だけ: 接続した後の要素自身の書き込みは編集と見分けられない） |
| 文書の穴 | 3,600 行の README のどこまでがアプリに要るかが書かれていない。`{{ }}` と `<!--@@: -->` が 1 ページに混在 | 修正: state の README の冒頭に読む範囲の案内を置き、2 つのテキストの書き方の使い分けも書いた |
| 文書のずれ | cross-tab-todo の例が 3.x のエコーの止め方を説明していた。`docs/typescript.md` と typescript の日本語 README が v1 の manifest の形を書いていた | 修正 |
| 設計の問い | リリースの速さ（6 週間で 26 回、major 2 回）と長期サポート版 | 未決、著者の判断: [v4-direction-2026-10.md](./v4-direction-2026-10.md) §4 と §6 が、継ぎ目アプリ 1 本で minor 1 回・patch はデータ損失と退行だけ・4.x の中で破壊的変更をしない、をすでに決めている。3.x や 4.x のサポート版は決めていない |
| 残り | 補助の関数（`concat(newRow())`）で足した行は形を読まない | 記録: `stateSchema` で補える |

### state-field-report（2026-10-19）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) の下で 2 本目のアプリで、§3.2 が次に挙げる継ぎ目、デバイス系の I/O × 権限を越える。スマートフォンからの現場報告: 権限のページ、カメラのプレビューとクリップ（`<wcs-camera>`・`<wcs-recorder>`・`<wcs-wakelock>`）、位置（`<wcs-geo>`）、口述のメモ（`<wcs-listen>` / `<wcs-speak>`）、`<wcs-fetch>` で作る報告と `<wcs-upload>` で送るクリップ、`<wcs-network>` がオフラインと言う間の送信待ち、送り終えたときの通知（`<wcs-notify>`）、`<wcs-router>` のルートをまたいで `<wcs-storage>` が持つ下書き、そして本番の形（SRI・厳しい CSP・`Permissions-Policy`・`<iframe>` の中のアプリ）。初めての作者は公開文書と公開済みの 4.4.0 を使った。生活の出来事はすべて、偽のカメラとマイクを持つヘッドレスの Chromium で確かめた。隠れたタブ・音声認識のサービス・OS の通知は模擬した。引っかかりは 18 件。わざとした間違い 15 件のうち 12 件は、wcstack の何も知らせなかった。生活の出来事は 1 つが失敗した（撮影のページを離れて戻る）。5 つは回避策があって初めて通った。

主張はどれも、分類する前に、リポジトリの 4.4.0 の dist を使って Chromium で再現した。2 つは書かれたより狭かった。安全でない origin で見張り役が `granted` と言ったのは、テスト環境がすべての origin に許可を与えたためで、本物のブラウザはそこで `denied` と言う（ページにとっては、やはり拒否に見える）。タブを落とした echo ループは、模擬の認識器の上で起きた。

| 種類 | 発見 | 結果 |
|---|---|---|
| 実行時の欠陥 | camera: `<wcs-camera>` が切断で `active` をイベントなしに `false` にしていた。router は離れたルートのノードを束縛ごと戻すので、ページはカメラが無いのに「Camera live.」と表示し、`active` の間は押せない開始ボタンも再読み込みまで押せなかった | 直した: 切断が `active: false` を知らせる |
| 実行時の欠陥 | 同じことが、さらに 12 のパッケージにあった（すべての I/O ノードを洗って見つけた）。出力をイベントなしに戻すもの（`speaking`・`listening`・消したエラー）と、世代の守りが完了を捨てて途中の値のまま残すもの（`loading`・`connected`） | 決めた: 横断の契約 — 切断は、変える state の出力をすべて知らせ、打ち切る操作は終わったと知らせる（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §22） |
| 設計の問い | 録画中に `<wcs-recorder>` が文書から外れると、録画を何も言わずに捨てていた | 決めた: 残す。録画を止め、ストリームのトラックが終わったときと同じく、クリップを `recorded` で渡す |
| 実行時の欠陥 | recorder: `mime-type` が無いと、クリップの `Blob` に型が無く、`mimeType` も `""` のままだった。Chromium は型を `onstart` で決め、recorder はその前に読んでいた。そのため README 自身の手順（`new File([blob], …)` を `<wcs-upload>` へ）が、サーバ（415）にも `accept="video/*"` にも拒まれた | 直した |
| 実行時の欠陥 | camera: プレビューの shadow の `<style>` が、`'unsafe-inline'` の無い `style-src` に止められる（`<video>` が元の大きさで描かれる） | 直した: 構築したスタイルシート |
| 設計の問い | `Permissions-Policy`（ヘッダ、`allow` の無い `<iframe>`）や安全でない origin がデバイスを切っていた。見張り役は `granted` か `denied`、取りに行く側は `not-allowed` と言い、利用者の拒否と同じに見えた（Chromium の Permissions API がそう答える）。アプリは利用者をサイトの設定へ案内した | 決めた: 見張り役も取りに行く側の `permission` も `unsupported`、理由付きの `capability-missing`、ブラウザには聞かない |
| 無言の間違い | upload: 1 つの `data-wcs` で `url` / `files` より前の `trigger`、使い切った後の再送、url より前のファイルは、何も送らず、エラーも立てなかった。fetch: url の無い `trigger`。notify: 許可の無い `notify()` | 直した: `[wcs/command-not-ready]`、要素ごとに 1 回 |
| 無言の間違い | `<wcs-storage>` が保存する下書きに入れた録画クリップ（`{}` で保存され、15 バイトの「動画」として送られた）、聞き取り中の読み上げ（echo ループ）、`keep-alive` なしで録画中にタブを隠す | 直した: `[wcs/storage-unserializable]`・`[wcs/speech-echo]`・`[wcs/camera-keep-alive-missing]` |
| lint の穴 | モジュールの定数を `map` する getter（`PERMS.map(…)`）の行が `wcs/binding-path-missing` の偽陽性になっていた。値として束ねた `streamReady:` に何も言わなかった | 直した: 行はコールバックのリテラルから読む。`wcs/handle-bound-as-value` |
| 文書の穴 | `mimeType` を双方向に束ねると state の初期値が要求に書かれる。`errorInfo` は今の許可ではなく最後の試み。アップロードは `files` を使い切る（fetch の `body` と同じ）。拒まれた 413 は `progress` を 100 に残す。1 つのウィンドウの下書きには `type="session"`。`leaveConfirm` は再読み込みとルートの移動を一緒に扱う。`devices` の形。network の README の「5 つ」の出力（6 つ）。通知の `data` の包み | 直した |
| 残り | `for:` の 1 行の `<wcs-upload>` に命じる（`abort`）には DOM のコードが要る（7GUIs の発見）。ページの可視性を出す要素が無い（新しい I/O のパッケージは 4.x の予定に無い）。`<wcs-camera>` の静止画が無い。切断が無効にした `objectURL` は知らせない（そのイベントは `recorded`） | 記録 |

上の 3 つの設計の問いは、2026-10-19 に著者が推奨どおりに決めた（[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.3）。2026-10-20 に `examples/` へ置き、4.5.0 で要らなくなった回避策を外した（[examples/state-field-report/README.md](../examples/state-field-report/README.md)）。spec は専用の Playwright の project（`chromium-media`: `channel: "chromium"` と `--use-fake-device-for-media-stream`。既定のヘッドレスシェルには `getUserMedia` が無い）で動く。

### state-field-report の examples/ への取り込み（2026-10-20）

4.5.0 の後、アプリを `examples/state-field-report/` へ移し、4.5.0 で要らなくなった回避策を外した。ルートの移動の後にカメラの状態を戻す `$watch`（F9）、自前の `document.permissionsPolicy` / `isSecureContext` の判定（F14）、強制した `mime-type`（F2）、`::part(video)` の CSS（F13）。意図を確かめる e2e（15 件）は、専用の Playwright の project `chromium-media` で走る: 偽のカメラとマイクを持つフル版の Chromium で、このファイルは 1 つの worker。多くのブラウザで同時に偽のカメラを符号化すると、ヘッダだけのクリップになったため。取り込みで、もう 1 つ見つかった:

| 種類 | 発見 | 結果 |
|---|---|---|
| 設計の問い | デバイスを使えないページは、接続の時点でそれを知る（`permission: "unsupported"`）が、理由（ポリシー、`<iframe>` の `allow`、安全なコンテキスト）は `start()` / `getCurrentPosition()` / `listen.start()` を拒まれた後の `error` / `errorInfo` にしか届かない。`unsupported` でボタンを押せなくする — 自然な作り — ページは、理由を一度も出せない | 未決: `unsupported` と一緒に理由を出すか、試みたときに届くと README に書く（アプリの README の「Known limits」） |

### fw-inventory（2026-10-20）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) の下で 3 本目のアプリで、§3.2 が挙げる継ぎ目、フレームワークの中の `wcs-*` を越える。店の在庫の道具。React 19 の管理画面には、検索・ページ送り・並べ替えのある商品の一覧（`<wcs-fetch>`）、在庫の生の値（`<wcs-sse>`）、`<wcs-storage>` に保つフィルタ、react-router、写真のアップロード（`<wcs-upload>`、ファイルごとに 1 つ）、`<wcs-broadcast>` で分け合う取り置きの一覧がある。Vue 3 の倉庫のパネルは、CSV を `<wcs-worker>` で読み、`<wcs-fetch>` で送る。I/O ノードは `@wc-bindable/react` / `vue` 0.10.0 から動かす: `@wcstack/state` も `data-wcs` も無い。初めての著者は公開の文書と公開された 4.5.0 を使い、StrictMode の Vite 開発サーバーと本番のビルドで、タグを遅れて・CDN から・autoloader でも読み込んだ。引っかかりを 14 件記録した。わざと犯した 19 の間違いのうち、12 はクライアントの何も知らせず、lint はどれも知らせなかった。文書と例のとおりに書くと 5 つの生活の出来事が失敗し、6 つは回避策でだけ通り、1 つの確認は今も失敗する（React の状態からの `trigger` での再読み込み）。

主張はどれも、分類する前に、公開された 4.5.0 を使って Chromium で再現した。1 つは 2 度目で再現した: リアクティブな配列の `toRaw()` は問題なく複製でき、行がプロキシになると — `filter` やスプレッドの後のように — post が失敗する。

| 種類 | 発見 | 結果 |
|---|---|---|
| 設計の問い | storage: React と Vue は `key` を自分のものとして取るので、README 自身の React と Vue の例（`<wcs-storage key="app-settings">`）は key の無い要素になった — 何も読み込まず、何も保存せず、`error` だけが跡 | 決めた: `storage-key`（`storageKey`）は `key` の別名。key の無い読み込み・保存・削除は `[wcs/command-not-ready]` で警告する |
| 設計の問い | upload: React 19 は props を書いた順に、要素を文書に入れる前に当てるので、`<wcs-upload files={files} url="…">` は何も送らなかった（警告は `data-wcs` の言葉で出ていた） | 決めた: url より先に来たファイルは、url が来たときに送る |
| 設計の問い | 統合の手引きの遅い読み込み `import("@wcstack/sse/auto")` が `TS7016` だった（`/auto` に型が無い）。タグの JSX 宣言も無い | 決めた: 今はどの `/auto` にも `dist/auto.d.ts`。JSX 宣言は記録し、手引きが手書きのものを示す |
| 無言の間違い | worker / broadcast: structured clone で写せない post は失われ、`error` だけが跡だった — Vue のリアクティブな一覧で、手引きの `toRaw()` の後でも | 直した: `[wcs/post-uncloneable]`。手引きとルートの README は深い素の写しと書く |
| 無言の間違い | 属性として書かれたオブジェクトの入力 — 定義が読み込まれる前の React 19 の prop（`files="[object File]"`）、Vue の `:body.attr` — は要素に何も渡さなかった | 直した: `[wcs/input-as-attribute]`。どの I/O ノードも走らせる共有のプロパティの取り込み直しの中で |
| 実行時の欠陥 | fetch: `<wcs-fetch-header>` / `<wcs-fetch-body>` のクラスが無く、autoloader の包みはそれを定義できず、要求はヘッダーなしで出ていた | 直した: `WcsFetchHeader` / `WcsFetchBody` を出し、`[wcs/fetch-helper-undefined]`。autoloader の README が `/auto` を読み込む包みを示す |
| lint の穴 | `wcs-validate` は `.vue` / `.tsx` のファイルにも、`<div id="root">` だけのページにも "0 error(s)" と言い、skill の完了の門は何も検査せずに通っていた | 直した: 件数の後に `not read:` / `nothing to check:`。lint の README と手引きが、framework のアプリはその外だと書く |
| 文書の穴 | 手引きの `toRaw()`。「JSX ではコロンのイベントを書けない」（コンパイルは通り、`onWcs-…` は発火しない）。`event` の出力をアダプターの values で読むと出来事を落とす — `websocket-chat` の React の例がそうだった（続けて来た 5 件のうち 2 件）。フレームワークの状態からの `trigger` は 1 回しか走らない。props の順。その場で変えたオブジェクトの入力。`key` による付け直しは接続し直す。外した prop はストリームを閉じない。React から更新の輪なしに `<wcs-storage>` へ保存する。Vite の optimize-deps の再読み込みと、死んだ SSE の応答を開いたままにする proxy | 直した: [framework-adapter-integration.ja.md](./framework-adapter-integration.ja.md) §2〜§10、storage の README、例 |
| アダプター | `@wc-bindable/react` / `vue`: `values` は最後の値を持つので、続けて来たものや繰り返した値は 1 つの出来事になる。コールバックの ref の横に要素が無く、README は入力にも命令にも触れない。npm の README がパッケージの外のファイルへリンクする | [wc-bindable-protocol#42](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/42) として提案した（[spec-proposal-adapter-occurrences.md](./spec-proposal-adapter-occurrences.md)） |
| 残り | 復元だけする `<wcs-storage>` は、key が無くても今も何も言わない: key の無いまま接続した要素は、state が `key:` の束縛を当てる前の姿でもある。タグの JSX 宣言。死んだ SSE の応答にページが気づけるハートビート | 記録した |

上の 3 つの設計の問いは、2026-10-20 に著者が推奨どおりに決めた（[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.4）。

直した結果は、直したソースからビルドしたパッケージで、著者のアプリ（React 19.3、Vue 3.5）で確かめた: `files={files} url=…` は送られる（201）。遅れた `files` の prop と `:body.attr` は `[wcs/input-as-attribute]` で警告する。Vue の post は `[wcs/post-uncloneable]` で警告する。`storage-key` は React でも Vue でも復元する。storage の README の React の作法は、復元し、保存し、再読み込みの後も保ち、2 回の変更で描画は 4 回。key の無い保存は警告する。ビルドし直した `websocket-chat` の React の例は、まとめて送った 5 件のメッセージを 5 件とも記録する（以前は 5 件のうち 2 件）。確かめる中で、もう 1 つ見つかった:

| 種類 | 発見 | 結果 |
|---|---|---|
| 文書の穴 | storage・fetch・websocket の README の Vue の例 — と `@wc-bindable/vue` 自身のもの — は `:ref="ref"` で束ねていた。`<script setup>` ではテンプレートが ref を剥がすので、`:ref` には `null` が渡る: アダプターは束縛せず、`values` は何も言わずに空のままだった（著者自身のコードは `ref="名前"` だった） | 3 つの README（静的な `ref="…"`）と手引きを直した。[wc-bindable-protocol#42](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/42)（§3）に入れた |
