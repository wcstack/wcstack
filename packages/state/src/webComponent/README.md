# webComponent/ — マウント（`bind-component`）

**利用者向けの正本は [`packages/state/README.md`](../../README.md) の "Web Component Binding" /
"Whole-object Mount" 節、設計の正本は
[docs/state-mount-design.md](../../../../docs/state-mount-design.md)（D1〜D22）と
[docs/state-mount-impl-plan.md](../../../../docs/state-mount-impl-plan.md)（§3-0 が実装機構）。**
ここは実装側の補足のみを置く。

`<wcs-state bind-component="<prop>">` がコンポーネント直下にあると、
`State._initializeBindWebComponent` がホスト要素の `<prop>` を取り込み、次の 2 形に分岐する。

- **マウント**（ホストに `state[.sub]: path` の配線が 1 本以上）— コンポーネントの
  テンプレートは**親ツリーの一部**としてバインドされる（v2 の単一ツリー・下記）。
- **plain**（配線なしの state 注入）— コンポーネント自身の state をリアクティブ化するだけ。
  `bindWebComponent()` が melt した作者のオブジェクトを自分の state 要素の実体にし、
  公開プロパティを outerState proxy に差し替える。

## 不変条件（v2）

> マウントされたコンポーネントのバインディングは、その位置にテンプレートを展開して
> パスに接頭辞を付けたものと区別できない。

実装は解決サイトの書き換えではなく**バインディングの変換**（impl-plan §3-0）:

1. **パース時の接頭辞合成** — スコープの collect は `translateParsedForMount` で各
   binding の `statePathName` / `statePathInfo` / `stateName` を親ツリーの絶対形へ
   書き換える（パース結果キャッシュは無接頭辞のまま・複製のみ）。以後この binding は
   台帳・依存グラフ・キャッシュ・LIS・プールのどれから見ても「親スコープにインラインで
   書かれたもの」と同一。
2. **台帳エイリアス**（Shadow DOM 形のみ）— 子 rootNode → 親 state 要素
   （`setStateElementAlias`）。`getRootNode()` で解決する全サイトが無改造で親に到達する。
   Light DOM 形は rootNode をホストと共有するのでエイリアス不要（`@name` 参照も
   変換が stateName を親に揃えるので自然に無効化される）。
3. **ループ文脈** — スコープ直下のバインディングには**直接エントリ**でホスト要素の文脈を
   渡す（`buildMountScopeBindings`）。text binding は登録前に comment が replaceNode へ
   差し替えられて切断されるため、DOM walk では文脈に届かない（happy-dom は切断後も
   parentNode を残す非準拠で偶然通るが、実ブラウザでは落ちる）。スコープ内の `for` が
   作る行は境界ホップ（`loopContextByNode` — マウントされた ShadowRoot → host）で
   ホスト行の listIndex を親に持つ。
4. **オーバーレイ dispatch**（D20） — 私有キー・getter・メソッドは予約セグメント
   `#m<id>`（パス文法で書けない）を挟んだ絶対アドレスに載る。親 handler の
   `getByAddress` は `hasMounts && lastSegment が '#'` のときだけ登録簿を引き、
   オーバーレイ値（`overlay.ts`）を返す。getter は chroot を `this` に、pushAddress 下で
   評価されるので依存エッジは素の wildcard getter と同じ機構で親グラフに載る。
5. **`$n` の Δ 補正**（§4-4） — テンプレート側の `$n` は変換時に囲む for の翻訳で増えた
   ワイルドカード数だけ繰り上げ、getter 内の `this.$1` は trap が
   `getIndexShiftForMarkerPath` で補正する。イベントハンドラの添字は
   `indexShiftByLoopElementPath`（変換された for → shift の台帳）でスコープ相対に落とす。
6. **chroot 公開面**（`element.state`） — 相対キー → 変換 → 親 proxy の薄い翻訳。
   `$getAll` / `$setAll` / `$resolve` / `$postUpdate` は接頭辞翻訳＋文脈添字の前置
   （`composeMountIndexes`）。他の `$` は親の意味論のまま（宣言面 `$watch` / `$streams` /
   `$listKeys` / `$updatedCallback` は P2-9b — マウントされた `<wcs-state>` は state
   ロード・名前登録・`$` 宣言の実行を行わない）。

## ファイル

| ファイル | 役割 |
|---|---|
| `mount.ts` | マウント記録（変換規則・マーカー・アクセサ台帳・shift 台帳）と登録簿 |
| `mountScope.ts` | スコープの構築（変換付き collect）・再初期化・プール再接続の張り直し |
| `overlay.ts` | オーバーレイ値（私有・getter・メソッド）と chroot 公開面 |
| `ownKeyShadow.ts` | 厳格 R1 の衝突報告（作者の own key がツリー/部分エントリを隠す） |
| `preCompletionWrites.ts` | 宣言前の窓の積みの控え（注入キー・上書きされた作者の値） |
| `bindWebComponent.ts` | plain 形の入口＋ `$stateReadyCallback` |
| `outerState.ts` / `meltFrozenObject.ts` | plain 形の公開 proxy と melt |
| `stateElementByWebComponent.ts` / `completeWebComponent.ts` | 台帳（plain の解決・完了/宣言） |
| `rootMountBinding.ts` | 完了前クロバーの復旧判定（authored オブジェクトの取り戻し） |

## R1（厳格・D19）と積み

作者の own data key は**私有** — マウント先の同名キー（ルート）も同名の部分エントリも
**隠す**（`ownKeyShadow.ts` が 1 回だけ warn）。私有の実体はマウントインスタンス
（listIndex）ごとに `privateSnapshot` から複製される（D21）。

完了前の親の初期適用（積み）は宣言済みなら書かない（`skipPendingMountWrite` —
apply/applyChange.ts）。宣言より先に走る窓（実ブラウザでは行 fragment、happy-dom では
template clone が upgrade 済み）では、**新規キー**は `injectedKeys`（作者のものではない →
ツリーに落ちる）、**既存キーの上書き**は `rememberOverwrittenValue` で作者の値を控え、
マウント構築が snapshot 前に復元する。

## 再初期化・プール再利用

- connectedCallback で shadow の innerHTML を張り直すコンポーネントは、再接続のたびに
  新しい `<wcs-state>` が同じ shadowRoot に入る。記録は (component, stateProp) で再利用
  （マーカー安定）、alias は冪等、旧スコープは `BindingSession.dispose()` で捨てて組み直す。
- shadow を 1 回だけ組む形の再接続は `remountScopeBindings` — 直接エントリを現在の行の
  文脈に張り替え、`rebindAddresses()` が台帳を張り直す（`for` は lastListValue を旧→新へ
  引き継ぐ。行ループ中の同期発火を避けるため microtask に遅延）。
- content 台帳が空の `for` binding は共有 lastListValue を無視して白紙から描く
  （apply/applyChangeToFor.ts — 再初期化・後着 binder の一般ガード）。

## 親 → 子の「通知」は存在しない

配送は変換済みバインディング＋単一台帳＋静的依存が担う。`applyChangeToWebComponent`
（完了済み (element, stateProp) への適用のルート先）は**意図的な no-op**。

## Light DOM

スコープ根はコンポーネント要素自身（D7）。ホスト側走査からの除外は §1.13 の prune
（`lightDomComponentScope.ts`）がそのまま担う。**name 属性が要るのは v1 の plain 形だけ**
（名前空間を共有するため）。マウントは独立ツリーを持たないので名前は不要。

## DCC との排他

`bind-component` は DCC ホスト（`data-wc-definition`）の内側では使えない（fail-fast）。
DCC の state はテンプレートに属し、インスタンスごとにロードされる — 定義時点のホストの
プロパティをソースにする `bind-component` とは両立しない（§3.1）。

## 設計の経緯

v1 の橋渡し機構（innerState / MappingRule / crossBoundaryAddress / outerListPath /
baseListIndex（Δ の帳簿）/ 再読込通知チャネル / outerPattern 相乗り）は Phase 2 slice 9
（P2-7）で削除した（−3,618 行）。個別修理の履歴は
[docs/architecture-hardening/15](../../../../docs/architecture-hardening/15-state-component-mechanism-consistency.md)
（§0 の表の「実装」列は廃止 — 挙動は本機構の上で impl-plan §7-8 の対応表どおり成立する）。
性能: 行コンポーネント create1k **169.4 → 128.6 ms（−24%）**・update −45%・ヒープ −1.4MB
（impl-plan §3-0-1 slice 7）。
