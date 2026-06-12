# state + fetch + debounce demo（ライブ検索）

`@wcstack/state` ・ `@wcstack/fetch` ・ `@wcstack/debounce` を組み合わせたインクリメンタルサーチのデモです。検索ボックスへの入力が **止まってから 300ms 後にだけ** API を叩き、商品カタログを絞り込みます。

## 起動方法

各パッケージは CDN（[esm.run](https://esm.run)）から読み込むため、ローカルビルドは不要です。Node.js さえあれば動きます。

```bash
node examples/state-search/server.js
```

http://localhost:3000 でアクセスできます。

## 機能

- **インクリメンタルサーチ**: `<input>` の値を `state` にバインドし、`/api/search?q=` から結果を取得してリスト表示
- **デバウンス**: `<wcs-debounce wait="300">` が入力の連打を集約。タイプ中はリクエストを送らず、静止後に1回だけ検索
- **APIリクエスト数カウンタ**: ネットワークへ**送信した**回数を表示。debounce の効果（=キーストロークごとに増えない）を可視化
- **古い応答の追い越し対策（stale-response safety）**: 飛行中のリクエストは url 変化時に `wcs-fetch` が abort するため、遅れて届いた古い応答が新しい結果を上書きしない
- **ステータス表示**: 入力中 / 検索中 / N件ヒット を状態に応じて切り替え（排他的に算出し文言と色を一致）

## データフロー

```
<input> ──value──▶ state.query
                      │
                      ▼  source
            <wcs-debounce wait=300>
                      │  value / pending
                      ▼
        state.debouncedQuery / state.typing
                      │
                      ▼  get "searchFetch.url"()  （debouncedQuery から URL を導出）
                <wcs-fetch>（url 変化で自動 fetch）
                      │  value / loading / error
                      ▼
                state.searchFetch.*  ──▶  リスト描画
```

## ポイント

- **値サーフェス**（`source` → `value`）を使用。シグナルサーフェス（`trigger` → `fired`）ではなく、デバウンス済みの「値」を state に書き戻すだけで済む
- `get "searchFetch.url"()` が `debouncedQuery` に依存するため、デバウンス済みの値が変わったときだけ `<wcs-fetch>` の URL が変化し、自動再取得が走る
- 空クエリ時は `/api/search`（=全件）を返すので、初期表示でカタログ全件が出る
- **追い越し対策**: 新しい検索が走ると `wcs-fetch` は飛行中の旧リクエストを `AbortController` で中断する。中断されたリクエストは応答イベントを出さないので、古い結果が後から上書きすることはない。サーバ遅延を 150〜800ms にランダム化しているのは、この順序逆転を実際に発生させて確認できるようにするため
- **カウンタは「送信時」に計上**: `eventToken.loading: requestStarted` で `loading` の `false→true` 端を数える。`value`（応答）で数えると、中断されたリクエストは応答を出さないため送信したのに数えられず、過少カウントになる。送信時計上なら abort の有無に関わらず正確。supersede（A 飛行中に B 発射）時も、`FetchCore` は**値変化に関係なく毎リクエスト開始で `loading-changed(true)` を dispatch する**ため B も確実に数えられる（カウント漏れなし）。検証はサーバのターミナルを見るだけ——到達ごとに `[search] #N` をログするので、その数（=送信のグラウンドトゥルース）と画面のカウンタが一致する
- **ステータスは排他算出**: フェッチ中に再入力すると `typing` と `loading` が同時に true になり得る。文言（`statusText`）と色（`class.*`）が食い違わないよう、`typing > loading > idle` の優先順位で**排他的な**フラグを算出して `class` に束縛している
