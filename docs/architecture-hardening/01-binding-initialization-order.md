# タグ定義とバインディング確立の順序

- **状態**: 設計提案（未採択・未実装）
- **対象**: state、UI、I/O の各カスタム要素とバインディングランタイム

## 問題

HTML パーサー、モジュール取得、`customElements.define()`、要素の upgrade、
`connectedCallback()`、バインディングスクリプトの実行順は一致しない。順序を暗黙に仮定すると、
未 upgrade 要素への書き込み、初期値の上書き、リスナー登録前の通知などが発生する。
タグが独立して交換できる構成では、個々のタグではなく接続境界が順序を管理する必要がある。

## 現状

- 未定義タグへの state → element の初回 apply は、`scheduleDeferredApply` により
  `customElements.whenDefined()` 後に最新の state 値で再試行する仕組みが実装済みである。
- `<wcs-defined>` は、複数タグの registration 完了を `customElements.get()` / `whenDefined()` で監視し、
  `defined`、`pending`、`missing`、`count`、`total`、`error` として公開する。`all` / `any` の集約と timeout による
  ロード失敗検出を含むため、アプリケーション層の registration readiness は既に明示的に gate できる。
- I/O タグを state より先に記述する構成は、現在の推奨マークアップで回避できる。
- ただし、すべての consumer が同じ時点で ready になることや、動的 import・遅延挿入を含む
  任意の順序で同じ結果になることは、共通契約になっていない。

## `<wcs-defined>` が解決する範囲

`<wcs-defined>` は registration readiness を観測して reactive state にする一方向ノードである。
タグを load / define したり、binding runtime の discover / attach / synchronize を停止・再開したりはしない。
したがって、利用側が `defined` を分岐条件にした処理は gate できるが、ページ内の binding 全体に自動的な
barrier を設けるものではない。`hidden` などで表示だけを gate しても、対象要素の DOM 接続や binding は
延期されない。

| 論点 | 担当する仕組み |
| --- | --- |
| 複数タグの registration 完了、timeout、ロード失敗 | `<wcs-defined>` が解決済み |
| 未定義要素への state → element 初回 apply | state の `scheduleDeferredApply` が解決済み |
| listener 登録前に発火した初期イベント | `<wcs-defined>` では復元できない。attach 後の初期 read が必要 |
| DOM 接続後に初期 property を読む必要 | wc-bindable の consumer option `syncOn: "connect"` を使う |
| 接続後も続く業務データ取得 | `whenDefined()` / `syncOn` の保証外。producer の後続 event で通知する |
| define 前後の command 順序 | `<wcs-defined>` の保証外。command 側の順序契約が必要 |

特に `whenDefined()` はクラスの registration を知らせるが、対象インスタンスの業務データ取得完了や、
過去イベントの replay を保証しない。`syncOn: "connect"` も初期 property read を最初の DOM 接続まで遅らせるだけで、
業務データの完了待ちではない。`connectedCallbackPromise` の存在から readiness を推測してはならない。

## 推奨する対策

### 1. 接続を三つのフェーズに分ける

1. **discover**: 宣言を読み、参照先を解決する。副作用は起こさない。
2. **attach**: 後続変更を取り逃さないよう、先に listener / observer を登録する。
3. **synchronize**: upgrade と接続条件を満たした対象へ初期スナップショットを適用する。

`attach → synchronize` の順序を不変条件にする。同期中に変更が入った場合は、リビジョンを比較し、
初期値で新しい変更を巻き戻さない。

### 2. registration と snapshot timing を分ける

- タグ集合の registration readiness をアプリケーションから扱う場合は、既存の `<wcs-defined>` を利用する。
- binding runtime がカスタム要素の API を利用する前は、個別に `customElements.whenDefined(localName)` を待つ。
- producer 初期値は既定の `syncOn: "call"` で listener attach と同じ同期 frame に読む。
- unconnected `HTMLElement` を接続後に読む必要がある binding だけ、明示的に `syncOn: "connect"` を使う。
- `syncOn: "connect"` 中も listener は先に動作し、接続前 event を配送した後で接続時 snapshot を配送する。
- `<wcs-defined>.connectedCallbackPromise` は監視対象の完了待ちであり、property readiness として待たない。
- 待機中に binding が破棄された場合、後続 apply を必ず無効化する。

### 3. 接続処理を冪等にする

binding ごとに世代番号と所有する teardown 集合を持つ。同じ接続要求の再実行は二重 listener を
作らず、古い世代からの callback は no-op にする。切断時は listener、observer、保留中の同期を
まとめて破棄する。

## 互換性と移行

既存タグのライフサイクルや `wcBindable` 宣言は変更しない。まずランタイム内部にフェーズ、ownership、世代を
導入し、`syncOn` は consumer 側の opt-in とする。現在の `scheduleDeferredApply` は synchronize フェーズの実装として
位置付け、個別の例外処理を共通経路へ統合する。詳細は [8 論点を横断する修正設計](09-remediation-design.md) を正とする。

## 検証条件

- UI / state / I/O スクリプトの全順列で最終状態が一致する。
- 定義前に値を複数回変更しても、upgrade 後は最新値だけが適用される。
- 待機中に要素の削除、再挿入、binding の再確立を行っても二重購読しない。
- 動的 import の成功、失敗、長時間保留を再現できるテストを持つ。
- teardown 後に遅延 callback が DOM や state を更新しない。

## 非目標

- 全タグのロード順を一つに固定すること。
- 各カスタム要素の内部初期化方式を統一すること。
- アプリケーション固有の「データ取得完了」を upgrade と同義にすること。

## 決定ゲート

1. wcstack binding grammar で `syncOn` をどう表記するか。
2. connection observer を Document / ShadowRoot 単位で共有する実装を採るか。
3. `syncOn` で扱えない component 固有 readiness の実例が出るまで拡張を保留するか。

## 関連文書

- [接続直後の初期状態配送](02-initial-state-delivery.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
- [既存の初期化競合分析](../state-binding-init-races.md)
- [`<wcs-defined>` 設計メモ](../defined-tag-design.md)
- [`@wcstack/defined` README](../../packages/defined/README.ja.md)
- [発火タイミング契約](../timing-and-firing-contract.md)
