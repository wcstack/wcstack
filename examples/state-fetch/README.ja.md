# state + fetch demo

`@wcstack/state` と `@wcstack/fetch` の連携デモです。ユーザー一覧の取得・フィルタリング・詳細表示・新規作成（POST）を行います。

## 起動方法

各パッケージは CDN（[esm.run](https://esm.run)）から読み込むため、ローカルビルドは不要です。Node.js さえあれば動きます。

```bash
node examples/state-fetch/server.js
```

http://localhost:3000 でアクセスできます。

## 機能

- **ユーザー一覧**: `/api/users` からデータを取得しリスト表示
- **ロールフィルタ**: All / Admin / Editor / Viewer でフィルタリング
- **詳細表示**: ユーザーをクリックすると `/api/users/:id` から詳細を取得
- **新規作成**: フォームから POST でユーザーを作成、完了後にリストを自動リロード

## ポイント

- **1 fetch = 1 state スロット**: 各 `<wcs-fetch>` は `...:` スプレッド（`...: listFetch` など）で配線し、`wcBindable` のプロパティと入力を一括でバインドします。テンプレートが読む出力（`value` / `loading` / `error` / `status`）と、デフォルトから変えたい入力だけを初期化します。未初期化（`undefined`）のパスは「無指定」として扱われ、要素のデフォルトが保たれます。
- **空 url は auto-fetch を抑制する**: `get "detailFetch.url"()` は未選択時（初期表示、およびフィルタで選択が解除されたとき）に `""` を返します。`<wcs-fetch>` は空 url を「リクエストなし」とみなして auto-fetch をスキップするため、詳細ペインは待機状態のままになります。この契約は重要で、抑制されなければ相対 `""` がページ自身に解決され、HTML を JSON として読みに行ってしまいます。
- **スプレッド順序と `manual: true`**: `createFetch` スロットは `manual: true` を設定します。スプレッドは `manual` より先に `url` を書き込みますが、`<wcs-fetch>` は auto-fetch の判定を microtask に合体させ、*最終状態* を読み直すため、後から書かれた `manual: true` が勝ち、ロード時に不用意な POST は走りません（フレームワーク側で保証。`packages/fetch` の「microtask coalesce」テスト参照）。
- **コマンドトークン vs `data-fetchtarget`**: 一覧の再読み込みは **コマンドトークン**（`userResponded` ハンドラからの `$command.refreshList.emit()`、`command.fetch: $command.refreshList` で配線）で行います。一方、作成ボタンは **`data-fetchtarget="create-fetch"`** という autoTrigger 属性 — クリック起点で fetch を実行するショートカット — を使います。素のボタンには属性、コードからはトークンを使い分けます。
- **イベントトークンと status ガード**: `eventToken.value: userResponded` で `create-fetch` のレスポンスを state が受け取ります。`wcs-fetch:response` は成功時専用ではなく、HTTP/ネットワークエラー時にも発火します（`value=null`、`status=`エラーコード）。`$on` ハンドラは `status` が 2xx であることを確認してからフォームをリセットするので、POST 失敗時は入力が保持されます。
- **`error` が立つ条件**: `<wcs-fetch>` は HTTP 非 2xx レスポンス（空 name ガードの `400` など。`error = {status, statusText, body}` で `body` は読み取り済みのレスポンス**テキスト**）**と** ネットワーク例外（`error` は生の `Error` で `body` なし）の **両方** で `error` プロパティをセットします。null のままになるのは abort（後続リクエストに置換）された場合だけです。したがって単一の `createFailed`（`!loading && !!error`）であらゆる実失敗を網羅でき、400 経路でサイレント失敗する隙はありません。
- **サーバメッセージは今日 round-trip する**: `body` が読み取り済みテキストを保持するため、fetch 出力のネストパスは `detailFetch.value.name` と同様に reactive にバインドできます。エラーバナーは `createFetch.error.body` から `createErrorMessage` を導出し、サーバの `{ "error": "<理由>" }` をパースして空 name の 400 では `"Name is required"` を表示、その JSON 形でないとき（ネットワークエラーなど）は汎用文言にフォールバックします。フレームワークの変更は不要で、`error.body` は契約の一部です（`fetchCore` の HTTP エラーテストに `error.body === "Not Found"` の主張を追加して釘を打ちました）。
- **リクエストヘッダは宣言的**: `create-fetch` は `<wcs-fetch-header name="…" value="…">` 子要素を入れ子にして `Content-Type: application/json` を送ります。ヘッダはコードではなく子タグとして積みます。
- **ステータスのライブリージョン**: 成功/エラーバナーは *常設の* `<div role="status">` の中に置き、テンプレートはその内側の中身だけを差し替えます。`aria-live` リージョンは確実に読み上げるために DOM に常駐している必要があり、テキストごとオンデマンドで mount すると読み飛ばされがちです。
- **`*` はクリックされた行に解決される**: `selectUser` は `listFetch.value.*.id` を読み、`*` は `for:` ループ内でクリックされた行のインデックス、つまりそのユーザーの id を指します。
- **排他的な UI 状態**: 詳細ペイン（`detailLoading` / `detailReady` / `detailIdle`）と作成バナー（`createSucceeded`）は相互排他的な getter として導出されるため、「Click a user…」のヒントがスピナーと重なって表示されたり、成功メッセージが次の送信に重なったりしません。
- **stale-while-revalidate**: フィルタ切替時、スピナーは初回ロード時のみ表示（`listLoadingFirst`）。以降は前の行を残したまま `class.stale` で薄く表示するので、一覧が一瞬空になりません。
- **`onclick` は引数を取れない**: メソッドを名前でバインドするため、各フィルタボタンは共通の `filterBy(role)` をラップした 0 引数版（`filterAdmin` など）を持ちます。
- **アクセシビリティ**: 行は `<button>`（キーボードフォーカス可能、Enter/Space で実行）、ラベルは `for`/`id` で入力と関連付け、スピナーは `aria-hidden`、ステータスバナーは `role="status"` を使用します。

> **作成中のフィルタについて**: *Admin* フィルタが有効な状態で *viewer* を作成すると、「Created」バナーは出ますが、新しいユーザーは表示中の一覧には現れません（一覧は現在のサーバ側フィルタ `/api/users?role=admin` を反映するため）。**All** に切り替えると表示されます。
