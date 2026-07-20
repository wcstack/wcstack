# 実装設計: `$streams` — state への stream 供給源の追加

- **状態**: 設計確定（実装前）。親文書 [state-stream-type-design.md](./state-stream-type-design.md) の未決論点をすべて決定し、実装可能な粒度に落としたもの。
- **対象**: `@wcstack/state` の core 拡張。外部の連続フロー（async iterable / ReadableStream / async generator）を fold して単一の reactive プロパティに適合させる。
- **参照仕様**: `packages/signals/src/streamResource.ts` とそのテスト（16 ケース）。adapter のセマンティクス（restart リセット・error 保持・fold 既定 latest・getReader フォールバック・stale-drop）は signals PoC で確定済みの共有契約をそのまま継承する。
- **スコープ再掲**: 「汎用 Streams パイプライン / backpressure 保持」ではなく「**async producer を fold して reactive property にする adapter**」。backpressure は明示的に放棄する（親文書 §4-3）。

---

## 0. 決定レコード

親文書 §4 の未決論点に対する決定（2026-07-11）。

| ゲート | 論点 | 決定 |
|---|---|---|
| **A-1** | 依存の捕捉方式 | **`args` 関数の分離**（signals `streamResource` と同型）。依存追跡の対象を同期関数 `args(state)` に限定し、`source` は args の評価値と AbortSignal のみを受ける。source は state を受けない（依存の抜け道を塞ぐ）。 |
| **A-2** | restart の発火機構 | **updater の drain 終了フック**。バッチ内の更新アドレスと各 stream の依存パス集合を交差させ、hit した stream を restart。1 drain につき 1 stream 最大 1 restart（依存変化の coalesce が自動で付く）。 |
| **A-3** | 起動タイミング | **eager**。`connectedCallback` で `$connectedCallback` 完了後に起動。lazy 起動は将来オプションの余地のみ残す。 |
| **B** | ライフサイクル所有権 | **State 単位**。`disconnectedCallback` で全 stream を abort。binding/構造単位の細粒度停止はスコープ外。 |
| **C** | コンパニオン状態の表現 | **名前空間方式** `$streamStatus.<name>` / `$streamError.<name>`。`$command` 名前空間（`getByAddress` の namespace 分岐 + namespace proxy）を前例として対称実装。state オブジェクト上に実プロパティは持たない。 |

signals PoC で確定済み（再議論しない）: restart 時は `initial` にリセット / error 時は直前値を保持 / fold 既定は latest（置換）・reduce は `initial` 必須 / source は async iterable が lingua franca・`Symbol.asyncIterator` 無しの ReadableStream は `getReader()` フォールバック / stale-drop は `signal.aborted` を全経路でチェック / status は `"idle" | "active" | "done" | "error"` の 4 値。

---

## 1. 宣言構文

`$commandTokens` / `$eventTokens` / `$on` と並ぶ宣言マップ `$streams` を予約する。

```js
export default {
  prompt: "",

  $streams: {
    // フル形: LLM トークンストリームを累積
    tokens: {
      args:    (state) => state.prompt,                   // 依存はここでのみ捕捉される
      source:  (prompt, signal) => llmStream(prompt, signal),
      fold:    (acc, chunk) => acc + chunk,               // reduce（累積）
      initial: "",                                        // fold 指定時は必須
    },

    // 最小形: fold 省略 = latest（最新チャンクで置換）、args 省略 = 一度だけ起動
    ticker: {
      source: (_args, signal) => priceStream(signal),
    },
  },
}
```

```html
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>
<p data-wcs="textContent: $streamError.tokens"></p>
```

### 1-1. 各フィールドの契約

| フィールド | 型 | 必須 | 契約 |
|---|---|---|---|
| `source` | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<同>` | ✔ | AbortSignal を **必ず尊重すること**（協調キャンセル契約、signals と同文言）。restart/破棄はこの signal で駆動される。 |
| `args` | `(state) => any` | — | **同期・純粋関数**。readonly proxy を受け、ここで読んだパスが依存として捕捉される。省略時は依存なし（起動後 restart しない）。戻り値はそのまま `source` の第 1 引数になる（複数値はオブジェクト/配列で束ねる）。 |
| `fold` | `(acc, chunk) => next` | — | **同期関数**。省略時は latest（チャンクで置換）。**新しい値を返すこと**（acc の in-place 変異は非サポート、§6-2）。 |
| `initial` | any | fold 指定時 ✔ | 初期値。起動・restart のたびに値はこれにリセットされる。 |

### 1-2. バリデーション（`processStreamsDeclaration` にて raiseError）

- `$streams` はオブジェクトであること（`$on` の検証と同文言レベル）。
- 各エントリ名（stream プロパティ名）:
  - **フラットなプロパティ名のみ**。`.`（DELIMITER）や `*`（WILDCARD）を含む名前はエラー（第 1 段スコープ外）。
  - getter / setter として宣言済みのパスと衝突しないこと（`getterPaths` / `setterPaths` を検査）。
  - `$` で始まらないこと（予約名前空間との衝突防止）。
  - **Object.prototype の継承名でないこと**（`__proto__` / `constructor` / `toString` 等。判定は `name in Object.prototype`）。own key でなくても `name in state` が真になるため実体化（§1-3）が skip され、起動時の initial リセット（proxy 経由 `Reflect.set`）が継承 setter に化ける — 特に `__proto__` は state の prototype を差し替え、継承キーの `bindableEventMap[path]` 誤 hit と併せて接続経路を不透明に破壊するため、宣言時に一律拒否する（外部レビュー 2026-07-12 指摘 2）。なおオブジェクトリテラルの `__proto__:` キーは prototype 指定構文で own key にならず、宣言としては黙って無視される（`Object.entries` に現れないため検出不能）。
- `source` は関数であること。`fold` は（あれば）関数であること。`fold` があるのに `initial` が無ければエラー。
- `args` は（あれば）関数であること。評価結果が Promise ならエラー（同期契約）。

### 1-3. 値プロパティの実体化

パース時に `state[name]` が未定義なら `initial`（fold 無しなら `undefined`）でデータプロパティとして初期化する。これにより:

- 起動前（および SSR 時）の binding 初期レンダが `initial` を表示できる。
- パス機構上、`tokens` は最初から普通のプロパティとして存在する（get/set トラップに特殊分岐は不要）。

ユーザーが state 側に同名のデータプロパティを先に宣言していてもよいが、**起動時に値は `initial` で上書きされる**（起動 = 最初の run も restart と同一セマンティクス）。起動後のプロパティは stream runtime の所有物であり、ユーザーコードからの直接代入は禁止しない（技術的には普通のプロパティ）が動作は未定義（次の fold は代入後の値の上に畳む）と規範化する。

---

## 2. ランタイムモデル

### 2-1. registry（`stream/streamRegistry.ts`）

`eventTokenRegistry` と対称の `WeakMap<IStateElement, Map<string, IStreamEntry>>`。

```ts
interface IStreamEntry {
  name: string;
  definition: {                    // 宣言由来（不変）
    args?: (state: IStateProxy) => unknown;
    source: StreamSource;
    fold: (acc: unknown, chunk: unknown) => unknown;   // 既定 latest を注入済み
    initial: unknown;
  };
  status: StreamStatus;            // "idle" | "active" | "done" | "error"
  error: unknown;                  // 初期 null、(re)start で null にリセット
  controller: AbortController | null;
  depAddresses: Set<IAbsoluteStateAddress>;  // 直近の args 評価で読まれた絶対アドレス
}
```

- `status` / `error` は **registry entry が正本**。state オブジェクト上には置かない（§4）。
- `AbsoluteStateAddress` はキャッシュにより同一 `(stateName, path)` が同一インスタンスになるため、`depAddresses` は `Set.has` の O(1) 照合で drain バッチと交差できる（updater の重複排除と同じ性質を利用）。

### 2-2. ライフサイクル状態機械

```
(宣言)──parse──▶ idle ──start(connect)──▶ active ──正常終端──▶ done
                  ▲                        │  │
                  │                        │  └──throw/reject──▶ error
                  └──disconnect(abort)─────┤
                                           └──依存変化──▶ (abort→reset→再起動) active
```

- **start**（初回・再接続・restart 共通）: `controller.abort()`（あれば）→ 新 `AbortController` → `args` 再評価（依存再捕捉、§3-1）→ 値を `initial` にリセット（writable proxy 経由 set）→ `status="active"`・`error=null`（§4-3 の反映経路）→ `source(argsValue, signal)` を起動し consume 開始。
- **done / error からも依存変化で restart する**（再試行 = 依存の叩き直し、親文書 §4-5 のとおり自動再接続は無い）。
- **disconnect**: 全 entry を abort し `status="idle"` に戻す。registry 自体は保持する（§5-2）。

### 2-3. State ライフサイクルへの接続（`components/State.ts`）

| 接続点 | 処理 |
|---|---|
| `_state` セッター | `clearStreamRegistry(this)`（旧 stream を abort して全削除）→ `processStreamsDeclaration(this, value)`。`clearEventTokenRegistry` → `processOnDeclaration` と同じ「再 set 時の二重配線防止」パターン。接続済みで再 set された場合は続けて起動。 |
| `connectedCallback` | `_callStateConnectedCallback()` の **後**に `startStreams(this)`。`$connectedCallback` で仕込んだ初期値を args が読めるようにするための後置。`inSsr()` 時は起動しない（§7-1）。 |
| `disconnectedCallback` | `abortAllStreams(this)`（abort + status を idle へ。registry は保持）。`clearCommandTokenRegistry` 等と並べて呼ぶ。 |

再接続（DOM 移動等で disconnect → connect）時は `connectedCallback` の `startStreams` が再び走り、**initial から再開**する（restart と同一セマンティクス。「切断前の続きから」は保証しない）。

実装補足（Phase A で確定）:
- disconnect 時に `stateElementByName` の名前登録が解除され再接続で復元されない既存バグがあり、再接続セマンティクスが原理的に成立しなかったため、`connectedCallback` に「initialized 済みかつ登録済みが自分でなければ再登録」の分岐を追加した（DCC 経路は除外）。既知の制限: 切断中に同名の別 state 要素が同じルートに登録されると、再接続の再登録は初回接続の同名重複と同じ `already registered` raiseError で失敗する（同名重複自体が既存のエラー条件で、失敗態様は一貫。衝突した要素は「接続済み・未登録」に陥り次の切断で throw する後続破綻があるため、graceful degradation は §11 の残課題）。
- `connectedCallback` 側の `startStreams` は `_rootNode !== null` ガード必須（`$connectedCallback` の await 中に切断されると `createState` の rootNode 解決で throw し `connectedCallbackPromise` が未解決のままになる）。`_state` セッター側のガードと対称。
- `_rootNode` ガードだけでは「await 中の切断 → **即再接続**」（DOM 移動・router remount 相当）を防げない: 新 connect が `_rootNode` を再設定済みのため陳腐化した旧 connect の再開がガードを素通りし、旧・新の双方が `startStreams` を実行して同一の再接続に対し source が二重起動する（旧 connect 側の起動は新 connect の `$connectedCallback` 完了を待たず、S1 の順序保証も一時的に破る）。connect 世代カウンタ `_connectGeneration`（`connectedCallback` 冒頭でインクリメントして捕捉し、末尾の `startStreams` 前に一致を検査）で陳腐 connect からの起動を skip する（特性化: `stream.lifecycle.test.ts` S12 補3。外部レビュー 2026-07-12 指摘 1）。
- `$connectedCallback` 実行中にユーザーコードが `setInitialState` を呼んだ場合（connect 処理と接続中再 set の同居）、`_state` セッター側の `startStreams`（`_initialized && _rootNode !== null` が真）が新宣言を即起動する。セッター起動時の connect 世代を記録する `_streamsStartedGeneration`（世代が進めば不一致となり自然に無効化 — サイクル単位のフラグリセット相当）で `connectedCallback` 末尾の `startStreams` を skip し、同一 connect 内で新宣言の source が 2 回起動する冗長（1 回目は即 abort — switchMap 意味論で状態は壊れないが副作用を持つ source が 2 回発火）を防ぐ（特性化: `stream.lifecycle.test.ts` S13 補3）。

---

## 3. 依存駆動の cancel / restart（A-1 / A-2）

### 3-1. args トレース（依存捕捉）

- 起動・restart の**たびに** `args` を再評価し、依存を**再捕捉**する（per-run の動的追跡。評議会 Gate 1 の「動的深追跡」と整合）。
- 評価は `stateElement.createState("readonly", ...)` の readonly proxy 上で行う。書き込みは readonly proxy が既に防ぐ。
- 捕捉機構: モジュールスコープの collector（`Set<IAbsoluteStateAddress> | null`）を立てて `args` を呼ぶ。`getByAddress` の入口（`checkDependency` 呼び出しと同位置）に「collector が active なら絶対アドレスを追加」の 1 フックを足す。getter（computed）のキャッシュ命中時は getter 自身のアドレスだけが記録されるが、依存変化時は `walkDependency` が getter のアドレスもバッチに載せるため照合は成立する（どちらのケースでも hit する）。
- **自己依存の禁止**: 捕捉結果に自分自身（`<name>` / `$streamStatus.<name>` / `$streamError.<name>`）が含まれていたら `raiseError`。restart が自分の書き込みで再発火する無限ループを検出する。検出時点の注意: getter キャッシュ命中時は初回トレースで内側の読みが捕捉されないため、検出が後続の再トレースまで遅延し、eager 起動の loud fail でなく drain 経路の error 正規化として表面化する場合がある（いずれにせよ有限回で検出・停止する）。
- **トレース失敗時の依存保持**: `traceArgs` が throw（ユーザー例外・Promise 違反・自己依存・wildcard）した場合、今回の未検査の捕捉は不採用とし、**前回成功 run の検証済み `depAddresses` を保持**する。これにより一時的な args throw で stream が「依存変化でも二度と restart しない error」に固着せず、§2-2 の「error からも依存の叩き直しで再試行」が保たれる（保持されるのは検査済み捕捉のみなのでループ安全）。
- **wildcard 読みの禁止**: 捕捉結果に wildcard を含むパスが入ったら `raiseError`（第 1 段スコープ外。`$getAll` 等の利用も同様）。

### 3-2. drain フックと restart 発火（A-2）

`updater/updater.ts` に drain 終了通知を追加する:

```ts
// updater.ts（追加分の骨子）
type UpdateBatchListener = (batch: ReadonlySet<IAbsoluteStateAddress>) => void;
export function registerUpdateBatchListener(listener: UpdateBatchListener): void;

private _applyChange(absoluteAddresses: IAbsoluteStateAddress[]): void {
  const absoluteAddressSet = new Set(absoluteAddresses);
  // ...既存の binding 適用...
  notifyUpdateBatchListeners(absoluteAddressSet);   // ★ 末尾に追加
}
```

stream runtime はモジュール初期化時にリスナーを 1 つ登録し、drain ごとに:

1. 各 connected な stateElement の各 entry について `entry.depAddresses ∩ batch` を判定（インスタンス同一性による `Set.has`）。
2. hit した entry を restart（§2-2 の start 手順）。**1 drain につき 1 entry 最大 1 回** — 同一 tick 内の複数依存書き込みは自動的に 1 restart に畳まれる（fetch の `_scheduleAutoFetch` と同じ「決定を microtask に遅延し最終状態で 1 回判断」パターン）。
3. drain リスナー内の restart は **entry ごとに try/catch** し、throw（args のユーザー例外・Promise 同期契約違反等）は error 経路（`status="error"`・`$streamError` 格納）に正規化する — updater の drain を壊さず、他 entry の restart も継続する。eager 起動（connect 時）の throw は既存の `$connectedCallback` と同じく loud fail のまま（Phase A の挙動を維持）。

順序と再入の整理:

- restart 内の「値リセット」「status 更新」の書き込みは**新しい microtask バッチ**を作る（drain 再入ではない）。自己依存禁止（§3-1）により restart 書き込みが再び自分の depAddresses と交差することはなく、ループしない。
- **stream 間の連鎖は正当**: stream A の値を stream B の `args` が読む場合、A のチャンク書き込み → drain → B が restart、と自然に連鎖する（switchMap のチェーン相当）。`$streamStatus.A` を B の args が読む status 依存の連鎖も同様に成立する。**依存捕捉される読み方は dotted ブラケット形 `s["$streamStatus.a"]` が正規形** — チェーン形 `s.$streamStatus.a` は値は読めるが namespace proxy 経由で `getByAddress` を通らないため依存が捕捉されず、連鎖が無音で切れる（args / getter 内では dotted 形を使うこと）。
- 既知の冗長（許容）: A のチャンク反映と A の依存書き込みが同一バッチに同居した連鎖では、B が同一 args 値で 2 回連続 restart され得る（直前 run は協調キャンセルで即 abort・最終状態は switchMap 意味論どおり収束。副作用を持つ source はこの冗長に耐えること）。
- **相互依存サイクルは footgun（MUST NOT）**: A の args が B の値を読み、B の args が A の値を読むと、restart の initial リセットが互いの依存に当たり続けて無限 restart になる。自己依存（§3-1）と異なりサイクルは動的検出しない（有界 fold 規範と同じくユーザー責務として規範化。将来必要なら restart 予算等の緩和を検討）。
- 同一 drain に「A のチャンク反映」と「A 自身の restart トリガ（依存変化）」が同居した場合、restart が勝つ（abort → initial リセット）。switchMap の意味論どおり。
- 未接続（disconnect 済み）の stateElement の entry は restart しない。

### 3-3. consume（チャンク消費）

`packages/signals/src/streamResource.ts` の `consume` / `iterate` / `readableToAsyncIterable` を `stream/consumeSource.ts` としてほぼそのまま移植する（パッケージ間依存は持たない。wcstack の各パッケージ自己完結原則）。移植で維持する要点:

- iterator を**明示的に**取得し、abort 時に `iterator.return()` を呼ぶ（async generator の finally 救済）。`return()` の throw/reject は握りつぶす。
- `source(...)` の await 中に abort された場合も、解決後の iterator に `return()` を発火。
- ReadableStream（getReader を持つもの）は**常に** `getReader()` 経路で消費する（2026-07-21 修正: 当初は `Symbol.asyncIterator` 優先のフォールバック扱いだったが、native ReadableStream が async-iterable な環境（Node 18+ / Chrome 124+ / Firefox）では仕様が `iterator.return()` を pending `next()` の後ろに直列化（[[ongoingPromise]]）するため parked read を強制解放できず、無音ストリームの abort がハング／リソースリークしていた）。abort 時は `reader.cancel()` で parked read を強制解放、done まで消費された場合は cancel しない。
- stale-drop: チャンク到着・正常終端・throw の全経路で `signal.aborted` をチェックし、abort 済み run の影響を落とす（done にもしない・error にもしない）。
- 非 AsyncIterable / 非 ReadableStream の source 戻り値は明示的 TypeError。

state 固有の差分:

- チャンク反映は `stateElement.createState("writable", s => { s[name] = fold(current, chunk) })`。`current` は同 proxy 経由で読む（signals の `value.peek()` 相当）。`setByAddress` を通るため **updater coalesce・sameValueGuard・walkDependency（stream 値に依存する computed の dirty 化）がすべて自動で乗る**。
- **fold が throw した場合も error 経路に正規化し、加えて `controller.abort()` で producer を掃除する**（signals PoC では fold throw 時に iterator が return されない微リークがあり、state 版で明確化する。signals 側への逆輸入は別リポジトリ課題として扱う）。

---

## 4. コンパニオン名前空間 `$streamStatus` / `$streamError`（C）

### 4-1. 表現

- `$streamStatus.<name>` → `"idle" | "active" | "done" | "error"`
- `$streamError.<name>` → 直近のエラー（無ければ `null`。(re)start で `null` にリセット）
- 正本は registry entry。state オブジェクト上に実プロパティは**持たない**。未宣言名へのアクセスは `undefined`（`$command` と同じ寛容規約 — `then` / `constructor` 等を内部機構が触っても throw しない）。

### 4-2. 読み取り経路（2 箇所に対称実装を追加）

1. **binding パス解決**: `getByAddress` の `$command` namespace 分岐（`_getByAddress` 冒頭）の直後に、第 1 セグメントが `$streamStatus` / `$streamError` の場合の分岐を追加。registry から現在値を返す。これで `data-wcs="textContent: $streamStatus.tokens"` が既存の binding 機構でそのまま解決される（`$command.<name>` を右辺に書ける既存前例と同型）。
2. **JS からの直接アクセス**: proxy get トラップの switch に `STATE_STREAM_STATUS_NAMESPACE_NAME` / `STATE_STREAM_ERROR_NAMESPACE_NAME` の case を追加し、`commandNamespace` と対称の **read-only namespace proxy** を返す（`set` / `deleteProperty` は raiseError、`ownKeys` は宣言済み stream 名）。

書き込み防御は自然に成立する: two-way binding 等で `$streamStatus.tokens` への set が走ると、`setByAddress` の親走査が namespace proxy に到達し `Reflect.set` が raiseError で落ちる。既知の許容: `sameValueGuard`（既定 ON）が親走査より先に評価されるため、**現在値と同値の primitive（または null）** の代入は raiseError せず黙って no-op になる（ガードの対象は primitive / null のみ — オブジェクト値はガードを素通りするため、`$streamError` が保持する Error インスタンスそのものの再代入でも raiseError する。registry/DOM の破壊は起きず、誤用診断が遅延するのみ）。

### 4-3. 反映経路（reactive 化）

status / error の変化時、runtime は registry を書き換えたうえで **writable proxy の `$postUpdate("$streamStatus.<name>")`** を呼ぶ。`$postUpdate` は out-of-band 変更向けの既存 API で、updater への enqueue と `walkDependency`（依存 computed の dirty 化 + enqueue）を両方行うため:

- `$streamStatus.tokens` を束縛した binding が次の drain で更新される。
- `get isStreaming() { return this["$streamStatus.tokens"] === "active" }` のような **status を読む computed も正しく無効化される**（getter 内の読みは `checkDependency` が動的依存として登録済み）。

同値の status を再セットする場合は runtime 側で skip する（`setByAddress` を通らないため sameValueGuard は効かない。同等の same-value 判定を runtime が持つ）。

**通知 dedup の基準（Phase B で確定）**: same-value 判定は entry フィールドとの比較ではなく「**最後に通知した観測値**」（stateElement 寿命の WeakMap）に対して行う。entry は再 set（`clearStreamRegistry` → 再生成）で作り直されるため、entry 比較では「error 表示中に再 set → 新 entry は error=null で誕生 → null→null と誤判定して通知が落ち、DOM に旧 error が残る」。dedup 状態を観測層（stateElement 単位）に置くことで、再 set・再接続を跨いだ陳腐化を正しく検出する。

**無通知ミューテーションとの同期（Phase B レビューで確定）**: `abortAllStreams`（§5-1）は registry entry を通知なしで `idle` / `null` に直接ミューテーションするため、台帳と registry が乖離する。binding / computed の fresh 読みは通知がなくても他パスの drain で走り、再接続ウィンドウ内に registry の `idle` を描画し得る。そのまま restart の `updateStreamStatus("active")` を台帳（切断前の `active`）との同値判定で skip すると DOM が恒久的に陳腐化するため、abortAllStreams はミューテーションと同時に台帳のうちミューテーション後の値と一致しないフィールドを「観測値不確定」として無効化し、次回の通知 dedup を強制解除する（`stream/lastNotified.ts`）。一致しているフィールド（例: error が `null` のまま）は dedup を維持し、余計な通知は出さない。

**台帳の prune（外部レビュー 2026-07-12 指摘 3）**: 台帳は stateElement 寿命で生存するが、再 set 跨ぎ dedup が必要なのは**同名エントリのみ**。旧宣言にしか存在しない名前のエントリは以後どの通知経路からも参照されないため、再 set（`processStreamsDeclaration` — 新宣言を知っている唯一の位置）で新宣言に無い名前を prune する（`$streams` 無し宣言への再 set は全削除）。放置すると再 set のたびに異なる stream 名を使うステートで台帳が単調増加する。既知の許容: prune 後に同名を**再宣言**した場合、dedup は基準値 { idle, null } からやり直しになる（宣言削除時の binding 陳腐化が §4-4 の既知エッジである以上、削除を挟んだ再宣言は新規宣言と同じ扱い。§4-4 の「同名入れ替え」= 1 回の再 set で同名が新宣言にも居るケースは prune 対象外で、従来どおり正しく追従する）。

### 4-4. 観測保証

- 中間 status の観測は保証しない。coalesce により同一 tick 内の `active → done` 遷移は最終値しか binding に見えないことがある（updater の既存契約と同じ）。
- `$updatedCallback` の paths には `<name>` / `$streamStatus.<name>` / `$streamError.<name>` が通常の更新として載る。
- 既知エッジ（第 1 段の許容）: 再 set で stream 宣言自体が**消えた**場合、その `$streamStatus.<name>` 等の binding には削除の通知が飛ばず直前表示が残る（以後の読みは undefined 解決）。宣言の同名入れ替えは §4-3 の dedup 基準により正しく追従する。

---

## 5. ライフサイクル所有権（B）

### 5-1. disconnect → abort

`State.disconnectedCallback` で `abortAllStreams(this)`: 全 entry の `controller.abort()` → `status="idle"`・`error=null` に戻す（$postUpdate は呼ばない — 切断済みで binding 更新は不要かつ rootNode が無い）。

### 5-2. registry の生存期間

- **disconnect では registry を削除しない**（abort のみ）。宣言情報は `_state` に紐づくため、再接続時に `startStreams` が同じ定義から再起動できる。
- **`_state` 再 set 時のみ `clearStreamRegistry`**（abort + 全削除 → 新宣言で再構築）。`clearEventTokenRegistry` → `processOnDeclaration` の再配線パターンと同じ位置に置く。
- 決定 B の「State 単位で abort」はこの 2 段（disconnect=abort / re-set=full clear）に精密化する。

### 5-3. スコープ外

binding / 構造（`deactivateContent`）単位の細粒度停止・再開は第 1 段では行わない。stream の生存は `<wcs-state>` 要素の接続状態にのみ従う。

---

## 6. 更新サイクルとの整合

### 6-1. coalesce（2026-07-11 改定 — Phase A 実測で粒度を確定）

- fold は**各チャンクに**適用（値は正確に畳まれる）。binding 反映は updater の microtask バッチ単位 — **同一 microtask ジョブ内に書かれた複数更新は 1 flush に畳まれる**が、async iterator 経由のチャンクは `await iterator.next()` ごとに別ジョブで届くため、**通常はチャンクごとに 1 drain** となる（初版の「1 tick に N チャンク → flush 1 回」は構造的に不成立だったため改定）。これは signals PoC（effect スケジューラ）と同一挙動＝共有契約であり、flush レートはチャンク到着レートに有界。専用の chunk coalesce 機構は追加しない（高頻度 producer の間引きは producer 側・fold 設計・`wcs-debounce` 系の責務）。
- 1 tick 内の複数依存書き込み: drain フック方式（§3-2）により restart は 1 回。

### 6-2. sameValueGuard（既定 ON）との交互作用

- latest fold で同値の primitive チャンクが連続する場合、`setByAddress` の same-value guard が set/enqueue/依存 walk を丸ごとスキップする。**望ましい挙動**であり仕様とする（binding 更新なし・`$updatedCallback` にも載らない）。
- 参照型は guard 素通しのため、**fold は毎回新しい値を返すこと（in-place 変異の禁止）**を規範化する。`(acc, chunk) => { acc.push(chunk); return acc; }` は非サポート（list diff / same-value 双方と噛み合わない）。正: `(acc, chunk) => [...acc.slice(-99), chunk]`（有界 fold の推奨形でもある）。

### 6-3. 有界 fold 規範（backpressure 放棄の帰結・再掲）

需要は producer に逆流しない。無限/長寿命ストリームでは latest・count・last-N・ウィンドウ集計など**有界な fold** を使うこと（MUST）。生の全チャンク累積は有限ストリーム限定。README / SPEC に明記する。

---

## 7. 環境・境界

### 7-1. SSR（`@wcstack/server`）

- `inSsr()` 時、`$streams` の**パースと値プロパティの実体化（`initial`）は行うが、起動はしない**。SSR 出力には `initial` が乗る。
- `enable-ssr` のクライアント側は通常どおり起動する（stream はシリアライズ不能なランタイム副作用であり、SSR データ引き継ぎの対象は値プロパティのみ）。

### 7-2. DCC（`data-wc-definition`）

未サポートなのは **DCC 定義要素の `_initializeDCC` 経路のみ**（2026-07-11 精密化）:

- **定義ホスト**（`data-wc-definition` を持つ要素）内の `<wcs-state>` は `_initializeDCC` 経路で `_state` セッターを通らないため、`$streams` 宣言はパース（registry 登録・値プロパティ実体化）も起動もされない（宣言があっても無視される）。定義要素側で宣言を扱う場合は defineDCC 側の状態初期化に同じパース＋起動を接続する後続課題とする。
- **DCC インスタンス内の `<wcs-state>` は通常経路で起動する**: defineDCC が template 化した定義を各インスタンスの ShadowRoot に clone するため、インスタンス側の `<wcs-state>` は通常の `_initialize` → `_state` セッター（`processStreamsDeclaration`）→ `connectedCallback` の `startStreams` を通り、`$streams` はインスタンスごとに独立して起動・切断される（特性化: `__tests__/stream.dcc.test.ts`）。

### 7-3. wc-bindable 境界

親文書 §7 の規約（stream サーフェスを追加しない / live ハンドルは binding 境界を越えない / チャンクは event-token・制御は command-token・畳み込み値はただの property）は本設計でそのまま維持される。`$streams` は「外部 → state」の供給経路であり、境界プロトコルには一切触れない。

---

## 8. 第 1 段スコープ外（明文リスト）

1. wildcard / ドット付きパスを stream 名にすること、および args 内での wildcard 読み（いずれも raiseError）。
2. async fold。
3. Observable（`subscribe` 型）の取り込み（async iterable への変換はユーザー責務）。
4. 自動再接続（再試行は依存の叩き直し）。
5. lazy 起動（将来 `lazy: true` オプションの余地のみ残す）。
6. binding / 構造単位の細粒度停止。
7. DCC **定義要素**（`_initializeDCC` 経路）での `$streams` の起動（インスタンス内 `<wcs-state>` は通常経路で起動する、§7-2）。
8. backpressure の保持（恒久的な非目標）。

---

## 9. 実装計画

### 9-1. ファイル一覧

**新規（`packages/state/src/stream/`）**

| ファイル | 内容 |
|---|---|
| `types.ts` | `StreamStatus` / `IStreamDefinition` / `IStreamEntry` / `StreamSource` |
| `processStreamsDeclaration.ts` | 宣言のバリデーション（§1-2）・registry 登録・値プロパティ実体化（§1-3） |
| `streamRegistry.ts` | `WeakMap` registry・`setStreamEntries` / `getStreamEntries` / `abortAllStreams` / `clearStreamRegistry`（`eventTokenRegistry` と対称） |
| `streamRuntime.ts` | `startStreams` / restart 手順（§2-2）・drain リスナー（§3-2）・status/error 反映（§4-3） |
| `argsTrace.ts` | args の依存捕捉（readonly proxy トレース・自己依存 / wildcard 検査、§3-1）。getByAddress → argsTrace ← streamRuntime の一方向依存に保つ import 循環回避の分割 |
| `consumeSource.ts` | signals `streamResource` の `consume` / `iterate` / `readableToAsyncIterable` 移植（§3-3） |
| `streamNamespace.ts` | `$streamStatus` / `$streamError` の read-only namespace proxy（`commandNamespace` と対称） |
| `lastNotified.ts` | 「最後に通知した観測値」台帳（§4-3 の dedup 基準・abortAllStreams の無通知ミューテーション invalidate） |
| `activeStateElements.ts` | 起動中 stateElement の列挙用 strong Set（§3-2 の drain リスナーの走査元。add = startStreams / delete = abortAllStreams・clearStreamRegistry のリーク防止不変条件） |

**変更**

| ファイル | 変更 |
|---|---|
| `define.ts` | `STATE_STREAMS_NAME = "$streams"` / `STATE_STREAM_STATUS_NAMESPACE_NAME = "$streamStatus"` / `STATE_STREAM_ERROR_NAMESPACE_NAME = "$streamError"` |
| `components/State.ts` | `_state` セッター（clear → parse）・`connectedCallback`（startStreams）・`disconnectedCallback`（abortAllStreams） |
| `updater/updater.ts` | `registerUpdateBatchListener` + `_applyChange` 末尾の通知（§3-2） |
| `proxy/traps/get.ts` | namespace 2 case 追加（§4-2） |
| `proxy/methods/getByAddress.ts` | namespace 分岐追加（§4-2）+ args トレース collector フック（§3-1） |

### 9-2. フェーズ分割

1. **Phase A — 供給の背骨**: 宣言パース + registry + eager 起動 + consume 移植 + チャンク書き込み + done/error + disconnect abort。依存 restart なし（`args` は受理するが未配線）。signals 由来テストの大半がここで通る。
2. **Phase B — コンパニオン**: namespace 2 系統の読み（binding / JS）と `$postUpdate` 反映、書き込み防御。
3. **Phase C — 依存駆動 restart**: args トレース + drain フック + restart（本設計の核心）。自己依存 / wildcard 検査。
4. **Phase D — 仕上げ**: SPEC.md / README（ja/en）追記（有界 fold 規範・協調キャンセル契約・スコープ外リスト）、example 1 本（fetch body streaming → text 累積、または fake LLM トークンデモ）、カバレッジ 100/97/100/100。

### 9-3. テスト戦略

happy-dom + vitest（既存パターン）。fake source ヘルパ（手動 resolve 制御の async generator / fake ReadableStream）を `__tests__/helpers` に用意。updater の drain は `testApplyChange` で決定的に駆動できる。

---

## 10. 受け入れ条件（テストマトリクス）

### 10-1. signals 参照仕様からの移植（16 → state 語彙へ）

| # | ケース | state での形 |
|---|---|---|
| P1 | latest（既定 fold）: 最後のチャンクに置換、終了で done | `state.ticker` が最終チャンク、`$streamStatus.ticker === "done"` |
| P2 | reduce fold: チャンクを累積 | `tokens` が `initial` から累積 |
| P3 | initial で初期値 | 起動前・起動直後の `state.tokens === initial` |
| P4 | getReader フォールバック | `Symbol.asyncIterator` 無し ReadableStream 風を消費 |
| P5 | args 変化で abort → initial リセット → 張り直し | 依存パス書き込み → drain → restart（§10-2 S5 系と統合） |
| P6 | 実エラーは error/status に出る（直前値保持） | `$streamError` 格納・`tokens` は直前の fold 結果のまま |
| P7 | source の同期 throw も error に正規化 | 同左 |
| P8 | 非 AsyncIterable/ReadableStream は明示 TypeError | 同左 |
| P9 | abort が throw として現れても error にしない | restart/disconnect 起因の throw は握りつぶし |
| P10 | 空 source のまま abort された run は done にしない | 同左 |
| P11 | 未消費 ReadableStream の abort は `reader.cancel()` で解放 | 同左 |
| P12 | done まで消費されたら cancel は呼ばない | 同左 |
| P13 | abort 時に iterator の `return()` を呼ぶ（finally 救済） | 同左 |
| P14 | `return()` の reject/throw で teardown が壊れない | 同左 |
| P15 | source の await 中 abort → 解決後 iterator に `return()` | 同左 |
| P16 | dispose で in-flight を止める（owner 連動） | disconnect で abort（S12 と統合） |

### 10-2. state 固有

| # | ケース | 検証点 |
|---|---|---|
| S1 | eager 起動 | connect 完了で `$streamStatus === "active"`、`$connectedCallback` の後に args 評価 |
| S2 | SSR 非起動 | `inSsr()` で source が呼ばれない・値は initial のまま |
| S3 | チャンク反映粒度 | fold は N 回正確に適用。同一ジョブ内の複数書き込みは flush 1 回・ジョブ境界を跨ぐチャンクはチャンクごとに 1 drain（§6-1 改定どおり・特性化テストで固定） |
| S4 | sameValueGuard | 同値 primitive チャンク → binding 更新なし |
| S5 | restart の coalesce | 1 tick に同一依存を複数回書き → restart ちょうど 1 回 |
| S6 | 無関係パス書き込み → restart しない | depAddresses 交差なし |
| S7 | computed 経由の依存 | args が getter を読む → getter の依存元の変化で restart |
| S8 | 自己依存の検出 | args が自 name / 自 status を読む → raiseError |
| S9 | `$streamStatus.<name>` の binding 反応 | idle→active→done が（coalesce 保証の範囲で）反映 |
| S10 | `$streamError.<name>` の binding 反応 | error 時に格納・restart で null |
| S11 | 名前空間への書き込み防御 | two-way / 直接代入 → raiseError |
| S12 | disconnect → abort、再接続 → initial から再開 | P16 統合。再接続で「続きから」にならないこと |
| S13 | `_state` 再 set | 旧 stream abort・新宣言で再構築・二重起動なし |
| S14 | fold throw | error 経路 + producer が abort される（P6 との差分） |
| S15 | 宣言バリデーション | §1-2 の各違反が raiseError |
| S16 | stream 値に依存する computed | チャンク到着で computed が dirty 化・再計算 |
| S17 | `$updatedCallback` | paths に `<name>` / `$streamStatus.<name>` が載る |
| S18 | stream 間連鎖 | A の値を B の args が読む → A の更新で B が restart |

---

## 11. 残課題（実装中に確定）

1. **TS 型の公開範囲**: `IState` への `$streams` 型付与と、`packages/vscode-wcs`（インライン script の言語機能）への型供給。実装後の別課題。
2. **example の題材**: fetch body streaming（`response.body` → text 累積）を第一候補。SSE/wcs-ws との併用デモは event-token 経路との使い分けを README で説明したうえで検討。
3. **signals への逆輸入**: fold throw 時の producer abort（§3-3）は signals `streamResource` にも適用すべき明確化。別 PR。
4. **リリース**: 挙動追加のため次リリースは minor bump（他パッケージとのバージョン揃え運用に従う）。
5. **consumeSource の suspendedStart 硬化**: source の await 中に abort され、解決値が `Symbol.asyncIterator` を持たない生 ReadableStream だった場合、未起動 generator への `return()` は本体（`getReader()` / finally）を実行せずに完了するため `reader.cancel()` に到達しない（signals 原本と同一挙動・協調キャンセル契約 MUST が担保線）。「aborted-after-await かつ生 ReadableStream なら `produced.cancel?.()` を直呼び」の硬化を、§11-3 の逆輸入とセットで検討。
6. **再接続の同名衝突の graceful degradation**: 切断中に同名の別 state 要素が登録された場合の再接続失敗（§2-3 実装補足）は raiseError で loud fail するが、衝突した要素が「接続済み・未登録」に陥り次の切断で同期 throw する後続破綻がある。console.error + スキップ等への軟化を検討（外部レビュー 2026-07-11 指摘 1 の検証で発見）。

---

## 関連

- [state-stream-type-design.md](./state-stream-type-design.md) — 親文書（論点の出自と背景、wc-bindable 境界規約 §7、signals PoC との共有契約 §8）。
- [state-redesign-council.md](./state-redesign-council.md) — Gate 1（動的深追跡の維持）と「async は seam に隔離する」層 2 の判断。本設計はその適用形。
- `packages/signals/src/streamResource.ts` / `packages/signals/__tests__/streamResource.test.ts` — 実行可能な参照仕様と受け入れ条件の原本。
