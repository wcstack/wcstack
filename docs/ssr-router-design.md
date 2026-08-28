# router SSR 設計 — サーバーでの初期ルート描画とクライアント採用

Status: Phase 1・2 実装済み（Phase 3 以降は設計のみ）
Scope: `@wcstack/server`（レンダリング基盤）、`@wcstack/router`（SSR モード対応）、`@wcstack/state`（Phase 3 のみ・スナップショット順序）
関連: [binder-protocol-design.md](./binder-protocol-design.md)、[view-transition-design.md](./view-transition-design.md)、[router-state-contract-design.md](./router-state-contract-design.md)

## 0. 要約

`@wcstack/server` は `<wcs-state>` ページしかレンダリングできない。SPA の初期ルート
（`/products/1` を開いたときの中身）はサーバーで描けず、この制約はドキュメントにも
書かれていなかった（README の "What SSR Cannot Do" 追記で先行修理済み）。

本設計は router SSR を 4 フェーズで導入する:

- **Phase 1（サーバー描画）**: `renderToString` にリクエスト URL を渡せるようにし、
  router が待機プロトコルに参加して、初期ルートの HTML がサーバー出力に乗る。
- **Phase 2（クライアント採用）**: クライアントの router がサーバー描画済み DOM を
  再描画せずに採用（adopt）する。state の `hydrateBindings` と同じ
  「成功したら採用・失敗したら CSR フォールバック」の二段構え。
- **Phase 3（スナップショット順序）**: `<wcs-ssr>` メタデータ生成をサーバー主導の
  最終パスに移し、route 内容と state スナップショットの順序レースを閉じる。
- **Phase 4（e2e・実機検証・ドキュメント反映）**。

設計原則は一つ: **server は router を知らない**。server が知るのはプロトコル
（`hasConnectedCallbackPromise` / `getBindingsReady` / binder）だけで、router は
そのプロトコルに参加する側になる。`packages/server/src` に router への言及が
0 のままであることは、欠陥ではなく到達目標である。

## 1. 現状の実測ギャップ

| # | ギャップ | 根拠 |
|---|---|---|
| 1 | `installGlobals` が `window` / `location` / `history` を入れない。Router は `window.location.href` を直読みするので bootstrap しても即死する | `packages/server/src/render.ts:26-30` / `packages/router/src/components/Router.ts:519,538` |
| 2 | `renderToString` に「このリクエストの URL」を渡す口が無い（`baseUrl` は fetch 解決専用） | `packages/server/src/render.ts:83-88` |
| 3 | router は待機プロトコル（`hasConnectedCallbackPromise` / `getBindingsReady`）に不参加。サーバーが初期ルート適用の完了を待てない | `packages/router/src` 全域 grep 0 ヒット |
| 4 | `parse()` が `template.content` を**破壊的に消費**する（route 要素は中身を移された抜け殻が残り、非 route ノードは fragment へ移動）。そのままシリアライズするとルート定義が失われ、クライアントが起動できない | `packages/router/src/parse.ts:44-97` |
| 5 | クライアント採用機構が無い。SSR 出力を読んだクライアント router は `_initialize` で template を再パースして outlet へ append + `applyRoute` するため二重描画になる | `packages/router/src/components/Router.ts:530-539` |
| 6 | 深い URL での basename 解決: `<base>` も `basename` 属性も無いと `_getBasename()` が現在パスを basename と誤認する。SSR は常に深い URL で起動するため顕在化する | `packages/router/src/components/Router.ts:169-176,515-522` |

副次事実:

- state は既にサーバー対応済み（`inSsr()` / `connectedCallbackPromise` /
  `getBindingsReady` / `<wcs-ssr>` 生成・採用）。router はこの型を踏襲すればよい。
- wcstack 自身のタグは `attachShadow` を一切使わない（`git grep` 0 件、outlet の
  opt-in shadow root を除く）ため、Declarative Shadow DOM 非対応の実害は
  第三者コンポーネント混在時に限られる。DSD は本設計のスコープ外。

## 2. 設計原則

1. **server はプロトコルだけを知る。** router 対応 = 「URL を持つ環境の提供」+
   「待機プロトコルの尊重」。`@wcstack/router` への import・言及はテストと docs に
   限る。bootstrap は従来どおり `options.bootstraps` で注入する。
2. **opt-in。** `<wcs-router enable-ssr>` を付けたときだけサーバーで描く。
   `<wcs-state>` の `enable-ssr` と同じ語彙。無印の router はサーバーで一切
   初期化されない（クライアント専用 = 部分 CSR）。
3. **安全側フォールバック。** 採用できない・描けない・整合しない場合は常に
   「何もせず CSR に落ちる」。state の `hydrateBindings` →失敗→ `buildBindings`
   フォールバック（`packages/state/src/stateElementByName.ts:102-106`）と同じ構え。
4. **guard 付きルートはサーバーで描かない（v1）。** guard は進入を守る認可点で、
   サーバーには判断材料（cookie / セッション）を渡す設計が無い。マッチしたルート
   連鎖に guard があれば SSR をスキップし outlet を空のまま返す（クライアントが
   従来どおり guard を実行して描く）。「guard が拒否するはずの内容を一瞬見せる」
   事故を構造的に排除する。
5. **transition-runner とは干渉しない。** 初回描画は arbiter に渡さない既存規則
   （`packages/router/src/showRouteContent.ts:100-115`）があるため、SSR の初期
   適用は常に同期実行される。追加作業ゼロ。

## 3. Phase 1 — サーバーが初期ルートを描く

### 3.1 server 側: レンダリング環境の拡張

`RenderOptions` に 2 つ追加する:

```ts
interface RenderOptions {
  baseUrl?: string;     // 既存: 相対 URL の fetch 解決
  bootstraps?: BootstrapFunction[];
  url?: string;         // 新設: このリクエストの完全 URL（例 "http://localhost:3000/products/1"）
  baseHref?: string;    // 新設: <base href> の値。url 指定時の既定は "/"
}
```

- `url` は happy-dom の `new Window({ url })` に渡す。`window.location` /
  `document.baseURI` がリクエスト URL を指す。
- `url` 指定時は `document.head` に `<base href={baseHref ?? "/"}>` を注入する。
  ブラウザで `<base>` を置く SPA と同じ条件をサーバー内に再現し、ギャップ #6
  （basename 誤認）を塞ぐ。サブパス配備は `baseHref`（または `basename` 属性）で
  明示する。
- `url` 指定かつ `baseUrl` 未指定なら、`url` の origin を `baseUrl` の既定にする
  （fetch の相対解決がリクエスト URL 基準で自然に効く）。
- `GLOBALS_KEYS` に `window` / `location` / `history` を追加する。restore の仕組みは
  既存のまま（保存→復元）。
- **binder pending queue の後始末**: binder プロトコルの保留キューは
  `Symbol.for("wcstack.binder.pending")` のグローバルに載り、`installGlobals` の
  restore 対象外なので**プロセス寿命で残る**。state を読み込まないページで router
  が initial content を差し出すと、引き取り手が現れないまま Node 参照が蓄積する。
  `renderToString` の `finally` でキューを空にする。これはプロトコルの公開
  シンボル面であり、server が個別パッケージの内部に触れるわけではない。

待機ループ（`render.ts:230-251`）は無変更。router が
`hasConnectedCallbackPromise` に参加することで自動的に待たれる。

### 3.2 router 側: SSR モード

**SSR 判定**: state と同じ規約 `document.documentElement.hasAttribute('data-wcs-server')`
を router 自身の `inSsr()` として持つ（キャッシュしない理由も state 側
`packages/state/src/config.ts:3-12` のコメントと同一 — SSR→hydrate が同一プロセスで
連続する）。パッケージ間 import はしない。

**待機プロトコル参加**: `Router` に `static hasConnectedCallbackPromise = true` と
`connectedCallbackPromise` を実装する。plumbing は State と同型 — コンストラクタで
作り、`connectedCallback` 完了で resolve、初期化例外で reject して再 throw
（reject を配管しないと renderToString が mutex を握ったまま無言ハングする。
`packages/state/src/components/State.ts:502-507` と同じ理由）。

**`connectedCallback` の SSR 分岐**:

```
inSsr() かつ enable-ssr 無し → 何もせず resolve して return（クライアント専用）
inSsr() かつ enable-ssr あり → SSR 初期化（下記）→ resolve して return
                                （navigate / popstate リスナは登録しない）
```

**SSR 初期化**（`_initialize` の SSR モード挙動）:

1. **template 温存**: `parse()` の前に `template.content` を deep clone し、
   パース後に復元する（ギャップ #4）。シリアライズ出力に完全なルート定義が残り、
   クライアントは従来どおり起動できる。
2. **a11y region を作らない**: 初回描画はアナウンスしない既存規則
   （`applyRoute.ts:78`）によりサーバーで不要。作るとクライアントが二重生成する。
3. **guard バリア**: 初期 `applyRoute` の前に `matchRoutes` でマッチ連鎖を求め、
   `guard` 属性を持つルートが含まれれば **SSR を中止**する（outlet 空・マーカー
   無し・エラーではない）。§2-4 の原則。
4. 初期 `applyRoute` を実行（従来コード。初回は transition に渡らず同期適用）。
5. **binder への差し出し**: 表示済みルートの `childNodeArray` を `bindSubtree` に
   渡す。クライアントの初回描画では「state の走査時に既に document に居る」前提で
   これを省略しているが（`showRouteContent.ts:91-95`）、サーバーではその前提が
   成立しない — state のロード方式（`json` 属性は I/O 無し、inline script は
   dynamic import）と文書順次第で state の初回走査が router の挿入より先に完了
   し得る。binder は「未構築なら保留して構築末尾で引き取る／構築済みなら同期
   バインド」の両側を吸収する（`packages/state/src/bindings/binder.ts:100-106` /
   `stateElementByName.ts:110-115`）ので、**どちらの順序でもレンダリング済み
   HTML は正しくなる**。`bindRouteContent` は使わない（binder 不在の警告は SSR
   では誤誘導になるため、warn 無しで直接差し出す）。
6. **ハイドレーションマーカー**（Phase 2 の入力）:
   - outlet に `data-wcs-ssr` 属性を付ける。
   - 表示した各ルートの内容を `<!--@@wcs-route-start:<absolutePath>-->` と
     `<!--@@wcs-route-end:<absolutePath>-->` で挟む。キーに placeholder の UUID を
     使わないのは、UUID がパースごとに再生成されクライアントと一致しないため。
     `absolutePath` はサーバーとクライアントが同一 template から決定的に導ける
     唯一の識別子である。ネストしたルートはマーカーも自然に入れ子になる。

**`_notifyLocationChange` / スクロール**: SSR 初期化では発火・実行しない
（`wcs:navigate` は Link の active 更新用で、サーバーの Link は自身の
`connectedCallback` で active を計算済み。スクロールはそもそも初期化経路に無い）。

### 3.3 Phase 1 の出力形状

```html
<wcs-router enable-ssr>
  <template>…（完全なルート定義が温存される）…</template>
</wcs-router>
<wcs-outlet data-wcs-ssr>
  静的ノード…
  <!--@@route:uuid-A-->            ← placeholder（クライアントでは別 UUID になる）
  <!--@@wcs-route-start:/products/:id(int)-->
  …ルート内容（state のバインド適用済み）…
  <!--@@wcs-route-end:/products/:id(int)-->
  静的ノード…
</wcs-outlet>
```

### 3.4 Phase 1 の既知の限界（Phase 2/3 で解消）

- **クライアント採用が無いため、`enable-ssr` を付けた router をブラウザで
  そのまま起動すると二重描画になる**（クライアントの `_initialize` が fragment を
  再 append する）。Phase 1 は基盤 + SSG 的用途（クローラ向け静的 HTML）まで。
  README には Phase 2 完了まで「router SSR は未対応」の記載を維持する。
- **`<wcs-ssr>` スナップショットとの順序レース**: route 内容の構造テンプレート
  （for/if）が `<wcs-ssr>` の template 群に載るかは、state の初回構築と router の
  挿入の相対順序に依存する（inline script state では router が必ず勝つが、`json`
  属性 state では文書順に依存し得る）。レンダリング済み HTML は §3.2-5 により
  常に正しい。Phase 3 で構造的に閉じる。
- **`<wcs-head>` はサーバー出力に乗らない**: 反映先が `document.head` で、
  `renderToString` は body しか返さないため。head 管理は当面クライアント専用。
  将来 head 出力を返すなら戻り値の拡張（`{ body, head }`）として別途設計する。

### 3.5 Phase 1 実装知見（実測）

- **happy-dom のパーサは開始タグの時点で connectedCallback を呼ぶ。** その時点で
  子（`<template>`）はまだパースされていないため、router の同期的な
  `_getTemplate()` が「template が無い」で落ちる。パース自体は同期完了するので、
  SSR 分岐の冒頭で 1 microtask 譲れば子が揃う（`Router.ts` の SSR 分岐参照）。
  クライアントでは deferred な auto バンドルの upgrade 時に子が揃っているため、
  この待避はサーバー専用。state が同じ問題を踏まないのは、`connectedCallback` が
  子を読む前に必ず await を挟む構造だから（偶然の耐性であり、契約ではない）。
- **`renderToString` の bootstraps は非同期ローダーを許容する**（実装済み）。
  `HTMLElement` をモジュールスコープで継承するクラスは、純 Node では
  トップレベル import できない（グローバル未設置で ReferenceError）。
  `async () => (await import('@wcstack/router')).bootstrapRouter()` の形で渡せば、
  installGlobals の後にモジュール評価が走る。state が動くのは
  `loadDefaultBootstraps` が dynamic import だから — 同じ構造を利用側にも開放した。
- **binder の実結合は committed dist では検証できない期間がある。** dist は
  リリース時にのみ再ビルドされるため、未リリースのプロトコル変更（今回は
  binder = PR#191）は junction → dist 経由では見えない。1c の結合テストは
  state / router とも **src を直接 import** して dist の鮮度から切り離した。
- CustomEvent の realm 差（Node ネイティブの CustomEvent を happy-dom 要素へ
  dispatch）は問題にならなかった — `commitNavigation` / `setParams` の発火を含む
  初期適用が結合テストで成立している。`GLOBALS_KEYS` への CustomEvent 追加は不要。

## 4. Phase 2 — クライアント採用（実装済み）

クライアントの `_initialize` は、outlet 予定位置に `data-wcs-ssr` 付きの
`<wcs-outlet>` を見つけたとき**採用経路**に入る:

1. template を通常どおり `parse()` する（route オブジェクト群と fresh fragment を
   得る — route の実体はクライアントで再構築される。サーバーの route 実体は
   シリアライズで失われているため、これは必須）。
2. fresh fragment は **outlet へ append しない**。代わりにサーバー DOM を走査し、
   `@@wcs-route-start/end:<absolutePath>` マーカーを route オブジェクトへ突合する:
   - マーカー間のノード列を当該 route の `childNodeArray` として**採用**する
     （fresh clone は破棄）。placeholder はマーカー位置に再設置する。
   - 突合できたら現在 URL で `matchRoutes` を実行し、**マッチ結果とマーカーの
     ルート集合が一致することを検証**する（サーバーとクライアントで URL が
     異なる・template が変わった等の不整合検出）。
3. 検証成功: guard 相を**通常どおり実行**した上で（採用はレンダリング最適化で
   あって認可のスキップではない。拒否時は採用済み `childNodeArray` を
   `hideRoute` → fallback へ navigate する — 採用ノードがそのまま隠せるので
   guard と自然に合成する）、DOM 変更なしで `commitNavigation` + `lastRoutes`
   設定 + マーカー除去。以後のナビゲーションは従来コードがそのまま動く
   （`hideRoute` は採用ノードを剥がし、戻れば `showRoute` が再挿入する）。
4. 検証失敗（マーカー欠損・集合不一致・マーカー無し）: **outlet の中身を捨てて
   従来経路**（fragment append + `applyRoute`）。安全側は常に CSR。

state との相互作用: state の `hydrateBindings` は outlet 内のサーバー DOM を
（router を知らずに）採用してバインドを確立している。router 採用はそのノードを
**保持**するため、確立済みバインドは生きたまま `childNodeArray` に入る。
router がフォールバックで outlet を捨てた場合、捨てたノード上のバインドは死ぬが、
新規挿入ノードは binder プロトコルで再バインドされる（`bindSubtree` は冪等）。

`<wcs-layout>` / slot 投影を含むルートの採用は初版スコープ外とし、検出したら
フォールバックに落とす（LayoutOutlet の投影状態はマーカーだけでは再構築できない。
必要になったら投影済み DOM の採用を別途設計する）。

### 4.1 実装知見（実測・設計からの精緻化）

- **placeholder 集合は完全一致検証**: serialize される placeholder = トップレベル
  ルート + 各マッチルートの直接の子。**不足**を許すと当該ルートへの後続
  ナビゲーションが anchor を失って無言の空描画になり、**過剰**（非活性ルートの
  子孫の ph）を許すと再設置が fresh クローンの内容から placeholder を奪って
  当該ルートを到達不能にする。どちらもフォールバック。
- **マーカーの幾何**: 自前サーバーの出力では子ルートの範囲は親の範囲の**外**
  （隣接）に置かれる — マーカー挿入は全ルートの表示完了後で、親の contentNodes の
  末尾は子 placeholder のため、親の end はその直後（＝子内容の手前）に入る。
  範囲の入れ子も検証（交差チェック）は正しい形として受理する（他システム由来の
  SSR HTML）。交差だけを拒否する。
- **Link 所有 anchor の除外**: 内容収集で `<wcs-link>` を見つけたらその
  `anchorElement` を除外集合に登録する。CSR で anchor は childNodeArray に決して
  入らない（Link の cc が後から生成する Link の所有物）ため、含めると hide → show
  の往復で Link 自身の anchor 管理と二重になる。
- **guard 相の共有**: showRouteContent のガード相を `runGuardPhase` として抽出し、
  採用経路と通常経路が同一実装を使う。採用では内容がサーバーによって既に
  見えているため、**lastRoutes を guard より先に立てる** — 拒否時の fallback
  遷移が採用済み内容を hideRoute できる。
- **フォールバック時の binder 差し出し**: 破棄と同時に state のハイドレート済み
  バインドは死んでおり「初期描画は走査時に DOM に居る」前提も崩れているため、
  描き直した内容を binder へ差し出す（冪等なので安全）。

### 4.2 Link のハイドレーション

`<wcs-link>` は cc で子を `<a>` へ移して描画するため、outlet 採用とは独立に
SSR 出力へ anchor が serialize される。素朴にクライアントが再接続すると
「host は空・serialize 済み anchor は放置」の二重 anchor になる。よって:

- **サーバー**: 生成した anchor に `data-wcs-ssr-link` を付け、リスナは登録しない
  （active class / aria-current は SSR 出力に載せる）。happy-dom は開始タグ時点で
  cc を呼ぶため、静的 Link は 1 microtask 譲ってから初期化する（Router と同じ
  待避 — 待機プロトコルには参加しないが、renderToString はプロトコル要素の
  await で microtask を消化するため serialize より先に完了する）。
- **クライアント**: cc で直後の兄弟に目印付き anchor を見つけたら**採用**する —
  目印を外し、anchor の子を自分の childNodeArray とし、href をクライアントの
  解決で引き直し、リスナを付けて active を更新する。目印が無ければ従来の生成。

## 5. Phase 3 — スナップショット順序（設計のみ）

§3.4 のレースの構造的解消。`<wcs-ssr>` の生成を State の `connectedCallback` 内
（`State.ts:489-509`）から**サーバー主導の最終パス**へ移す:

- `renderToString` は安定化ループと `readyPromises` の完了後、serialize の直前に
  state の公開 API（新設 `buildSsrDocument(document)` 相当）を呼ぶ。この時点で
  route 内容の挿入・バインドは全て完了している。
- 互換性: サーバーは能力を `data-wcs-server` 属性の**値**で告知する
  （例 `data-wcs-server="orchestrated"`）。新 state は値を見て inline 生成を
  スキップし、旧 server（値が空）とは従来どおり inline 生成で動く。旧 state +
  新 server は inline 生成のまま（今日のレースが残るだけで悪化しない）。
- `Ssr.buildContent` が使う fragment UUID レジストリはモジュールグローバルで
  state 要素ごとに分かれていない。複数 `enable-ssr` state の切り分けはこの
  フェーズで併せて仕様化する。

## 6. スコープ外

- **Declarative Shadow DOM**: wcstack 自身のタグは light DOM（§1 副次事実）。
  第三者コンポーネントの DSD 出力は happy-dom の serializable shadow root 対応の
  調査から別トラックで。
- **`<wcs-head>` のサーバー反映**（§3.4）。
- **guard のサーバー実行**: リクエストコンテキスト（cookie 等）をサーバーの
  guard に渡す設計は、実需が出てから。v1 は「guard 付き = SSR しない」で固定。
- **ストリーミング SSR**。

## 7. フェーズ計画とテスト戦略

CI 制約: ci.yml の matrix は「変更されたパッケージで `npm ci`」であり、
`@wcstack/*` の相互参照は lockfile の local link（`"resolved": "../state"`）経由で
**兄弟パッケージの committed dist** を消費する。dist は機能 PR ではコミットしない
規約のため、**クロスパッケージ統合テストを CI の unit テストに置くと、相手の dist
がリリースで再ビルドされるまで偽赤になる**（#183 と同型の罠）。よって:

| フェーズ | 内容 | テスト |
|---|---|---|
| 1a | server: `url` / `baseHref` / globals / 既定 `baseUrl` / pending queue 後始末 | `packages/server/__tests__/` — テスト内で定義したモック custom element（`window.location` を読み `hasConnectedCallbackPromise` を実装）で server の契約を検証。router 非依存で CI 安全 |
| 1b | router: `inSsr` / 待機プロトコル / SSR モード（template 温存・a11y skip・guard バリア・binder 差し出し・マーカー） | `packages/router/__tests__/` — src 直 import なので CI 安全 |
| 1c | server × router 実結合 | `packages/server/__e2e__/router-ssr.test.ts` — CI matrix 外（`test:e2e` は別コマンド）。state / router とも src 直 import で dist 鮮度から独立（§3.5） |
| 2 | クライアント採用 | `packages/router/__tests__/ssrHydration.test.ts`（ラウンドトリップ + 検証失敗系）+ server `__e2e__` のフルラウンドトリップ（state ハイドレーション込み・採用ノード上でバインドが生きることを実測）。実ブラウザ検証は Phase 4 |
| 3 | スナップショット順序 | state / server unit + e2e |
| 4 | examples（`examples/ssr` の router 版）、README 反映（"Cannot Do" から router を降ろす）、wcstack-skill 追随 | — |

## 8. 却下した代替案

- **「捨てて再描画」を正式なハイドレーションとする**: クライアントが常に
  outlet を破棄して再描画する案。実装は最小だが、state が採用済みのバインドを
  死なせて張り直すため、hydrate の「再レンダリングなしで再開」という既存の売りと
  矛盾する。フォールバック経路としてのみ残す（§4-4）。
- **server が router を import して待つ**: プロトコルで足りる。server の
  パッケージ非依存性（§2-1）を壊し、I/O ノード等「後から挿入する側」の一般解に
  ならない。
- **`parse()` を非破壊に変える**: クライアント経路の挙動変更になりリスクが
  SSR に閉じない。SSR モードでの snapshot/restore は router 内に閉じる。
- **placeholder UUID をマーカーに使う**: UUID はパースごとに再生成され、
  サーバーとクライアントで一致しない。決定的な `absolutePath` を使う。
