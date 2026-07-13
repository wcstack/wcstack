# DevTools Hook Protocol 設計 (devtools-hook-protocol)

- Status: **設計ドラフト（2026-07-14・未実装）** — UI 側は [devtools-tag-design.md](devtools-tag-design.md)
- 位置づけ: 「静的検査可能性の弱さを**実行時検査可能性**で補う」ための規範プロトコル。
  wc-bindable / command-token / event-token に続く第 4 のプロトコル文書であり、
  UI（`<wcs-devtools>`）とランタイム（state / 将来 signals）の唯一の接点。
- スコープ決定（2026-07-14 ユーザー決裁）:
  - A: Phase 1（フック実装 + オーバーレイ UI）まで進める
  - B: 提供形態はページ内オーバーレイ（ブラウザ拡張は Phase 3 判断保留）
  - C: v1 は **state + 配線（binding / token）** のみ。signals は namespace 予約に留める

## 0. 一言要約

ランタイム側は「**フックが繋がっていなければ分岐 1 個**」の計装点だけを持ち、
検査用の台帳・整形・UI はすべてフック消費者（devtools）側に置く。
接点は `globalThis.__WCSTACK_DEVTOOLS_HOOK__` ただ 1 つ。モジュール同一性に依存しない
（CDN で state のコピーが複数あっても、各コピーが独立した source として登録される）。

---

## 1. 設計原則（規範）

1. **detached zero-cost**: フック未接続時、各計装点のコストは「null チェック 1 回」を
   超えてはならない（MUST）。未接続時のアロケーション・文字列整形・クロージャ生成は禁止。
   先例: signals `dev.ts` の call-time 判定 + 早期 return。
2. **台帳はフック側**: ランタイムは列挙用の恒常台帳を持たない（イベント台帳リーク教訓:
   [state-append-clear-cost] の detach 不呼出で DOM 永久保持）。例外は §4.1 の
   state 要素 registry のみ（要素数個・disconnect で削除・上限が DOM に拘束される）。
3. **push + pull の二層**: 変化はイベント（push）で流し、接続時点の世界はスナップショット
   API（pull）で取る。遅延アタッチはこの二層で成立する範囲まで（§6）。
4. **プロトコルはモジュール境界を跨がない値のみ**: イベント payload はランタイム内部
   オブジェクト（IBindingInfo 等）への**生参照を含んでよい**（同一 realm・オーバーレイ前提。
   B 決定の直接の帰結）。ただし消費者は participant の内部を変異してはならない（MUST NOT）。
   将来ブラウザ拡張化する場合はシリアライズ層を devtools 側に足す（プロトコル不変更）。
5. **inspected と inspector の分離**: DevTools UI 自身も wcstack で動く（ドッグフーディング）
   が、自分自身を検査対象から外せること（§5 ignore 機構）。
6. **SSR 不活性**: `inSsr()` が真の環境では bridge は global を作らず、イベントも発しない。

## 2. グローバルとハンドシェイク

```ts
// 双方が create-if-missing で取得する（ロード順非依存）
interface IDevtoolsHookRegistry {
  readonly version: 1;                       // プロトコル版。additive change は版を上げない
  readonly sources: Map<string, IDevtoolsSource>;
  register(source: IDevtoolsSource): void;   // ランタイム → registry
  unregister(sourceId: string): void;
  addListener(l: IDevtoolsListener): () => void;  // devtools → registry。戻り値は解除
}

interface IDevtoolsListener {
  onSourceRegistered?(source: IDevtoolsSource): void;
  onEvent?(sourceId: string, event: DevtoolsEvent): void;
}
```

- global 名: `globalThis.__WCSTACK_DEVTOOLS_HOOK__`。
- 生成規則: 参照する側が `??=` で最小実装を置く。**registry 実装は双方に埋め込む**
  （state 側 bridge / devtools 側 client の両方が同一仕様の最小実装を持ち、先勝ち）。
  実装は 30 行程度に抑え、version 不一致時は console.warn の上で新しい方が勝たない
  （先勝ち固定。振る舞いを差し替えない）。
- ランタイム側の登録タイミング: state は `bootstrapState()` 内で 1 回 register。
  sourceId は `"state:" + ランダム UUID`（`getUUID` 流用）。同一ページに state の
  モジュールコピーが N 個あれば N source になる — これは正常系（§5）。
- **hot path の形**: bridge はモジュールローカルに `let sink: ((e) => void) | null` を
  持つ。listener が 0↔1+ に遷移したとき registry が各 source の `_setSink()` を呼んで
  差し替える。計装点は `sink !== null && sink(...)` のみ（原則 1 の実装形）。
  イベントオブジェクトの生成も `sink !== null` の内側で行う。

## 3. Source インターフェース（pull API）

```ts
interface IDevtoolsSource {
  readonly id: string;
  readonly kind: "state";        // v1。"signals" は予約（§8）
  readonly packageVersion: string;
  // --- pull ---
  getStateElements(): IStateElementSummary[];   // 接続時スナップショットの起点
  keys(name: string, rootNode: Node): string[]; // トップレベルキー列挙（状態ツリーの描画起点）
  read(name: string, rootNode: Node, path: string, indexes?: number[]): unknown;
  write(name: string, rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
  // --- 内部（registry 専用） ---
  _setSink(sink: ((e: DevtoolsEvent) => void) | null): void;
}

interface IStateElementSummary {
  readonly name: string;
  readonly rootNode: Node;
  readonly element: Element;          // <wcs-state> 生参照（原則 4）
  readonly paths: {
    list: ReadonlySet<string>; element: ReadonlySet<string>;
    getter: ReadonlySet<string>; setter: ReadonlySet<string>;
  };
  readonly commandTokenNames: ReadonlySet<string>;
  readonly eventTokenNames: ReadonlySet<string>;
  readonly staticDependency: ReadonlyMap<string, readonly string[]>;
  readonly dynamicDependency: ReadonlyMap<string, readonly string[]>;
}
```

- `keys` はメソッド・`$` 始まり・ワイルドカードを含むキーを除外したトップレベルキーを
  返す（メソッド判別の typeof アクセスが getter を 1 回実行する点は仕様。コンテキスト外で
  throw する getter は「キーとして存在する」側に倒す）。IStateElementSummary の paths が
  binding 済みパスしか持たないのに対し、こちらは宣言された全データ面が起点になる。
- `read` / `write` は `stateElement.createState("readonly" | "writable", cb)` を通す。
  つまり **write は通常のリアクティブパイプライン（set trap → enqueue → drain）を通り**、
  DevTools からの編集がユーザーコードの set と完全に同じ経路になる（別経路を作らない）。
- `read` の副作用について: readonly proxy の get は依存追跡スコープ外（binding 適用中でも
  `$updatedCallback` 中でもない呼び出し）なら依存グラフを汚さない。実装時に
  `trackDependency` の発火条件を再確認し、汚す経路が見つかった場合は plain-read 用の
  内部 API（`getByAddress` 直呼び）に切り替える（実装ゲート G-R、§9）。
- ワイルドカードパスの読み出しは `indexes` で具体化する（`$resolve` と同じ意味論）。

## 4. state 側の計装点（v1 で追加するフック）

変更ファイルと発火点。すべて §2 の `sink` 経由・原則 1 準拠。

### 4.1 state 要素の登録簿を列挙可能化

- [stateElementByName.ts](../packages/state/src/stateElementByName.ts) の WeakMap は維持し、
  **並走する `Set<IStateElement>`（モジュールローカル）を追加**。register で add /
  unregister（`State.ts` の disconnectedCallback → `setStateElementByName(…, null)`）で delete。
- これだけは常時 ON の台帳（原則 2 の明示的例外）。サイズは `<wcs-state>` 要素数に拘束され、
  disconnect で必ず削除されるためリークしない。`getStateElements()` の実体。
- イベント: `state:element-registered` / `state:element-unregistered`
  payload = `{ name, rootNode, element }`。

### 4.2 書き込みログ

- [setByAddress.ts](../packages/state/src/proxy/methods/setByAddress.ts) の
  same-value guard **通過後**（実書き込みのみ）に発火。
- payload = `{ stateName, path, listIndexes: number[] | null, value, oldValue? }`。
  `oldValue` は guard が既に取得している場合（primitive かつ guard ON）のみ含める。
  参照型のために追加の get はしない（MUST NOT — ホットパス保護）。
- swap 経路（`_setByAddressWithSwap`）も同一点を通るため個別対応不要。

### 4.3 更新バッチ（drain）

- 既存の [updater.ts](../packages/state/src/updater/updater.ts)
  `registerUpdateBatchListener` をそのまま使う。**ランタイム変更ゼロ**。
- bridge が attach 時に register / detach 時に unregister する（$streams リスナーと同格の
  消費者としてぶら下がる）。
- イベント: `state:update-batch` payload = `{ addresses: ReadonlySet<IAbsoluteStateAddress> }`。

### 4.4 binding 台帳の増減

- [getBindingSetByAbsoluteStateAddress.ts](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts)
  の `addBindingByAbsoluteStateAddress` / `removeBindingByAbsoluteStateAddress` /
  `clearBindingSetByAbsoluteStateAddress` に発火点を置く。
- イベント: `state:binding-added` / `state:binding-removed`
  payload = `{ absoluteAddress, binding /* IBindingInfo 生参照 */ }`。
  clear は `state:binding-cleared` `{ absoluteAddress }`。
- devtools 側はこれで node⇔binding⇔path の台帳を組む。**ランタイムは台帳を持たない**。

### 4.5 token 発火（command / event）

- [CommandToken.ts](../packages/state/src/command/CommandToken.ts) /
  [EventToken.ts](../packages/state/src/event/EventToken.ts) の `emit` を薄く override
  （`sink && sink(...)` → `super.emit(...)`）。
- token は自分の stateElement を知らないため、コンストラクタに owner 情報
  `{ stateName }` を**内部 optional 引数**として追加し、registry
  （`getOrCreateCommandToken` 等）が渡す。プロトコル外部仕様（command-token-protocol /
  event-token-protocol）は不変更。
- イベント: `state:token-emit`
  payload = `{ kind: "command" | "event", stateName, tokenName, args: unknown[], subscriberCount }`。
  `subscriberCount === 0` の emit は「空撃ち」としてそのまま流す — raf で踏んだ
  whenDefined 前の command 空撃ちレースが**タイムライン上で見える**ようにするのが狙い。

### 4.6 v1 でやらない計装

- get（読み取り）トレース: 量が桁違いでホットパス直撃。やらない。
- 依存グラフの動的変化イベント: pull（`IStateElementSummary.staticDependency` 等）で足りる。
- `$streams`: status/error は `$streamStatus.*` 等の**通常パスとして** 4.2/4.3 に乗るため
  専用イベント不要（設計済みの reactive 露出を再利用）。

## 5. 複数 source と自己除外

- 同一ページに state コピーが複数（CDN `.`/`.dom` 混在事故、または devtools 自身が
  持ち込むコピー）→ それぞれが独立 source。UI は source 単位でタブ/フィルタ表示。
- **自己除外**: devtools は自分の UI が使うランタイムの sourceId を知っている
  （自分が import したモジュールの register を `onSourceRegistered` で捕捉できる…では
  同一版が dedup された場合に曖昧）。確実な機構として、source 登録**前**に
  `globalThis.__WCSTACK_DEVTOOLS_IGNORE_NEXT__` のような暗黙印は採らず、
  **予約 state 名 prefix `"wcs-devtools"`** を規範化する:
  - devtools が生成する `<wcs-state>` の name は `wcs-devtools*` で始めなければならない（MUST）
  - UI は既定でこの prefix の要素・アドレス・イベントを表示から除外する
  - 加えて `rootNode` が `<wcs-devtools>` の ShadowRoot 配下かの包含判定を第 2 の網とする

## 6. 遅延アタッチの成立範囲（明示的な制限）

接続タイミングで得られる情報を 2 層に分ける。**この差は仕様であり、UI に明示する。**

| 情報 | 先行ロード時 | 遅延アタッチ時 |
|---|---|---|
| state 要素一覧・状態ツリー・値の読み書き | ✓ | ✓（4.1 registry + pull） |
| 更新バッチ / 書き込み / token タイムライン | ✓ | ✓（接続以降分のみ） |
| **binding 台帳（内部オブジェクト）** | ✓（4.4 イベント蓄積） | ✗ — 過去分は復元不能 |
| 宣言配線ビュー（element⇔path の対応） | ✓ | ✓（**DOM 再スキャン**で代替） |

- 復元不能の理由: binding 台帳のキー `IAbsoluteStateAddress` のキャッシュは
  [AbsoluteStateAddress.ts:5](../packages/state/src/address/AbsoluteStateAddress.ts#L5) の
  WeakMap 二段で**列挙不能**。列挙可能化は GC 寿命を変えるため却下。
- 代替の DOM 再スキャン: `data-wcs` 属性と `<!--wcs-*-->` コメントは binding 構築後も
  DOM に残るため、devtools 側が `bindTextParser` 相当（または同パーサの import）で
  **宣言レベルの配線ビュー**を組める。ライブ binding 由来のエントリと区別して
  「declared」バッジ表示（詳細は tag-design §UI）。
- 推奨導線: 遅延アタッチ時、UI に「完全なライブ配線ビューにはリロードが必要」を表示し、
  ワンクリックリロード（`location.reload()`。devtools は `<script>` で入っているので
  リロード後は先行ロードになる）。

## 7. コスト検証ゲート（実装受け入れ条件）

1. detach 状態で `e2e/bench/jsfb-verify.mjs`（append / swap / clear / select）の
   計測が計装前とノイズ範囲で一致すること（リグレッション扱いの閾値は当該ドライバの
   既存運用に従う）。
2. attach → detach 後、bridge 側に残留参照が無いこと（sink null 化・updater listener
   解除・devtools 側台帳 clear）。イベント台帳リークの再演防止。
3. 4.1 の registry が disconnect で確実に縮むこと（テストで要素 add/remove を往復）。

## 8. signals 予約（Phase 2 への引き継ぎ）

- `IDevtoolsSource.kind: "signals"` とイベント namespace `signals:*` を予約。
- 先送りの理由（v1 に入れない根拠）: signal / computed / effect は**無名**であり、
  識別子 API（`signal(v, { name })` 等）を signals 側で先に設計しないと
  表示が「Signal #47」になり無価値。API 表面の変更を伴うため独立の設計判断
  （[signals-migration-plan.md](signals-migration-plan.md) 系列に接続）。
- signals が実装する際の対応表（想定）: source pull = ルート signal 一覧（owner tree）、
  push = write / recompute / effect-run。`dev.ts` の `__WCS_DEV__` とは独立
  （dev.ts = 警告、hook = 検査。統合しない）。

## 9. 未決ゲート

- **G-R（read の副作用）**: §3 の readonly read が依存グラフ・キャッシュを汚さないことの
  実装時検証。汚す場合は `getByAddress` 直読みへ切替。
- **G-P（binding イベントの粒度）**: リスト大量更新時に binding-added/removed が
  バースト発火する。devtools 側 ring buffer で受け切れるか、bridge 側で
  microtask 集約が要るかは実装時にベンチで判定（既定は素通し・集約は複雑化のため後手）。
