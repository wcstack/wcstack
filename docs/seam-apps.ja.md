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
| `fw-inventory` — 店の在庫の道具: React 19 の管理画面と Vue 3 の倉庫のパネル。`@wcstack/state` は使わない | I/O ノード × `@wc-bindable/react` / `vue`、React 19 の props × 要素の入力、フレームワークのリアクティビティ × structured clone、`key` × 要素、遅れた定義（autoloader・CDN・動的 import）× アダプター、Vite の開発サーバー × SSE | 続けて届くイベント、開発の proxy の背後でのサーバーの再起動、保存したフィルタでの再読み込み、片方が React でもう片方が Vue の 2 つのタブ、深いリンクと素早い移動、アップロードの取り消し・再送・拒否、最初の描画より後の定義、StrictMode、HMR | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-21）。発見は下 |
| `prod-booking` — 本番に出す会議室の予約アプリ: サブパスの下、`integrity` 付きの版の固定、分割エントリ、厳しい CSP と Trusted Types、`immutable` のキャッシュでの自前配信、Vite のビルド、Service Worker | 配信 × すべてのパッケージ: `integrity` × 分割の chunk、`installFeatures` × エンジンの 2 つのコピー、CSP × import map / インラインの state / ガード、Trusted Types × 部品、バンドラ × インラインのスクリプト、`<wcs-router>` × 読み直し、`<wcs-autoloader>` × 後で定義されるタグ、開いたままのタブ × 次の版のファイル | 各プロファイルを Chromium・Firefox・WebKit で; タブを開いたままの配備（v1 4.3.0 → v2 4.6.2）; 2 つの版の 2 つのタブ; 1 つのファイルの失敗（404・502・別の版のダイジェスト）; 本番でのエラー; オフラインと更新 | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-25）。発見は下 |
| `shift-desk` — サポート窓口のオペレーター画面。シフトの間、夜通し開いたまま: キュー（fetch の初期データと SSE の差分）、チャット（WS）、SLA の残り、日付で区切る集計、壁の画面（wakelock と raf）、在席（idle）、オフラインの送信待ち、タブの間の共有（broadcast と storage） | 時間 × すべての I/O ノード: タイマー × 隠れたタブとスリープ、SSE / WS × 閉じられずに死んだ接続、ルートの I/O ノード × 遷移ごとの入れ直し、`<wcs-head>` × 数百回の遷移、`<wcs-ws>` × back/forward cache、警告の「1 回」× 一日中生きる要素、ストレージ × 複製したタブ | 12 時間の早送りのシフトと真夜中、夏時間、1 時間のスリープ、1 時間隠れたタブ、凍結、bfcache からの復帰、破棄、複製、ネットワークの断続、トークンの期限、10,000 件のイベントと 500 件のチケット、数時間あけた同じエラー、実時間の 22 分 | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-26）。発見は下 |
| `family-ledger` — 2 人で使う家計簿。作者を変えた回: AI の作成スキルだけを入口にする、別のモデルの初めての作者 | 作者 × スキル: スキルが言うことと言わないこと × 1 巡目の継ぎ目（ガード × storage、クエリ ⇄ state ⇄ fetch、422 と 409、SSE × 一覧、アップロード、通貨と日付、離脱の確認、`@wcstack/testing`） | 再読み込み、ログアウト中のディープリンク、2 回目、2 つのブラウザ、編集の衝突、編集中のトークン切れ、遅い・失敗するサーバー、オフライン、サーバーの再起動、同じブラウザの 2 タブ、タイムゾーンの境目、Firefox と WebKit | e2e の spec と一緒に [`examples/`](../examples/README.ja.md#継ぎ目アプリ) に置いた（2026-10-28）。発見は下 |
| `city-library` — 日本語・英語・アラビア語（右から左）の市立図書館の利用者サイト: URL で探す蔵書目録、予約、ライブで知らせる予約の準備完了、どこからでも読む東京の図書館の開館時間 | router × 遷移の後のフォーカスと読み上げ、`<base>` の下のスキップリンク、`aria-current`。`<wcs-view-transition>` × `$watch` × フォーカス × ライブリージョン。`422` × `aria-invalid` × 最初の誤った欄。`<dialog>` × 委譲されたイベント。`<wcs-sse>` × ライブリージョン。`<html lang>` × 日付・金額のフィルタ × タイムゾーン。言語ごとの basename × `leaveConfirm`。`dir="rtl"` × 双方向の文 | キーボードだけ、スクリーンリーダーに聞こえるもの（アクセシビリティツリー、ライブリージョンの記録）、axe、reduced motion、強制カラー、200 % のズーム、3 つのロケール × 3 つのタイムゾーン、Chromium / Firefox / WebKit | 再現して分類し、修正の PR を出した（2026-10-29）。発見は下 |

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

### fw-inventory の examples/ への取り込み（2026-10-21）

直しをマージした後、アプリを `examples/fw-inventory/` へ移した。著者の実験のページと試験用の切り替えは外し、4.6 で要らなくなった回避策も外した: ref の中の `el.key = …`（`storage-key` を書く）、`files` より前の `url`（今は `<wcs-upload files={files} url={url}>`）。ストリーム・チャンネル・worker のメッセージは、手引きのとおり要素のイベントから取る。著者の一覧を丸ごと送る形で `values` が害の無かった所もそうした。Vite のアプリなので、`e2e.yml` が `WCS_LOCAL=1` でインストールとビルドをする。`WCS_LOCAL=1` は `@wcstack/*` の import を、CI が src から作り直した dist に向ける。spec（意図を確かめる 9 件）は、例自身の `server.js` を `TICK=0` で、5200 + ワーカーの番号のポートに立てる。取り込みで、もう 1 つ見つかった:

| 種類 | 発見 | 結果 |
|---|---|---|
| 無言の間違い | 著者のフィルタは、アダプターの `value` を React の状態に当て直して、他のタブに追随していた。ページ自身の保存が 1 描画遅れて戻り、その間の入力を巻き戻すので、"bolt" を速く打つと "bol" と "bolt" を交互に保存して当てることが止まらなかった — そのたびに要求が出て、エラーは無い（著者の速い入力の確認は開発サーバーで走って通った。本番のビルドでは止まらなかった） | アプリを直した: 他のタブの保存は `wcs-storage:value-changed` から取り、ページ自身の保存が出すイベントは飛ばす。storage の README に書き、目録に入れた（文書だけ: 返ってきた書き込みと編集は、要素から見分けられない） |

### prod-booking（2026-10-24）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) の下での 4 本目、その §3.2 が挙げる最後の継ぎ目 — 本番の形 — のためのアプリ。サブパス `/booking/` で配る会議室の予約アプリ（料金つきの部屋、その日の枠と予約のフォームがある部屋のページ、「自分の予約」、`<wcs-storage>` に残す設定、ガードの後ろの管理ページ、`<wcs-autoloader>` が読むアプリ自身の部品 2 つ）を、本番のアプリが通る配信の形に順に通した: `integrity` 付きの版の固定、`@wcstack/state` の分割エントリ（import map と `dist/split/auto.js`）、nonce とハッシュの厳しい CSP、Trusted Types、`immutable` のキャッシュでの公開ファイルの自前配信、Vite のビルド、Service Worker。そして**古い版を開いたままの新しい版の配備**（v1 は 4.3.0、v2 は 4.6.2）。初めての作者は公開文書と公開版だけを使い、20 のプロファイルを 2 つの版で作り、Chromium 149・Firefox 151・WebKit 26.5 で通した。引っかかりを 29 件記録し、わざと犯した間違いは 40 件。配信の間違い 20 件のうち lint が知らせたのは 3 件。

主張はすべて、分類の前に 3 つのブラウザで公開版に対して再現した。1 件は再現しなかった:「CSP が拒んだ import map にも autoloader が従う」— 作者のテストは nonce を外せていなかった。拒まれた import map では、autoloader の `import()` は解決に失敗する。いくつかは書かれたより広かった: autoloader の名前空間の外のカスタム要素が 1 つあると、ページの自動読み込みがすべて止まった（`wcs-*` に限らない）。`<wcs-head>` は遷移のたびに `<base>` だけでなく `<head>` の要素をすべて入れ直していた。v1 の core の中の v2 のアドオンは「黙って動いた」のではなく、`$watch` が一度も動かなかった。

| 種類 | 発見 | 結果 |
|---|---|---|
| ランタイムの欠陥 | router: ページが求める読み直し（`location.reload()`・`history.go(0)`・`navigation.reload()`）を同じ文書の中のルートの遷移として受けた — 「更新があります — 再読み込み」のボタンも、Service Worker の更新も、`<wcs-devtools>` の再読み込みも、どのブラウザでも効かなかった | 修正 |
| ランタイムの欠陥 | autoloader: どの `@components/` の名前空間にも属さないカスタム要素が 1 つ — 別のライブラリのタグ、後で定義される `<wcs-link>` / `<wcs-state>`（autoloader のスクリプトを先に置く、分割版の auto エントリ）— あると、`No matching namespace found` を投げて走査を止め、最初の走査なら監視も始めなかった: ページの部品は 1 つも読まれない。integrity の失敗も、エラーの収集にはこの reject としてしか届かなかった | 修正: そうした要素には手を出さない |
| ランタイムの欠陥 | router: `<wcs-head>` は遷移のたびに `<head>` の要素をすべて写しで入れ直した — スタイルシートを取り直し、WebKit は遷移ごとに `base-uri` の CSP 違反を報告した | 修正: 同じ要素は残す |
| ランタイムの欠陥 | router: module のスクリプトの無い `<wcs-guard-handler>` — HTML を処理するバンドラが取り去る — は「ルートは守られない」と言って開け、`guard` 属性があると逆に、来ないハンドラを待って何も描かなかった | 決定: 読み込めなかったハンドラと同じく閉じる — ルートへのナビゲーションはすべて guard のパスへ |
| ランタイムの欠陥 | state: `installFeatures` は別のエンジンのコピーのアドオン（`esm.run` を通した分割エントリ、2 つの版、タブが古い core を動かしている間にその場で置き換えた自前配信のディレクトリ）を受け入れた: アドオンは別のコピーの口を埋めた — `$watch` は黙って一度も動かず、入れたはずの `formats` のフィルタは「入っていない」と報告された | 決定: 拒む。`[wcs/feature-foreign]`（次の行と合わせて core に 61 B） |
| 設計の問い | state のエラーは `console.error` にだけ出た: `window.onerror` で作ったエラーの収集には何も届かず、ページの初期化の失敗さえ届かなかった | 決定: エンジンが報告するエラーはすべて `reportError()` を通す。エンジンの文面と、`cause` に元のエラー。無い環境では `console.error` |
| 設計の問い | `date` / `time` / `datetime` / `ymd` / `hms` は `undefined` / `null` で投げた。README の `coalesce` は無い日付の代わりにならない | 決定: 値が無いときは素通し（書式の族と同じ） |
| 設計の問い | 分割のファイルには公開されたダイジェストが無く（`sri.json` は `auto.min.js` だけ）、別のビルドの import map の `integrity` の一覧は、何も言わずに何も守らない | 決定: `sri.json` とリリースノートが `dist/split` のすべてのファイルと import map のブロックを載せる |
| lint の穴 | lint が読めない `<wcs-state src>` — / から始まるパス（csp.md が `<base>` の下で勧める形）・URL・無いファイル — のページは、`0 error(s)` で検査されずに通った。`examples/router-i18n` がそうだった | 修正: `wcs/state-src-unread`（info）。lint の限界を属性の上で言う |
| lint の穴 | `(this.items ?? []).map(() => ({ … }))` と、`null` を種にしたリストの行が `wcs/binding-path-missing` の偽陽性になった | 修正 |
| 文書の穴 | Firefox は import map の `integrity`（138）と外部スクリプトの CSP ハッシュ（115）を強制し、Safari も同じ、Trusted Types は Safari 26 と Firefox にある — CSP と SRI の手引きは Chromium だけと書いていた。部品自身の `shadowRoot.innerHTML`（README の形）は Trusted Types の sink。自前配信（URL に版、古いものを残す）。バンドラはインラインの state とガードのスクリプトを取り去る。1 つのルートだけが使うアドオンをバンドルで。保存した値は前後の配備と共有される。`basename` は相対 URL の解決先を変えない。fetch の種 `[]` は要素の `null` で置き換わる | 修正 |
| 未決 | autoloader は一度失敗した部品を読み直さない（配備中の 502 の窓）。1 つのパッケージの 2 つの版がページにあっても何も言わない（4.x のプロトコルは互換）。空の `<wcs-state>` は `setInitialState()` を黙って待つ。`bootstrapState()` の後の `installFeatures` はタイミングで動く。配信の間違いの多くに lint は何も言わない（アドオンの欠けは実行時に知らせる）。4.5 へ戻すと `storage-key` は何も保存しない | 記録 |

上の設計の問いは、2026-10-25 に著者が推奨どおりに決めた（[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.5）。

### prod-booking の examples/ への取り込み（2026-10-25）

4.7.0 の後、アプリを `examples/prod-booking/` へ移し、2 つの版を並べた: v1 は公開版の 4.6.2（例の `package.json` の npm の別名なので、CI は CDN を要らない）、v2 は `WCS_LOCAL=1` でこのツリーの `packages/*/dist`。v2 には 4.7.0 で要らなくなった回避策が 1 つも無い — `location.reload()` の前に router を外す、遅れて置く `<wcs-autoloader>`、autoloader を最後に置く、日付の束縛を囲む `if:`、`connectedCallbackPromise` で拾う報告（素の `error` のリスナーで足りる）— そして別のライブラリのタグを部品の前に置いた。v1 は 3 つを `4.6.2:` の印付きで残し、`diff -r v1 v2` でリリースが変えたものが見える。プロファイルは 6 つ（integrity 付きの固定、分割のすべてのファイルに integrity を持つ import map、分割版の auto エントリ、nonce と Trusted Types の厳しい CSP、版付きの URL での自前配信、その場で置き換える間違い）。Service Worker・ハッシュだけの CSP・バンドル・Vite のビルドは記録に残した。spec（11 件）は Chromium で、そのうち `@browsers` の 2 件 — import map の integrity と Trusted Types — は新しい `firefox` の project でも走る。取り込みでもう 1 つ見つかった:

| 種類 | 発見 | 結果 |
|---|---|---|
| 設計の問い | その場で置き換える配備が拒まれるのは、開いたままのタブが 4.7 以降のときだけ: 4.6 の core には検査が無いので、4.6.2 の v1 のタブは v2 のアドオンと chunk を何も言わずに読む（spec は逆向き — v2 を開いて v1 のファイルを置く — を確かめる） | 記録: 答えは版付きの URL（docs/sri.ja.md §7）。古い core に後から教えることはできない（アプリの README の「既知の限界」） |

### shift-desk（2026-10-25）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §3.2 の 2 巡目の 1 本目。1 巡目の生活の出来事はどれも数秒から数分だったので、時間を長い側へ伸ばした: シフトの間、夜通し開いたままのサポート窓口のオペレーター画面（14 パッケージ）。初めての作者は公開文書・公開版 4.7.0・スキル v4.7.0 だけを使い、時間は Playwright の時計（ページのタイマーだけを動かす）と CDP で模擬し、実時間でも 22 分走らせた。引っかかりは 25 件。わざとした間違い 16 件のうち 10 件は何も知らせず、lint が知らせたのは 1 件。公開版の lint はアプリに 10 件の警告を出し、すべて誤報だった。

主張は分類の前に、リポジトリの 4.7.0 の dist（公開版と同じ）を使って Chromium で再現した。3 件は書かれたより狭かった: ルートの `<wcs-sse>` の古い url への要求はページを出なかった（同じタスクで閉じる）。`<wcs-storage>` は前のキーを一瞬読み直しただけで、保存は壊れなかった。SSE だけのページは back/forward cache から復元され、ストリームも続いた。getter の `@returns` は、早い `return` のせいではなく、lint がそもそも読んでいなかった。1 件は書かれたより広かった: 存在しない `debounce` フィルタは notification の README だけでなく、speech の README と I/O ノードの手引きにもあった。再現の途中で、接続時に入力で決まる仕事をその場でする I/O ノードがほかに 12 あることも洗い出した。

| 種類 | 発見 | 結果 |
|---|---|---|
| 実行時の欠陥 | router: `<wcs-head>` の中の束ねた子が、遷移ごとにノードを残した（`<title>` 2 つ、`<meta>` 1 つ）。遷移のたびに新しいクローンを binder に渡し、binder には束縛を解く口が無い — binder の設計書 §6-2 が未解決として残していた論点 | 直した（#537）: 束ねた子のクローンを 1 つ持ち、入れ直す。core は 0 B |
| 実行時の欠陥 | パラメータだけの遷移で、ルートの `<wcs-ws>` がまず前のチケットのチャットへつないで閉じた。router は params を先に出すが、state が入力を書くのはマイクロタスクで、`connectedCallback` でその場で動くノードは前の入力を使う。同じ形が 17 パッケージにあった（前のカメラのデバイス、前の権限、state が書く直前の `manual` に逆らう開始） | 決めた: ファミリーの規則（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §23） — 接続時の判断は 1 つのマイクロタスクで、そのときの入力で。明示のコマンドは判断を引き取る（#538） |
| 設計の問い | 閉じられずに死んだ接続（スリープ・NAT・proxy）に `<wcs-sse>` も `<wcs-ws>` も気づかず、`connected: true` のまま。実時間の走行でキューが 80 件遅れて止まり、ヘッダは "Live" | 決めた: 任意の `stale-after`（#540） |
| 設計の問い | 開いた `<wcs-ws>` はページを back/forward cache から外した（Chromium の理由 `websocket`）。ページが自分で閉じると、閉じた知らせは復元の後に届いた | 決めた: `<wcs-ws>` が `pagehide` で閉じ、`pageshow` でつなぎ直す（#540） |
| 設計の問い | 「要素ごとに 1 回」の `[wcs/command-not-ready]` は、一日中同じルートの要素ではページの寿命で 1 回だった | 決めた: 不調 1 回につき 1 回（#542） |
| 無言の間違い | 許可なしの `<wcs-idle>` の `start()` が何も言わなかった | 直した（#542）: 4.5 の `notify()` と同じく `[wcs/command-not-ready]` |
| lint の欠陥 | getter の `@returns` を読まず（`{ ...r, ...live }`・早い return の後の `[x].map(…)` の行が誤報）、既定引数が呼び出しのメソッド（`id = crypto.randomUUID()`）を見失った。JSDoc の交差型も読まなかった | 直した（#539）。アプリの警告は 10 → 0。リポジトリの examples/prod-booking の誤報 5 件も消えた |
| 文書の穴 | 存在しない `debounce` フィルタ（notification の README の例はページ全体の初期化を落とした、speech、I/O ノードの手引き）。idle の README の例は読み込みのたびに "Away"（出力の種は束縛に上書きされる） | 直した（#541） |
| 文書の穴 | sse の README の追いつきの作法は、イベントごとにストリームを開き直した（30 秒で 15 本）。`readyState` は最初の接続の前から `CLOSED` で、「CLOSED なら開き直す」は読み込みのたびに走った。URL のトークンの 401 は 502 と区別できない | 直した（#540） |
| 文書の穴 | 開いたままのページに何が要るかを、どの文書も書いていなかった（bfcache・凍結・破棄・スリープ・間引き）。`$connectedCallback` の「再確立」は復帰のことではない。`<wcs-timer>` の刻みは時間ではない。`<wcs-raf>` の `dt` は活動していた時間。記録に属する下書きのキー | 直した（#541）: [long-lived-pages.ja.md](./long-lived-pages.ja.md) |
| 設計の問い | ページの可視性を出す要素が無い（state-field-report に続いて 2 本目の要望） | 決めた: 作法を文書に書いて記録する。3 本目の要望で見直す |
| 残り | `<wcs-camera>` は、取得の途中の制約の変化を見ない（`active` の間だけ見る）。`<wcs-wakelock>` の `active` はその場で動くので、入れ直しの窓で `manual` より先に `active` が書かれると取得する。センサーは切断で止まり、入れ直しでは始め直さない。かたまり（10,000 件のイベントは 1 件ずつ描く）、複数の `<wcs-fetch>` のトークンの更新は手引きの作法のまま | 記録 |
| 私たちのものではない | ヘッドレスのページは隠れず、CDP の凍結は効かず、破棄はできない。Playwright の Chromium は bfcache を切って起動する。`runFor` はすべてのアニメーションフレームを走らせる | — |

上の設計の問いは、2026-10-25 に著者が推奨どおりに決めた（[v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.7）。誤りの目録に 11 項目を足した（無言で残るもの — 刻みで時間を測る、伸び続ける一覧、モジュールのトップレベルで読むセッション、`$connectedCallback` や `online` だけでの取り直し、復帰の後の通知の洪水、`dt` で壁の時計、記録の下書きの固定のキー、`stale-after` の無い長い接続、`readyState` で「諦めた」を判断、イベントごとに変わる SSE の url）。

### shift-desk の examples/ への取り込み（2026-10-26）

4.8.0 の後、アプリを `examples/shift-desk/` へ移し、4.8.0 で要らなくなった回避策を外した。閉じられずに途絶えた接続の見張りと自前のチャットの ping（今は `<wcs-sse>` と `<wcs-ws>` の `stale-after`。サーバーの 20 秒ごとのチケットとチャットの ping は、要素が聞くものとして残した）、`pagehide` でチャットを閉じて `pageshow` で開き直すこと（要素が両方する）、`document.title` で設定していた静的なチケットのタイトル（`<wcs-head>` の中の束縛した `<title>`）、守りを付けた `readyState === 2`（`errorInfo.recoverable === false`）、初期値を置いた idle の `active`（`userState`）。起き上がりの処理、まとめての適用、上限は [long-lived-pages.ja.md](./long-lived-pages.ja.md) のとおり残した。公開版の lint はページに 0 件のエラーと 0 件の警告。spec（12 件、意図を確かめる）は例の `server.js` を `WCS_LOCAL=1` で 5700 + 10 × worker の番号のポートに立てる。bfcache の試験は、headless shell が決して復元しないので、フル版の Chromium を自分で起動する（`channel: "chromium"`、`--disable-back-forward-cache` なし）。DOM ノードの試験を公開版の 4.7.0 に当てると、キューと 2 つのチケットの 100 往復で +400 ノード。このツリーでは 0。取り込みで、もう 2 つ見つかった:

| 種類 | 発見 | 結果 |
|---|---|---|
| 文書の穴 | `docs/` の下の未リリースの印は、リリースで確かめられも剥がされもしない: `scripts/unreleased-marks.mjs` は README しか読まないので、4.8.0 の後も [long-lived-pages.ja.md](./long-lived-pages.ja.md)（と英語版）は「4.8（未リリース）」を 4 か所、4.6.0 の後も [framework-adapter-integration.ja.md](./framework-adapter-integration.ja.md) は「4.6（未リリース）」を 6 か所（英語版は 5 か所）に残す | 記録: 手で外すか、スクリプトに `docs/` も読ませる |
| 文書の穴 | ガイドの起き上がりの処理は「まずトークンを更新する」と言うが、スリープの間に期限の来たタイマー（毎分の取得）は、空白に気づく刻みと同じ瞬間に、待っている更新が返る前に走る: 期限の切れたトークンで出て 401 を受ける。ガイドの「トークン」は 401 で失敗したものをやり直すと書いて覆っているが、処理のコメントはそう言わず、spec の最初の版は 401 が無いことを期待した | 記録（アプリの README の「Known limits」） |

### family-ledger（2026-10-27）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §3.2 の 2 巡目の 2 本目。1 本目は継ぎ目（時間）を変えたので、この回は作者だけを変えた。継ぎ目は 1 巡目で通ったもの — ガード × storage、クエリ ⇄ state ⇄ fetch、フォームの 422 と 409、SSE で届く相手の変更、アップロード、通貨と日付、離脱の確認、`@wcstack/testing` — にそろえ、作者は AI の作成スキル（v4.8.0）だけを入口にする、別のモデルの初めての作者にした。題材は 2 人で使う家計簿。依頼は利用者の書き方で、使うパッケージも lint も指定していない。作者はリポジトリと関係のないディレクトリで、入れ子の `claude -p` として動かした — サブエージェントにはリポジトリのパスと CLAUDE.md が見えてしまう。作者に見えたのは、スキルと公開版 4.8.0 だけだった。

**作者の軸。** 作者は lint を自分から回した。始めて 6 分で回し、警告まで読み、22 件の誤報をすべて回避して 0 件にした（2026-07 に計ったスキルなしの初見の AI は 9 回中 0 回）。スキルの外に出たのは `npm view <pkg> readme` と型宣言だけで、Web も GitHub も読まなかった。自分の確認 105 件を Chromium で通し、Firefox と WebKit でも機能の確認はすべて通った。わざとした間違い 26 件のうち、何も知らせなかったのが 6 件、スキルだけが知らせたのが 3 件、lint だけが 7 件（うち 4 件は warning で、スキルの完成の関門 `--errors-only` を通る）。残った穴は、スキルが言わないところに集まった: トークンの要るアップロード、日付だけの文字列とタイムゾーン、`leaveConfirm` の型、リクエストの完了の知り方、別のタブのログアウト。

主張は分類の前に、公開版 4.8.0 を使って Chromium と Firefox で再現した。1 件は書かれたより重かった: ルートの `<wcs-state>` が 2 つあると、文書で後ろの `json=` が先にルートを取り、文書で先にあるページの本物の state が拒まれた（作者は後ろの方が拒まれたと推測した）。1 件は私たちのものではなかった: Firefox の「接続が中断された」は、素の `EventSource` でも、開いたまま全体の遷移をすれば出る。

| 種類 | 発見 | 結果 |
|---|---|---|
| 実行時の欠陥 | router: `leaveConfirm: dirty`（真偽値）が文言 `"false"` / `"true"` になり、遷移のたびに `confirm("false")` が出た（無言） | 直した（#548）。決めた: `true` は既定の文言で聞き、`false` は聞かない |
| 実行時の欠陥 | state: ルートの `<wcs-state>` が 2 つあると、状態が先にそろった方がルートを取る — 文書で後ろの `json=` が、ページの `src=` やインラインの state より先に。ページは違う state でバインドされ、作者の版では別の原因（`token-undeclared`）の文が出た | 決めた: 診断の後付けが両方を名指す（#549）。どちらが勝つかは変えない（core 0 B） |
| 道具の欠陥 | `@wcstack/testing` の `mount()` は、ソースの無い `<wcs-state>` で何も言わずに時間切れになり、`src` の state を読めなかった（server が 4.3 から持つ `resolveModule` の口が無かった） | 直した（#551） |
| 設計の問い | `<wcs-upload>` からトークンを送る口が無かった（shell は core に `method` と `fieldName` だけを渡していた）。作者は `UploadCore` を CDN から import した | 決めた: `<wcs-upload-header>`（#552） |
| 設計の問い | 502 / 401 で諦めた SSE のストリームを開き直すタイマーを、state-collab-board・shift-desk・family-ledger の 3 本が同じように自前で書いた | 決めた: `<wcs-sse>` の `auto-reconnect` / `reconnect-interval` / `max-reconnects`（ws と同じ名前、opt-in。#553） |
| lint の欠陥 | メソッドで代入した行（`this.rows = list.map((c) => ({ … }))`）と、`{}` で始めたエラーの表を読まず、誤報になった。getter が束縛の書き込み先を入れ子で読む（`this.monthFetch.value`）と、ページは「読み込み中…」のまま止まるのに warning だった | 直した（#554）: 代入を読む。束縛が書くパスなら error（4.3「確実なものは error」） |
| 診断の穴 | `$on` の `this` は番号の無い TypeError だけだった。`date` フィルタの文面「a getter returning new Date(…)」に従うと、`new Date("2026-10-01")` は UTC の真夜中で、グリニッジより西では 1 日早かった | 直した（#549）: state の宣言のときに `[wcs/on-handler-this]`。日付だけの文字列には `new Date(y, m - 1, d)` と言う |
| 文書の穴 | fetch: `value` は新しい url の間も空の url の後も前の応答のまま（作者の編集フォームは前の記録で埋まった）。`value` と `status` は同じ値では発火しない（2 回目の `204` の削除が終わらなかった） | 直した（#550） |
| スキルの穴 | スキルの「`<base>` の下では `src="/state.js"`」に従うと lint がその state を読まない（`<base href="/">` なら相対の `src` で同じ URL）。別のタブのログアウト（router-auth の形）、upload のヘッダ、諦めた SSE のストリーム、日付だけの文字列、`leaveConfirm` の型、完了の知り方、完成の関門が通す warning — どれもスキルが言わない | スキルの次の版で（4.9.0 と一緒に） |
| 私たちのものではない | Firefox は、開いた `EventSource` のまま全体の遷移をすると "The connection … was interrupted while the page was loading." を出す（`beforeunload` で閉じれば出ない） | sse の README に 1 行（#553） |

4 つの設計の問いは、2026-10-27 に著者が推奨どおりに決めた（[v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.8）。誤りの目録に 6 項目を足した: 無言で残る 5 つ（`status` で完了を知る、`value` を今の項目として読む、日付だけの文字列から `Date` を作る、セッションを state にだけ置く、別のタブで変わったセッション）と、設計で消した真偽値の `leaveConfirm`。

### family-ledger の examples/ への取り込み（2026-10-28）

4.9.0 の後、アプリを `examples/family-ledger/`（ページは `public/`、Node の組み込みだけのサーバー、作者の Vitest の試験）へ移し、4.9.0 で要らなくなった回避策を外した。領収書にトークンを付けるために CDN から import した `UploadCore`（今は `<wcs-upload manual>` と `<wcs-upload-header>`）、ブラウザが諦めたストリームを開き直す 3 秒のタイマー（`auto-reconnect`。つながり直したときの追いつきは残した）、`loading` が `true` → `false` になるのを見て知った削除（応答のイベント、`eventToken.value` と `$on`）、`budgetRows` の JSDoc（`map` で代入した行は読まれる）、`lib.js` をインラインの state に貼り付けた試験（本物の `state.js` に `mount(html, { resolveModule })`）。コメントを付けて残したもの: 取得したカテゴリの JSDoc と、もう一度写した `summaries`（lint は応答の形を知らず、import した補助関数を追わない）、すべてのキーを置いた `fieldErrors`（下）。4.9.0 の lint はページに 0 件のエラー、0 件の警告、0 件の情報。spec（14 件、意図を確かめる）は例の `server.js` を `WCS_LOCAL=1` で 6100 + 10 × worker の番号のポートに立てる。サーバーはストリームの要求ごとにその答えを、アップロードごとにトークンの来かたを記録するので、spec は領収書が `Authorization` ヘッダーで上がったこと、再起動のあと 502 に続いて要素が開いた 200 が来たことを確かめる。実行時の 3 つの置き換えは、それぞれ無ければ落ちる試験を持つ: `auto-reconnect` が無ければ再起動のあとストリームは閉じたまま、`<wcs-upload-header>` が無ければアップロードは 401 でログインを求められ、`status` で知る削除は 2 回目の削除がフォームに残る。取り込みで、もう 2 つ見つかった:

| 種類 | 発見 | 結果 |
|---|---|---|
| 実行時の欠陥 | state の診断: 4.9 の lint は `{}` を種にしてオブジェクトリテラルを代入するキー（`fieldErrors: {}` に `this.fieldErrors = { date: "…" }`）を受け入れるが、診断の後付けは確かめるときの値を見る: `fieldErrors.*` の束縛ごとに `[wcs/binding-path-missing]` を警告し（ログインと月のページを読み込むたびに 4 行）、「Updates to this path will be silently dropped」と言う — 落ちない: オブジェクトを置き換えれば束縛は更新され、422 の文は出る。lint の新しい読み方どおりに書いたページはコンソールが誤報で埋まるので、アプリは作者のすべてのキーを置いた種を残した | 未決: 後付けと lint が食い違う（アプリの state.js に種を残す理由を書いた） |
| 無言の間違い | 作者の CSS は `wcs-link.btn a` を整えていた: `<wcs-link>` は自分を隠して `<a>` を自分の後ろに置き、`class` はホストに残る（router の README は両方を書いている）ので、「＋ 追加」と「予算」はただのリンクだった — 何も言わない | アプリで直した（`wcs-link.btn + a`）。記録: `wcs-link` の下の子孫セレクタは lint が見られる |

アプリの README は、しないことを書く（「Known limits」）: 別のタブのログアウトは、このタブが移動するまで月を画面に残す（router-auth が `$watch` 1 つで扱う形）。トークンの切れたストリームは 3 秒ごとに開き直されて毎回 401 になり、ページの次の要求が期限切れに気づくまで続く — sse の README のとおり、`auto-reconnect` は何も更新しない。Firefox は全体の遷移で「接続が中断された」の行を出す。

### city-library（2026-10-29）

[docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §3.2 の 2 巡目の 3 本目: アクセシビリティと言語。変えたのは継ぎ目なので、作者は 1 巡目の設定に戻した — 公開文書、スキル v4.9.0、公開版 4.9.0。題材は日本語・英語・アラビア語（右から左）の市立図書館の利用者サイト: 検索が URL にある蔵書目録、サーバーが検証するフォームでの予約、サイトのどこにいても知らされる予約の準備完了、どこからでも読む東京の図書館の開館時間、読み手の reduced motion と配色の設定。スクリーンリーダーは無かった: 作者はキーボードだけで流れを通ってフォーカスを記録し、アクセシビリティツリーを読み（`ariaSnapshot`）、ライブリージョンの文の変化を `MutationObserver` ですべて記録し、各言語と配色で axe をかけ、reduced motion・強制カラー・200 % のズーム・3 つのロケールと 3 つのタイムゾーンを模して、Chromium・Firefox・WebKit で確かめた。引っかかりは 28 件。わざとした間違い 20 件のうち 16 件は何も知らせず、wcstack の実行時が知らせたのは 0 件、lint は 1 件（warning）、axe は 1 件。公開版の lint はアプリに 108 件の警告を出し、すべて誤報だった。

主張は分類の前に、4.9.0 の dist を使って Chromium と Firefox で再現した。1 件は書かれたより重く、この巡でいちばん重かった: `<wcs-view-transition>` を足すと、文書が教えるログインが壊れた — 最小のページでも、タグを足した `examples/router-auth` でも（タグありで 3 回中 0 回、なしで 3 回中 3 回ログインできた）。1 件は原因が書かれたものと違った: lint は辞書のボリュームの `src` を読んでいた。名前で書いたキー（省略形のプロパティ、import した定数）を飛ばしていた。ブリーフの一文が誤っていた: どの `ar-*` がアラビア・インド数字になるか。

| 種類 | 発見 | 結果 |
|---|---|---|
| 実行時の欠陥 | state × view-transition: 構造の変わるパスはトランジションの中で 1 フレーム遅れて適用されるのに、`$watch` はその場で走った — `$watch` から画面を移すログインが `<wcs-storage>` のセッションの保存より先に走り、`localStorage` を読むガードが読み手を戻した。`$watch` が欄を invalid にする前にフォーカスを動かした | 決めた: `$watch` はトランジションが適用するバインディングを待つ（#561）。core +39 B |
| 設計の問い | router: `<base href="/">` — どの SPA も持つ — の下で `href="#main"`（スキップリンク）がホームのルートへ移った | 決めた: 素のフラグメントへのリンクは router がページの中に留める（#563） |
| 設計の問い | router: クエリ付きの `<wcs-link>`（「次のページ」）が `aria-current="page"` を持った | 決めた: クエリ付きのリンクはそのクエリのときだけ current（#563） |
| 設計の問い | `date` / `time` / `datetime` は読み手のタイムゾーンで書き、ゾーンを受けなかった: 東京の木曜の開館がロサンゼルスからは水曜 17:00 になった | 決めた: 3 つ目の引数でタイムゾーン（#564）。4.9 まで `RangeError` だった `date(,long)` も動く |
| 診断の欠陥 | router の `searchParams` の下の `query.next` を「silently dropped」と報告した。空の `{}` の種の下のキーも（family-ledger の取り込みで見つけた） | 直した（#562、#560） |
| lint の欠陥 | 文書の i18n のページに 108 件の誤報: 名前で書いたキー、`<base>` を書く `<head>` のスクリプト、入れ子のコールバックの `return`、`$renderedCallback` の中の文字列の比較。ルートより下の base の下のルート絶対の `src` を読まなかった | 直した（#565）。`--root` を足した |
| lint の穴 | 文と一緒に挿入される状態のリージョンは決して読み上げられない | 新しい規則 `wcs/live-region-inserted`（#565）。リポジトリ自身の `family-ledger`・`router-auth`・`state-field-report` がその形だった — 直した。`role="alert"` は挿入で読み上げられるので外した |
| 文書の穴 | 遷移の後に聞かせる文がルートの中身にある（文と一緒に挿入される。ビュー遷移があると Chromium は件数を 10 回中 0 回、reduced motion では 10 回中 10 回読んだ）。開いた要素が消えた `<dialog>` の後のフォーカス。ガードのセッションの「stored as JSON」（文字列はそのまま保存される）。basename をまたぐリンクで選んだ言語を、離脱の確認の答えより先に保存した。行の中の `<wcs-link>` の束ねた `aria-*` はアンカーに届く。件数の読み上げ。クエリが URL にある検索欄。双方向の文。アラビア数字。Firefox にも view transition がある | 直した（#563、#561） |
| 私たちのものではない | Windows の Playwright の WebKit: このページのビュー遷移で描画が落ちた。Tab がリンクに止まらない（Safari の既定）。書きかけのフォームで別の言語へ移ると 2 回聞いた（ブラウザの確認が先）— どれも Safari では未確認。開いた `EventSource` があると `networkidle` が決まらない | 記録 |

4 つの設計の問いは、2026-10-29 に著者が推奨どおりに決めた（[v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.9）。2 巡目の止める目安には当たらない: この巡でいちばん重い実行時の欠陥と、新しい種類の発見 — スクリーンリーダーに何が聞こえるか — が出た。誤りの目録に 8 項目を足した（lint の新しい規則の項目も）。
