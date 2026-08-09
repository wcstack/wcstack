# state のコンポーネント機構 3 系統の整合性監査

- **作成日**: 2026-08-05
- **状態**: 監査記録＋**修正完了**（2026-08-05〜06、および §1.7 を 2026-08-10）。
  §7 の decision gate G1-G4 は 4 件とも決着・実装済み。
  実装済み = §1.1〜§1.7 / §2.1〜§2.4 / §2.6 / §2.7 / §3.1 / §3.2 / §3.4 / §3.5 / §3.6、
  部分 = §2.5、訂正 = §3.3（本書の誤り）。
  **監査で挙げた項目は全て解消**（§2.5 は診断性のみ・§3.3 は本書の誤りとして撤回）。
  ただし §1.7 は、G1 の修正自体が片肺で着地していたことを後日発見した記録である。
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
| §1.7 | §1.1 で分離した内部チャネルが一度も選ばれていない（親→子の配送が丸ごと不成立） | ✅ 修正済み（2026-08-10・後日発見） |
| §2.1 | 変更イベントが完全一致パスでしか出ない | ✅ 修正済み（サブパス ＋ `$postUpdate` ＋ property getter） |
| §2.2 | DCC アクセサの同期／非同期が非対称 | ✅ 修正済み（setter を同期化。`callFn` は意図的に Promise 維持） |
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
| [`webComponent/completeWebComponent.ts`](../../packages/state/src/webComponent/completeWebComponent.ts) / [`apply/applyChange.ts`](../../packages/state/src/apply/applyChange.ts) | §1.7（チャネル選択ゲートのキーを stateProp 名に） |
| [`webComponent/MappingRule.ts`](../../packages/state/src/webComponent/MappingRule.ts) | §1.7（派生バインディングを BindingSession 経由で購読者登録） |
| [`dcc/defineDCC.ts`](../../packages/state/src/dcc/defineDCC.ts) | §1.3 / §1.4 / §2.4 / §2.5 / §2.7 / §3.5 |
| [`dcc/processDccDeclarations.ts`](../../packages/state/src/dcc/processDccDeclarations.ts)（新規） | §1.5 / §2.3 / §1.6 |
| [`dcc/wcBindable.ts`](../../packages/state/src/dcc/wcBindable.ts) | §1.6（`commands` 生成） |
| [`getAllPropertyDescriptors.ts`](../../packages/state/src/getAllPropertyDescriptors.ts)（新規） | §2.4（State と DCC で走査を共有） |
| [`components/State.ts`](../../packages/state/src/components/State.ts) | §2.4 / §2.6 / §3.1 |
| [`components/types.ts`](../../packages/state/src/components/types.ts) | §3.5 / §2.2（`initialized`） |
| [`dcc/dispatchBindableEvent.ts`](../../packages/state/src/dcc/dispatchBindableEvent.ts)（新規） | §2.1 |
| [`dcc/dccPropertyFactories.ts`](../../packages/state/src/dcc/dccPropertyFactories.ts) | §2.2 |
| [`proxy/methods/setByAddress.ts`](../../packages/state/src/proxy/methods/setByAddress.ts) / [`proxy/apis/postUpdate.ts`](../../packages/state/src/proxy/apis/postUpdate.ts) | §2.1 |
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

### 1.7 §1.1 で分離した内部チャネルが一度も選ばれていなかった ✅ 修正済み（2026-08-10・後日発見）

G1 は公開 proxy の一本化（§1.1）と内部通知チャネルの分離（`applyChangeToWebComponent`）を対にした修正だった。
公開面は意図どおり直ったが、**分離した内部チャネルを選ぶゲートが壊れており、親 state 起点の変更は
子コンポーネントに一度も届いていなかった**。断線は 3 箇所に分かれていた。

1. **完了台帳のキー取り違え**（本丸）。`markWebComponentAsComplete` は
   `(component, 内側の IStateElement)` で記録し、`applyChange` は
   `(component, context.stateElement ＝ 親スコープの IStateElement)` で照会していた。
   標準の Shadow 構成でこの 2 つが一致することはないので `isWebComponentComplete` は恒久 `false`。
   **どちらも同じ `IStateElement` 型なので TypeScript が取り違えを検出できない**。
2. **フォールバックの自己相殺**。ゲートが偽なら `applyChangeToProperty` に落ちるが、そこでの
   旧値読みは §1.1 で素通しにした公開 proxy を通るライブ読みなので、既に親の新値を返す。
   `oldValue !== newValue` が偽になり書き込みごとスキップされ、子側の再描画も enqueue されない。
3. **サブパスの派生バインディングが購読者になっていない**。`MappingRule` は子が読んだサブパス
   （inner `user.name` ＝ outer `person.name`）の規則を遅延導出し、対応するバインディングを
   `addBindingByNode` で node 台帳に積んでいたが、**その台帳を読む消費者は
   `bindWebComponent` のプライマリ抽出フィルタだけ**で、しかも当時の `propSegments` は
   stateProp プレフィックスを欠いていたためそのフィルタにも掛からない。
   絶対アドレス台帳には一切載らないので updater からは不可視だった。

**なぜ気づかれなかったか**（§6 の「テストの穴」の再発）。既存の回帰は
「初期配送」と「公開プロパティ経由の write」の 2 方向しか固定していない。前者は子のバインディングが
innerState 経由で親をライブ読みする経路、後者は子自身の `setByAddress` が子アドレスを enqueue する経路で、
**どちらも子側のコードが動くので内部チャネルを通らない**。単体テストは `isWebComponentComplete` を
丸ごとモックしており、実引数が合っているかは検証対象外だった。

**修正**:

- 完了台帳のキーを `IStateElement` → **state プロパティ名**に変更
  （[`completeWebComponent.ts`](../../packages/state/src/webComponent/completeWebComponent.ts)）。
  完了はプロパティ単位の事実（`defineProperty(component, stateProp, …)` が済んだか）なので粒度が正しく、
  かつ型が違う（`string` vs `IStateElement`）ので今回の取り違えが**書けなくなる**。
  ゲートが正しく真になると 2 の経路自体を通らなくなる
- 派生バインディングを `addBindingByNode` ではなく、**プライマリを所有する `BindingSession`** に
  `initialize({ registerAddress: true })` で登録（[`MappingRule.ts`](../../packages/state/src/webComponent/MappingRule.ts)）。
  絶対アドレス台帳への登録・teardown・ノード削除時の破棄が既存のライフサイクルにそのまま乗るため、
  台帳エントリが component を強参照したまま残らない。`propSegments` は stateProp を保つ
  （適用側が先頭セグメントで束ね先の state 要素を引くため）。node 台帳へは積まない
  （プレフィックスを保った結果、再バインド時にプライマリ抽出フィルタへ混入してしまうため）

**ゲートは propSegments の長さ 1 を除外する**。台帳のキーが stateProp 名になった以上、
`data-wcs="state: user"`（stateProp をそのままプロパティ名に書いた形＝ propSegments が 1 セグメント）も
ゲートを通ってしまう。`applyChangeToWebComponent` は「先頭セグメント＝束ね先の state 要素、
残り＝子側のパス」を前提にしており残余が空だと raiseError するため、`updater` の drain
（例外を捕まえない）を突き抜けて**同じバッチに乗った無関係な更新まで巻き添えで落ちる**。
この形は修正前から無言の no-op（公開プロパティは getter のみなので代入が strict TypeError になり
`applyChangeToProperty` の try/catch が握り潰す）なので、そのまま no-op に留める。
実測で「1 タグの誤設定が同一バッチの別バインディングを更新不能にする」ことを確認済み。
なお `data-wcs="<stateProp>: <path>"` を bind 時に fail-fast させる案（§2.6 の併記禁止と同じ扱い）は
breaking なので本修正には含めていない。

**登録できない 2 ケースは登録だけ諦める**（翻訳が本務なので read は落とさない ＝ この機構が
入る前と同じ挙動に留める。`config.debug` 時のみ `console.warn`）。

- プライマリのセッションが引けない（内部的な想定外）
- 導出した outer パスがワイルドカードを含むのに listIndex が定まらない。
  **子が配列マッピングの上で `for` を回している形**がこれにあたる（規則 `state.items: rows` に対し
  子の行が `items.*.name` を読む → outer は `rows.*.name`）。派生バインディングの `node` は
  親スコープにあるコンポーネント要素で、ループは子の Shadow 内にあるため、
  コンポーネントの DOM 位置からは行を特定できない。
  **この形の bind-component は本修正の前から成立していない**（子側の `for` の初期化自体が
  完了せず、行が 1 つも描画されない）。ガードが無いと `getAbsoluteStateAddressByBinding` が
  raiseError し、元は無言だった不成立が例外に化けるため、明示的に登録をスキップする。
  配列を子コンポーネントへ束ねて子側で `for` を回す構成は、現状サポート範囲外。

回帰は happy-dom
（[`integration.bindComponentDelivery.test.ts`](../../packages/state/__tests__/integration.bindComponentDelivery.test.ts)）と
実ブラウザ（[`e2e/tests/state-bind-component-parent-write.spec.ts`](../../e2e/tests/state-bind-component-parent-write.spec.ts)）の
両方で固定した。判別子は **Shadow 内のビュー**であること — 親スコープのビューは親自身のバインディングなので
断線していても更新され、それを見ていると壊れていることに気づけない。
葉のマッピング（`state.name: user.name`）とオブジェクトのマッピング下のサブパス読み
（`state.user: user` ＋ 子が `user.name`）の 2 形を覆う。後者だけが 3 の断線を踏む。
いずれも修正前のコードに対して失敗することを確認済み。

---

## 2. 契約の乖離（実害はケース依存）

### 2.1 DCC の変更イベントは完全一致パスでしか出ない ✅ 修正済み

`setByAddress` は `bindableEventMap[address.pathInfo.path]` の完全一致で判定していた。
`$bindables: ["user"]` で `user.name` を書いても発火しない。配列の in-place 変異・`$postUpdate`・
getter 由来の派生値も同様。wcBindable の `properties[].event` は「変更で発火する」契約なので乖離していた。

**修正**: 判定を [`dispatchBindableEvent.ts`](../../packages/state/src/dcc/dispatchBindableEvent.ts) に
切り出し、3 経路をカバーした。

1. **完全一致** — 従来どおり。`detail` は書き込んだ値
2. **サブパス** — `user.name` / `items.*.done` が `user` / `items` メンバを撃つ。
   `$bindables` のエントリは常にフラットなトップレベル名（dotted 名は §2.3 の存在検査で落ちる）なので、
   先頭セグメントを見れば足りる。この場合 `detail` は付けない — メンバ全体ではない値を載せると誤解を招く
3. **`$postUpdate`** — in-place 変異を通知する正規の idiom。`postUpdate` からも撃つ

併せて `createWcBindable` が各 property に
`getter: (event) => event.target[name]` を宣言するようにした。
これで**イベントは通知、値は要素から読む**という形に揃い、`detail` に依存しなくなる。
サブパス書き込みには載せられる単一の値が無く、state 側の setter が正規化した場合も
`detail` は正規化前になるため、`detail` は元々信頼できない経路だった。

**残る非カバー**: `$postUpdate` を伴わない in-place 変異（`items.push(...)`）。
set トラップを通らないのでここでも捕まらないが、これはリアクティブコア全体の規範
（in-place 変異は `$postUpdate` で通知する）と同じであり、DCC 固有の乖離ではない。

**`$listKeys` との相互作用**: [`$listKeys`](../state-list-key-design.md) を宣言したリストパスへの
配列代入は、キー突合のあと変化フィールドを per-path 書き込みへ分解する（同 §2）。
その 1 本 1 本が上記 2（サブパス）に該当するため、**1 回のリスト代入で `1 + N` 回発火する**
（N = 変化フィールドを持つ行数）。1 回目はリスト本体への完全一致なので `detail` に新しい配列が載り、
以降のサブパス発火には `detail` が付かない。実測（3 行中 2 行の `name` を変更）は
宣言ありで 3 回・宣言なしで 1 回。

observer は「イベントは通知、値は要素から読む」形なので**重複発火しても結果は変わらない**が、
イベント回数が変化行数に比例する点は `$listKeys` と `$bindables` を同じリストに掛けるときの
既知の性質として扱う。回数を 1 回に畳むには書き込み単位ではなく更新サイクル単位で
coalesce する必要があり、それは `dispatchBindableEvent` の責務を越えるため見送っている。

### 2.2 DCC アクセサの同期／非同期が非対称 ✅ 修正済み

- `getterFn` は同期。state 未初期化なら `console.warn` して `undefined` を返す
- `setterFn` / `callFn` は `initializePromise.then()` 経由で**非同期**

（[`dccPropertyFactories.ts`](../../packages/state/src/dcc/dccPropertyFactories.ts)）

`el.count = 5; el.count` は旧値を返す。また
[`readProducerSnapshot`](../../packages/state/src/bindings/BindingSession.ts) は
`target[name]` を同期読みするため、`#init=element` / `#init=auto` では `undefined` が
`commitProducerValue` 経由で親 state に commit されうる。
既定は `state` authority（properties と inputs の両方に載るため）なので通常経路では当たらない。

**修正**: `IStateElement` に `initialized`（`initializePromise` の同期版）を足し、
`setterFn` は**初期化済みなら同期で書く**ようにした。未初期化のときだけ従来どおり
`initializePromise` に積む — §1.4 の「未接続の行に書かれた値を捨てない」経路はそのまま残る。

`getterFn` も未初期化を「まだ値が無い」正常系として扱い、warn せず `undefined` を返す。
fragment 上の行に対する初期スナップショット読み（`readProducerSnapshot`）は必ずここを通るため、
warn を出すと通常フローが騒がしくなる（§1.4 の e2e で実際に大量に出ていた）。
真のエラーだけが warn として残る。

`callFn` は**意図的に常に Promise** のままにした。同期に倒すと戻り値の型が
初期化状態で変わってしまい、§1.6 で `commands` に一律 `async: true` を宣言したこととも矛盾する。

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
| P2 | 2.1 変更イベントの発火範囲 | 中 | ✅ | サブパスは先頭セグメントのメンバに畳む。`$postUpdate` も撃つ |
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
