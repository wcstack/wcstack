# state + intersection + fetch デモ（2 つの I/O ノードで作る無限スクロール）

互いを知らない 2 つの I/O ノード —— `<wcs-intersect>` のセンチネルと `<wcs-fetch>` —— で作る
無限スクロールのフィードです。両方を知っているのは `@wcstack/state` だけです。センチネルは可視性を
**event token** で知らせ、ページを読むかどうかは state が決め、**command token** で `<wcs-fetch>` を
実行します。各レスポンスは別の event token で戻り、state のフィードに追記されます。

2 つの姉妹デモの中間に当たります。

| デモ | ページを読むのは | 見せたいこと |
|---|---|---|
| [`infinite-scroll`](../../packages/fetch/examples/infinite-scroll) | `<wcs-infinite-scroll target="page-fetch">` が `<wcs-fetch>` を直接実行 | 全部入りのタグ: センチネルと fetch をマークアップでつなぐ |
| **このデモ** | センチネルの event token が見えたと言ったとき、state が command token で | 2 つの I/O ノードを state でつなぐ: event token で受け、state で決め、command token で動かす |
| [`state-intersect-scroll`](../state-intersect-scroll) | `fetch()` を呼ぶ `$stream` の source | 低レベルの道: switchMap の取り消しと上限付きの再試行を source の中に書く |

## 起動

パッケージは CDN（[esm.run](https://esm.run)）から読み込むので、必要なのは Node.js だけです。

```bash
node examples/state-intersect-fetch/server.js
```

http://localhost:3000 を開いてスクロールしてください。

Retry ボタンを見るための失敗注入:

```bash
# page 2 が 1 回失敗する
FAIL_PAGE=2 node examples/state-intersect-fetch/server.js

# 各ページが 40% の確率で失敗する
FLAKY=0.4 node examples/state-intersect-fetch/server.js
```

## データフロー

```text
$connectedCallback ──────────────────────────────┐
                                                  v
<wcs-intersect> ──eventToken.intersecting──> $on.sentinelChanged
   (target="self"、240px の余白)                    │ 見えた・読み込み中でない・エラーでない・終端でない?
                                                  v
                                         $command.loadPage.emit()
                                                  │ command.fetch
                                                  v
                                   <wcs-fetch manual url=pageUrl>.fetch()
                                                  │ wcs-fetch:response（eventToken.value）
                                                  v
                                         $on.pageArrived
                                            items = items.concat(page); page++
                                            短いページ → noMore
                                                  │（更新の終わり: 行は描画済み）
                                                  v
                                         $watch.items → $command.rearm.emit()
                                                  │ command.reobserve
                                                  v
                                   <wcs-intersect>.reobserve() → いまの位置を知らせ直す
```

## 要点

- **どちらの要素も相手を知りません。** `<wcs-intersect>` は可視性を知らせ
  （`eventToken.intersecting: sentinelChanged`）、`command.reobserve` を受けるだけです。
  `<wcs-fetch>` は `url` を受け、`loading` / `error` / 各レスポンス（`eventToken.value: pageArrived`）
  を知らせ、`command.fetch` を受けるだけです。いつページを読むか、何が終端か、エラーの後どうするか
  —— 決まりはすべて state にあります。
- **page 1 はセンチネルを待ちません。** `<wcs-intersect>` は定義された時点で観測を始め、それは state が
  バインドされる前です。IntersectionObserver は最初のコールバックの後は*変化*しか知らせません。
  event token の購読より先に来た最初の通知は失われ、センチネルは見えたまま何も言わなくなります。
  `$connectedCallback` は、バインディングができてから page 1 を頼みます（`infinite-scroll` は同じ競合を、
  `<wcs-fetch>` に page 1 の `url` を静的に書いて解いています）。
- **読み込み中の交差 edge は無視します。** `<wcs-fetch>` は `latest` 方針で、新しい `fetch()` は進行中の
  要求を中断します。余分な edge は page N を中断して、また page N を頼むことになるので、ハンドラは
  先に `fetching`（バインドした `loading`）を見ます。
- **`manual` と url の getter。** `pageUrl` は常に次のページを指します。要素が `manual` なので、`url` を
  書き換えても取得は始まりません。始めるのは `loadPage` だけです。次の交差 edge が来るころには、
  `page` を進めた更新が新しい `url` を書き終えています。
- **ページごとに張り直す。** センチネルは変化しか知らせません。ページが着地してもセンチネルが見えたまま
  （背の高い画面、速いスクロール）なら、何も変わりません。`items` の `$watch` は行を追記した更新の
  終わり —— 行の描画の後 —— に走り、センチネルにいまの位置を知らせ直させます（`reobserve()`）。
  短いページで `noMore` が立ち、そこで止まります。
- **エラーは Retry ボタンで止まります。** `wcs-fetch:response` は HTTP のエラーでも発火します
  （`value` は `null`）。`pageArrived` はそれを飛ばし、`page` を進めません。エラーを出している間は
  センチネルの edge を無視するので、レイアウトのずれで取り直しが繰り返されることはありません。
  Retry は同じページの `loadPage` を出します。自動の上限付き再試行は、`$stream` 版
  （`state-intersect-scroll`）が足しているものです。
- **スクリプトの順番。** 2 つの I/O パッケージを `@wcstack/state` より先に読むので、state が command token
  を購読させる時点で両方の要素は定義済みです。後から定義された要素への emit は再生されません
  （[examples/README.md](../README.md)）。

## テスト

[`e2e/tests/state-intersect-fetch.spec.ts`](../../e2e/tests/state-intersect-fetch.spec.ts):
page 1 はスクロールせずに読み、各ページを終端まで 1 回ずつ読む。背の高い画面は `reobserve()` で
埋まるまで読む。エラーは Retry を待ち、スクロールでは取り直さない。

```bash
cd e2e
npx playwright test state-intersect-fetch
```
