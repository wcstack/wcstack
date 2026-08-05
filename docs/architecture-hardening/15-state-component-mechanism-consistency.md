# state のコンポーネント機構 3 系統の整合性監査

- **作成日**: 2026-08-05
- **状態**: 監査記録＋**修正進行中**（2026-08-05）。§7 の decision gate G1-G4 は 4 件とも決着済み。
  実装済み = §1.1〜§1.6 / §2.3 / §2.4 / §2.6 / §2.7 / §3.1 / §3.2 / §3.4 / §3.5 / §3.6、
  部分 = §2.5、訂正 = §3.3（本書の誤り）。
  残り = §2.1 / §2.2（どちらも gate 無し）。**§1 の確定欠陥と decision gate 対象は全て解消**。
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
| §1.1 | `this.state` の意味論が mapped / plain で二重 | ✅ 修正済み（G1 = 内部チャネル分離） |
| §1.2 | outer-state 分岐条件が `data-wcs` 属性の有無 | ✅ 修正済み |
| §1.3 | DCC が再接続で `attachShadow` を呼び直して throw | ✅ 修正済み |
| §1.4 | fragment 内（未接続）の DCC が初期値を落とす | ✅ 修正済み（G4 = DCC 側で解決。実装は遅延構築） |
| §1.5 | `$bindables` 重複で wcBindable 宣言が丸ごと棄却される | ✅ 修正済み |
| §1.6 | DCC メソッドに command-token を張れない | ✅ 修正済み（G2 = `$commands` 明示宣言） |
| §2.1 | 変更イベントが完全一致パスでしか出ない | ⛔ 未着手 |
| §2.2 | DCC アクセサの同期／非同期が非対称 | ⛔ 未着手 |
| §2.3 | `$bindables` だけ宣言検証が無い | ✅ 修正済み（構造検証＋存在検査。`$streams` 名も解決） |
| §2.4 | prototype チェーンの扱いが State と DCC で違う | ✅ 修正済み |
| §2.5 | inner `<wcs-state>` が `:not([name])` 固定 | 🟡 部分修正（挙動は不変、`console.warn` で可視化） |
| §2.6 | bind-component と state ソース属性の二重指定 | ✅ 修正済み |
| §2.7 | `bindableEventMap` の設定タイミング | ✅ 修正済み |
| §3.1 / §3.2 / §3.4 | 相互排他・wcBindable の要求範囲・重複定義の作法 | ✅ 修正済み（G3 = 分離を規範として明文化） |
| §3.3 | root 判定が 2 系統 | ❌ **本書の誤り**（SSR で必要。コメントを追加して訂正） |
| §3.5 | 型・レイヤ（`IStateElement` に setter が無い） | ✅ 修正済み |
| §3.6 | `src/` 配下の README が実装と食い違う | ✅ 修正済み |

修正の実装は以下。

| ファイル | 対象 |
|---|---|
| [`webComponent/bindWebComponent.ts`](../../packages/state/src/webComponent/bindWebComponent.ts) | §1.2 / §1.1 |
| [`webComponent/outerState.ts`](../../packages/state/src/webComponent/outerState.ts) | §1.1（mapped 専用 proxy と lastValue 台帳を削除し 1 本化） |
| [`webComponent/innerState.ts`](../../packages/state/src/webComponent/innerState.ts) | §1.1（台帳書き込みと listIndex 解決を除去） |
| [`apply/applyChangeToWebComponent.ts`](../../packages/state/src/apply/applyChangeToWebComponent.ts) | §1.1（内部チャネルを分離） |
| [`dcc/defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) | §1.3 / §1.4 / §2.4 / §2.5 / §2.7 / §3.5 |
| [`dcc/processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts)（新規） | §1.5 / §2.3 / §1.6 |
| [`dcc/wcBindable.ts`](../../packages/state/src/dcc/wcBindable.ts) | §1.6（`commands` 生成） |
| [`getAllPropertyDescriptors.ts`](../../packages/state/src/getAllPropertyDescriptors.ts)（新規） | §2.4（State と DCC で走査を共有） |
| [`components/State.ts`](../../packages/state/src/components/State.ts) | §2.4 / §2.6 / §3.1 |
| [`components/types.ts`](../../packages/state/src/components/types.ts) | §3.5 |
| [`stateElementByName.ts`](../../packages/state/src/stateElementByName.ts) | §3.3（コメントのみ・挙動不変） |
| `src/dcc/README.md` / `src/webComponent/README.md` | §3.6（実装の現状に書き直し） |

回帰テストは
[`webComponent.bindWebComponent.semantics.test.ts`](../../packages/state/__tests__/webComponent.bindWebComponent.semantics.test.ts)（新規・§6 の穴を塞ぐ）、
[`dcc.processDccDeclarations.test.ts`](../../packages/state/__tests__/dcc.processDccDeclarations.test.ts)（新規）、
[`src.getAllPropertyDescriptors.test.ts`](../../packages/state/__tests__/src.getAllPropertyDescriptors.test.ts)（新規）、
`dcc.defineDCC.test.ts` / `webComponent.bindWebComponent.test.ts` / `components.State.test.ts`（追記）。
新規テスト（unit / e2e とも）はいずれも修正前のコードに対して失敗することを確認済み。

---

## 1. 実害が確定している非整合

### 1.1 bind-component の外向き proxy が 2 種類あり、意味論が正反対 ✅ 修正済み

`bindWebComponent` の分岐は**「要素に `data-wcs` 属性があるか」だけ**で決まっていた。

| 分岐 | 実装 | `get` | `set` |
|---|---|---|---|
| mapped（`data-wcs` あり） | 旧 `outerState.ts` | `lastValue` キャッシュ（ライブ読みではない） | **値を捨てて** `$postUpdate(path)` のみ |
| plain（`data-wcs` なし） | 旧 `plainOuterState.ts` | inner state proxy へ素通し | inner state proxy へ実書き込み |

この proxy は `this.state` としてコンポーネント作者に露出される。つまり
**同一のコンポーネント実装が、親ページ側が `data-wcs` を書いたかどうかで動作を変える**。
`$stateReadyCallback` は両分岐で呼ばれるので、作者は当然 `this.state` を触る。
README の「`this.state.message = "..."` で即反映」が成立するのは plain 分岐だけだった。

mapped の意味論自体は**内部チャネルとしては筋が通っていた**。親 state が変わると
`applyChangeToWebComponent` が `element["state"]["path"] = v` を実行するが、値の正本は親 state 側に
あるので、子に必要なのは「読み直せ」という通知だけであり `$postUpdate` で足りる。
**問題は内部チャネルと公開 API に同じ proxy を使っていたこと**であって、mapped の実装が
間違っていたわけではない。

**修正（G1 = (b) 内部チャネルを分離）**:

- 公開 proxy は 1 種類だけになり、mapped / plain の区別が消えた
  （[`outerState.ts`](../../packages/state/src/webComponent/outerState.ts)）。
  mapped でも素通し先の innerState proxy がマッピング経由で親 state に解決するので、
  read はライブ・write は親に届く
- 内部チャネルは [`applyChangeToWebComponent.ts`](../../packages/state/src/apply/applyChangeToWebComponent.ts) が
  `getStateElementByWebComponent` で state element を直接引いて `$postUpdate` する形に分離した。
  `element[stateProp]` を一切触らない（この関数が選ばれるのは `isWebComponentComplete` が真のときだけなので、
  state element は必ず登録済み）
- 不要になった mapped 専用 proxy と `lastValueByAbsoluteStateAddress.ts` は削除。
  `innerState.get` からも listIndex 解決と台帳書き込みが落ち、読みごとの
  `createAbsoluteStateAddress` 割り当てが 1 個減った

回帰は実ブラウザで固定した
（[`e2e/tests/state-bind-component-write.spec.ts`](../../e2e/tests/state-bind-component-write.spec.ts)）。
修正前は mapped な要素の `element.state.name` が `undefined` を返して落ちる。

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

### 1.4 リスト内の DCC は初期値を無言で落とす ✅ 修正済み

`for` の全追加高速パスは fragment に組んでから `activateContent` し
（[`applyChangeToFor.ts:244,266`](../../packages/state/src/apply/applyChangeToFor.ts)）、
fragment を DOM に挿すのは `306` 行目。よって binding 適用時点で DCC は**未接続**である。

DCC の `stateElement` getter は `_shadow`（`connectedCallback` で初めて代入される）に依存するため、
[`dccPropertyFactories.ts:26-27`](../../packages/state/src/dcc/dccPropertyFactories.ts) の
`if (!stateEl) return;` で書き込みが黙って捨てられる。

[`applyChange.ts:137-145`](../../packages/state/src/apply/applyChange.ts) の未定義要素ガードは
**「define 待ち」しか持たず「connect 待ち」が無い**。I/O ノード Shell は素のフィールド代入なので
未接続でも値が Core に残る ＝ **この失敗は DCC 固有**。

**修正（G4 = (a) DCC 側で解決）**: shadow を `_ensureShadow()` で遅延構築し、
`connectedCallback` と `stateElement` getter の両方から呼ぶ。未接続でもアクセサが
`stateElement` を解決できるので、書き込みは inner `<wcs-state>` の `initializePromise` に
積まれ、接続・state ロード後に適用される。pending バッファは要らない。

> **決定との差分**: G4 は「constructor へ前倒し」で決着したが、実装は constructor ではなく
> 遅延構築を採った。目的（未接続でもアクセサが動く・影響が DCC に閉じる）は同じで、
> constructor 版だと (1) 定義要素の判定に属性を読む必要があり constructor の作法に反する、
> (2) 同一タグの `data-wc-definition` が 2 つある場合、DSD の shadow を既に持つ 2 つ目に
> `attachShadow` して throw する、の 2 点を踏むため。冪等なので §1.3 の再接続ガードも兼ねる。

実装中に判明した追加の落とし穴: `template.content` は inert なテンプレート所有ドキュメントに
属するため、その clone はカスタム要素として **upgrade されていない**。ホストが接続済みなら
`appendChild` で upgrade されるが、未接続の shadow に挿した場合は契機が無く、内側の
`<wcs-state>` が素の `HTMLElement` のまま残って `createState is not a function` で落ちる。
`_ensureShadow` の末尾で `customElements.upgrade` を明示的に呼ぶ。
これは unit test では踏めず（happy-dom は clone 時に upgrade する）、e2e で初めて出た。

### 1.5 `$bindables` の重複で wcBindable 宣言が丸ごと無効化される ✅ 修正済み

[`createWcBindable`](../../packages/state/src/dcc/wcBindable.ts) は重複名を素通しする。
一方 reader の [`readNamedList`](../../packages/state/src/protocol/wcBindableReader.ts)（118-129 行）は
重複名を見つけると `null` を返し、`readBindableDeclaration()` 全体が `null` になる。

probe 実測: `$bindables: ["count","count"]` → `readBindableDeclaration()` が `null`。
結果、双方向バインド不可・spread 不可・`resolveInitialSyncPolicy` が「非 bindable 要素」として素通し。
**エラーも警告も出ない。自前のファクトリが自前の reader に棄却されている。**

**修正**: `processDccDeclarations()`（当初は `processBindablesDeclaration()`）を新設し、`defineDCC` が
`createWcBindable` を呼ぶ前に宣言を検証して fail-fast させる（§2.3 と同一の修正）。

### 1.6 DCC のメソッドに command-token を張れない（構造的に不可能） ✅ 修正済み

- [`defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) はメソッドを prototype に生やす
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

**修正（G2 = (a) `$commands` 明示宣言）**: `$bindables` と対になる `$commands: ["bumpBy"]` を導入し、
宣言されたものだけを `commands` に載せる。`$commands` は §2.3 と同じ構造検証に加え
「state 上に実在する **関数** であること」も検査する（`$bindables` 側は逆に「関数でないこと」）。

`async` は一律 `true`。`callFn` が常に `initializePromise` に chain するため、state 側のメソッドが
同期でも呼び出し側から見た戻り値は Promise になる。state メソッド自身の asyncness を報告すると
呼び出し側が観測しないものを記述することになる。

宣言モジュールは `$bindables` 専用ではなくなったので
`processBindablesDeclaration.ts` → [`processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts) に改名した。
回帰は実ブラウザで固定（[`e2e/tests/state-dcc-command.spec.ts`](../../e2e/tests/state-dcc-command.spec.ts)）。

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

**修正**: [`processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts) を新設し、
`$commandTokens` と同じ強度で **非配列 / 非文字列・空文字列 / `$` 始まり / 重複** を `raiseError` する。

**存在検査**（G2 と同時に実施）: `getAllPropertyDescriptors`（§2.4 で共有化した走査）に
名前が無ければ `raiseError`。併せて種別も見て、`$bindables` にメソッドを書いた場合と
`$commands` に値プロパティを書いた場合をそれぞれ相手側の宣言へ誘導する。

`$streams` については「stream 名も実在として許可し、アクセサも生やす」を採った。
値プロパティはインスタンス側で実体化されるため `defineDCC` の時点では descriptor が無く、
素直に落とすと `$streams` × `$bindables` が一律エラーになる。この組み合わせは従来
**アクセサが生えず黙って死んでいた**ので、エラーにするより動くようにするほうが素直だと判断した。
descriptor が無い名前は `streamBackedBindables` として `defineDCC` が別途 getter/setter を生やす。

> 残る論点: stream 由来メンバも `properties` + `inputs` の両方に載る（＝ settable 扱い）。
> producer 駆動の値に書き込む意味は薄いが、`$streams` の実行時も `Reflect.set` で書いているため
> 現状は整合している。変更イベントが完全一致パスでしか出ない点（§2.1）は stream 由来でも同じ。

### 2.4 prototype チェーンの扱いが State と DCC で違う ✅ 修正済み

- `State` は prototype チェーンを歩いて getterPaths / setterPaths を収集していた
- `defineDCC` は `Object.getOwnPropertyDescriptors(state)` の own のみ

state をクラスインスタンスや `Object.create(proto)` で書くと両者が食い違い、
「getterPaths には載るのに DCC prototype にアクセサが生えない」状態になる。
オブジェクトリテラルが規約なので顕在化しにくいが、走査が 2 本ある事実そのものが
§2.3 の存在検査を入れられない理由にもなっていた。

**修正**: 走査を [`getAllPropertyDescriptors.ts`](../../packages/state/src/getAllPropertyDescriptors.ts)
に切り出して両者で共有した。同名は手前（自身に近い側）が勝つ — プロパティ解決の実際の優先順位と一致する。
元の実装は遠いプロトタイプが後勝ちで上書きしていたが、名前の集合しか見ない
getterPaths / setterPaths には影響が無かったため露見していなかった。

### 2.5 DCC の inner `<wcs-state>` は `:not([name])` 固定 🟡 部分修正

[`defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) の `stateTagSelector`。`name` を付けると
`stateElement` が常に `null` になり、全 getter が `undefined`、全 setter が no-op になる。

逆に bind-component は Light DOM で `name` を**必須**とする
（[`State.ts:278`](../../packages/state/src/components/State.ts)）。
同じ「コンポーネント内 state」なのに命名規約が正反対で、相互バリデーションも無い。

**修正**: 挙動は変えず、`$bindables` を宣言しているのに無名の `<wcs-state>` が見つからない場合に
`console.warn` を出すようにした（従来は分岐が無言で落ちていた）。命名規約そのものの統一は §3 と併せて未着手。

### 2.6 bind-component と state ソース属性の二重指定が片方を無言で捨てる ✅ 修正済み

`_initializeBindWebComponent()` → `setInitialState()` → `_resolveSetState()`
（[`State.ts:628-634`](../../packages/state/src/components/State.ts)）だが、
`_initialize()` は `state` / `src` / `json` / inner `<script>` があればそちらを採用し `_setStatePromise` を await しない
（`State.ts:213-240`）。結果、`createInnerState` で作った proxy ごと破棄され、親↔子マッピングが死ぬ。

**修正**: `_initializeBindWebComponent` で `state` / `src` / `json` / inner `<script type="module">`
との併記を検出して `raiseError` する。併記は必ず設定ミスなので fail-fast が正しい。

### 2.7 `bindableEventMap` の設定タイミング ✅ 修正済み

`defineDCC` は `initializePromise.then()` で設定していたため、
`$connectedCallback` 内で行った初期変更はイベントを出さなかった。

**修正**: `connectedCallback` 内で同期的に設定する。`setBindableEventMap` はフィールド代入だけで
state を参照しないので、`<wcs-state>` の初期化前に呼んでも安全。

---

## 3. 設計・衛生

- **3.1** ✅ 修正済み（G3）。DCC 定義内の `bind-component` は DCC 検出の `return` で無言に無視されていた。
  DCC の state はテンプレートに属しインスタンスごとにロードされるので、定義時点のホストのプロパティを
  ソースにする bind-component とは両立しない。`raiseError` に変更した
- **3.2** ✅ 修正済み（G3）。wcBindable の要求範囲が機構ごとに揃っていなかった。spread（`...:`）と
  command-token は wcBindable 必須で未宣言なら `raiseError` するが、bind-component コンポーネントは
  wcBindable を持たないので `state.msg: x` は通る。**同じ「コンポーネント」なのに書ける構文が違う**。

  これは欠陥ではなく設計上の帰結だと整理した。bind-component は宣言されたプロパティ面ではなく
  **パス**で配線する機構なので、`wcBindable` 宣言を要求する構文が使えないのは筋が通っている。
  統合はせず、**規範として明文化**した — README.md / README.ja.md に
  「Choosing a Component Mechanism / コンポーネント機構の選び方」節を新設し、
  定義方法・state の在処・`static wcBindable` の有無・親からの値バインド／メソッド起動・spread の可否・
  自身の読み書き の 6 軸で対応表を置き、排他であることと選択の目安を書いた。
  `src/dcc/README.md` と `src/webComponent/README.md` からも相互に参照する
- **3.3** ~~root 判定が 2 系統~~ ❌ **本書の誤り（2026-08-05 訂正）**。
  `instanceof ShadowRoot`（`State.ts:268,357` / `setByAddress.ts:237`）と
  `rootNode.constructor.name === ...`（[`stateElementByName.ts`](../../packages/state/src/stateElementByName.ts)）の
  併存を「揃っていない」と書いたが、後者は**必要**だった。SSR では `@wcstack/server` の
  `installGlobals` が happy-dom の一部だけを `globalThis` に載せ、その `GLOBALS_KEYS` に
  `Document` は入っていない。Node にも `Document` は無いので `rootNode instanceof Document` は
  ReferenceError になる。`ShadowRoot` はリストに含まれるため他所の instanceof は成立する。
  **対応 = コード側に理由コメントを追加**（統一はしない）。
  なお `DocumentFragment` root で bindings が組まれない点は事実だが、fragment は
  `setRootNodeByFragment` で別途対応先が与えられるため、ここでの取りこぼしではない
- **3.4** ✅ 修正済み（G3）。重複定義時の作法が不揃いだった。DCC タグ重複は `console.warn` してスキップ、
  state 名重複は `raiseError`（`stateElementByName.ts`）。DCC 側を `raiseError` に揃えた。
  警告で済ませると先勝ちで**別テンプレートのインスタンスが生える**ため、
  「動いているように見えて中身が違う」状態になる。これは authoring error として落とすのが正しい
- **3.5** ✅ 修正済み。`IStateElement` に `bindableEventMap`（readonly）はあるが `setBindableEventMap` が無く、
  `defineDCC` が具象 `State` を import して cast していた（dcc → components の逆参照）。
  インターフェースに setter を追加し、`defineDCC` は `import type { IStateElement }` のみに依存する。
  `stateElement` の型も `dccPropertyFactories` 側と揃った
- **3.6** ✅ 修正済み。[`src/dcc/README.md`](../../packages/state/src/dcc/README.md) が設計メモのまま残り
  実装と食い違っていた（`typeof func.constructor.name === "AsyncFunction"` は常に false、
  イベントを host ではなく stateElement に dispatch する旧仕様など）。
  [`src/webComponent/README.md`](../../packages/state/src/webComponent/README.md) も断片のみだった。
  どちらも「正本は `packages/state/README.md`」と明示したうえで実装側の補足に書き直し、
  未修正の制約は本書へリンクする形にした

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
| P0 | 1.5 / 2.3 `createWcBindable` に `$commandTokens` 相当の宣言検証 | 小 | ✅ | `processDccDeclarations` を新設。存在検査も G2 と同時に実施済み |
| P1 | 1.4 DCC の shadow 構築を接続前に可能にする | 中 | ✅ | §7 G4 = (a)。実装は遅延構築（理由は §1.4） |
| P1 | 1.6 DCC の `commands` 生成 | 小〜中 | ✅ | §7 G2 = (a) `$commands` 明示宣言。§2.3 の存在検査も同時に実施 |
| P2 | 1.1 `this.state` の意味論統一 | 大 | ✅ | 内部チャネルと公開 API を分離（§7 G1 = (b)） |
| P2 | 2.1 変更イベントの発火範囲 | 中 | ⛔ | サブパス変更をどう畳むかの仕様判断 |
| P3 | 2.4 走査を共有 / 2.6 併記の fail-fast / 2.7 同期設定 / 3.5 型 / 3.6 README | 小 | ✅ | |
| P3 | 2.5 命名規約の統一 | 小 | 🟡 | 診断 warn のみ実施。規約の統一は §7 G3 と併せて |
| P3 | 3.1 / 3.2 / 3.4 | 小 | ✅ | §7 G3 = (b) 分離を規範として明文化 |
| — | 2.3 の存在検査 | 小 | ✅ | `$streams` 名は許可しアクセサも生成する（§2.3 末尾） |

## 6. 回帰テストの穴

- ✅ `webComponent.bindWebComponent.test.ts` は依存を全てモックするため、outerState / innerState の
  **意味論の組み合わせ**を検証していなかった。1.2 はこの穴に落ちていた →
  実モジュールで read / write の結果を固定する `webComponent.bindWebComponent.semantics.test.ts` を追加
- ✅ `__e2e__/dcc/index.html` は単発の DCC インスタンスのみで、**リスト内 DCC / 条件付き DCC が無かった**。
  1.3 / 1.4 はこの穴に落ちていた → [`e2e/tests/state-dcc-in-list.spec.ts`](../../e2e/tests/state-dcc-in-list.spec.ts) を追加。
  `for` 3 行 + `if` トグルで両方を踏む。**この e2e が無ければ 1.4 の修正が不完全なまま通っていた**
  （template clone の upgrade 漏れは happy-dom では再現しない、§1.4 末尾）
- ✅ bind-component は unit / e2e とも「親 → 子の初期配送」しか見ておらず、
  **公開プロパティ経由の read / write が 1 度も踏まれていなかった**。1.1 はこの穴に落ちていた →
  [`e2e/tests/state-bind-component-write.spec.ts`](../../e2e/tests/state-bind-component-write.spec.ts) を追加。
  実ブラウザで mapped な要素の `element.state.x` の read / write 両方向を固定する
- 🟡 10-defaulting-rollout-status.md §209 の `bindable-conformance` job は
  「dist export に現れない宣言ファクトリ（DCC `createWcBindable`）は state の unit test が固定」としているが、
  その unit test は `properties`/`inputs` の同一集合しか見ておらず、`commands` と重複名は対象外だった →
  重複名も `commands` も `dcc.processDccDeclarations.test.ts` が固定するようになった

## 7. Decision gate

**4 件とも 2026-08-05 に決着した。** 以下は決定内容と、選ばなかった案を残す理由。

### G1: `this.state` の意味論 — ✅ **(b) 内部チャネルを分離**（実装済み）

公開面は plain 意味論に一本化し、mapped でも read はライブ・write は innerState 経由で
親 state に届く。親 → 子の再読込通知は `applyChangeToWebComponent` が
`getStateElementByWebComponent` で state element を直接引いて `$postUpdate` を呼ぶ形に移した。
`element[stateProp]` を経由しなくなったので、公開 proxy に「値を捨てる」制約が要らなくなった。

- 却下 (a)「mapped でも実書き込みを通す」— proxy の意味論は直るが、親 → 子の通知が
  同じ経路を通り続けるため親 state への冗長な書き戻しが 1 往復増え、
  echo 抑止（same-value guard / propagation context）への依存が残る
- 却下 (c)「mapped は read-only」— 実装は最小だが、README の記述と `$stateReadyCallback` の
  用途に反し、利用者側の書き換えを強いる

副産物として mapped 専用 proxy（旧 `outerState.ts`）と `lastValueByAbsoluteStateAddress.ts` が
不要になり削除。`innerState.get` からも listIndex 解決と台帳書き込みが落ちて、読みごとの
`createAbsoluteStateAddress` 割り当てが 1 個減った。

### G2: DCC の commands — ✅ **(a) `$commands` 明示宣言を追加**（実装済み）

`$bindables` と対になる `$commands: ["inc"]` を導入し、宣言されたものだけを
`wcBindable.commands` に載せる。

- 却下 (b)「prototype 上の関数を自動宣言」— 内部ヘルパまで公開面に出る。
  「data-wcs は配線であって DSL ではない」という既存方針に照らしても明示宣言が整合的
- 却下 (c)「生成しない方針を規範化」— §1.6 の非対称（event-token は動くのに command-token だけ不可）が残る

§2.3 の存在検査（`$streams` × `$bindables`）も同時に実施した。

### G3: ②と③の関係 — ✅ **(b) 分離を規範として明文化**

統合はしない。README に「HTML だけなら DCC、JS クラスがあるなら bind-component」という
使い分けと、機構ごとに使える構文の対応表を書く。§3.1 の無言 return は `raiseError` に、
§3.4 の DCC タグ重複 `console.warn` は `raiseError` に揃える。**実装済み**。

対応表の軸は 定義方法 / state の在処 / `static wcBindable` の有無 / 親からの値バインド /
親からのメソッド起動 / spread の可否 / 自身の読み書き の 6 つ。SPEC には書いていない —
これは wcstack 内の機構選択であって wc-bindable プロトコルの規範ではないため。

### G4: 未接続要素への apply — ✅ **(a) DCC 側で解決**（実装済み）

未接続でもアクセサが動くようにする。影響が DCC に閉じ、§1.3 の再接続ガードも自然に包含する。
実装は constructor 前倒しではなく `_ensureShadow()` の遅延構築を採った（理由は §1.4）。

- 却下「`applyChange` を connect 待ちまで拡張」— 原因は汎用だが、全機構・全 I/O ノードの
  適用タイミングが変わる。§1.4 は DCC 固有の症状（他の Shell は素のフィールド代入なので
  未接続でも値が残る）なので、汎用側を動かす理由が弱い
- 却下「DCC 側に pending バッファ」— constructor を触らずに済むが、状態とフラッシュ順序の
  契約が増える

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
