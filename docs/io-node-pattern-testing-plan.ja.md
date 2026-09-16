# I/O ノードのパターンテスト導入計画

**状態**: 実装提案（2026-09-15）。この文書の追加時点では、新しいテスト・runner・CI ジョブは未実装。

**English**: [io-node-pattern-testing-plan.md](./io-node-pattern-testing-plan.md)

## 1. 方針と対象

フラグの ON・OFF、値の変化、変更順序、非同期完了を、**初期条件＋順序付き操作＋観測点＋期待出力＋禁止出力**で定義する。既存テストと対応付けたケース一覧を作り、不足する組み合わせをテーブル駆動テストとして追加する。

最初の対象は `fetch` と `debounce`。Core の処理、Shell の属性・プロパティ連動、`data-wcs` を通るノード間連動の順に導入する。全タグの全入力の直積を最初から生成せず、意味が結び付く入力群を単位にする。

本計画は公開 API やプロトコルを変更しない。期待動作の根拠は次の現行文書とする。

- 各パッケージの README: [fetch](../packages/fetch/README.ja.md)、[debounce](../packages/debounce/README.ja.md)
- [I/O ノードガイドライン](./async-io-node-guidelines.ja.md)
- [非同期実行モデル](./async-execution-model.ja.md)
- [タイミング・発火契約](./timing-and-firing-contract.ja.md)

[トレース適合契約の草案](./io-node-trace-conformance.md) §5 のベクトル形式、§9 の段階導入を具体化するが、草案の採択や `trace` 適合認定を意味しない。実装の現在値だけから新しい仕様を確定しない。仕様と実装の不一致・未規定事項は記録し、期待値を決めてからゲートにする。

## 2. 既存資産と不足の調べ方

| 既存資産 | 確認できた内容 | パターン化で追加する管理 |
|---|---|---|
| [fetch.test.ts](../packages/fetch/__tests__/fetch.test.ts) | `url` / `manual` の同一ターン更新、URL の同値抑制、再接続、trigger、body のリセット | フラグ遷移・更新順・実行経路の対応表と不足ケース |
| [fetchCore.phase4.test.ts](../packages/fetch/__tests__/fetchCore.phase4.test.ts)、[operationLane.test.ts](../packages/fetch/__tests__/operationLane.test.ts) | 非同期レーン関連の既存検証 | 成功・失敗・キャンセル・遅着を入力列と照合 |
| [debounceCore.test.ts](../packages/debounce/__tests__/debounceCore.test.ts) | leading/trailing、pending、cancel/flush、dispose 後のタイマー | 4 通りの設定と入力回数・境界時刻の対応表 |
| [integration.commandBinding.test.ts](../packages/state/__tests__/integration.commandBinding.test.ts) | 合成要素への command binding | 実際の I/O タグを使った連動の追加 |
| [共有 upgrade テスト](../protocol/upgrade-properties.test.ts) | 合成オブジェクトによる upgradeProperties の検証 | 実タグの upgrade 前代入と実行回数の確認 |
| [構造検査](../scripts/conformance-io-nodes.mjs)、[入力宣言検査](../scripts/conformance-bindable-inputs.mjs) | 実装構造・宣言の検査 | 時系列の実行検証は別 suite で扱う |

これは代表箇所の読解結果であり、全ケースの網羅性を監査済みという意味ではない。既存テストを一括削除・置換せず、移行前後で値だけでなくイベント・副作用の assertion が維持されることを確認する。

## 3. まず入力と出力を分類する

タグごとに、公開名、Core/Shell の対応、入力経路、既定値、正規化、発火条件、根拠を一覧にする。`wcBindable` は列挙の手掛かりに使い、意味論は README・契約から人が補う。

| 分類 | 例 | テストで区別すること |
|---|---|---|
| 自動実行の制御 | fetch の `manual` | ON/OFF と停止・キャンセルは同義ではない |
| 発火方式の設定 | debounce の `leading` / `trailing` | 両方 OFF を含む組み合わせ、処理中の設定変更 |
| 実行要求 | fetch の `trigger=true`、debounce の `trigger(...)` | 真偽値代入とメソッド呼び出しの違い、繰り返し要求 |
| 値の入力 | `url`、`source`、`body` | 同値、差し替え、空値、消費後リセット |
| 出力状態 | `loading`、`pending` | 入力として書かず、各観測点で遷移を検証 |
| 発生通知 | `response`、`settled`、`fired` | 同値 payload の通知回数、通知中の getter |

特に次の違いを共通 runner に埋め込まない。

- fetch の `manual` は属性の存在で判定される。`manual="false"` は ON、OFF は属性の削除。プロパティの `false`、属性の文字列 `"false"`、binder の boolean を別経路で扱う。
- 現行 [Fetch Shell](../packages/fetch/src/components/Fetch.ts) では `manual=false` だけでは自動 fetch は予約されない。接続または URL 更新により予約された microtask が、その時点の `manual` を読む。この差は明示的なケースにし、README に不足する説明があれば併せて補う。
- `manual=true` や `trigger=false` を、実行中リクエストの abort と解釈しない。キャンセルはそのタグで定義された操作で起こす。
- fetch の `loading-changed(true)` はリクエストごとの通知、debounce の `pending-changed` は同値抑制付き。全 boolean 出力に同じ通知回数を要求しない。
- Shell では `no-trailing` が trailing の否定、throttle では `no-leading` で既定の leading を無効化する。Core の設定名をそのまま HTML 属性として生成しない。

## 4. パターンの選び方

| 軸 | 必須の候補 |
|---|---|
| フラグ | 初期 ON/OFF、OFF→ON、ON→OFF、ON→ON、OFF→OFF |
| 値 | 未設定→A、A→B、A→A、A→空、A→空→A。`null` / `undefined` / `0` / `false` は対応する入力だけ |
| 連動 | OFF 中に値変更→ON、ON 中に値変更、値とフラグの同時更新 |
| 順序 | 値→フラグ、フラグ→値。同一同期区間と microtask を挟む場合 |
| ライフサイクル | 接続前、接続後、upgrade 前代入、disconnect、再接続 |
| 非同期 | 成功、失敗、キャンセル、A→B 開始後の A/B 完了順の逆転、停止後の遅着 |
| 時間 | 期限直前・期限・期限後、同一時刻での callback と操作の先後 |
| 連動経路 | property、attribute、command、`data-wcs`。実際に公開される経路のみ |

進め方:

1. 各フラグの 4 遷移と、関係のある 2 フラグの 4 設定を基礎ケースにする。
2. 値の同値・差し替え・空値、および更新順を重ねる。fetch の `manual × url × trigger` のような既知の相互作用は 3 因子以上でも明示ケースにする。
3. キャンセル・遅着・再接続は順序を列挙する。単なる pairwise では順序依存の不具合を覆えない。
4. 残る独立設定が多い場合だけ pairwise を使う。制約、生成 seed、実際のケースを保存し、失敗を固定ケースとして再現できるようにする。

非該当には理由を付ける。未実装・仕様未決定・runner 非対応を非該当や pass にしない。行数やコードカバレッジだけでパターンの網羅を主張しない。

## 5. ケース形式と実行器

最初はパッケージ内の TypeScript データと `it.each` を使う。JSON/YAML の公開形式、任意スクリプトを解釈する DSL、新しい公開パッケージは初期段階では導入しない。

各ケースは次の情報を持つ。共通値を suite 側に置いても、失敗レポートでは展開して読めるようにする。

| フィールド | 内容 |
|---|---|
| `id`, `title` | 安定 ID と日本語のテスト名 |
| `basis`, `status` | 仕様の節、既存テスト、仕様確認済み／現状記録／未決定 |
| `layer`, `appliesTo` | Core / Shell / binding、対象タグ・入力経路 |
| `initial` | 設定、初期値、接続状態、fake API・時計 |
| `steps` | 順序付き操作。代入、接続、解決・拒否、callback、時計進行、checkpoint |
| `observedSurface` | 検証対象イベント・getter・API 呼び出し・resource 解放の範囲 |
| `expected` | checkpoint ごとの snapshot、イベント列、副作用の回数・引数 |
| `forbidden` | 発生してはいけない通知・書き込み・API 呼び出し |
| `normalization` | Error 比較、payload snapshot、handle の参照比較など |
| `settleBoundary`, `allowAdditional` | 観測終了条件、追加出力の許可（対象範囲内では既定 false） |

この内部形式は草案 §5 の完全な適合ベクトルではない。草案への対応が必要になった段階で `contractVersion`、`conformanceLevel`、拡張対応などを追加する。部分的な `observedSurface` で全公開面を検証したと報告しない。

例（説明用データであり、実行可能な runner API ではない）:

```text
id: debounce.core.trailing.latest-value
basis: debounce README; debounceCore.test.ts
status: specification-backed
layer: Core
initial: fresh instance; leading=false; trailing=true; wait=100; no maxWait; clock=0
observedSurface: pending, value, pending-changed, settled
steps:
  setSource(A) at t=0
  checkpoint(start): pending=true; value=undefined
  advance clock to t=50; setSource(B)
  advance clock to t=149
  checkpoint(before): pending=true; value=undefined; no settled
  advance clock to t=150
  checkpoint(done): pending=false; value=B
expected events, in order:
  pending-changed(true)
  settled({ value: B })
  pending-changed(false)
forbidden: settled(A); any extra event on the observed surface
normalization: primitive equality; copy event payloads at dispatch
settleBoundary: t=150 after due timer callbacks return
allowAdditional: false
```

runner とタグ別 adapter の境界:

- runner: step の順次実行、連番付き記録、checkpoint 比較、禁止出力判定、失敗表示。
- adapter: 公開 setter/command への操作、fake API の生成と完了操作、getter の読み出し、payload 正規化、破棄。
- ケース: 期待値と契約上の順序。実装の private field や内部条件分岐から期待値を計算しない。
- 最初は既存のテスト関数を薄く整理し、2 パッケージで共通部分が確認できてから recorder を抽出する。タグ別の意味論を変更する巨大な汎用 runner を先に作らない。

全順序は契約で必要な範囲だけを指定する。順不同を許す範囲は明示する。イベントは listener 内で payload と関連 getter を記録し、後で同じ可変オブジェクトを読むことで過去の値が書き換わるのを防ぐ。handle は複製せず、識別名・参照同一性・解放回数を検証する。

## 6. 最初の実装ケース

以下は採番案。実装時に既存テストとの対応と採用した期待値の根拠を各行へ付ける。

### 6.1 fetch

| ID（`fetch.` に続く部分） | 条件・操作 | 主な期待値 |
|---|---|---|
| `shell.auto.final-inputs` | 接続済み・未送信、同一同期区間で URL=A と manual=true を両順序で設定 | 自動送信 0 回。初期化 Promise がある場合も完了する |
| `shell.auto.latest-url` | auto、URL=A→B を同一同期区間で設定 | microtask 前は 0 回、判定後は B を 1 回 |
| `shell.auto.equal-url` | A の自動送信が成功／失敗した後に A を再代入 | 追加送信 0 回。明示要求とは区別 |
| `shell.auto.empty-roundtrip` | A 送信済み、URL=A→空→A。同期区間内／境界を挟む | 自動再送 0 回。別 URL=B なら新規送信 |
| `shell.manual.transition` | manual=true で URL=A、予約処理を終えてから manual=false のみ | 現行挙動は送信 0 回。次の URL 更新・再接続との違いを仕様確認 |
| `shell.trigger.explicit` | manual=true、URL=A、trigger=true を繰り返す | 要求ごとに実行。false 代入は実行・キャンセル要求にならない |
| `shell.trigger.empty-url` | 空 URL で trigger=true、後で URL と trigger を設定 | 空 URL 時は送信・完了通知なし、初期 false を保持。その後の要求は実行 |
| `core.latest.late-settle` | A→B 実行、成功／失敗を両完了順で返す | latest 契約に従い、失効した A は出力を上書きしない |
| `shell.lifecycle.disconnect` | 自動送信予約中／送信中に切断、その後旧 callback、再接続 | 未開始なら送信なし、開始済みなら cancel、旧結果を反映しない、再接続は同値 URL でも実行 |
| `shell.body.consume` | POST body=A で開始、完了前に body=B を設定 | A を送信し開始時に入力リセット、旧完了が B を消さない |

`trigger.explicit` は、まず逐次完了する反復要求を確定し、その後、実行中の反復要求と各 `trigger-changed` の順序を別ケースで確認する。`trigger` を「現在有効な全処理の busy フラグ」と仮定しない。URL・manual の coalesce は Shell の機能なので Core に架空の setter を足して再現しない。

### 6.2 debounce / throttle

`wait=100`、`maxWait` なしの debounce に、単発 A（t=0）または A→B（t=0,50）を入力する。表は `settled` のみを示し、実ケースは `pending` と getter も記録する。

| leading | trailing | 単発 A | A→B |
|---|---|---|---|
| OFF | OFF | 発火なし | 発火なし |
| OFF | ON | A at t=100 | B at t=150 |
| ON | OFF | A at t=0 | A at t=0 |
| ON | ON | A at t=0 の 1 回 | A at t=0、B at t=150 |

この 8 ケースを `debounce.core.edges.*` とし、`source` の値経路と `trigger(...args)` のシグナル経路で適用可能な行を実行する。追加順は次のとおり。

1. `wait` 境界直前・境界・直後。同時刻の再入力は callback の前後を別ケースにする。
2. 同値入力のバーストと別バースト。入力値の同値を理由に occurrence を自動的に省略しない。
3. cancel、flush、dispose、旧タイマー callback。cancel 前の出力値保持、flush の二重発火禁止まで確認。
4. 保留中の leading/trailing/wait 変更。適用時点が未規定なら現状記録に留め、仕様確認後に期待値を固定。
5. `maxWait` の連続入力、`source` と `trigger` の混在、throttle の既定値と否定属性。上の no-maxWait 表をそのまま throttle に適用しない。

## 7. タグとバインドの連動テスト

Core は処理とイベント、Shell は属性変換・反映・接続・upgrade、binding は初期値適用・双方向更新・ノード間伝播を担当する。全ケースを 3 層で複製せず、その層でしか起きない問題を検証する。

実ノード連動の最初のシナリオは「入力 state → debounce.source → debounce.value → URL を作る state → fetch.url → fetch.value/loading → state / DOM」とする。

- 初期値の適用後、短時間の A→B→C 入力から最終 URL の送信が 1 回だけ起きる。
- 同じ URL を作る更新では追加の自動送信がなく、明示 command では再送できる。
- fetch の応答・loading が state と DOM に反映され、その書き戻しが余計な再送を起こさない。
- debounce 保留中または fetch 実行中のアンマウント後、旧通知が削除済み binding を更新しない。

初期化中のレースは最初の ready を待つ前から記録する。通常の state 操作は [state のテスト手順](../packages/state/README.ja.md#ページをテストする)に従い `getBindingsReady(root)` 後に `createStateAsync("writable")` で行う。要素への直接代入だけで binder を検証したことにしない。

[testing の mount/settle](../packages/testing/README.ja.md) は安定化後の assertion に使えるが、初期化途中の coalesce や保留中のリクエストを観測するケースは段階的に mount し、adapter の完了操作を使う。準備待ちが自動 fetch の完了を待つ場合、fake 応答を解決する前に mount 全体を await して行き詰まらないようにする。

## 8. 非同期を決定的に制御する

- API は fake に置き換え、request A/B ごとの resolve/reject をテストから選ぶ。abort を受けても遅着できる fake を用意し、古い結果の破棄を検証する。
- タイマーは fake clock で期限まで個別に進める。RAF・再試行・継続監視に無制限の run-all を使わない。
- 同期直後、予約 microtask 後、指定 Promise の反応後、指定時刻の callback 後を区別する。適当な回数の `await Promise.resolve()` や実時間の sleep を共通の「完了」としない。
- adapter は何を待つ checkpoint なのかを定義する。公開 operation Promise と fake callback を使い、必要な有限 drain は回数上限・終了条件・タイムアウト時の診断を持つ。
- 「通知なし」は時刻・Promise・callback の有限境界までの主張にする。破棄後の遅着は意図的に callback を注入してから判定する。
- 毎ケース新規 instance を使う。要素の切断と resource の解放を fake が有効な間に行い、その後 listener・mock・時計・設定を復元する。Custom Elements の登録衝突も避ける。
- fake timer/API を使うテストは同じ realm で concurrent 実行しない。

happy-dom の結果はブラウザ固有の permission、user activation、実レイアウト、実デバイス動作の保証ではない。それらに依存するケースは browser integration として別に管理し、headless の pass に含めない。

## 9. 配置と CI

次は作成予定の配置であり、現時点のファイル一覧ではない。

```text
packages/fetch/__tests__/patterns/core.test.ts
packages/fetch/__tests__/patterns/shell.test.ts
packages/fetch/__tests__/patterns/cases.ts
packages/fetch/__tests__/patterns/adapter.ts
packages/debounce/__tests__/patterns/...
packages/fetch/__tests__/patterns/binding.test.ts
test-support/io-patterns/recorder.ts   # After both pilots establish a shared shape.
```

`__tests__` 以下に置けば既存の Vitest include で実行される。初期の helper は各パッケージ内に置く。共有化するときは `test-support/io-patterns/` を唯一のソースとし、production の `io-core` や `src/protocol` にテスト専用依存を入れない。共有 helper は Vitest を直接 import せず、記録データを返し、各 package の Vitest で assertion する。同期済み生成ファイルは直接編集しない。

実タグの binding pilot は fetch パッケージが所有し、必要になった段階で state/debounce をローカル開発依存として宣言し lockfile を更新する。未宣言の兄弟 `node_modules` に依存させない。package export を使う場合は state/debounce をソースからビルドして実行し、古い committed dist に対してだけ緑になるのを防ぐ。

[現在の CI](../.github/workflows/ci.yml) は主に `packages/<name>/` の変更で対象を選ぶ。共有 helper の抽出と同じ変更で、次を追加する。

- `test-support/io-patterns/**` 変更時は全 consumer の package test を選択する。
- fetch/state/debounce、binding fixture、関連する共有 protocol/IO-core ソース、runner、CI 定義の変更時は binding pilot を選択し、依存の install/build を先に行う。
- 新しいタグを参加させるときは consumer 一覧と変更検出を同時に更新する。

新規 CI ジョブを最初に作る必要はない。パッケージ内 pilot は通常の `npm test` に含め、共有化・複数 package の結合時に検出範囲を広げる。意図的に壊した HTML/manifest は永続 fixture にせず、既存の静的検証方針に従う。

## 10. 段階別の成果物と完了条件

| 段階 | 作業 | 完了条件 |
|---|---|---|
| 0: 棚卸し | fetch/debounce の入力分類とケース対応表 | 全候補に根拠・適用層・既存/追加/未決定/非該当と理由がある |
| 1: 単体 pilot | §6 の Core/Shell ケース、パッケージ内 recorder | 仕様確認済みケースが通る。イベント回数・中間 snapshot・禁止出力・終了境界を検証する |
| 2: 連動 pilot | §7 の実タグと state、初期化・書き戻し・破棄 | fresh build で連動が通る。余計な通信と循環更新を検出できる |
| 3: 共通化 | 重複 recorder の抽出、consumer と CI の対応 | helper のみの変更でも対象テストが動く。未知 step は失敗または unsupported |
| 4: タグ展開 | 通信、observer、継続処理、managed resource の代表へ展開 | タグごとの適用表があり、未検証のタグを全体 pass と表示しない |

各実装 PR は対象ケースのテスト、当該パッケージの通常テスト・coverage・lint・build を実行する。共有変更は consumer 全体、結合変更は依存を含めて実行する。新しい root `package.json` は作らない。

導入予定ファイルができた後のローカル実行例（各パッケージ内）:

```sh
npx vitest run __tests__/patterns/core.test.ts __tests__/patterns/shell.test.ts
npm test
npm run test:coverage
npm run lint
npm run build
```

pilot 完了前に検出力も確認する。例: 一時的に余分な自動 fetch を許す、debounce の末尾値を先頭値に変える、失効結果を通知する、という既知の誤動作をそれぞれ対象ケースが検出することを確認する。変更は確実に戻し、通常コードで再実行する。runtime の検査用フラグは追加しない。

報告は `case ID / tag / layer / status / basis / failure checkpoint` を含める。pass、fail、未実装、未決定、unsupported、非該当を区別する。coverage の数値とケース対応表を併記し、失敗時には期待トレースと実トレースの最初の差分を出す。

最初の実装 PR は **fetch の自動実行・manual・URL の順序と同値ケース、および debounce の 8 基礎ケース**に絞る。既存テストとの対応を確定し、禁止出力を観測できる recorder が成立してから、非同期競合とノード間連動へ進む。
