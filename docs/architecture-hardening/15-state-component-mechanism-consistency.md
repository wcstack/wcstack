# state のコンポーネント機構 3 系統の整合性監査

- **作成日**: 2026-08-05
- **状態**: 監査記録＋**P0 実施済み**（2026-08-05、branch `fix/state-component-mechanism-p0`）。
  §1.2 / §1.3 / §1.5 と §2.3 の大半・§2.5 の診断性を修正した。§1.1 / §1.4 / §1.6 および
  §2 の残り・§3 は未着手で、いずれも §7 の decision gate を通してから行う。
  対応状況の一覧は §0。
- **対象**: `@wcstack/state` の
  [`protocol/`](../../packages/state/src/protocol/) /
  [`dcc/`](../../packages/state/src/dcc/) /
  [`webComponent/`](../../packages/state/src/webComponent/)
- **対象スナップショット**: wcstack `065774839c36d2a34a22c928f968acdbb169a98f`（`@wcstack/state@1.25.0`）
- **検証方法**: ソース読解＋happy-dom 上の一時 probe テスト（§8 に再現手順。probe 自体はリポジトリに残していない）

## 結論

`<wcs-state>` に紐づく「カスタム要素に状態を持たせる」機構は 3 系統ある。

| 機構 | 定義の書き方 | wcBindable | 実装 |
|---|---|---|---|
| ① wc-bindable protocol | 任意のカスタム要素が `static wcBindable` を宣言 | **正本** | `src/protocol/` |
| ② DCC | HTML だけ（`data-wc-definition` + Declarative Shadow DOM）。`$bindables` から wcBindable を**実行時生成** | 自動生成 | `src/dcc/` |
| ③ bind-component | JS クラスの `state` プロパティを outer/inner proxy で橋渡し | **一切関与しない** | `src/webComponent/` |

②③は目的が同じ（コンポーネントに state を持たせる）のに、**契約・ライフサイクル規律・宣言の検証強度が揃っていない**。
①を正本として②が部分的にそれを生成し、③は①の外側に独立した意味論を持つ、という三層構造になっており、
その継ぎ目に silent failure が集中している。

本書は [13-framework-adapter-binding-constraints.md](13-framework-adapter-binding-constraints.md) の
「バインドが成立するか」軸を **wcstack 内部の 3 機構間**に適用したものにあたる。13 が外部 adapter との境界を
扱うのに対し、本書は自前の 3 機構が互いに整合しているかを扱う。

---

## 0. 対応状況

| 論点 | 内容 | 状態 |
|---|---|---|
| §1.1 | `this.state` の意味論が mapped / plain で二重 | ⛔ 未着手（**G1 待ち**） |
| §1.2 | outer-state 分岐条件が `data-wcs` 属性の有無 | ✅ 修正済み |
| §1.3 | DCC が再接続で `attachShadow` を呼び直して throw | ✅ 修正済み |
| §1.4 | fragment 内（未接続）の DCC が初期値を落とす | ⛔ 未着手（**G4 待ち**） |
| §1.5 | `$bindables` 重複で wcBindable 宣言が丸ごと棄却される | ✅ 修正済み |
| §1.6 | DCC メソッドに command-token を張れない | ⛔ 未着手（**G2 待ち**） |
| §2.1 | 変更イベントが完全一致パスでしか出ない | ⛔ 未着手 |
| §2.2 | DCC アクセサの同期／非同期が非対称 | ⛔ 未着手 |
| §2.3 | `$bindables` だけ宣言検証が無い | 🟡 部分修正（構造検証は実装。存在検査は残件・理由は §2.3） |
| §2.4 | prototype チェーンの扱いが State と DCC で違う | ⛔ 未着手 |
| §2.5 | inner `<wcs-state>` が `:not([name])` 固定 | 🟡 部分修正（挙動は不変、`console.warn` で可視化） |
| §2.6 | bind-component と state ソース属性の二重指定 | ⛔ 未着手 |
| §2.7 | `bindableEventMap` の設定タイミング | ⛔ 未着手 |
| §3.1-3.6 | 設計・衛生 | ⛔ 未着手 |

修正の実装は以下。

- [`webComponent/bindWebComponent.ts`](../../packages/state/src/webComponent/bindWebComponent.ts) — §1.2
- [`dcc/defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) — §1.3 / §2.5
- [`dcc/processBindablesDeclaration.ts`](../../packages/state/src/dcc/processBindablesDeclaration.ts)（新規） — §1.5 / §2.3

回帰テストは
[`webComponent.bindWebComponent.semantics.test.ts`](../../packages/state/__tests__/webComponent.bindWebComponent.semantics.test.ts)（新規・§6 の穴を塞ぐ）、
[`dcc.processBindablesDeclaration.test.ts`](../../packages/state/__tests__/dcc.processBindablesDeclaration.test.ts)（新規）、
`dcc.defineDCC.test.ts` / `webComponent.bindWebComponent.test.ts`（追記）。
新規テストはいずれも修正前のコードに対して失敗することを確認済み。

---

## 1. 実害が確定している非整合

### 1.1 bind-component の外向き proxy が 2 種類あり、意味論が正反対

[`bindWebComponent.ts:24`](../../packages/state/src/webComponent/bindWebComponent.ts) の分岐は
**「要素に `data-wcs` 属性があるか」だけ**で決まる。

| 分岐 | 実装 | `get` | `set` |
|---|---|---|---|
| mapped（`data-wcs` あり） | [`outerState.ts:16-38`](../../packages/state/src/webComponent/outerState.ts) | `lastValue` キャッシュ（ライブ読みではない） | **値を捨てて** `$postUpdate(path)` のみ |
| plain（`data-wcs` なし） | [`plainOuterState.ts:12-33`](../../packages/state/src/webComponent/plainOuterState.ts) | inner state proxy へ素通し | inner state proxy へ実書き込み |

この proxy は `this.state` としてコンポーネント作者に露出される。つまり
**同一のコンポーネント実装が、親ページ側が `data-wcs` を書いたかどうかで動作を変える**。
`$stateReadyCallback` は両分岐で呼ばれる（`bindWebComponent.ts:46-56`）ので、作者は当然 `this.state` を触る。
README の「`this.state.message = "..."` で即反映」（`packages/state/README.md:1142`）が成立するのは plain 分岐だけ。

mapped の意味論自体は**内部チャネルとしては筋が通っている**。親 state が変わると
[`applyChangeToWebComponent.ts:16`](../../packages/state/src/apply/applyChangeToWebComponent.ts) が
`element["state"]["path"] = v` を実行するが、値の正本は親 state 側にあるので、
子に必要なのは「再読み込みしろ」という通知だけであり `$postUpdate` で足りる。
**問題は内部チャネルと公開 API に同じ proxy を使っていること**であって、mapped の実装が間違っているわけではない。

### 1.2 上記の分岐条件そのものが誤っている ✅ 修正済み

分岐は `component.hasAttribute(config.bindAttributeName)` であって「`<stateProp>.*` バインドが 1 件以上あるか」ではない。

```html
<my-component data-wcs="class.on: flag"></my-component>  <!-- state.* が 1 件も無い -->
```

このとき `bindings` は空になり [`MappingRule.ts:32-34`](../../packages/state/src/webComponent/MappingRule.ts)
が即 return してマッピングが 1 件も作られないが、outerState は mapped 意味論のまま残る。

probe 実測:

- `component.state.msg` → **常に `undefined`**（`setLastValueByAbsoluteStateAddress` はマッピング経路でしか呼ばれない）
- `component.state.msg = 'written'` → **完全な no-op**（inner の値は `'hello'` のまま。`$postUpdate('msg')` だけが飛ぶ）
- 同条件で `data-wcs` を外すと read/write とも正常

既存の [`webComponent.bindWebComponent.test.ts`](../../packages/state/__tests__/webComponent.bindWebComponent.test.ts)
は outerState / innerState / MappingRule を全てモックしているため、この経路の意味論は 1 度も検証されていなかった。

**修正**: 分岐条件を「`<stateProp>.*` バインドが 1 件以上あるか」に変更した。
`data-wcs` があってもマッピング対象が 0 件なら plain 分岐に入り、read / write が inner state へ素通しする。
併せて実モジュールで read / write の結果そのものを固定する
`webComponent.bindWebComponent.semantics.test.ts` を追加した（§6 の穴）。

### 1.3 DCC 要素は再接続すると必ず throw する ✅ 修正済み

[`defineDCC.ts:49-52`](../../packages/state/src/dcc/defineDCC.ts) の `connectedCallback` は
`this._shadow` / `this.shadowRoot` のガード無しに `attachShadow` を呼ぶ。

```
Failed to execute 'attachShadow' on 'Element':
Shadow root cannot be created on a host which already hosts a shadow tree.
```

（happy-dom / 実ブラウザとも同一。probe で確認）

踏む経路は日常的:

- `if` の false → true 再マウント（[`applyChangeToIf.ts:35,49`](../../packages/state/src/apply/applyChangeToIf.ts) が
  同一ノードを `unmount()` → `mountAfter()` する）
- `for` の**行プーリング**（[`applyChangeToFor.ts:188-195`](../../packages/state/src/apply/applyChangeToFor.ts) で
  プールに戻し、`235` 行目で `pop()` して再利用する）

`<wcs-state>` 本体は `_initialized` と `_connectGeneration` で再接続を丁寧に扱っている
（[`State.ts:347-371`](../../packages/state/src/components/State.ts)）のと真逆の作りであり、
**同一パッケージ内でライフサイクル規律が揃っていない**ことがそのまま欠陥になっている。

**修正**: `connectedCallback` の冒頭に `if (this._shadow !== null) return;` を置いた。
shadow tree は host の切断後も保持されるので、2 回目以降は何もしないのが正しい。
closed mode では `this.shadowRoot` が `null` になるため、判定はフィールド側で行う。

### 1.4 リスト内の DCC は初期値を無言で落とす

`for` の全追加高速パスは fragment に組んでから `activateContent` し
（[`applyChangeToFor.ts:244,266`](../../packages/state/src/apply/applyChangeToFor.ts)）、
fragment を DOM に挿すのは `306` 行目。よって binding 適用時点で DCC は**未接続**である。

DCC の `stateElement` getter は `_shadow`（`connectedCallback` で初めて代入される）に依存するため、
[`dccPropertyFactories.ts:26-27`](../../packages/state/src/dcc/dccPropertyFactories.ts) の
`if (!stateEl) return;` で書き込みが黙って捨てられる。

[`applyChange.ts:137-145`](../../packages/state/src/apply/applyChange.ts) の未定義要素ガードは
**「define 待ち」しか持たず「connect 待ち」が無い**。I/O ノード Shell は素のフィールド代入なので
未接続でも値が Core に残る ＝ **この失敗は DCC 固有**。

### 1.5 `$bindables` の重複で wcBindable 宣言が丸ごと無効化される ✅ 修正済み

[`createWcBindable`](../../packages/state/src/dcc/wcBindable.ts) は重複名を素通しする。
一方 reader の [`readNamedList`](../../packages/state/src/protocol/wcBindableReader.ts)（118-129 行）は
重複名を見つけると `null` を返し、`readBindableDeclaration()` 全体が `null` になる。

probe 実測: `$bindables: ["count","count"]` → `readBindableDeclaration()` が `null`。
結果、双方向バインド不可・spread 不可・`resolveInitialSyncPolicy` が「非 bindable 要素」として素通し。
**エラーも警告も出ない。自前のファクトリが自前の reader に棄却されている。**

**修正**: `processBindablesDeclaration()` を新設し、`defineDCC` が
`createWcBindable` を呼ぶ前に宣言を検証して fail-fast させる（§2.3 と同一の修正）。

### 1.6 DCC のメソッドに command-token を張れない（構造的に不可能）

- [`defineDCC.ts:78-80`](../../packages/state/src/dcc/defineDCC.ts) はメソッドを prototype に生やす
- しかし `createWcBindable` は `properties` / `inputs` のみを生成し **`commands` を作らない**
- [`applyChangeToCommand.ts:73-75`](../../packages/state/src/apply/applyChangeToCommand.ts) は
  `declaredCommands` 未宣言なら `raiseError`

probe 実測: 生成される宣言は `{protocol, version, properties:[…], inputs:[…]}` のみ。
`command.inc: $command.x` は必ず失敗する。

対になる event-token は `properties` を参照する（[`eventTokenHandler.ts:86`](../../packages/state/src/event/eventTokenHandler.ts)）
ので DCC で動く。すなわち **command-token / event-token の双対性が DCC でだけ崩れている**。
README「Declarative Custom Components (DCC)」節にこの制約の記載は無い。

なお 1.5 と 1.6 は同じ根（`createWcBindable` が①の宣言仕様の一部しか実装していない）から出ている。
[10-defaulting-rollout-status.md §7 件目](10-defaulting-rollout-status.md) が記録した
「`inputs` を作っていなかった」欠陥と**同じクラスの 3 件目・4 件目**にあたる。

---

## 2. 契約の乖離（実害はケース依存）

### 2.1 DCC の変更イベントは完全一致パスでしか出ない

[`setByAddress.ts:234,294`](../../packages/state/src/proxy/methods/setByAddress.ts) は
`bindableEventMap[address.pathInfo.path]` の完全一致で判定する。
`$bindables: ["user"]` で `user.name` を書いても発火しない。配列の in-place 変異・`$postUpdate`・
getter 由来の派生値も同様。wcBindable の `properties[].event` は「変更で発火する」契約なので乖離している。

### 2.2 DCC アクセサの同期／非同期が非対称

- `getterFn` は同期。state 未初期化なら `console.warn` して `undefined` を返す
- `setterFn` / `callFn` は `initializePromise.then()` 経由で**非同期**

（[`dccPropertyFactories.ts:7-59`](../../packages/state/src/dcc/dccPropertyFactories.ts)）

`el.count = 5; el.count` は旧値を返す。また
[`readProducerSnapshot`](../../packages/state/src/bindings/BindingSession.ts)（916-933 行）は
`target[name]` を同期読みするため、`#init=element` / `#init=auto` では `undefined` が
`commitProducerValue` 経由で親 state に commit されうる。
既定は `state` authority（properties と inputs の両方に載るため）なので通常経路では当たらない。

### 2.3 `$bindables` だけ宣言検証が無い 🟡 部分修正

| 宣言 | 検証 |
|---|---|
| `$commandTokens` | 配列 / 非空文字列 / 予約名衝突 / 重複 を全て `raiseError`（[`processCommandTokensDeclaration.ts:17-39`](../../packages/state/src/command/processCommandTokensDeclaration.ts)） |
| `$streams` | getterPaths / setterPaths との衝突検査あり |
| `$bindables` | [`defineDCC.ts:28-30`](../../packages/state/src/dcc/defineDCC.ts) の `Array.isArray(...) ? ... : []` のみ |

結果、非配列は無言で無視（`$bindables: "count"` が黙って空扱い）、実在しないプロパティ名も無検証
（probe 実測: `["nosuch"]` がそのまま `properties` / `inputs` に載る → 親からの書き込みが expando に着地して消える）、
`$` 始まりの名前も無検証（`isInternalProperty` で prototype には生えないのに wcBindable には載る）。

**修正**: [`processBindablesDeclaration.ts`](../../packages/state/src/dcc/processBindablesDeclaration.ts) を新設し、
`$commandTokens` と同じ強度で **非配列 / 非文字列・空文字列 / `$` 始まり / 重複** を `raiseError` する。

**残件 — 存在検査は入れていない。** `$streams` が生成する値プロパティはインスタンス側の `bindProperty` で
後から実体化されるため、`defineDCC` の時点では素の state オブジェクト上に存在しない。
`!(name in state)` で落とすと正当な組み合わせまで落としうる。さらに `in` は prototype チェーンを歩くので、
§2.4（own descriptor のみを見る）を直さない限り「検査は通るがアクセサは生えない」名前が残り、検査として
不完全になる。**§2.4 と同時に扱うべき残件**として据え置く。

### 2.4 prototype チェーンの扱いが State と DCC で違う

- [`State.getAllPropertyDescriptors`](../../packages/state/src/components/State.ts)（37-45 行）は
  prototype チェーンを歩いて getterPaths / setterPaths を収集する
- [`defineDCC.ts:71`](../../packages/state/src/dcc/defineDCC.ts) は `Object.getOwnPropertyDescriptors(state)` の own のみ

state をクラスインスタンスや `Object.create(proto)` で書くと両者が食い違う。
オブジェクトリテラルが規約なので現状は顕在化しにくいが、`$commandTokens` の doc コメントが
「クラス形式は未サポート」と明記している一方、DCC 側には同等の明文が無い。

### 2.5 DCC の inner `<wcs-state>` は `:not([name])` 固定 🟡 部分修正

[`defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) の `stateTagSelector`。`name` を付けると
`stateElement` が常に `null` になり、全 getter が `undefined`、全 setter が no-op になる。

逆に bind-component は Light DOM で `name` を**必須**とする
（[`State.ts:278`](../../packages/state/src/components/State.ts)）。
同じ「コンポーネント内 state」なのに命名規約が正反対で、相互バリデーションも無い。

**修正**: 挙動は変えず、`$bindables` を宣言しているのに無名の `<wcs-state>` が見つからない場合に
`console.warn` を出すようにした（従来は分岐が無言で落ちていた）。命名規約そのものの統一は §3 と併せて未着手。

### 2.6 bind-component と state ソース属性の二重指定が片方を無言で捨てる

`_initializeBindWebComponent()` → `setInitialState()` → `_resolveSetState()`
（[`State.ts:628-634`](../../packages/state/src/components/State.ts)）だが、
`_initialize()` は `state` / `src` / `json` / inner `<script>` があればそちらを採用し `_setStatePromise` を await しない
（`State.ts:213-240`）。結果、`createInnerState` で作った proxy ごと破棄され、親↔子マッピングが死ぬ。バリデーション無し。

### 2.7 `bindableEventMap` の設定タイミング

[`defineDCC.ts:58`](../../packages/state/src/dcc/defineDCC.ts) は `initializePromise.then()` で設定するため、
`$connectedCallback` 内で行った初期変更はイベントを出さない。

---

## 3. 設計・衛生

- **3.1** DCC 定義内の `bind-component` は無言で無視される（[`State.ts:356-361`](../../packages/state/src/components/State.ts)
  が DCC 検出で先に `return` する）
- **3.2** wcBindable の要求範囲が機構ごとに揃っていない。spread（`...:`）と command-token は
  wcBindable 必須で未宣言なら `raiseError` するが、bind-component コンポーネントは wcBindable を持たないので
  `state.msg: x` は通る。**同じ「コンポーネント」なのに書ける構文が違う**
- **3.3** root 判定が 2 系統。`instanceof ShadowRoot`（`State.ts:268,357` / `setByAddress.ts:237`）と
  `rootNode.constructor.name === 'ShadowRoot' | 'Document' | 'HTMLDocument'`
  （[`stateElementByName.ts:66,81`](../../packages/state/src/stateElementByName.ts)）。後者は文字列比較で
  `DocumentFragment` を取りこぼす
- **3.4** 重複定義時の作法が不揃い。DCC タグ重複は `console.warn` してスキップ（`defineDCC.ts:16-20`）、
  state 名重複は `raiseError`（`stateElementByName.ts:91-93`）
- **3.5** 型・レイヤ。`IStateElement` に `bindableEventMap`（readonly）はあるが `setBindableEventMap` が無く、
  `defineDCC` が具象 `State` を import して cast している（dcc → components の逆参照。
  型としてのみ使うため tsc が elide し実行時循環は無いが依存の向きは逆）。
  `IDCCElement.stateElement` の型も `IStateElement` と `State` で二重定義になっている
- **3.6** [`src/dcc/README.md`](../../packages/state/src/dcc/README.md) が設計メモのまま残り実装と食い違う
  （`typeof func.constructor.name === "AsyncFunction"` は常に false、イベントを host ではなく stateElement に
  dispatch する旧仕様など）。[`src/webComponent/README.md`](../../packages/state/src/webComponent/README.md) も断片のみ。
  正本は `packages/state/README.md`

---

## 4. 根本原因の整理

3 つに集約できる。

1. **①の宣言仕様を②が部分実装している** — `createWcBindable` は `properties` / `inputs` しか作らず、
   `commands` も重複検査も持たない。①の reader は厳格なので、②が生成した宣言が①に棄却される
   （1.5 / 1.6 / 2.3）。10-defaulting-rollout-status.md の `inputs` 欠落と同じ構造の再発である
2. **内部チャネルと公開 API に同じ proxy を使っている** — ③の `outerState` は
   「親 state → 子への再読込通知」という内部用途で正しいが、それが `this.state` として作者に見える（1.1 / 1.2）
3. **ライフサイクル規律が機構間で共有されていない** — `<wcs-state>` は再接続・世代・未接続をすべて扱うが、
   ②の DCC クラスは何も扱わない（1.3 / 1.4）

## 5. 修正の見立て（順序と規模）

| 優先 | 項目 | 規模 | 状態 | 備考 |
|---|---|---|---|---|
| P0 | 1.2 分岐条件を「`<stateProp>.*` バインドが 1 件以上あるか」に変更 | 数行 | ✅ | 意味論の変更を伴わない純粋な条件バグ |
| P0 | 1.3 DCC `connectedCallback` に再接続ガード | 数行 | ✅ | `if (this._shadow !== null) return;` |
| P0 | 1.5 / 2.3 `createWcBindable` に `$commandTokens` 相当の宣言検証 | 小 | ✅ | `processBindablesDeclaration` を新設。存在検査のみ残件 |
| P1 | 1.4 未接続要素への apply を connect 待ちに退避 | 中 | ⛔ | `applyChange` の deferred 機構を connect まで拡張。②専用の逃げも可（§7 G4） |
| P1 | 1.6 DCC の `commands` 生成 | 小〜中 | ⛔ | どのメソッドを command とするかの仕様判断が要る（§7 G2） |
| P2 | 1.1 `this.state` の意味論統一 | 大 | ⛔ | 内部チャネルと公開 API の分離（§7 G1） |
| P2 | 2.1 変更イベントの発火範囲 | 中 | ⛔ | サブパス変更をどう畳むかの仕様判断 |
| P3 | 2.4 / 2.6 / 2.7 / §3 | 小 | ⛔ | 個別に軽い。2.3 の存在検査は 2.4 と同時に |
| P3 | 2.5 命名規約の統一 | 小 | 🟡 | 診断 warn のみ実施。規約の統一は §7 G3 と併せて |

## 6. 回帰テストの穴

- ✅ `webComponent.bindWebComponent.test.ts` は依存を全てモックするため、outerState / innerState の
  **意味論の組み合わせ**を検証していなかった。1.2 はこの穴に落ちていた →
  実モジュールで read / write の結果を固定する `webComponent.bindWebComponent.semantics.test.ts` を追加
- 🟡 `__e2e__/dcc/index.html` は単発の DCC インスタンスのみで、**リスト内 DCC / 条件付き DCC が無い**。
  1.3 / 1.4 はこの穴に落ちている → 1.3 は unit test（`dcc.defineDCC.test.ts` の再接続 2 本）で塞いだが、
  **e2e は未追加**。1.4 の修正時に合わせて追加すること
- 🟡 10-defaulting-rollout-status.md §209 の `bindable-conformance` job は
  「dist export に現れない宣言ファクトリ（DCC `createWcBindable`）は state の unit test が固定」としているが、
  その unit test は `properties`/`inputs` の同一集合しか見ておらず、`commands` と重複名は対象外だった →
  重複名は `dcc.processBindablesDeclaration.test.ts` が固定。`commands` は 1.6 が未着手なので依然として対象外

## 7. Decision gate

- **G1: `this.state` の意味論をどうするか** — (a) mapped でも実書き込みを通す / (b) 内部チャネル用の
  proxy を `this.state` から分離し公開面は plain 意味論に統一 / (c) mapped は read-only と規範化して
  書き込みを `raiseError`。README の記述と `$stateReadyCallback` の存在は (a)(b) を示唆するが、
  mapped の値の正本は親 state なので (c) も筋は通る
- **G2: DCC のメソッドを command として公開するか** — 公開するなら `$bindables` と対になる
  `$commands` 宣言を足すのか、prototype 上の関数を全て自動宣言するのか。
  「data-wcs は配線であって DSL ではない」（feedback）に照らすと明示宣言が整合的
- **G3: ②と③を統合するか、分離を明文化するか** — 現状は「HTML だけで書きたいなら②、JS クラスがあるなら③」
  という暗黙の使い分けだが、README にも SPEC にも書かれていない。統合しないなら
  **相互排他と適用条件を規範として明記する**必要がある（3.1 の無言 return もここに含む）
- **G4: 未接続要素への apply を汎用機構にするか** — 1.4 は②固有の症状だが、原因
  （`applyChange` に connect 待ちが無い）は汎用。汎用側を直すと全機構に影響するため、
  ②専用の逃げ（`_shadow` を constructor で用意する等）と比較する

## 8. probe の再現手順

本書の「probe 実測」は以下で再現できる。`packages/state/__tests__/` に一時ファイルを置き、
`npx vitest run <file>` で実行し、確認後に削除した（リポジトリには残していない）。

- **1.3**: `defineDCC(host, shadow, {count:0,$bindables:['count']})` → インスタンス生成・`document.body` に append →
  `el.remove()` → 再 append で `attachShadow` が throw することを確認
- **1.5**: `readBindableDeclaration()` に `createWcBindable('t-dup', ['count','count'])` を積んだ要素を渡すと
  `null` が返ることを確認
- **1.6**: 生成された `static wcBindable` に `commands` キーが存在しないこと、
  かつ `Ctor.prototype.inc` が関数であることを同時に確認
- **1.2 / 1.1**: `bindWebComponent(fakeStateElement, component, 'state', {...})` を、
  `component` に `data-wcs` を付けた場合／付けない場合で実行し、`component.state.msg` の
  read / write 結果を比較（mapped: `undefined` / no-op、plain: 素通し）
