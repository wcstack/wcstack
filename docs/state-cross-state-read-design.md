# 設計: クロス state 読み取り — getter から別の `<wcs-state>` を読む

- **状態**: 論点整理（2026-08-27）。**初稿・未決** → **2026-09-01 に [state-mount-design.md](./state-mount-design.md) で閉じた**。本書は名前付き State（`@stateName`）を前提に越境読みを増やす案だが、v2 は名前付き State そのものを廃止して 1 rootNode 1 ツリーにする（同書 §4-2: 越境読みはツリーが 1 本になることで機能として消滅し、§0 の D1〜D12 は不要になる）。以下は記録として残す。§0 の決定レコードは提案であって合意ではない。実装前。**最初の実需を失って優先度は下がった**（下の「実需の後退」）。
- **対象**: `@wcstack/state` の core 拡張。proxy / 依存グラフ / 名前解決 / 初期化順序に触る。updater と binding 台帳には触らない（§2 がその理由）。
- **一言で**: 「**getter から `@stateName` 越しに読む**」ための唯一の手段。テンプレートには既にある（`text: mode@theme`）が、JS 側には無い。この非対称が塞がれていないことが機能の穴になっている。
- **動機**: 横断的関心事（テーマ・認証情報・機能フラグ）は「1 つの state に置いて全 state から読む」形でしか表現できないのに、現行 API では読めない。
- **適用条件**: **可変で、かつ複数の state から読まれるもの**だけがこの機能を必要とする（§1-1）。不変な横断データは ES モジュールで配れば足りる。
- **実需の後退（2026-08-27）**: 当初は [i18n-design.md](./i18n-design.md) を最初の実需としていたが、i18n は**ライブ切替を非目標にした**ため、辞書が起動時に確定する**不変データ**になった。不変なら ES モジュールを正本にして `import` で配れるので、越境読みは要らない（[i18n-design.md](./i18n-design.md) §0-2 / §5）。**駆動力はテーマ・認証情報だけになり、§8（評価スタックのモジュール化）の性能リスクを今すぐ引き受ける理由は無い。**
- **双対**: [state-watch-hook-design.md](./state-watch-hook-design.md) の D8「`@stateName` 越境の watch は認めない」。**この設計はその決定を覆すものではない**。watch（変更の観測）は自 state のまま、読み取りだけを越境させる（§12）。

---

## 0. 決定レコード

| ゲート | 論点 | 決定（提案） |
|---|---|---|
| **D1** | 何を作るのか | **読み取り専用のクロス state 参照**。書き込み・`$watch`・双方向は含めない。存在理由は「横断的関心事を 1 箇所に置いたまま、依存追跡を壊さずに読む」こと（§1） |
| **D2** | API 形 | **宣言 `$refs: ["auth"]` ＋ アクセス `this.$refs.auth.roles`**。パス文字列に `@name` は入れない（§3） |
| **D3** | 宣言の必須性 | **必須**。未宣言の state を読んだら throw。暗黙の越境は作らない（§3-2） |
| **D4** | スコープ解決 | **自 rootNode → ShadowRoot の host の rootNode へ遡上**。document を特別扱いする ambient state は作らない（§4） |
| **D5** | 依存エッジの置き場 | **読まれた側（参照先 state）に外向きエッジとして置く**。書き込み起点で即座に引けるため（§5） |
| **D6** | walk の越境 | **walk 終端で越境エッジを集め、参照先 state で walk を再開**（幅優先キュー）。`MAX_DEPENDENCY_DEPTH` は越境込みで共有（§6） |
| **D7** | ワイルドカード | **越境読みは `*` を含まないパスに限る**。行スコープ（listIndex）は state 境界を越えない（§7） |
| **D8** | 循環 | 越境エッジも `wcs/getter-cycle` の検査対象。評価時の循環検出のため**評価フレームスタックを handler ごとからモジュールレベルへ移す**（§8） |
| **D9** | 初期化順序 | `$refs` を宣言した state は、**参照先の初期化完了を待ってから**自身を初期化する。循環参照は throw（§9） |
| **D10** | 書き込み禁止 | 既存の `readonly` proxy を使い、`$` 付き API も塞ぐ（mapped bind-component の blank-out に前例あり）（§10） |
| **D11** | 切断・不在 | **throw**。`undefined` を黙って返さない。権限や設定は `undefined` が「無効」側に倒れて静かに事故る（§10-2） |
| **D12** | updater / 台帳 / キャッシュ | **変更しない**。既に絶対アドレス単位で越境対応済み（§2） |

---

## 1. 現状の穴

テンプレートは越境できるが getter はできない。

```html
<wcs-state name="auth">{ userId: null, roles: [] }</wcs-state>

<wcs-state>
{
  items: [...],
  // したいこと: 行ごとの編集可否を、ログイン中のロールから決める
  get "items.*.canEdit"() {
    return /* auth の roles をどう読む？ */;
  }
}
</wcs-state>
```

`this` は自 state に閉じている。`document.querySelector('wcs-state[name=auth]')` から生の値を読む逃げ道はあるが、**依存が張られない＝ログアウトしても行の編集可否が二度と更新されない**ので解ではない。「読めない」のではなく「読むと壊れる」のが現状である。

一方、同じことをテンプレートに書けば動く。

```html
<span data-wcs="text: userId@auth"></span>
```

この非対称は設計の意図ではなく、単に JS 側の入口が無いだけである。

### 1-1. この機能が要る条件・要らない条件

越境読みが要るのは、横断データが **(a) 可変で、(b) 複数の state から読まれ、(c) その変化が読み手側の派生値に届く必要がある** ときだけである。3 つ揃わないなら、より安い解がある。

| 横断データ | 可変か | 解 |
|---|---|---|
| テーマ（配色・密度） | ユーザーが切り替える | **この設計が要る** |
| 認証情報（ロール・ログイン状態） | ログイン / ログアウトで変わる | **この設計が要る** |
| 機能フラグ | 実行中に変わるなら要る。起動時固定なら不要 | 場合による |
| メッセージ辞書（i18n） | **起動時に確定**（ライブ切替は非目標） | **ES モジュールを正本にして `import`。越境読みは不要** |
| 定数・エンドポイント設定 | 不変 | 同上 |

**不変な横断データはモジュールで配れる。** モジュールスコープは DOM スコープと無関係なので shadow DOM の内側からでも同じ実体が読め（§4 の遡上が要らない）、不変だから依存も張らなくてよい（§5 / §6 が要らない）。i18n はこの道に移った（[i18n-design.md](./i18n-design.md) §0-2）。

**この設計の価値は「可変であること」に全部乗っている。** 逆に言えば、可変な横断データの実需が薄いあいだは、§8 の性能リスクを引き受ける理由も薄い（§14-6）。

---

## 2. 棚卸し — 既に越境できているもの / できていないもの

**この設計で最も重要な事実**。越境は 7 割方すでに実装されている。

| 機構 | キー | 越境 | 実装 |
|---|---|---|---|
| binding 台帳 | `AbsoluteStateAddress`（state 要素を内包） | ✅ | [getBindingSetByAbsoluteStateAddress.ts](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts) |
| updater の queue / drain | 同上・**モジュール単一インスタンス** | ✅ | [updater.ts:170](../packages/state/src/updater/updater.ts#L170) |
| getter キャッシュ | `AbsoluteStateAddress` の WeakMap | ✅ | [cacheEntryByAbsoluteStateAddress.ts](../packages/state/src/cache/cacheEntryByAbsoluteStateAddress.ts) |
| DOM 適用 | `binding.stateName` で state を引き直す | ✅ | [applyChange.ts:188](../packages/state/src/apply/applyChange.ts#L188) |
| 依存グラフ | state 要素ごとの `Map<string, string[]>` | ❌ | [State.ts:718](../packages/state/src/components/State.ts#L718) |
| 依存 walk | `Context` が単一 state 前提 | ❌ | [walkDependency.ts:95](../packages/state/src/dependency/walkDependency.ts#L95) |
| 依存の記録 | `handler.stateElement` と `handler.lastAddressStack` | ❌ | [checkDependency.ts:16](../packages/state/src/proxy/methods/checkDependency.ts#L16) |
| 評価フレーム | `StateHandler` インスタンスごとの `_addressStack` | ❌ | [StateHandler.ts:18](../packages/state/src/proxy/StateHandler.ts#L18) |
| 名前解決 | rootNode（Document / ShadowRoot）スコープ | ❌ | [stateElementByName.ts:20](../packages/state/src/stateElementByName.ts#L20) |

**帰結**: 値が変わってから DOM に届くまでの後半（enqueue → drain → binding 探索 → 適用）は、書き込み元と binding の所属 state が違っても既に正しく動く。足りないのは前半、すなわち「**A の getter が B の値に依存している**」という事実をグラフに記録し、B への書き込みからそれを辿ることだけである。

これは工数見積りを大きく変える。「別 state を読む」機能は、更新パイプラインの作り直しではなく、**依存グラフを 1 段だけ越境可能にする**変更である。

---

## 3. API 形

### 3-1. 宣言とアクセス

```js
export default defineState({
  $refs: ["auth"],                       // 宣言（必須）

  items: [],
  get "items.*.canEdit"() {
    const { userId, roles } = this.$refs.auth;   // 読み取り
    return roles.includes("editor") || this["items.*.ownerId"] === userId;
  },
});
```

`this.$refs.<name>` は参照先の **readonly state proxy** を返す。get trap をそのまま通るので、依存の記録は既存の `checkDependency` の延長で済む（§5）。

### 3-2. なぜ「宣言必須」か

宣言を必須にすると、単なる行儀の問題を超えて 4 つが同時に解ける。

1. **初期化順序** — 誰を待てばよいかが静的に分かる（§9）
2. **循環検出** — state 間の参照グラフを初期化時に検査できる（§9）
3. **静的解析** — vscode-wcs / `wcs-validate` が「未宣言 state の参照」「参照先に存在しないパス」を報告できる。[static-wiring-dx-design.md](./static-wiring-dx-design.md) の延長
4. **越境の可視化** — この state がどの横断的関心事に結合しているかが宣言 1 行に集約される。暗黙の越境が無いので、依存の棚卸しが grep で終わる

### 3-3. なぜパス文字列に `@name` を入れないか

`this["mode@theme"]` の形は一見テンプレート構文と対称で魅力的だが、採らない。

- **パス文字列は正規化キーである**。`PathInfo` はパスをそのままキャッシュ・依存グラフ・アドレスの同一性判定に使う。`@` の解釈をここに持ち込むと、パス文字列の文法が「バインド式の文法」と二重管理になる
- getter の**宣言側**（`get "items.*.canEdit"()`）に `@` が現れないのに参照側にだけ現れるのは、読み手にとって非対称で分かりにくい
- proxy 経由なら分割代入（`const { roles } = this.$refs.auth`）が自然に書ける。文字列パスでは 1 パスずつ読むことになる

関数形（`this.$ref("auth")`）も検討したが、プロパティバッグのほうが型付け（`defineState` の `this` 型）と静的解析の双方で扱いやすいため採らない。

### 3-4. 予約キーとしての `$refs`

`$refs` は state 宣言の予約キーになるため、**vscode-wcs の validator 側に追従先が 3 箇所ある**（`$` 宣言キーを足したときの既知の追従作業）。実装時にチェックリスト化すること。また mapped な `bind-component` の子は `$` 付きプロパティが blank-out されるため、そこでは `$refs` を宣言できない（`$streams` / `$watch` と同じ制約）。

---

## 4. スコープ解決 — 遡上であって ambient ではない

state 名は rootNode（Document または ShadowRoot）ごとに登録される。フォールバックは一切無く、見つからなければ throw する。

**これは横断的関心事にとって致命的**である。shadow DOM を持つコンポーネントの中から document 直下の `<wcs-state name="theme">` は見えない。しかしテーマや認証状態を読まないコンポーネントのほうが少ない。

### 決定: レキシカルな遡上

`$refs` の名前解決は次の順で行う。

1. 自 state の rootNode で `getStateElementByName` を引く
2. 見つからず、rootNode が ShadowRoot なら `rootNode.host.getRootNode()` へ移って 1 に戻る
3. Document に到達しても見つからなければ **throw**

**ambient state（document を暗黙の最終フォールバックにする）とは違う**。遡上は DOM の包含関係、すなわちレキシカルスコープに沿う。外側にあるものが内側から見えるのは、CSS のカスケードやイベントのバブリングと同じ既知の意味論である。

[scoped-custom-element-registries.md](./scoped-custom-element-registries.md) が置いた規範「**スコープ化は隔離を改善してよいが意味論を担ってはならない**」との整合もここで取れる。遡上は隔離を弱めるが、**弱まる範囲は `$refs` の宣言でのみ決まる**。宣言していない名前は絶対に越境しないので、隔離は「宣言で穴を開けたぶんだけ」失われる。暗黙の越境が無いことが規範を守る条件である。

### 未決の論点

- 遡上の途中に同名 state が複数ある場合、**最も近いものが勝つ**（レキシカルスコープの通常の意味論）。ただしこれは shadow root ごとにテーマを差し替える機能にもなる。意図した機能とするか、曖昧さとして禁止するか未決
- `bind-component` の mapped 子スコープ、および light DOM コンポーネントスコープ（[lightDomComponentScope.ts](../packages/state/src/bindings/lightDomComponentScope.ts)）での遡上の定義が未検証

---

## 5. 依存エッジは「読まれた側」に置く

現行の動的依存は、getter を評価している state 要素自身に記録される。

```
// checkDependency: 読んでいる proxy の handler の stateElement に記録
stateElement.addDynamicDependency(address.pathInfo.path, lastInfo.path);
```

越境時、読みは**参照先（B）の handler** を通るので `handler.stateElement` は B になる。一方「今どの getter を評価中か」（`lastAddressStack`）は **A の handler** にある。したがって現行のコードは越境時に、B の中で「起点不明の読み」として何も記録しないか、誤って B 内のエッジとして記録する。

### 決定: 外向きエッジを B に持たせる

B に `addOutboundDependency(sourcePath, targetState, targetPath)` を追加し、`(B, "roles") → (A, "items.*.canEdit")` を記録する。

**なぜ読まれた側か**。書き込みの起点は必ず B である（`roles` を書き換えるのは auth state）。walk は B の書き込みアドレスから始まるので、越境エッジが B にあれば追加の索引なしにその場で引ける。A 側に持たせると、B の書き込みから A を発見するために全 state を走査する逆引きが必要になる。

副作用として **A が切断されたときのエッジ掃除が B の責務**になる。A の state 要素を WeakRef で保持し、切断済み参照は walk 時に落とす（binding 台帳が `replaceNode.isConnected` で行っているのと同じ扱い）。

---

## 6. walk の越境

`walkDependency` の `Context` は `stateName` / `stateElement` / `staticMap` / `dynamicMap` / `stateProxy` を readonly で持つ単一 state 構造である。ここを「複数 state を跨ぐ 1 回の walk」に変えるのではなく、**walk を state ごとに分割して連鎖させる**。

1. B の walk を従来どおり実行する
2. 訪問した各パスについて B の外向きエッジを引き、`(A, path)` を**越境キュー**へ積む
3. B の walk 完了後、キューから `(A, path)` を取り出し、**A の Context を新たに作って walk を再開**する
4. キューが空になるまで幅優先で繰り返す

- **訪問済み集合**は `IStateAddress` ではなく `IAbsoluteStateAddress`（state 要素を内包する）で持つ。越境しても同一性が保たれ、A→B→A の往復も自然に停止する
- `MAX_DEPENDENCY_DEPTH`（1000）は**越境込みの総ホップ**で共有する。state ごとにリセットすると越境の連鎖で無限に伸びる
- enqueue とキャッシュ dirty 化は現行どおり絶対アドレス単位。§2 のとおり updater 側の変更は無い

---

## 7. ワイルドカードは越境させない

**決定: 越境読みのパスは `*` を含んではならない。**

行スコープ（`listIndex`）は state 要素に紐付いた概念である。A の `items.*` の 3 行目という文脈を B に持ち込んでも、B 側にはそれと対応するリストが無い。無理に通すと「どの行の翻訳か」が定義不能になる。

制限に見えるが、実需はこれで満たされる。**行ごとの計算は A 側の行 getter が行い、B からはスカラ（辞書オブジェクト）だけを読む**。

```js
get "items.*.canEdit"() {
  const { userId, roles } = this.$refs.auth;   // 越境読みは * 無し
  return roles.includes("editor") || this["items.*.ownerId"] === userId;  // 行の解決は A 側
}
```

これは「計算は state 側に押し出す」という既存の規範と同じ方向を向いている。越境は**値の供給**であって、**行の展開**ではない。

なお B が theme のとき `tokens[mode]` のような添字アクセスは、B 側では単に `tokens` 全体への依存として記録される。トークン全体が 1 つの依存単位になるので、テーマ切替時にトークンを読む全 getter が dirty になる。テーマでは**それが正しい**（配色が変われば派生値も全部変わる）。

---

## 8. 循環と評価スタック

`_addressStack` は `StateHandler` インスタンスごとに持たれており、getter の評価スタック（`CYCLE_REPORT_DEPTH` を使った循環報告）もここに依存している。越境すると評価が別 handler に移るため、スタックが分断されて循環を検出できない。

**決定: 評価フレームをモジュールレベルの単一スタックへ移す。** フレームは `(stateElement, address)` の組にする。既存の per-handler スタックはこの単一スタックのビューになる。

- `wcs/getter-cycle` の検査は越境エッジを含めて行う
- 循環報告のパス表示は `name:path` 形式にして、どの state を跨いだかが読めるようにする

**リスクの明示**: `_addressStack` は `MAX_LOOP_DEPTH` 固定長配列で確保されるホットパスである。モジュールレベル化は読み取りのたびに通る場所を触る変更なので、既存の計測手順（[e2e/bench/jsfb-verify.mjs](../e2e/bench/jsfb-verify.mjs)）で回帰を確認してから着地させること。**この節が本設計で最も性能リスクが高い。**

---

## 9. 初期化順序

A の getter が評価される時点で B が未初期化だと、辞書が空のまま初回描画されてしまう。

**決定**: `$refs` を宣言した state は、宣言した全参照先の初期化完了を待ってから自身を初期化する。既存資産（`waitForStateInitialize` / `getBindingsReady`）に載せる。

- 参照グラフが循環していたら（A が B を、B が A を宣言）**初期化時に throw**。実行時に発見して曖昧に片方を先行させるより、宣言時に落とすほうがよい
- 参照先が最後まで現れない場合も throw する。`<wcs-state name="theme">` の置き忘れが「なぜか既定の配色のまま」という診断困難な症状になるのを防ぐ
- **未決**: 待ち合わせの粒度。「B の値が読める」ことと「B のバインドが張れている」ことは別の完了条件であり、A が必要なのは前者だけである。後者まで待つと初期化が直列化して初回描画が遅くなる

---

## 10. 書き込み禁止と不在時の扱い

### 10-1. readonly

`this.$refs.auth` は `createState("readonly", ...)` 系の既存 readonly proxy を返す。加えて `$setAll` / `$resolve`（書き込み形）/ `$postUpdate` など `$` 付き API も塞ぐ。mapped bind-component の子で `$` 付きを blank-out している前例があるので、同じ機構を再利用できる。

**双方向を認めない理由**: A から B に書けると、B の変更が A に伝わり A の getter が再評価されて再び B に書く、という循環が実行時にしか見つからない形で作れてしまう。読み取り専用なら、state 間の関係は非循環な有向グラフとして初期化時に検査できる（§9）。

### 10-2. 不在・切断は throw

参照先が見つからない、あるいは切断済みの場合は `raiseError` する。`undefined` を返す設計は採らない。権限判定なら `undefined` は「不可」に、テーマなら空文字として描画に倒れ、**ページが無言で壊れる**。autoloader の失敗ロードで踏んだのと同じ失敗様式（失敗が沈黙し、症状が原因から遠い場所に出る）である。

---

## 11. SSR / hydrate

越境エッジは getter の評価時に張られるので、初期同期が走れば自然に復元される。ただし **SSR 時に参照先 state の初期値が確定していること**は別途要る（サーバー側でテーマ・認証を解決してから描画する）。クライアントで違う値に落ち着くと、ハイドレーション直後に派生値が総入れ替えになる。

hydrate 経路（`hydrateBindings`）は `getStateElementByName` を rootNode 固定で引いているため、§4 の遡上を入れる際は hydrate 側にも同じ解決を通す必要がある。**取りこぼすと SSR ページだけが「参照先 state が見つからない」で落ちる。**

---

## 12. 非目標

- **越境 `$watch`** — [state-watch-hook-design.md](./state-watch-hook-design.md) D8 の決定を維持する。観測は自 state のみ。越境で観測したいなら参照先が自分で watch する
- **越境の書き込み**（§10-1）
- **越境のワイルドカード**（§7）
- **ambient / グローバル state**（§4）。名前解決は必ず DOM の包含関係に沿う
- **state 間の依存注入コンテナ**。`$refs` は名前解決であって、ライフサイクル管理でも差し替え機構でもない

---

## 13. 段階

| Phase | 内容 | 検証 |
|---|---|---|
| **0** | 本書の決定確定。特に §4（遡上）と §8（評価スタック）を単独でレビュー | — |
| **1** | 名前解決の遡上 ＋ `$refs` 宣言 ＋ readonly proxy（依存追跡なし・読めるだけ） | 単体。この時点では「更新されない」のが正常 |
| **2** | 外向きエッジ（§5）と walk の越境（§6）。ここで初めてライブ更新が成立する | テーマ切替が、参照している全 state のバインドに届くこと |
| **3** | 評価スタックのモジュール化と循環検出（§8） | ベンチ回帰（`jsfb-verify.mjs`）必須 |
| **4** | 初期化順序（§9）、hydrate 経路（§11） | SSR e2e |
| **5** | 静的解析（未宣言 state / 参照先に存在しないパス）を vscode-wcs と `wcs-validate` へ | 契約テストは lint 側と vscode-wcs 側の**両方**に置く（片側だけだと次のビルドまで壊れが見えない） |

---

## 14. 未解決の論点

1. **遡上の同名衝突**（§4）を機能とするか禁止とするか
2. **初期化待ちの粒度**（§9）— 値の準備完了とバインド確立を分離できるか
3. **評価スタックのモジュール化の性能影響**（§8）— 実測前に着地させないこと
4. `bind-component` / light DOM コンポーネントスコープでの遡上の定義（§4）
5. 越境エッジの掃除タイミング — WeakRef ＋ walk 時の遅延削除で十分か、切断時に能動的に削るか
6. **実需（§1-1）** — 最初の実需だった i18n が別解に移った以上、**可変な横断データ（テーマ / 認証 / 実行時に変わる機能フラグ）の具体要求が出るまで Phase 1 以降に着手しない**。着手判断は「モジュール `import` で代替できないこと」を 1 件でも示せるかどうかで行う
