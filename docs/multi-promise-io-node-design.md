# 複数Promiseを扱うIOノードの設計論点

- **対象**: 1つのIOノードが**複数の非同期処理を同時に(独立して)抱える**必要があるケースの設計検討
- **状態**: 調査メモ（非規範）。実装方針は未決定。設計が固まったら該当ノードの `docs/<name>-tag-design.md`、プロトコル自体を変える場合は `docs/spec-proposal-*.md`（[spec-proposal-command-token-arguments.md](./spec-proposal-command-token-arguments.md)と同格）に格上げする
- **発端**: [io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) のREST-node検討（論点E: 並行実行モデル）を一般化した問い。REST固有の話ではなく、既存プロトコル・既存実装パターン全体に関わる横断論点
- **関連**: `[[rest-io-node-design-discussion]]`（memory）/ [io-node-candidate-screening.md](./io-node-candidate-screening.md)

---

## 1. 問題の所在: 既存パターンは全て「単一in-flight」

既存の非同期IOノード（`fetch` / `upload` / `worker` / `geolocation` 等）は、実装を確認した限り**例外なく**「1つのCoreインスタンスにつき、進行中の非同期処理は常に1本」というモデルを採用している。

- `FetchCore`: `private _gen = 0` と単一の `private _abortController` のみを持ち、新しい `fetch()` 呼び出しは前の処理を `abort()` してから開始する（[FetchCore.ts:48-54, 180-195](../packages/fetch/src/core/FetchCore.ts#L48-L54)）
- `UploadCore`: 同型。`_doUpload()` の冒頭で `this.abort()` を呼び、単一 `_xhr` を差し替える（[UploadCore.ts:162-186](../packages/upload/src/core/UploadCore.ts#L162-L186)）
- `WorkerCore`: 明示的にRPCモデルを**採用しない**とコメントで宣言している:

  > Message model is bus-style (fire-and-forget `post`, observe `message`), not RPC: **there is no request/response correlation**.
  > （[WorkerCore.ts:14-15](../packages/worker/src/core/WorkerCore.ts#L14-L15)）

  これは見落としではなく意図的なスコープ除外。`post()`は一方向のfire-and-forgetで、送った内容とどのレスポンスが対応するかをCoreは一切追跡しない。

つまり「複数Promiseを扱うノード」は、既存の25パッケージのどこにも先例が無い、**新しい設計領域**である。

---

## 2. 2つの異なるパターン

一口に「複数Promise」と言っても、実際には性質の異なる2つの要求がある。これを混同すると設計が発散する。

### パターン(1): 同一操作の並行複数呼び出し
例: RESTノードで `list()` 実行中に `create()` と `remove(id)` が同時に進行する。それぞれが独立した完了・失敗を持ち、互いに干渉してはならない（片方のabortがもう片方を巻き込んではいけない）。

### パターン(2): 共有チャネル上でのリクエスト/レスポンス相関
例: `<wcs-worker>` や `<wcs-websocket>` で「送ったメッセージ」と「返ってきたレスポンス」を紐付けたい（RPC的な使い方）。1つの永続的なチャネル（Worker/WebSocket接続）の上で、複数のリクエストが多重化される。

パターン(1)は「操作の種類ごとに1つ」、パターン(2)は「1つの操作の中でメッセージ単位に多重化」という違いがあり、必要な相関キーの出どころも異なる（(1)は呼び出しの引数や操作種別、(2)は明示的に生成・送信する correlation id）。

---

## 3. 壁1: `_gen` / abort の単数→複数化（技術的には解決可能）

現行パターンをMapベースに一般化するのは技術的には難しくない。

```
private _gen = 0                          →  private _genByKey: Map<string, number>
private _abortController: AbortController →  private _abortControllers: Map<string, AbortController>
```

ただし規律が要る:
- `dispose()` は**全キー**の世代を無効化しなければならない（1箇所でも取りこぼすと、そのキーだけ torn-down 要素への stale 書き込みが漏れる）
- `abort(key?)` のようにキー単位の中断と全体中断を両方提供するか、常に全体か個別かを設計時に固定するか
- パターン(2)（相関）では、対応する応答が永遠に来ない場合のタイムアウト・クリーンアップも必要（既存パターンには存在しない新しい懸念）

---

## 4. 壁2（本質）: wc-bindableプロトコルは「動的キー付きプロパティ」を表現できない

これが技術的な難所というより**プロトコル語彙の欠落**に当たる。

`static wcBindable.properties` は**クラス定義時に固定された配列**である:

```typescript
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}
```
（[wcBindable.ts:20-24](../packages/state/src/protocol/wcBindable.ts#L20-L24)、25パッケージ共通の自動生成コピー元）

`getter` は `(event: Event) => any` という単一引数しか取れない。実行時に生成される動的キー（例: RESTの`resource-id: 42`、RPCの`correlation-id: "req-7"`）に対して、`loading.42` のような個別プロパティを**宣言することも、`getter`にキーを渡すことも、プロトコル上できない**。

これは`spread`機能の「composed name（`<sourceId>.<sourceName>`）」パターンとも別物である点に注意。あちらは**複数の異なるコンポーネント**を合成する仕組みで、**単一コンポーネント内の動的キー空間**を表現するものではない。

---

## 5. 3つの戦略的選択肢

### (a) コレクション化 — 1つの「まとめ」イベントに全部載せる
`results`のような配列/オブジェクト全体を、変化のたびに丸ごと再dispatchする。

- これは**REST-node検討で出た「collectionをノードが保持する」パターンと構造的に同一**であり、そこで洗い出した制約がそのまま当てはまる（`[[rest-io-node-design-discussion]]`参照）:
  - state側の配列差分は**参照同一性**で判定するため、ノード内部は非破壊+再代入の規律が要る
  - state側からの書き込みが「出力専用setter」だと握り潰され desync する
  - 楽観更新的な差し替えは参照が変わりDOMチャーンを起こす
- **利点**: 既存プロトコルのまま実装できる（新しい語彙が要らない）。宣言的バインド（`for: results`）にそのまま乗る
- **欠点**: 個別キーの状態（「resource 42だけloading」）を直接バインドすることはできず、UI側で配列をフィルタ/検索する一段階が必要

### (b) 相関をuserland（state側）に押し出す — ノードは薄いbusのまま
`WorkerCore`が実際に選んだ道。ノードは「送った」「受け取った」という単方向イベントだけを流し、リクエストとレスポンスの対応付けはstate側のロジック（例: 送信時に自前でMapを持ち、`message`イベントの中身から相関idを読んで解決する）に委ねる。

- **利点**: ノードは既存パターンのまま拡張不要。プロトコルにも触れない
- **欠点**: 「宣言的にバインドするだけで動く」というwcstackの価値提案が薄れ、利用者がPromise管理コードを書く羽目になる（`@wcstack/fetch`が存在する理由＝「async/awaitのグルーコードを書かせない」という思想と逆行する）

### (c) プロトコル拡張 — 動的キー付きプロパティを正式にサポートする
`IWcBindableProperty`に`keyed`相当の概念を追加し、`getter`がキーを受け取れるようにする等、**wc-bindable-protocol自体の語彙を拡張する**案。長期的には最も筋が良いが:

- wcstack単体の判断では閉じず、`wc-bindable-protocol`本体（外部仕様）への提案が要る
- `state`側のバインディング構文（`data-wcs`）にも「動的キーをどう書かせるか」という対応する構文拡張が要る（現状`for`は配列専用、動的キーのRecord/Mapを直接for展開する構文は無い）
- 影響範囲が1ノードに留まらず全パッケージの`IWcBindable`型に及ぶため、着手するなら`spec-proposal-command-token-arguments.md`と同格の提案文書が必要

---

## 6. 該当しそうな候補

- **REST-node**（`[[rest-io-node-design-discussion]]`、論点Eそのもの）— パターン(1)
- **worker/websocketのRPC拡張**（現状は明示的にスコープ外、`WorkerCore.ts:14-15`）— パターン(2)
- **fetchの並列/バッチ版**（`fetchAll(urls[])`のような複数URL同時実行、現状は単一in-flight前提）— パターン(1)
- **uploadの複数ファイル独立進捗**（現状は全ファイルを1つのFormData/1 XHRにまとめて送信しており、ファイル毎に独立した進捗/中断はできない）— パターン(1)

---

## 7. 未決事項

- (a)/(b)/(c)のどれを既定路線にするか。**現時点の暫定見立て**: 短期的には(a)（REST-node検討と実装資産を共有できる）、(c)は将来課題として切り離すのが現実的
- (a)を採る場合、REST-nodeの「collection保持」設計（未決: `items` setterを出力専用にするか受理するか）と歩調を合わせる必要がある
- パターン(2)（RPC）を本当に必要とするユースケースがどれだけあるか（worker/websocketは意図的に避けている実績があるため、需要確認が先）
- タイムアウト・孤児(orphan)リクエストの扱いは(a)(b)(c)いずれの案でも共通の未決課題
