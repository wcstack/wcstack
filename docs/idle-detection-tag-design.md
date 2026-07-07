# 設計メモ: `@wcstack/idle`（`<wcs-idle>`）

- **状態**: 実装済み（`packages/idle`）。本文書は実装時の論点整理と決定事項の記録。
- **対象 WebAPI**: Idle Detection API（`new IdleDetector()`、静的 `IdleDetector.requestPermission()`、インスタンスの `.start({threshold, signal})`（Promise）、`'change'` イベント、`.userState` / `.screenState`）。
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ2（gesture-gated permission パターン）の1本目。「静的で user gesture 文脈が必須の `requestPermission()` command を公開する」という共有アーキタイプを、`<wcs-permission>` との**合成**という形で最も安く実証する候補として最初の着手対象に選定済み。
- **前提資産**: `permission`（`_permGen` ＋ `_permissionSubscribed` による冪等 observe/dispose、4値 permission state、Core/Shell 分離、never-throw、unsupported フォールバック）、`fetch`/`upload`（単一 `_gen` ＋ `AbortController` による世代ガード）。

---

## 0. 大前提: このノードは `<wcs-permission>` と合成できる — だから状態追跡を重複させない

[permission-tag-design.md](./permission-tag-design.md) §0 は、Permissions API を「`query()` しか持たない read-only API」、機能ノード側を「許可を取りに行くプロデューサ」と位置づけ、両者の責務を割った（`<wcs-permission>` が監視、機能ノードが request）。Idle Detection はこの枠組みに**そのまま乗る**。

Idle Detection には Permissions API 上のエントリ `navigator.permissions.query({name: "idle-detection"})` が実在する。つまり permission の4値状態（`prompt` / `granted` / `denied` / `unsupported`）は、既存の `<wcs-permission name="idle-detection">` が寸分違わず監視できる。`<wcs-idle>` が自前で `PermissionStatus` を購読し `_permGen` 相当のガードを再実装するのは、既にあるものの**車輪の再発明**でしかない。

| | `<wcs-permission name="idle-detection">` | `<wcs-idle>` |
|---|---|---|
| 監視する状態 | permission の4値（prompt/granted/denied/unsupported） | 実際のアイドル状態（userState/screenState） |
| request手段 | なし（Permissions API に request 標準が無い、[permission-tag-design.md](./permission-tag-design.md) §2） | **あり**（`IdleDetector.requestPermission()` という静的メソッドが実在） |
| command | `commands: []`（監視専用） | `requestPermission` / `start` / `stop` |
| 役割 | 「許可されているか」を監視するプロデューサ | 「許可を取りに行き、実際に検知する」機能ノード |

> [permission-tag-design.md](./permission-tag-design.md) §0 の「機能ノードが request し、permission ノードが observe する」という枠組みを、**再帰的に**同じ形で適用したのが `<wcs-idle>` である。geo が `<wcs-geo>`（機能）と `<wcs-permission name="geolocation">`（監視）に分かれるのと同型で、`<wcs-idle>` と `<wcs-permission name="idle-detection">` も同じ関係になる。

**決定 1（ステータス合成）**: `<wcs-idle>` は permission の4値状態プロパティを一切持たない。合成が必要な利用者は `<wcs-permission name="idle-detection">` を併置する。`<wcs-idle>` 自身が公開するのは実際のアイドル状態（`userState` / `screenState` / 派生 `active`）と、一回限りのアクションである `requestPermission()` だけに限定する。

この決定により、`<wcs-idle>` は「監視専用ノード」（`<wcs-permission>`）でも「双方向の1タグ完結ノード」（`<wcs-notify>`）でもない、**第三の形**——「permission 状態の監視は他ノードに委譲し、自分は request action + 機能監視だけを持つ機能ノード」——の最初の実例になる。後続の Generic Sensor 族（Accelerometer 等、[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ5）も同じ合成パターンを踏襲できる見込み。

---

## 1. 存在意義 — 何を解決するノードか

- **離席検知による UI 状態遷移**: ユーザーが一定時間操作しない、または画面がロックされたときに、自動ログアウト・省電力表示・プレゼンス表示（チャットの「離席中」バッジ）などを宣言的に切り替える。
- **画面ロック検知**: `screenState` の `"locked"` / `"unlocked"` を `hidden: screenState|eq(locked)` のような束縛で使い、ロック中は機微な情報の表示を止める、といったセキュリティ配慮ができる。
- **既存ノードとの組み合わせ**: `<wcs-idle active="false">` を条件に `<wcs-timer>` を止める、`<wcs-permission name="idle-detection">` の `granted` を条件に「離席検知を有効化」ボタンの活性を出し分ける、といった構成が自然に書ける。

---

## 2. 公開する state — **決定: userState/screenState/active の3プロパティ + never-throw の error（4値 permission state は持たない）**

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "userState",   event: "wcs-idle:change", getter: (e) => (e as CustomEvent).detail.userState },
    { name: "screenState", event: "wcs-idle:change", getter: (e) => (e as CustomEvent).detail.screenState },
    { name: "active",      event: "wcs-idle:change", getter: (e) => (e as CustomEvent).detail.userState === "active" },
    // never-throw (§3.6): requestPermission()/start() failures land here
    // instead of rejecting/throwing. Mirrors every other bidirectional IO
    // node in this batch (fetch, share, screen-orientation).
    { name: "error", event: "wcs-idle:error" },
  ],
  inputs: [
    { name: "threshold" },
  ],
  commands: [
    { name: "requestPermission", async: true },
    { name: "start", async: true },
    { name: "stop" },
  ],
};
```

- `userState`: `"active" | "idle"`。ネイティブ `IdleDetector.userState` をそのまま publish。
- `screenState`: `"locked" | "unlocked"`。ネイティブ `IdleDetector.screenState` をそのまま publish。
- `active`: `userState === "active"` の派生 boolean getter。`hidden: active|not`（離席中はプレゼンス表示を隠す等）のような単純束縛のための便宜プロパティ。§4.2 の「1イベント＋派生 getter」の典型適用(`permission` の4値 boolean 派生と同型、[PermissionCore.ts:27-33](../packages/permission/src/core/PermissionCore.ts#L27-L33))。
- `error`: ガイドライン §3.6（never-throw MUST）に従い、`requestPermission()`/`start()` の失敗を never-throw で受け止める標準プロパティ。この3プロパティの決定（permission 4値を持たない）とは独立に、この batch の他ノード（fetch/share/screen-orientation 等）と同様に必ず持つ横断的なプロパティであり、上のコードブロックにも反映済み。
- **`screenState` からの派生 boolean（例: `locked`）は初版では追加しない**。`userState`/`active` の2軸で足りるユースケースが大半であり、`screenState` は文字列のまま `screenState==="locked"` の filter 式で足りる。需要が明確になってから追加を検討する（除外理由を明記する程度に留める）。
- **`granted` / `denied` / `prompt` / `unsupported` の4値は一切持たない**（§0 決定1）。permission 状態が欲しい利用者は `<wcs-permission name="idle-detection">` を併置する。

---

## 3. `threshold` 入力 — **決定: 範囲外は `error` として扱い、never-throw**

```
threshold: number   // ミリ秒単位。仕様上 60000ms（60秒）以上が MUST
```

- 属性連動入力（§4.3 の分類でいう「属性連動入力」）。`get` は `getAttribute("threshold")` を数値化、`set` は属性 reflect。
- Idle Detection API の仕様は `threshold` に **60000ms 以上**を要求する。これを下回る値で `start()` を呼ぶと、ブラウザは `TypeError` を投げる（reject ではなく同期 throw であることに注意——Core 側は必ず `try/catch` で包む）。
- ガイドライン §3.6（never-throw MUST）に従い、範囲外の `threshold` はバリデーションで事前に弾いて即 `error` にするのではなく、**ブラウザの `TypeError` をそのまま `error` として `_setError` に流す**（`permission` パッケージが不正な `name` をバリデーションで弾かず `query()` の reject に委ねているのと同じ流儀、[permission-tag-design.md](./permission-tag-design.md) §3「未知 / 非対応の name はブラウザの reject に委ねる」を踏襲）。
  - 理由: 60秒という閾値は仕様変更の可能性がある値であり、wcstack 側にハードコードして事前チェックすると、仕様が変わった際に不必要に厳しい／緩いガードになりうる。ブラウザ自身の判定に委ねるほうが将来の仕様変更に対して頑健。
- `threshold` 属性が未指定の場合の既定値は 60000（仕様の最小値）とする。

---

## 4. commands

### 4.1 `requestPermission` — **静的メソッドのラップ、user gesture 文脈は呼び出し元の責務**

```typescript
async requestPermission(): Promise<"granted" | "denied"> {
  if (typeof IdleDetector === "undefined") {
    this._setError({ message: "IdleDetector is not supported in this browser" });
    return "denied";   // unsupported も "denied" に倒す（戻り値は2値のみ、§9参照）
  }
  try {
    const result = await IdleDetector.requestPermission();   // "granted" | "denied"
    this._setError(null);   // 例外なく解決したら直前の error をクリア（start() 成功時との対称性）
    return result === "granted" ? "granted" : "denied";
  } catch (e) {
    this._setError({ error: e });
    return "denied";
  }
}
```

- `IdleDetector.requestPermission()` は**静的**メソッドであり、[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ2の共有アーキタイプ通り、**user gesture 文脈からの呼び出しが必須**。`connectedCallback` はこの文脈の外（要素の接続はクリックの結果として起こるとは限らない）なので、Core / Shell が `observe()` の中で自動的に呼ぶことは**できない**。
- したがって `requestPermission` は明示的な `command` として公開し、README に「利用者自身のクリックハンドラなど、実際の user gesture ハンドラの中から呼ぶこと」を明記する（`command.requestPermission: $command.askIdlePermission` のように配線し、state 側のクリックイベントハンドラで `emit()` する）。
- gesture 文脈外から呼んだ場合、ブラウザは Promise を reject する。これも never-throw で `error` に吸収し、戻り値は `"denied"` に倒す（呼び出し元に「許可されなかった」という一貫した結果を返す。gesture 違反と実際の拒否を区別する専用状態は設けない——両者とも「今は使えない」という点で扱いは同じでよいため）。
- **`<wcs-permission name="idle-detection">` との関係**: `requestPermission()` が実際に許可ダイアログを出す（初回）／出さない（2回目以降、ブラウザが記憶した結果を即返す）のいずれであっても、その結果としての permission 状態遷移は `<wcs-permission name="idle-detection">` 側の `change` 購読が拾う。`<wcs-idle>` 自身は `requestPermission()` の戻り値を一時的な参考情報として扱うのみで、状態としては保持・公開しない（§0 決定1）。

### 4.2 `start` — Core 所有の `AbortController`、呼び出しごとに新しい世代

```typescript
async start(): Promise<void> {
  this.stop();   // 進行中の検知を止めてから開始（fetch の「進行中のリクエストをキャンセル」と同型）

  const ac = new AbortController();
  this._abortController = ac;
  const gen = ++this._gen;   // このstart呼び出しの世代を捕捉

  try {
    this._detector = new IdleDetector();
    this._detector.addEventListener("change", this._onChange);
    await this._detector.start({ threshold: this._threshold, signal: ac.signal });
    if (gen !== this._gen) return;   // stop()/disposeでスーパーシードされていたら何もしない
    this._setUserState(this._detector.userState ?? "active");
    this._setScreenState(this._detector.screenState ?? "unlocked");
  } catch (e: any) {
    if (gen !== this._gen) return;
    if (e.name === "AbortError") return;   // 明示的なstop()由来のabortは無音
    this._setError({ error: e });
  }
}
```

- `_gen` の捕捉タイミングと stale 判定は `FetchCore._doFetch` と同型（[FetchCore.ts:189-195](../packages/fetch/src/core/FetchCore.ts#L189-L195): `const ac = new AbortController(); this._abortController = ac; const gen = ++this._gen;`、[FetchCore.ts:230-234](../packages/fetch/src/core/FetchCore.ts#L230-L234) の stale チェック）。fetch/upload では「1インスタンス1リクエスト」だったのに対し、`<wcs-idle>` では「1インスタンス1検知セッション」が対応する。
- `dispose()`/`stop()` は `_abortController.abort()` を呼ぶ（[UploadCore.ts:63-66](../packages/upload/src/core/UploadCore.ts#L63-L66) の `dispose() { this._gen++; this.abort(); }` と同型）。`abort()` によって `IdleDetector.start()` の Promise が `AbortError` で reject するので、これを無音の正常系として扱う（fetch の「明示 abort はエラーではない」という扱いと同じ）。
- `change` イベントは `start()` の resolve 後、検知セッションが継続している間ずっと発火し続ける。`_onChange` ハンドラは世代ガードの対象外（`start()` の Promise 自体は1回しか resolve しないが、`change` はセッションが生きている限り繰り返し発火するイベント購読なので、世代の生死は `dispose`/`stop` 時の `removeEventListener` で管理する。ガードは「今アクティブな `IdleDetector` インスタンスが現世代のものか」で行う）。

### 4.3 `stop`

```typescript
stop(): void {
  this._gen++;
  this._abortController?.abort();
  this._abortController = null;
  if (this._detector) {
    this._detector.removeEventListener("change", this._onChange);
    this._detector = null;
  }
}
```

- `dispose()` は `stop()` を呼ぶだけでよい（notification が「dispose では通知を残す」ため close を呼ばないのとは対照的に、idle detection の検知セッションは要素が消えたら継続する意味がないため、dispose で確実に止める）。

---

## 5. Chromium 限定 — unsupported 分岐

```typescript
private _api(): typeof IdleDetector | undefined {
  const g = globalThis as any;
  return typeof g.IdleDetector === "function" ? g.IdleDetector : undefined;
}
```

- Idle Detection API は執筆時点で Chromium 系（Chrome/Edge）限定。Firefox・Safari は未実装。
- `_api()` が `undefined` を返す環境では、`start()` は即座に `unsupported` 相当のエラーを `error` に流し、`userState`/`screenState` は初期値（`null` 固定）のまま変化しない。`requestPermission()` も同様に `undefined` チェックで早期リターンする（§4.1）。
- ガイドライン §3.7（API 解決は呼び出し時、MUST）に従い、コンストラクタでキャッシュせず `start()`/`requestPermission()` それぞれの呼び出し時に `_api()` を解決する。

---

## 6. connect 時の自動 `start()` — **決定: しない（通常の既定からの意図的な逸脱）**

async-io-node-guidelines.md 自体には「connect 時に自動 observe する」という明文の既定はないが、既存ノードの大半（geo/permission/network 等）は `connectedCallback` で監視や監視相当の処理を無条件に開始する。`<wcs-idle>` は**この慣習に沿わない**。

**決定 2**: `<wcs-idle>` は `connectedCallback` で `start()` を自動的に呼ばない。`start()` は利用者が明示的に command として呼ぶ（多くの場合、`requestPermission()` の成功後に呼ぶフロー）。

理由:

1. **gesture gate が `start()` の手前に立っている**。`start()` 自体に user gesture 要件はないが、実用上は「まず `requestPermission()` を gesture 文脈から呼び、許可されてから `start()` する」という順序を踏まないと、`start()` は permission が `"prompt"` のまま呼ばれ、ブラウザは暗黙に許可プロンプトを出すか、あるいは既に `"denied"` なら確実に失敗する。
2. **未許可のまま `start()` を試みても確実に失敗する**のが分かっている以上、`connectedCallback`（要素が DOM に挿入されただけで gesture 文脈を伴わない）から自動的に投げるのは「失敗するとわかっている非同期処理を毎回起動する」だけの無駄働きになる。geo の `getCurrentPosition` や network の購読開始のように「対応していれば基本的に動く」処理を connect 時に自動起動するのとは前提が異なる。
3. Idle Detection は「常時バックグラウンドで有効化しておきたい」機能というより「ユーザーが明示的にオプトインする」機能である（離席検知は個人情報のセンシティブな監視に近い）。オプトイン UI（「離席検知を有効にする」ボタン）と `requestPermission()` → `start()` の対応関係を README・example で明示する設計のほうが利用者にとって自然。

したがって、通常ガイドラインが暗黙に踏襲する「`connectedCallback` で `observe()` 相当を自動開始する」という既定から、`<wcs-idle>` は意図的に外れる。この逸脱理由は本ドキュメントに記録済みであり、[async-io-node-guidelines.md](./async-io-node-guidelines.md) 冒頭の「やむを得ず逸脱する場合は理由を記録する」MUST を満たす。

---

## 7. SSR

- `IdleDetector.start()` は非同期だが、connect 時に自動起動しない（§6）ため、`ready` / `connectedCallbackPromise` は**常に `Promise.resolve()`** となる（`network` の「非同期 probe が存在しないため `Promise.resolve()` 固定」という扱いと結果的に同型、[network-tag-design.md](./network-tag-design.md) §5）。
- `hasConnectedCallbackPromise = true` は宣言する（プロトコル上の一貫性のため）が、実質的な待ち合わせは発生しない。

---

## 8. テスト方針（happy-dom）

happy-dom は `IdleDetector` を持たないため、`__tests__/mocks.ts` で**クラス自体をモック**する必要がある（`navigator.permissions` のようなオブジェクトプロパティの差し替えでは足りない。グローバルの `IdleDetector` コンストラクタごと `globalThis.IdleDetector = FakeIdleDetector` として install/remove する）。

```typescript
class FakeIdleDetector extends EventTarget {
  static requestPermission = vi.fn(async () => "granted");
  userState: "active" | "idle" = "active";
  screenState: "locked" | "unlocked" = "unlocked";
  async start({ threshold, signal }: { threshold: number; signal: AbortSignal }) { /* controllable */ }
}
```

観点:

- `typeof IdleDetector === "undefined"` 環境で `start()`/`requestPermission()` が例外を投げず `error`/`unsupported` 相当に倒れる（never-throw）。
- `threshold` が 60000 未満のとき、ブラウザ側の `TypeError` を模した reject を `start()` が catch し `error` に流す（バリデーションで事前に弾いていないことの確認）。
- `change` イベントで `userState`/`screenState`/`active` が更新され、同値の連続発火では再 dispatch されない（同値ガード）。
- `stop()` 呼び出しで `AbortController.abort()` が呼ばれ、以後の `change` が無視される。
- `start()` を連続で呼んだとき、古い世代の検知セッションが `stop()` されてから新しい世代が始まる（`_gen` ガード、fetch の「進行中のリクエストをキャンセルしてから開始」と同型）。
- `dispose()` 後に `change` が来ても状態が変わらない。
- `requestPermission()` が gesture 文脈外由来の reject を模したケースで `error` に落ち、戻り値が `"denied"` になる。
- `connectedCallback` 直後に `start()` が呼ばれていないこと（自動起動しないことの確認、§6 決定の検証）。

---

## 9. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §0/§2 ステータス合成 | **`<wcs-permission name="idle-detection">` に委譲**。`<wcs-idle>` は permission 4値を持たない |
| §2 公開 state | `userState` / `screenState` / 派生 `active` の3プロパティ + never-throw の `error` |
| §3 `threshold` 範囲外 | バリデーションで弾かず、ブラウザの `TypeError` を `error` として never-throw で吸収 |
| §4.1 `requestPermission` | 静的メソッドのラップ。gesture 文脈は呼び出し元の責務、README に明記 |
| §4.2 `start`/`_gen` | fetch/upload と同型の単一 `_gen` ＋ Core 所有 `AbortController`、呼び出しごとに新世代 |
| §5 対応ブラウザ | Chromium 限定、`typeof IdleDetector === "undefined"` で unsupported 分岐 |
| §6 connect 時自動 start | **しない**（gesture gate の手前で失敗が確実なため、意図的な既定からの逸脱） |
| §7 SSR | 自動起動しないため `ready`/`connectedCallbackPromise` は常に即 resolve |
| パッケージ/タグ | `@wcstack/idle` / `<wcs-idle>` / Shell `WcsIdle` |

---

## 10. 実装順の推奨

1. `IdleDetectorCore`（`_api()` 呼び出し時解決 ＋ `threshold` 入力 ＋ `requestPermission`/`start`/`stop` ＋ 単一 `_gen` ＋ `AbortController`）。`permission` パッケージの `_permGen`/冪等 observe パターンは「監視の開始/停止」部分だけ参考にし、permission 状態そのものは持たない。
2. Shell `<wcs-idle>`（`threshold` 属性、display:none、`connectedCallback` では何も自動起動しない、`disconnectedCallback` で `stop()`）。
3. Fake double（`FakeIdleDetector`、グローバルクラスの install/remove）とテスト一式。
4. example: **「離席検知を有効にする」ボタン**が目玉。ボタンの click ハンドラから `requestPermission()` → 成功したら `start()` という一連の gesture 起点フローを示し、`<wcs-permission name="idle-detection">` を並置して「機能ノードが request、permission ノードが observe」の合成デモを添える。
5. README ja/en（Chromium 限定・secure context 不要な点があれば明記・gesture 文脈からの `requestPermission()` 呼び出し必須・connect 時に自動 start しない設計上の理由・`<wcs-permission name="idle-detection">` との組み合わせ例）。
