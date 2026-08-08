# wcstack 非同期IOノード作成ガイドライン (Async IO Node Authoring Guidelines)

- **対象**: `@wcstack` に新しい非同期IOノードパッケージ（Web API を宣言的タグ化したもの。`@wcstack/fetch` / `geolocation` / `clipboard` / `sse` / `broadcast` / `worker` / `wakelock` / `intersection` / `resize` / `speech` / `permission` / `notification` ほか）を追加する実装者
- **状態**: 規範ドキュメント（normative）。「MUST / SHOULD / MAY」は RFC 2119 の意味で使う。新規ノードはここに反した実装をしてはならない（MUST NOT）。やむを得ず逸脱する場合は、その理由をパッケージの設計ドキュメント（`docs/<name>-tag-design.md`）に記録すること
- **なぜ存在するか**: 既存ノードは全て同じ骨格（Core/Shell 分離・wc-bindable 準拠・never-throw・`_gen` 世代ガード・SSR 対応）を共有している。この一貫性が「1つ覚えれば全部使える」という DX と、`state` binder からの相互運用性を支えている。新規ノードがこの骨格を踏襲しないと、利用者は個別に内部を読まねばならず、エコシステムの価値が崩れる。本書はその骨格を1枚に集約し、レビューのチェックリストにする
- **関連**: タイミング・発火の契約は [timing-and-firing-contract.md](./timing-and-firing-contract.md)。実行意味論（実行形・レーン・排他モード・キャンセル・再試行・タイムアウト）の規範は [async-execution-model.md](./async-execution-model.md)。それらを順序付き入力・出力トレース、決定性境界、適合ベクトルとして横断する検証層の提案は [io-node-trace-conformance.md](./io-node-trace-conformance.md)。observable の snapshot 境界は [React の不変スナップショットと wc-bindable I/O 境界](./architecture-hardening/11-react-immutable-snapshot-boundary.md) と [observable 棚卸し](./architecture-hardening/12-wc-bindable-observable-inventory.md)。プロトコル本体は各 SPEC（wc-bindable / command-token / event-token）。設計検討の様式は既存の `docs/*-tag-design.md` を参照

---

## 0. TL;DR — 新規ノードが満たすべき不変条件

1. **Core/Shell 2層に分ける**。Core は `EventTarget` を継承したヘッドレス実装、Shell は `HTMLElement`。Shell は Core を `new Core(this)` で包むだけ
2. **wc-bindable-protocol に準拠**する。`static wcBindable` で `properties` / `inputs` / `commands` を宣言
3. **never-throw**。失敗は例外でなく `error` プロパティ（＋必要なら `"unsupported"` 状態）として宣言的状態に流す
4. **同値ガード**。状態 setter は値が変わったときだけイベントを発火する
5. **`_gen` 世代ガード**。非同期処理は開始時に世代番号を捕捉し、resolve 時に古ければ何もしない（disconnect / 高速 reconnect 後の torn-down 要素への書き込みを防ぐ）
6. **`observe()` / `dispose()` ライフサイクル**。Shell の `connectedCallback` で `observe()`、`disconnectedCallback` で `dispose()`。`observe()` は冪等
7. **SSR 対応**。Core は最初のプローブ完了を表す `ready` promise を持ち、Shell は `connectedCallbackPromise` として公開（`static hasConnectedCallbackPromise = true`）
8. **API 解決は呼び出し時**。グローバル API（`navigator.x` 等）はキャッシュせず呼ぶたびに解決する（テストで差し替え可能・unsupported 環境を正しく報告）
9. **テストカバレッジ 100 / 97+ / 100 / 100**（statements / branches / functions / lines）。テスト記述は日本語
10. **出力状態の CSS 反映（CustomStateSet）**。boolean 出力 observable・派生 boolean getter・`error` の存在を Shell が `ElementInternals.states` に反映し `:state()` で選択可能にする。反映は Shell のみで行い Core に持ち込まない。`attachInternals` 不在環境では静かに無効化する（§4.5）
11. **Core は公開ヘッドレスサーフェス**。Core クラスをパッケージの entry（`exports.ts`）から export し、その構造保証（§3.9）を semver 保護の公開 API として扱う。README に headless（Core）利用の節を持つ（§9）
12. **producer snapshot contract**。state-like object / array は公開後に producer が変更せず、logical state の変更時は fresh value を割り当ててから通知する。event は occurrence を同値ガードせず、handle は owner と release point を明示する（§3.3.1）。入力側で受け取った値の扱いは §3.3.2
13. **property upgrade**。Shell は `connectedCallback` の先頭で `upgradeProperties(this)` を呼び、upgrade 前に代入された input を取り込み直す（§4.1.1）

---

## 1. まず設計ドキュメントを書く（実装より先）

新規ノードはコードを書く前に `docs/<name>-tag-design.md` を作成し、最低限ここを確定させる。既存の `permission-tag-design.md` / `notification-tag-design.md` / `speech-tag-design.md` を雛形にする。

確定すべき論点:

- **タグ名と短縮名**: `<wcs-xxx>`。イベント prefix `wcs-xxx:`、triggerAttribute `data-xxxtarget` の素地になる
- **方向性**: そのノードは
  - **monitor 専用**（element → state のみ。`commands: []`）か → 例: `permission`（Permissions API に `request()` が無い）
  - **command 専用**（state → element のみ）か
  - **双方向**（command-token と event-token の両方）か → 例: `notification`（show コマンド＋click イベント）
- **observable surface**: どのプロパティを公開するか。複合状態は「1イベント＋派生 getter」に分解する（§4.2）
- **observable semantics**: 各 property を `state` / `event` / `handle` のどれとして扱うか。object / array の owner、公開後 mutation の有無、live resource の停止・交換・release point も表にする（§3.3.1）
- **desired / actual の二相**が必要か → 例: `wakelock`（取得要求 `desired` と実際に保持中 `actual` を分離）
- **同値ガードのみで十分か**、debounce/throttle は利用者責務にするか（基本は利用者責務。filter で `notice@x|debounce(1000)` のように書かせる）
- **permission / secure-context** の扱い。既存の4値 surface（`prompt` / `granted` / `denied` / `unsupported`）を流用するか
- **autoTrigger**（クリック起動ショートカット）を持つか
- **外部クロックを持つか**（オーディオスレッド等、メインスレッドの sync / microtask / task で表現できない独自の時間軸）。持つ場合は **desired のみ公開し、実効になる時刻を規定しない**（[timing-and-firing-contract.md §19.1](./timing-and-firing-contract.md)）。実効値を読み戻して publish してはならない（MUST NOT）— 読み値がレンダー単位に依存し、同値ガードが機能しなくなる
- **ライブハンドルを扱うか**。扱う場合、既定は **Core が所有し、プロトコル境界に出さない**（worker / websocket / broadcast と同じ）。外へ渡す必要が実際に生じたときだけ command-token 引数素通しを足す（camera が唯一の例）。ハンドルが相互に接続されてグラフを成す場合は [ADR-14](./architecture-hardening/14-handle-graph-wiring.md) を先に読むこと — トポロジは値ではなく descriptor として表現する

設計が固まったら `architecture-review` スキルや `protocol-spec-review` スキルでレビューしてから実装に入ることを推奨する。

---

## 2. パッケージ構成（ファイルレイアウト）

`packages/notification/` を最新の参照実装とする。既存パッケージをコピーして始めるのが最短（permission は最小、notification は双方向＋SW＋autoTrigger の全部入り）。

```
packages/<name>/
  src/
    auto/
      auto.js              # プリビルド bootstrap（手書き、rollup で dist へコピー）
      auto.min.js
    core/
      <Name>Core.ts        # ヘッドレス。EventTarget 継承。static wcBindable。
    components/
      <Name>.ts            # Shell。HTMLElement 継承。クラス名 Wcs<Name>。
    bootstrap<Name>.ts      # setConfig + registerComponents
    config.ts              # config / getConfig / setConfig（deepFreeze/deepClone 付き）
    registerComponents.ts  # customElements.define（二重定義ガード）
    autoTrigger.ts         # （command 系のみ）data-xxxtarget クリック起動
    raiseError.ts          # 共通エラーヘルパ
    types.ts               # IWcBindable* と Core/Shell の値・コマンド・入力型
    exports.ts             # 公開 re-export
  __tests__/
    setup.ts
    *.test.ts              # 日本語記述
  package.json             # "type":"module"、rollup 出力、coverage 閾値
  tsconfig.json            # ルートを extends
  rollup.config.js
  eslint.config.js
  vitest.config.ts
  README.md / README.ja.md
```

公開境界（`exports.ts`）で **必ず** export するもの:

- `bootstrap<Name>`
- `getConfig`（`config` 内部 mutable はエクスポートしない。`getConfig()` は deep-frozen clone を返す）
- `<Name>Core`（ヘッドレス利用）
- `Wcs<Name>`（Shell クラス。アダプター利用時の DX のため必須。`feedback_export_shell_class` 参照）
- 型一式（`type` re-export）

---

## 3. Core（ヘッドレス実装）の規約

参照: [`packages/notification/src/core/NotificationCore.ts`](../packages/notification/src/core/NotificationCore.ts)、[`packages/permission/src/core/PermissionCore.ts`](../packages/permission/src/core/PermissionCore.ts)

### 3.1 形

- `export class <Name>Core extends EventTarget`
- コンストラクタは `target?: EventTarget` を取り、`this._target = target ?? this` とする。Shell は `new Core(this)` で自分を渡し、Core が dispatch するイベントが Shell 要素から bubble する。ヘッドレス利用時は Core 自身が EventTarget になる
- DOM 要素（`HTMLElement` / `document`）に依存してはならない（MUST NOT）。Core は Web API（`navigator` / `globalThis.X`）だけを触る

### 3.2 `static wcBindable`

```ts
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [ /* observable outputs */ ],
  commands:   [ /* invocable methods（無ければ [] ） */ ],
};
```

- `properties`: `{ name, event, getter? }`。`event` は `wcs-<name>:<kind>` 形式。Core はプロトコル上 `properties` のみ解釈する。`inputs` / `commands` は記述的メタ（ツール・codegen 用）
- `properties[].semantics`（`"state" | "event" | "handle"`）で観測意味論を宣言する。**`event` と `handle` は宣言必須（MUST）**。省略は「未指定」であって `state` の意味ではなく、読み手は省略時に現行動作を維持する。`state` の明示は現状 optional（§3.3.1）。型や property 名から adapter が推測する前提を置かない
- `commands`: `{ name, async? }`。非同期コマンドは `async: true`
- monitor 専用ノードは `commands: []` とし、その旨をコメントで明記する

### 3.3 状態は private フィールド ＋ 同値ガード付き setter

```ts
private _setState(v: T): void {
  if (this._state === v) return;          // 同値ガード（MUST）
  this._state = v;
  this._target.dispatchEvent(new CustomEvent("wcs-<name>:change", {
    detail: v, bubbles: true,
  }));
}
```

- イベントは必ず `bubbles: true`
- **イベント性のもの（クリック・メッセージ等、毎回発火が意味を持つ）は同値ガードしない**。状態性のもの（permission・loading 等）はガードする。どちらかを設計ドキュメントで明示する

### 3.3.1 producer snapshot contract（MUST）

この節は新規ノードと新規 observable property に適用する。既存ノードは
[observable 棚卸し](./architecture-hardening/12-wc-bindable-observable-inventory.md) を起点に段階移行し、
既存の配送・getter・resource lifetime を一括で破壊変更してはならない（MUST NOT）。

#### `state`

`state` はある時点の current value であり、初期 property read と後続 event の両方から読める。

- producer は一度公開した object / array / binary instance を後から in-place mutation してはならない（MUST NOT）。
- logical state を変更するときは fresh object / array を構築し、private field へ割り当ててから event を発火する（MUST）。
- event 発火時の public getter と event detail / custom getter は同じ logical state を表さなければならない（MUST）。
  defensive copy を返す場合、reference identity まで同じである必要はないが、内容と ownership が食い違ってはならない。
- arbitrary payload を一律に clone しない。参照渡しする場合、producer は公開後に変更しない ownership transfer とし、
  consumer は read-only として扱う（producer MUST、consumer SHOULD）。
- `ArrayBuffer` など producer が再利用・書き換えを続ける値は、そのまま state として公開してはならない（MUST NOT）。
  node 固有の理由がある場合だけ明示的に copy するか、`event` / `handle` として設計する。
- platform `Error` / `Event` / credential など opaque value を公開する場合、可能なら `errorInfo` のような
  serializable projection も提供する（SHOULD）。opaque value 自体を汎用 serializable state と説明してはならない。

```ts
private _setItems(items: readonly Item[]): void {
  const next = items.map((item) => ({ ...item }));
  this._items = next;
  this._target.dispatchEvent(new CustomEvent("wcs-x:items-changed", {
    detail: next,
    bubbles: true,
  }));
}
```

この例の copy は node が mutable input を所有 snapshot へ変換するためのものである。汎用 adapter が全 payload を
deep clone / deep freeze する根拠にはならない。deep equality、deep clone、deep freeze は一律に強制しない
（MUST NOT）。開発時に adapter の outer snapshot だけを shallow freeze する判断は producer 契約の外である。

#### `event`

`event` は current level ではなく occurrence である。

- declaration に `semantics: "event"` を宣言する（MUST）。宣言が無い property を汎用 consumer が occurrence として
  扱うことは期待できない。
- 同じ payload が連続しても各 occurrence を dispatch する（MUST）。same-value guard を置いてはならない（MUST NOT）。
- 最後の payload を getter に保持して既存 consumer と互換を保つことはできる（MAY）。ただし getter の値だけでは
  occurrence count を表現できないことを README に明記する（MUST）。
- event を state snapshot の同値比較で dedupe する前提を置いてはならない（MUST NOT）。callback / stream / event-token
  で受ける surface を正とする。

#### `handle`

`handle` は `MediaStream` のように外部状態と独自 lifecycle を持つ live resource である。

- declaration に `semantics: "handle"` を宣言する（MUST）。source comment / README だけの明記では、
  汎用 adapter は通常の state と区別できない。
- producer / consumer のどちらが owner か、交換・停止・dispose 時に誰が release するかを設計文書と README に
  記録する（MUST）。
- clone / freeze / serializable projection により通常の state へ見せかけてはならない（MUST NOT）。
- state snapshot とは別の ref / callback / direct-channel surface で渡す（SHOULD）。現行 protocol の制約で
  `wcBindable.properties` に置く場合は、`semantics: "handle"` に加えて README でも live resource である旨と
  その lifecycle を明記する（MUST）。

#### managed resource value

`blob:` URL のように値自体は primitive でも backing resource を producer が破棄するものは、通常の state より強い
lifetime 契約を必要とする。producer は supersede / dispose 時の revoke point と、過去の値の有効性を保証するかを
README と test に固定する（MUST）。consumer lifecycle まで保証できない場合は best-effort current value と明記する。

### 3.3.2 input value contract（MUST）

§3.3.1 は producer → consumer の出力側を規範化する。入力側（consumer → producer）には双対の問題がある。
framework の reactive store は値を Proxy で包むため、consumer が `el.post = store.message` と書くと Core は
Proxy を受け取る。Vue の `reactive`、Svelte の `$state`、Solid の store、Alpine、MobX、Qwik の `useStore` が
該当し、包まれるのは plain object / array / Map / Set である（`MediaStream`・`Error`・`Blob`・`ArrayBuffer` などの
platform object は対象外なので影響しない）。

- Core は input として受け取った値を、そのまま structured clone 境界（`Worker.postMessage`、
  `BroadcastChannel.postMessage`、IndexedDB ほか）へ渡してよい（MAY）。ただし Proxy は structured clone できず
  `DataCloneError` になるため、never-throw（§3.6）で `error` / `errorInfo` に落ちる経路を必ず持つ（MUST）。
  例外を投げて利用者コードを壊してはならない（MUST NOT）。
- Core が framework 固有の unwrap（`toRaw` / `$state.snapshot` / `unwrap`）を実装してはならない（MUST NOT）。
  依存を持ち込むうえ、どの framework の Proxy かを判定する一般的手段がない。zero runtime dependency の原則にも反する。
- object を受け取る input を持つノードは、reactive store の値は raw 化してから渡すことを README に明記する
  （MUST）。scalar の属性バック input は文字列化されるため対象外でよい。
- 入力値を保持して後から state として再公開する場合、受け取り時に own snapshot へ変換する（SHOULD）。
  consumer 側の store が後から変更されても producer の state が黙って変わらないようにするためで、§3.3.1 の
  「公開後に変更しない」を入力経路から破られないようにする措置である。

### 3.4 `_gen` 世代ガード（MUST）

```ts
private _gen = 0;

observe(): Promise<void> {
  const gen = ++this._gen;
  return someAsyncProbe().then((r) => {
    if (gen !== this._gen) return;        // 古い世代なら破棄
    this._apply(r);
  });
}

dispose(): void {
  this._gen++;                            // 進行中の非同期を全て無効化
  /* listener 解除・subscription flag リセット */
}
```

進行中の非同期処理が disconnect 後や高速 disconnect→reconnect 後に解決したとき、torn-down 要素に書き込んだり二重 listener を張ったりするのを防ぐ。**boolean フラグだけでは不十分**（dispose→observe で false→true に戻り、古い処理がすり抜ける）。

### 3.5 ライフサイクル: `observe()` / `dispose()`

- `observe(...)`: 監視/購読を開始。**冪等**（既に購読中なら設定更新のみで二重購読しない）。再起動は `dispose()` してから
- `dispose()`: listener 解除・subscription flag リセット・`_gen++`。`dispose()` 後の `observe()` で復活できること
- リソースを残す設計判断（例: notification は dispose 後も画面に通知を残す）は理由をコメントに書く

### 3.6 never-throw（MUST）

- 公開メソッドは例外を投げない。失敗は `_setError({ error, message })` で `error` プロパティに流し、API 不在は `"unsupported"` 状態にする
- レガシーエンジンが reject しうる箇所は `try/catch` で握り、現状態を維持する
- 戻り値が必要なメソッドは失敗時のサニタイズ値を返す（空文字・null 等）

### 3.7 API 解決は呼び出し時（MUST）

```ts
private _api() {
  const g = globalThis as any;
  return typeof g.SomeAPI === "function" ? g.SomeAPI : undefined;
}
```

コンストラクタでキャッシュしない。テストが API を install/remove でき、unsupported 環境を正しく報告できる。secure-context 必須 API は `window.isSecureContext` を呼び出し時に確認する。

### 3.8 SSR: `ready` promise

- Core は「最初のプローブが settle したら解決する」`get ready(): Promise<void>` を持つ。unsupported なら `Promise.resolve()`
- `observe()` はこの promise を返す

### 3.9 Core は公開アダプタサーフェス（headless adopter surface）

Core は Shell の実装詳細ではなく、**要素なしで直接使ってよい公開サーフェス**である。`@wcstack/signals` の `bindNode(new XxxCore())` は descriptor 省略で Core を束縛でき（`core.constructor.wcBindable` 解決）、`customElements` レジストリに一切触れないため定義タイミング問題が存在しない（[signals-definition-timing.md](./signals-definition-timing.md) §3.4 の床3）。この利用形を支えるため、次を保証する:

- Core クラスをパッケージ entry（`exports.ts`）から export する（MUST）
- **構造保証**（いずれも既存規範の adopter 向け再掲・MUST）: `EventTarget` 継承（§3.1）・`target` 省略時は自己 dispatch（§3.1）・`static wcBindable` 宣言（§3.2）・observable プロパティは public getter で読める（§4.2 の delegation 前提であり、bindNode の初期 seed もこれを読む）・`observe()`/`dispose()`/`ready` ライフサイクル（§3.5・§3.8）・never-throw（§3.6）
- **headless 構築可能**（MUST）: `target` および DOM 要素を渡さずに構築できる。設定引数を持つ場合も（例: `DefinedCore(tags, mode, timeoutMs, target?)`・`DebounceCore(prefix, target?, options?)`）`target` は省略可能に保つ
- **semver**: 上記の構造保証と Core クラス名は公開 API として semver 保護する。**コンストラクタの設定引数の形・順序はパッケージ個別**であり、各パッケージの README / 設計ドキュメントが正（構造保証の外）
- README に headless（Core）節を持つ（§9・MUST）

実態（2026-07-28 棚卸し）: 全 I/O ノード 38 Core が `extends EventTarget`・`target ?? this`・entry export を満たす（逸脱ゼロ）。コンストラクタが `(target?)` 単独でないのは defined / debounce / permission / raf / wakelock の5つで、いずれも `target` 省略可＝headless 構築可能。利用者向けの説明の正本は `@wcstack/signals` README の「Binding a Core directly」節。

---

## 4. Shell（`<wcs-xxx>` カスタム要素）の規約

参照: [`packages/notification/src/components/Notify.ts`](../packages/notification/src/components/Notify.ts)

### 4.1 形

```ts
export class Wcs<Name> extends HTMLElement {
  static hasConnectedCallbackPromise = true;       // SSR
  static wcBindable: IWcBindable = {
    ...<Name>Core.wcBindable,                       // properties/commands を継承
    inputs: [ /* Shell の settable surface（attribute 連動）*/ ],
    commands: <Name>Core.wcBindable.commands,
  };

  private _core: <Name>Core;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() { super(); this._core = new <Name>Core(this); }

  // 属性アクセサ（get は属性読み、set は属性 reflect。冪等）
  // Core 委譲 getter（observable surface をそのまま転送）
  // コマンド（Core へ委譲）

  connectedCallback() {
    upgradeProperties(this);                          // §4.1.1（MUST・先頭で呼ぶ）
    this.style.display = "none";
    if (config.autoTrigger) registerAutoTrigger();
    this._connectedCallbackPromise = this._core.observe(/* 属性から解決した設定 */);
  }
  disconnectedCallback() { this._core.dispose(); }
  get connectedCallbackPromise() { return this._connectedCallbackPromise; }
}
```

### 4.1.1 property upgrade（MUST）

`connectedCallback` の**先頭**で `upgradeProperties(this)` を呼ぶ（MUST）。`src/protocol/upgradeProperties.ts` は
`/protocol/upgrade-properties.ts` から `scripts/sync-protocol-types.mjs` が配る生成コピーで、手で書き換えない。

未定義タグの要素は素の `HTMLElement` なので、upgrade 前の `el.url = "..."` は own データプロパティを作る。
upgrade 後もそれが prototype の accessor を隠し続けるため、setter は二度と呼ばれず値は静かに消える。
常にプロパティ代入を行う framework（Angular の `[prop]`、Lit の `.prop=`、Solid の `prop:`）× 遅延定義
（autoloader / CDN / code-split）で常態的に起きる
（[framework adapter のバインド成立制約](./architecture-hardening/13-framework-adapter-binding-constraints.md) §1.2）。

- 対象は `wcBindable.inputs` に宣言した入力だけである。宣言していない settable surface は救済されない。
- `await` を含む `connectedCallback` では、最初の `await` より前に同期で呼ぶ（MUST）。
- 冪等なので毎回の接続で呼んでよい。prototype 側が accessor でない own プロパティは触らない。

- Shell は **薄く**保つ。ロジックは Core に置く。Shell の責務は「属性 ↔ Core 設定の橋渡し」「Core observable の委譲」「ライフサイクル駆動」「reactive command-property」だけ
- `this.style.display = "none"`（IO ノードは非表示。`intersection` など layout box が必要な例外は `display:contents` 等を使い理由を書く）

### 4.2 observable は「1イベント＋派生 getter」に分解する

複合状態（例: permission の4値）は、1つのイベントを発火し、`granted` / `denied` / `prompt` / `unsupported` のような boolean を **同じイベントから派生 getter** として公開する。これで `hidden@granted` のような単純バインドが全ノードで同じように書ける。

```ts
{ name: "state",   event: "wcs-x:change" },
{ name: "granted", event: "wcs-x:change", getter: (e) => (e as CustomEvent).detail === "granted" },
```

### 4.3 入力の種類

- **属性連動入力**（宣言的 config。例: `mode` / `body`）: `get` は `getAttribute`、`set` は属性 reflect。冪等
- **reactive command-property**（動的な値で副作用を起こす。例: `notice` / `say`）: 属性を持たず、setter が同値ガードした上で Core メソッドを呼ぶ。`undefined`/`null` は no-op に正規化する（binder は undefined を書かない契約だが直接代入はありうる）。`manual` 属性で抑止できるようにする

### 4.4 SSR

`static hasConnectedCallbackPromise = true` を宣言し、`connectedCallback` で `_core.observe()` の戻り promise を `connectedCallbackPromise` として保持する。state binder 側はこれを待ってからスナップショットを取る。

### 4.5 出力状態の CSS 反映（CustomStateSet / `:state()`）

正本設計: `custom-state-reflection-design.md`。Shell は以下を満たすこと:

- constructor で `super()` の直後・**`new Core(this)` より前**に `attachInternals()` の取得と反映リスナーの配線を行い（Core が constructor 内で同期 dispatch する初回イベントを取りこぼさないため — MUST）、**boolean 出力 observable・派生 boolean getter・`error` の存在**（イベント detail が非 null）を `ElementInternals.states` に反映する（MUST）。連続値・高頻度値・データ値・派生 getter の無い enum は反映しない（design §3.2）。状態名は property 名の kebab-case（design §3.3）
- 反映は Shell が **constructor 登録の自己リスナー**で自分自身の `*-changed` / `:error` イベントを購読して行う。**Core には持ち込まない**（MUST NOT）。wcBindable 宣言も変更しない
- **never-throw**: `attachInternals` 不在（happy-dom・旧環境）や非ダッシュ状態名を拒む旧 Chromium (<125) は取得時 probe で検出し、反映系全体を静かに無効化する
- states は「最後に発火したイベントの同期写像」であり、disconnect で消さない（タイミング契約は timing-and-firing-contract §17）
- **デバッグ観測性**: `debugStates` ゲッターは現在 on の状態名の**スナップショット配列**を返す（MUST）。live な `CustomStateSet` を返してはならない（MUST NOT — 外部書き込み経路になる）。wcBindable には載せない。`debug-states` 属性が付いた要素に限り `data-wcs-state-<name>` 属性をミラーする（既定 OFF。CSS は `:state()` に書くよう README で誘導）
- canonical snippet・テストテンプレ（5〜8本、shim は `__tests__/helpers.ts`＋`setup.ts`）は design §3.4 / §3.6 に従う。新規ノードの tag-design doc には反映状態マップの表を1つ含めること

---

## 5. プロトコル（command-token / event-token）

双方向ノードは2つの結線方向を持つ。詳細は各 SPEC とメモリの設計ノートを参照。

- **command-token**（state → element 起動）: `commands` に宣言したメソッドを `command.<method>:` で起動。引数は位置引数として素通し（MUST、await しない、undefined 引数も素通し）。`spec-proposal-command-token-arguments.md` 参照
- **event-token**（element → state）: `properties` のイベントが state 側に流れる。キー名は wcBindable property 名
- `event` semantics の property は同一 payload でも occurrence ごとに流す。`handle` semantics の property は
  state の値として保持する前提を置かず、owner / release contract に従う
- 同じ Web API で「reactive 版（同値ガード有・宣言的）」と「imperative 版（同値でも発火・命令的）」の両方が要るなら両方提供してよい（例: speech の `say`/`speak`、notification の `notice`/`notify`）

---

## 6. config / bootstrap / 登録

`packages/notification/src/config.ts` をそのまま流用する:

- `config`（内部 mutable、呼び出し時読み取り。**exports.ts から出さない**）
- `getConfig()`（deep-frozen clone を返す。公開用）
- `setConfig(partial)`（型チェックしてマージ、frozen キャッシュ無効化）
- config には最低限 `tagNames` / `autoTrigger` / `triggerAttribute` を持たせる
- `registerComponents()` は `customElements.get()` で二重定義をガード
- `bootstrap<Name>(userConfig?)` は `setConfig` → `registerComponents`

`autoTrigger.ts`（command 系のみ）は `data-<name>target` クリックを拾い、要素を `customElements.get()` で解決して（import 循環回避）コマンドを呼ぶ。不正な triggerAttribute セレクタは try/catch で握り、このショートカットだけ無効化する。

---

## 7. ビルド

ルートの方針に従う: `rimraf dist` → `tsc` → `rollup -c`。Rollup は `src/exports.ts` から:

- `dist/index.esm.js`
- `dist/index.d.ts`（rollup-plugin-dts）

加えて `src/auto.ts` を独立エントリとして `dist/auto.min.js`（Terser）を出力する。これは**外部 import ゼロの自己完結バンドル**でなければならない（MUST）。`src/auto.ts` から兄弟の dist ファイルを相対 import してはならない（MUST NOT）— `integrity` 1 属性でランタイム全体を覆えるという性質が壊れる（[sri.md](./sri.md)）。`dist/index.esm.min.js` は出力しない（`exports` に無く、消費者は旧 auto スタブだけだった）。

Service Worker など追加エントリがあるノードは rollup 出力を増やし、`package.json` の `exports` にサブパス（例: `"./sw"`）を足す（notification 参照）。

`package.json` は `"type": "module"`（ESM only、CommonJS 非対応）。バージョンはクライアントパッケージ（state/fetch/autoloader/router）と揃えてリリースする（`feedback_version_alignment` 参照）。

---

## 8. テスト

- Vitest ＋ happy-dom。`__tests__/*.test.ts`、`setup.ts` あり
- カバレッジ閾値 **100 / 97+ / 100 / 100** を満たす（statements / branches / functions / lines）
- テスト記述（`describe` / `it`）は日本語
- Web API は Fake double で差し替える（`FakeIntersectionObserver` 等の先例あり）。`_api()` が呼び出し時解決なので install/remove でテスト可能
- 必ずテストすること:
  - never-throw（API 不在・reject・secure-context 外で例外が出ない）
  - 同値ガード（同値書き込みでイベントが出ない／イベント性は毎回出る）
  - state-like object / array（後続 update 後も過去に公開した値が変化しない・logical state の変更時は fresh value）
  - property read と event payload / getter が同じ logical state を表す
  - handle / managed resource（交換・dispose の release point と、過去値の有効性）
  - `_gen` ガード（disconnect 後に resolve した非同期が状態を変えない・dispose→observe で復活）
  - `observe()` 冪等性
  - SSR（`connectedCallbackPromise` / `ready` が settle する）
  - unsupported 環境で `"unsupported"` になる

---

## 9. ドキュメント

- `README.md`（英語）/ `README.ja.md`（日本語）を両方書く。既存ノードの構成（概要・インストール・属性表・イベント表・コマンド表・Design Notes）に合わせる
- **headless（Core）節**を README に持つ（MUST・§3.9）: Core クラス名・headless 構築の最小例（実コンストラクタ引数）・ライフサイクルが手動になる旨（`observe()`/`dispose()` ないし start/stop コマンド）・`@wcstack/signals` README「Binding a Core directly」へのリンク
- observable ごとに `state` / `event` / `handle`、値の owner、serializability、resource release point を記録する（MUST・§3.3.1）
- ルート README のノード一覧に追加する
- **タイミング/発火の挙動**（いつ・何回・何が同期で何が microtask か）を持つノードは、[timing-and-firing-contract.md](./timing-and-firing-contract.md) に §1/§2 と同じ粒度で1節追加する（MUST）。example の長文コメントで内部挙動を説明しそうになったら、まずこの契約書に項目を足し、コメントはそこへリンクする

---

## 10. レビュー収束チェックリスト

実装完了の判定。全て満たすまでマージしない。

- [ ] Core は `EventTarget` 継承・DOM 非依存・`static wcBindable` 宣言済み
- [ ] Shell は薄く、Core を `new Core(this)` で包むだけ
- [ ] never-throw（全公開メソッドが例外を投げない）
- [ ] 状態 setter に同値ガード（イベント性は除外し、その旨明記）
- [ ] state-like object / array は公開後に producer が変更せず、logical state の変更時に fresh value を公開する
- [ ] event は同一 payload の occurrence を失わず、handle / managed resource は owner と release point が文書・testで固定されている
- [ ] property read と event payload / getter が同じ logical state を表す
- [ ] `_gen` 世代ガードで非同期の stale 書き込みを防いでいる
- [ ] `observe()` 冪等・`dispose()` で復活可能
- [ ] API は呼び出し時解決（キャッシュしない）
- [ ] SSR: `ready` / `connectedCallbackPromise` / `hasConnectedCallbackPromise`
- [ ] config / bootstrap / registerComponents / exports が規約どおり
- [ ] Core が entry から export され、headless 構築可能（`target` 省略可）・README に headless（Core）節あり（§3.9）
- [ ] テスト 100/97+/100/100、日本語記述、Fake double
- [ ] README ja/en・ルート README 更新・（必要なら）timing 契約に1節追加
- [ ] 設計ドキュメント `docs/<name>-tag-design.md` あり、逸脱は理由が記録済み
- [ ] 非同期実行を持つノードは [async-execution-model.md](./async-execution-model.md) §13 の追補チェックリスト（実行形・レーン・排他モードの宣言ほか）を満たす
