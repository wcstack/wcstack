# wcstack 非同期IOノード作成ガイドライン (Async IO Node Authoring Guidelines)

- **対象**: `@wcstack` に新しい非同期IOノードパッケージ（Web API を宣言的タグ化したもの。`@wcstack/fetch` / `geolocation` / `clipboard` / `sse` / `broadcast` / `worker` / `wakelock` / `intersection` / `resize` / `speech` / `permission` / `notification` ほか）を追加する実装者
- **状態**: 規範ドキュメント（normative）。「MUST / SHOULD / MAY」は RFC 2119 の意味で使う。新規ノードはここに反した実装をしてはならない（MUST NOT）。やむを得ず逸脱する場合は、その理由をパッケージの設計ドキュメント（`docs/<name>-tag-design.md`）に記録すること
- **なぜ存在するか**: 既存ノードは全て同じ骨格（Core/Shell 分離・wc-bindable 準拠・never-throw・`_gen` 世代ガード・SSR 対応）を共有している。この一貫性が「1つ覚えれば全部使える」という DX と、`state` binder からの相互運用性を支えている。新規ノードがこの骨格を踏襲しないと、利用者は個別に内部を読まねばならず、エコシステムの価値が崩れる。本書はその骨格を1枚に集約し、レビューのチェックリストにする
- **関連**: タイミング・発火の契約は [timing-and-firing-contract.md](./timing-and-firing-contract.md)。実行意味論（実行形・レーン・排他モード・キャンセル・再試行・タイムアウト）の規範は [async-execution-model.md](./async-execution-model.md)。プロトコル本体は各 SPEC（wc-bindable / command-token / event-token）。設計検討の様式は既存の `docs/*-tag-design.md` を参照

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
- **desired / actual の二相**が必要か → 例: `wakelock`（取得要求 `desired` と実際に保持中 `actual` を分離）
- **同値ガードのみで十分か**、debounce/throttle は利用者責務にするか（基本は利用者責務。filter で `notice@x|debounce(1000)` のように書かせる）
- **permission / secure-context** の扱い。既存の4値 surface（`prompt` / `granted` / `denied` / `unsupported`）を流用するか
- **autoTrigger**（クリック起動ショートカット）を持つか

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
    this.style.display = "none";
    if (config.autoTrigger) registerAutoTrigger();
    this._connectedCallbackPromise = this._core.observe(/* 属性から解決した設定 */);
  }
  disconnectedCallback() { this._core.dispose(); }
  get connectedCallbackPromise() { return this._connectedCallbackPromise; }
}
```

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
- `dist/index.esm.min.js`（Terser）
- `dist/index.d.ts`（rollup-plugin-dts）

`src/auto/` のプリビルドスクリプトを `dist/` へコピーする。Service Worker など追加エントリがあるノードは rollup 出力を増やし、`package.json` の `exports` にサブパス（例: `"./sw"`）を足す（notification 参照）。

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
  - `_gen` ガード（disconnect 後に resolve した非同期が状態を変えない・dispose→observe で復活）
  - `observe()` 冪等性
  - SSR（`connectedCallbackPromise` / `ready` が settle する）
  - unsupported 環境で `"unsupported"` になる

---

## 9. ドキュメント

- `README.md`（英語）/ `README.ja.md`（日本語）を両方書く。既存ノードの構成（概要・インストール・属性表・イベント表・コマンド表・Design Notes）に合わせる
- ルート README のノード一覧に追加する
- **タイミング/発火の挙動**（いつ・何回・何が同期で何が microtask か）を持つノードは、[timing-and-firing-contract.md](./timing-and-firing-contract.md) に §1/§2 と同じ粒度で1節追加する（MUST）。example の長文コメントで内部挙動を説明しそうになったら、まずこの契約書に項目を足し、コメントはそこへリンクする

---

## 10. レビュー収束チェックリスト

実装完了の判定。全て満たすまでマージしない。

- [ ] Core は `EventTarget` 継承・DOM 非依存・`static wcBindable` 宣言済み
- [ ] Shell は薄く、Core を `new Core(this)` で包むだけ
- [ ] never-throw（全公開メソッドが例外を投げない）
- [ ] 状態 setter に同値ガード（イベント性は除外し、その旨明記）
- [ ] `_gen` 世代ガードで非同期の stale 書き込みを防いでいる
- [ ] `observe()` 冪等・`dispose()` で復活可能
- [ ] API は呼び出し時解決（キャッシュしない）
- [ ] SSR: `ready` / `connectedCallbackPromise` / `hasConnectedCallbackPromise`
- [ ] config / bootstrap / registerComponents / exports が規約どおり
- [ ] テスト 100/97+/100/100、日本語記述、Fake double
- [ ] README ja/en・ルート README 更新・（必要なら）timing 契約に1節追加
- [ ] 設計ドキュメント `docs/<name>-tag-design.md` あり、逸脱は理由が記録済み
- [ ] 非同期実行を持つノードは [async-execution-model.md](./async-execution-model.md) §13 の追補チェックリスト（実行形・レーン・排他モードの宣言ほか）を満たす
