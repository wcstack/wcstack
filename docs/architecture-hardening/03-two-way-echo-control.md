# 双方向バインディングのエコー制御

- **状態**: 採択・実装済み（`PropagationContext` / `WriteReceipt` = phase 3、`enablePropagationContext`
  として **既定 `true`**・恒久 opt-out）。実装マッピングは [09](09-remediation-design.md) §4、
  既定化ステータスは [10](10-defaulting-rollout-status.md) を参照。
- **対象**: UI ↔ state、state ↔ I/O などの双方向経路

## 問題

A の変更を B に書き、B の change を再び A に書く単純な双方向 binding は、同期的な再入、
同値イベント、正規化、非同期通知によってエコーループを作る。単純な boolean の「更新中」フラグは、
非同期境界や A → B → C → A の循環を越えられず、正当なユーザー変更まで捨てることがある。

## 推奨する対策

### 1. 変更に provenance を持たせる

各伝播へ少なくとも次を割り当てる。

- `transactionId`: 一つの原因から派生した伝播系列。
- `originId`: 最初に変更を生成した node / binding。
- `hopId` または訪問済み binding 集合: 同じ edge への再入検出。
- `revision`: origin 内の単調増加番号。

同じ `transactionId` が同じ binding edge に戻った場合だけ抑止する。別 transaction の変更は、処理中でも
正当な入力として扱う。公開値にメタデータを混ぜず、ランタイム内部または side channel で運ぶ。

### 2. write と notification を分ける

入力 property への write が必ず change を表すとは限らない。binding は「値を書いた」ことと
「producer が変更を確定して通知した」ことを別に追跡する。正規化する要素では、write した値ではなく
通知または read-back された確定値を state へ戻す。

### 3. 同値ガードを補助線として使う

`Object.is(previous, next)` を標準の短絡条件にし、構造値の比較はタグまたは binding が明示した比較器に
限定する。同値ガードは計算量を減らすが、それだけをループ防止の正しさの根拠にはしない。

### 4. 収束しない変換を診断する

一 transaction の hop 数に診断上限を置く。上限到達時は、経路、各hopの値型・同一性、正規化有無を
開発用フックへ記録して当該 transaction の未処理配送だけを停止する。既適用値はrollbackせず、
updaterから例外を投げない。値payloadは既定では記録しない。

## 推奨アルゴリズム

1. 外部入力に新しい `transactionId` と origin revision を付ける。
2. edge が同 transaction を処理済みなら配送しない。
3. 同値なら write を省略する。ただし edge を処理済みとして記録する。
4. setter call stack内の同期通知は、member / binding generation付きreceiptからprovenanceを継承する。
5. 非同期通知はrevision / cause token extensionがある場合だけ継承し、untagged eventは新transactionにする。
6. untagged eventは`Object.is`同値ならstate更新を短絡できるが、時間窓だけのledgerでuser eventを抑止しない。
7. transaction 完了後、receipt と訪問集合を解放する。

## 互換性と移行

既存イベント payload は変更しない。第一段階では binding ランタイム内部の transaction context、同値ガード、
同期scope receipt、診断だけを追加する。非同期にfresh objectを生成して通知する双方向タグは、意味的同値なら
通知しない契約を持つか、revision / cause token / equalityの明示extensionを採用する必要がある。同じobjectの
in-place変更もreferenceだけでは識別不能であり、core eventだけで完全解決できるとは主張しない。

## 検証条件

- A ↔ B の同期通知はreceiptで停止し、microtask / task通知はrevision / cause extension有無を分けて検証する。
- untagged delayed fresh-object echoを「解決済み」と誤判定せず、明示diagnosticまたはcomponent contractで扱う。
- A → B → C → A の循環を検出できる。
- trim、clamp、型変換などの正規化後の値が両端で収束する。
- 処理中に発生した別のユーザー入力を誤って破棄しない。
- `NaN`、`-0`、オブジェクト参照、カスタム比較器のケースを固定テストにする。
- teardown 後に receipt や transaction context が残らない。

## 非目標

- 任意の相互変換が数学的に収束することの自動証明。
- オブジェクト全体の暗黙 deep equality。
- 業務上の競合解決や共同編集アルゴリズムの代替。

## 決定ゲート

1. provenance を binding 内部だけに置くか、タグが継承できる opt-in API を設けるか。
2. hop 上限を警告、例外、transaction 停止のどれにするか。
3. 非同期echoの実例に対してrevision / cause / equality extensionのどれを採るか。

## 関連文書

- [接続直後の初期状態配送](02-initial-state-delivery.md)
- [観測性・デバッグと wc-bindable 境界](05-observability-and-wc-bindable.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
- [発火タイミング契約](../timing-and-firing-contract.md)
