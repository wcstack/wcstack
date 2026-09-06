# router × state パス契約 — Router 観測面・クエリ文字列・Route 死接面の整理

Status: Draft（設計承認待ち）
Scope: `@wcstack/router`（本体）、`examples/router-spa`（追随）、docs/README（追随）
State-side changes: **なし**（wc-bindable プロトコルが汎用に吸収する — それ自体がこの設計の検証になる）

## 0. 要約

`@wcstack/state` と `@wcstack/router` の間にはパス契約が存在しない。「Path as the
Universal Contract」を掲げながら、看板パッケージ同士がその契約で繋がっていない。
本設計は 3 点を一体で解決する:

- **A. Router 観測面**: マッチ結果（`params` / `typedParams` / `routeName`）と
  クエリ（`searchParams`）を、live DOM に居る唯一の要素である `<wcs-router>` の
  wc-bindable 面として露出する。
- **B. Route 死接面の撤去**: `<wcs-route>` の `static wcBindable` 宣言は構造的に
  到達不能（後述 §1.2）。宣言を削除し、README の乖離した記述を修正する。
- **C. クエリ文字列の規範化**: URL 分解の共通規範を導入し、`navigate()` /
  `<wcs-link>` のクエリ破壊バグを修正、`replaceUrl` 書き込み面を新設、
  クエリのみ遷移の発火規範を定める。

到達目標は一文で言える: **旗艦例 router-spa から正規表現が消えること。**

```html
<!-- Before: router が :productId(int) で解析済みの結果を捨て、state で regex 再実装 -->
<wcs-router data-wcs="path: path; navigateUrl: navigateUrl">
<!-- state 側: get productId() { const m = this.path.match(/^\/products\/(-?\d+)$/); ... } -->

<!-- After: 解析結果がそのまま流れる -->
<wcs-router data-wcs="path: path; typedParams: routeParams; searchParams: query; navigateUrl: navigateUrl">
<!-- state 側: get productId() { return this.routeParams.productId ?? null; } -->
```

## 1. 現状の実測欠陥

### 1.1 欠陥一覧

| # | 欠陥 | 根拠 |
|---|---|---|
| 1 | `RouteCore.wcBindable` の `params` / `typedParams` / `active` は data-wcs から**構造的に到達不能**（§1.2） | `packages/router/src/parse.ts:53-61` |
| 2 | README の JS アクセス例 `document.querySelector('wcs-route[...]')` は動かない疑いが濃厚 — 著者が書いた要素は inert な template content 内の抜け殻、初期化済み clone は detached | `packages/router/README.md` §「Get from the route element」 |
| 3 | Router 要素は `path` / `navigateUrl` しか晒さず、params はどの live 要素からも取れない | `packages/router/src/components/Router.ts:30-49` |
| 4 | 旗艦例 router-spa は router の型付き解析結果を捨て、state 側で regex を再実装（例自身がコメントで自白） | `examples/router-spa/index.html:103-106` |
| 5 | `packages/router/src` に `searchParams` / `location.search` は 0 ヒット。クエリは読めず、変化を観測する手段も無い | 全域 grep |
| 6 | **既存バグ**: Navigation API 非対応環境で `navigate("/products?page=2")` は 404 に落ちる — `normalizePathname` がクエリを剥がさないままセグメントマッチに渡るため | `packages/router/src/components/Router.ts:250-251` + `normalizePathname.ts` |
| 7 | **既存バグ**: `<wcs-link to="/products?page=2">` の active 判定はクエリ込みの文字列比較になり、決して active にならない | `packages/router/src/components/Link.ts:193-197` |
| 8 | クエリのみ遷移（`/products` → `/products?page=2`）は今日すでに applyRoute を全経路通過しており、guard 再実行・空 mutate の transition 包み・a11y 再アナウンスが**未定義のまま発生**する | §1.3 |
| 9 | param 配送の契約が 3 系統に断片化: `data-bind`（独自・route 子ノード限定）/ Route の wcBindable（死接面）/ state 側 regex（手動）。どれも state に繋がらない | `assignParams.ts` / `RouteCore.ts` / router-spa |

### 1.2 なぜ Route の wcBindable は到達不能か

`parse.ts` は template 内の `<wcs-route>` を clone して **detached なコントローラ
オブジェクト**に変換する。live DOM に入るのは placeholder コメント
（`@@route:<uuid>`）とマッチ時にスタンプされる子ノードだけで、route 要素自体は
決して document に接続されない。

- `data-wcs` は live DOM 上の要素の属性走査で結線する仕組みなので届かない。
- binder プロトコル（`showRouteContent.ts` の `bindSubtree`）は「後から DOM に
  **入る**ノード」を救うもので、「決して DOM に**入らない**ノード」は対象外。
- `wcs-route:params-changed` は detached 要素に dispatch されるため、bubbles でも
  detached tree の外に出ない。誰にも観測されない。

つまり宣言は「果たせない約束」であり、修理の方向は「約束を果たせる場所
（Router）に移す」以外にない。route 要素を live DOM に置く方向は display / CSS /
a11y への副作用が大きく採らない。

### 1.3 クエリのみ遷移の現状挙動（未定義動作の実測）

Navigation API 環境で `/products` → `/products?page=2` へのアンカークリックは
`navigate` イベントを発火し、`hashChange: false` なので `_onNavigateFunc` は
素通しでインターセプトする。その結果:

- `matchRoutes` 再実行 → 同一マッチ → guard 相が**再実行**される
- `mutate` は no-op だが `runTransition("router", mutate)` は**呼ばれる**
  （arbiter が居れば空の view transition が走る）
- `applyA11yPolicies` が**再実行**される（同じページを再アナウンス）
- `path` は不変なのでイベントは発火せず、state からは**何も見えない**

本設計はこの経路を「same-match 高速パス」（§4.4）として規範化する。

## 2. 設計原則と非目標

原則:

1. **URL が正、Router がその代弁者。** state は観測と書き込み依頼を行うだけで、
   URL の権威は持たない（router-spa の `path` バインドで確立済みの分担）。
2. **書き込み面は null-idle transient に統一する。** `navigateUrl` で確立した
   「null は待機・書き込みで起動・完了で自己リセット」の契約を再利用し、
   スナップショット型プロパティへの書き込みは導入しない（§4.3 の理由による）。
   この選択を支配する優先順位は**「契約の安全性（attach タイミング非依存）>
   API 表面の便利さ」**であり、書き込み面に関する本設計の決定はすべて
   この順位にトレースされる。
3. **単一パイプライン。** クエリ更新も通常のナビゲーションと同じ経路
   （navigate イベント → intercept → applyRoute）を通す。第二の更新経路を作らない
   （transition-runner の「mutation は正確に一度」と同じ規律）。
4. **state 側は変更ゼロ。** 新しい面はすべて既存の wc-bindable 語彙
   （properties / inputs / commands、output-only、getter、semantics: "state"）で
   表現できなければならない。

非目標:

- **ハッシュ（`#`）のルーティング関与**: `hashChange` ナビゲーションは従来どおり
  無視する。navigate ターゲット内の `#hash` は分解時に温存して URL に渡すのみ。
- **クエリのマッチング関与**: ルートマッチはパスのみ。`:param` 構文へのクエリ
  拡張はしない（パス契約の複雑化に見合う実需がない）。
- **guard へのクエリ引き渡し**: `GuardHandler(toPath, fromPath)` の署名は不変。
- **Route 要素の live DOM 化**: §1.2 で棄却。

## 3. A — Router 観測面

### 3.1 wcBindable 宣言（変更後の全量）

```ts
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "navigateUrl",  event: "wcs-router:navigate-url-changed", semantics: "state" },
    { name: "replaceUrl",   event: "wcs-router:replace-url-changed",  semantics: "state" },
    { name: "path",         event: "wcs-router:path-changed",         semantics: "state" },
    { name: "params",       event: "wcs-router:params-changed",       semantics: "state",
      getter: (e) => (e as CustomEvent).detail.params },
    { name: "typedParams",  event: "wcs-router:params-changed",       semantics: "state",
      getter: (e) => (e as CustomEvent).detail.typedParams },
    { name: "searchParams", event: "wcs-router:search-changed",       semantics: "state" },
    { name: "routeName",    event: "wcs-router:route-name-changed",   semantics: "state" },
  ],
  inputs: [
    { name: "basename", attribute: "basename" },
    { name: "navigateUrl" },
    { name: "replaceUrl" },
  ],
  commands: [
    { name: "navigate", async: true },
    { name: "replace",  async: true },
  ],
};
```

`params` / `typedParams` / `searchParams` / `routeName` は **output-only**
（properties のみ・inputs に無い）。state 側の既存規範により authority は
element（attach 時に要素の現在値を読む）となり、state→element 書き込みは恒久
ブロックされる。router-spa の `path` バインドで実証済みの「値は読むもので、
待つものではない」性質がそのまま乗る — バインドがいつ attach しても取りこぼしが
ない。

### 3.2 各プロパティの意味

| プロパティ | 型 | 値 |
|---|---|---|
| `params` | `Record<string, string>` | 現在マッチしたルートチェーンの**マージ済み** param（文字列）。`matchResult.params` そのもの。fallback ルート時・初期化前は `{}` |
| `typedParams` | `Record<string, any>` | 同上の型変換済み値。`:id(int)` なら number |
| `searchParams` | `Record<string, string>` | 現在 URL のクエリ。キー重複は **last-wins**（§3.5）。クエリ無しは `{}` |
| `routeName` | `string` | 最深マッチルートの `name` 属性値。fallback 時は **fallback ルートの `name`**（state 側で 404 UI も `routeName` 分岐で書けるようにする。§3.6 の実装規則 `routes.at(-1)!.name` と一致）。無名・初期化前は `""` |

露出するオブジェクトは **`Object.freeze` したスナップショット**とする。params は
router の所有物であり、消費側の変異は silent corruption ではなく loud failure に
すべきだから。ナビゲーションごとに新しいオブジェクトを作る（`===` が変わるので
state の same-value guard を正しく通過する）。

`routeName` を含める理由: これが無いと静的ルートの判別（router-spa の `isList`）
だけが `path === "/"` の文字列比較として state に残る。`name` 属性は既存であり、
プロパティ 1 つの追加費用で「state 側のパス文字列解釈ゼロ」が完成する。

### 3.3 イベントと detail

| イベント | detail | 発火条件 |
|---|---|---|
| `wcs-router:params-changed` | `{ params, typedParams }` | params の shallow 比較（文字列値）で変化した commit のみ |
| `wcs-router:search-changed` | 新しい `searchParams` | 正規化比較（§3.5）で変化した commit のみ |
| `wcs-router:route-name-changed` | 新しい `routeName` | 値が変化した commit のみ |
| `wcs-router:path-changed` | 新しい `path` | 従来どおり |

detail 形状 `{ params, typedParams }` と typedParams の getter 分派は、削除される
RouteCore 宣言（§5）と同型 — 既存の設計語彙を場所だけ移す。ただし **`params` 側にも
getter が必要**（実装時修正）: state 側の DEFAULT_GETTER は `event.detail` 全体を
返すため、getter 無しでは `params` バインドに `{ params, typedParams }` が丸ごと
届いてしまう（RouteCore の旧宣言は同じ欠陥を持っていたが、死接面だったため
発現しなかった）。全イベント `bubbles: true`（既存の path-changed に整合）。

### 3.4 発火規範（firing contract）

commit（applyRoute がガード通過を確認した後）における規範:

1. **全内部値（`_params` / `_typedParams` / `_searchParams` / `_routeName` /
   `_path`）を先にコミットし、その後で初めてイベントを発火する。**
   どのイベントのリスナーから要素プロパティを読んでも、遷移後スナップショットの
   一貫した値が見える。半端な状態は観測できない。
2. 発火順序は **params → route-name → search → path**。`path` を最後に置くのは、
   既存例で `path` が「ナビゲーション完了」の信号として使われているため —
   `path` 発火時点で他の全観測面は確定済みであることを保証する。
3. guard 拒否（committed = false）では何も更新せず何も発火しない
   （既存の path 非発火規範を全面に拡張）。

保証範囲の明確化: 規範 1 の一貫性保証の主語は**要素プロパティ**である。
state 側では 4 イベントが逐次 state へ書き込まれるため、event-token（`$on`）
ハンドラ内で別の面を読むと遷移途中の state 値を観測し得る（DOM 描画は
updater のドレイン合流により最終スナップショットで行われるため実害は
限定的）。複数面に依存する処理は、最後に発火する `path` を契機にするのが規範。

attach 先行時に取りこぼしがないことの根拠: バインド attach が Router 初期化より
先行した場合、attach 時読み取りは内部初期値（`{}` / `""`）を返すが、初回 commit
の変化判定はその内部初期値との比較で行われるため、実 URL に param / query /
name があれば初回イベントが必ず発火し、バインドは追随する。取りこぼしは
構造的に生じない。

これは `docs/timing-and-firing-contract.md` の系列に属する規範であり、実装後に
同文書へ追記する。

### 3.5 searchParams の正規化

- 読み取り形状は `Record<string, string>`。`URLSearchParams` の生ハンドルは
  露出しない（生ハンドルを state に入れない規範 — camera/recorder で確立）。
- キー重複（`?tag=a&tag=b`）は **last-wins**。フィルタパイプラインと data-wcs の
  消費形がスカラー前提であり、重複キーの実需が出た時に別面
  （例: `searchParamsAll`）を追加で切る余地を残す。読み捨てではなく規範として
  README に明記する。
- 変化判定はキーをソートした pair 列の比較（順序非依存）。表示順の違いだけで
  イベントを発火させない。
- 値のデコードは `URLSearchParams` に委ねる（`+` → space を含む）。

### 3.6 コミットの供給源

`applyRoute` に `search: string` を明示引数で渡す（隠れた `window.location` 読み
にしない — テスト容易性と権威の明示のため）。各呼び出し元の供給源:

| 呼び出し元 | search の供給源 |
|---|---|
| `_onNavigateFunc`（Navigation API intercept） | `new URL(navEvent.destination.url).search` |
| `_onPopState` | `window.location.search` |
| `_initialize` | `window.location.search` |
| `navigate()` フォールバック経路 | §4.1 の分解結果 |

`params` / `typedParams` / `routeName` の供給源は `matchResult`
（`matchResult.routes.at(-1)!.name` が routeName）。`IRouteMatchResult` に
search は**入れない**（マッチングの入力ではないから）。

## 4. C — クエリ文字列の規範

### 4.1 URL ターゲット分解の共通規範

新設 `splitUrlTarget(to: string): { pathname: string; search: string; hash: string }`
を `normalizePathname.ts` の隣に置き、**ナビゲーションターゲット文字列を受理する
全地点**で使う: `Router.navigate` / `Router._joinInternalPath` の入口 /
`Link._setAnchorHref` / `Link._joinInternalPath` / `Link._updateActiveState`。

- 最初の `#` より後を hash、残りの最初の `?` より後を search として分離。
- `normalizePathname` / basename 結合は **pathname にのみ**適用し、search / hash
  を再結合して URL を組み立てる。
- これにより §1.1 の欠陥 6（フォールバック 404）と 7（Link active 不成立）が
  直る。**この修正は新面と独立に成立する単独バグ修正**（Phase 0）。

受理形の拡張: `to` / `navigateUrl` / `replaceUrl` は次を受理する。

| 形 | 意味 |
|---|---|
| `/path` / `path` | 従来どおり（クエリ無し遷移。現在のクエリは**引き継がない**） |
| `/path?k=v` | パス遷移＋クエリ指定 |
| `?k=v` | **クエリのみ遷移**: pathname は現在値を維持 |
| `?` | クエリの全消去（pathname 維持） |

「クエリを引き継がない」を既定にするのは、URL 組み立てを暗黙マージにすると
「消す」操作が表現できなくなるため。引き継ぎたい場合は state 側で
`searchParams` から組み立てる（getter 一つで書ける）。

`<wcs-link to="?page=2">` も受理する（現状は `new URL("?page=2")` が throw して
raiseError になる）。href は「現在 pathname + 指定クエリ」で組み立て、active
判定と同じリスナー（`currententrychange` / `wcs:navigate` / `popstate`）で追従
させる。active 判定は **pathname のみの比較**（クエリ非感応）と明文化する。

### 4.2 replaceUrl — replace 書き込み面の新設

`navigateUrl` の対（push / replace）として `replaceUrl` を新設する。契約は
navigateUrl と完全同型:

- null は待機。null / undefined / `""` の書き込みは no-op。
- 文字列書き込みで `replace(value)` を起動、完了後に自分で null へ戻し
  `wcs-router:replace-url-changed`（detail: null）を発火。
- 同一値の再書き込み中は再起動しない（既存ガードと同じ）。

`replace(path)` の実装: Navigation API では
`navigation.navigate(url, { history: "replace" })`、フォールバックでは
`history.replaceState` + `applyRoute` + `_notifyLocationChange`。command としても
`{ name: "replace", async: true }` を宣言し、command-token
（`$command.replace`）からも起動可能にする。

使い分けの規範（README に記載）:

- **ページネーション・タブ**（戻るボタンで戻りたい）→ `navigateUrl = "?page=2"`
- **検索ボックス・絞り込み**（履歴を汚したくない）→ `replaceUrl = "?q=" + ...`
  （高頻度入力は `<wcs-debounce>` を挟むことを併記）

### 4.3 決定: searchParams への直接書き込みは設けない

「`searchParams` を input にも宣言して書き込み可能にする」案は**棄却**する。
理由は初期同期の地雷: properties + inputs 両宣言のメンバーは state 側の既定
authority が "state" であり、バインド attach 時に **state の初期値（例 `{}`）が
要素へ書かれて実 URL のクエリを消す**。`?page=2` 付きでロードしたページが
バインド確立の瞬間に `/products` へ replace されるのは受け入れられない。
`#init=element` 修飾子で回避可能だが、「注釈を忘れると URL が壊れる既定」は
契約として不良である。

output-only + null-idle transient（navigateUrl / replaceUrl）の組は:

- attach タイミングに依存せず安全（読みは attach 時、書きは意図した時だけ）
- ループ構造が生まれない（transient は自己リセットし、search-changed の
  受信が再書き込みを誘発しない）
- 既存契約の再利用であり、新しい語彙を増やさない

### 4.4 same-match 高速パス

**判定規範**: same-match 判定は共有関数 1 実装（`isSameMatch(router, pathname)`
相当）に集約する。比較は **basename スライス後の path 同士**で行う —
`router.path` に格納されているのはスライス後のパスであり、スライス前の
`fullPath` と比較すると basename 運用で same-match が決して成立しない
（basename="" のテストでは検出できない型の欠陥になる）。判定が必要な地点は
2 箇所ある: `_onNavigateFunc` の intercept **オプション決定時**（applyRoute
実行前に `scroll` / `focusReset` を決める必要がある）と、`applyRoute` の入口
分岐。両方が同じ関数を呼ぶ。

**初回ガード**: 最初の成功 commit より前には same-match を適用しない。
現実装では初期 `_path = ""` が正規化後パス（常に `/` 始まり）と一致しない
ため偶然安全だが、それは normalizePathname の実装詳細への暗黙依存であり、
規範として明示する。

same-match と判定されたナビゲーションでは、次を**規範として**行う:

- `matchRoutes` / guard 相 / `showRouteContent` を**スキップ**する。
  guard はルートへの**進入**を守るものであり、クエリ変化は進入ではない。
- transition-runner に**渡さない**（DOM mutation が無いのに arbiter へ空遷移を
  依頼しない — §1.3 の実測欠陥の修理）。
- `applyA11yPolicies` を**実行しない**（同一ページの再アナウンスは騒音）。
- `focusReset: "manual"` とする。検索ボックスにバインドした `replaceUrl` の
  1 打鍵ごとにフォーカスが body へ飛ぶ事故を防ぐ。
- `scroll` は **navigationType で分岐する**: push / replace は `"manual"`
  （1 打鍵ごとにスクロールがトップへ戻る事故の防止。フォールバック経路の
  `window.scrollTo(0, 0)` も同様にスキップ）。**traverse（戻る/進む）は仕様既定
  （`"after-transition"` = ブラウザのスクロール位置復元）を維持する** —
  `?page=2` から戻る操作でスクロールが固定される事故を防ぐ。これは
  フォールバック経路の「popstate は決してスクロールしない = ブラウザ復元に
  任せる」既存規範と同じ思想である。
- search を commit し、§3.4 の規範でイベントを発火する（この場合 search-changed
  のみが発火し得る）。

パス遷移（same-match でない）は従来どおり全経路を通り、
`scroll` / `focusReset` / a11y も従来規範のまま。

既存挙動からの変更点（リリースノート対象）: 同一パスへのナビゲーションで
guard が再実行されなくなり、空の view transition が走らなくなる。これは
「未定義だった隅の規範化」であり、guard の進入セマンティクスに照らして正当。

### 4.5 マルチ Router の注記

`basename` 分割で複数 Router が共存する場合、`params` / `routeName` は各 Router
のマッチを反映するが、**`searchParams` はページ単位の共有状態**である
（URL のクエリは 1 つしかない）。どの Router 経由で書いてもクエリ全体が
置き換わる。README に注記する（設計での分割はしない — クエリの名前空間分割は
実需が出てから）。

ただしこの「共有」は**書き込み面の性質**であり、読み取り面は per-Router で
ある: search の commit は各 Router の applyRoute 経由で `_isOwnPath` ゲートの
内側にあるため、**自分の basename 外へのナビゲーションでは commit されない**。
よって各 Router の `searchParams` が返すのは「その Router が最後に処理した
ナビゲーション時点のクエリ」であり、ページの現在クエリと一致する保証が
あるのは自分の basename 配下に居る間だけである。これを規範として README に
明記する。全 Router で search だけを commit する代替案は、params / routeName
との整合（同一 commit 由来のスナップショットであること）を壊すため棄却する。

## 5. B — Route 死接面の撤去

### 5.1 変更内容

- `RouteCore.wcBindable`（`params` / `typedParams` / `active`）と
  `Route.static wcBindable = RouteCore.wcBindable` を**削除**する。
- `wcs-route:params-changed` / `wcs-route:active-changed` の **dispatch は存置**
  する。RouteCore は EventTarget であり、Core 直接消費（signals の正式推奨形）
  と既存ユニットテストの観測面として生きているため。削除するのは
  「data-wcs から結線できる」という果たせない約束だけ。
- `data-bind`（`assignParams`）は**不変**。route 子ノードへの param 配送として
  守備範囲が異なる（州の分担: state を使わないページ・汎用コンポーネント向け）。

### 5.2 ドキュメント追随

- `packages/router/README.md`（+ `README.ja.md`）:
  - `document.querySelector('wcs-route[...]')` の JS アクセス例を削除し、
    Router バインド経由の取得に差し替える。
  - `params` / `typedParams` の表を Route 節から Router 節へ移し、
    wcBindable 面（§3.1 の全量）と発火規範（§3.4）を記載する。
  - param 配送の分担表を新設: 「state に流す → Router バインド」
    「route 内の要素へ直接 → data-bind」。
- `docs/architecture-hardening/12-wc-bindable-observable-inventory.md`:
  Route の行を削除し Router の行を更新する。
- `docs/custom-state-reflection-design.md` §7 フォローアップ候補 2
  （`wcs-route` の `active` への `:state()` 反映）: **成立しない**注記を追加する。
  detached 要素は CSS からも到達不能であり、ナビゲーションハイライトの実装済み
  対応物は `wcs-link` の `.active` / `aria-current` である。

### 5.3 互換性

`Route.wcBindable` の削除は「宣言されていたが機能し得なかった面」の削除であり、
実働コードは壊れない（data-wcs 結線は不可能だったし、querySelector 経由の
JS アクセスも実際には null を返していた）。次リリースは i18n の
`config.locale` 既定変更により **minor bump が既に確定**しているため、そこに
同乗する。リリースノートに明記する項目: Route wcBindable 削除 /
same-match 規範化（§4.4）/ navigate のクエリ受理（§4.1、従来はフォールバック
環境で 404 になっていた旨）。

## 6. state 側の変更 — なし（設計の検証点）

新面はすべて既存語彙で表現される:

- output-only member → authority=element の attach 時読み取り + 恒久書き込み
  ブロック（`initialSync.ts` 実装済み）
- `typedParams` の event getter 分派（`twowayHandler.ts` の
  `propDesc.getter ?? DEFAULT_GETTER` 実装済み）
- null-idle transient の書き込み（navigateUrl で実証済み）
- `...: routerX` spread も宣言追加だけで自動追随する（properties + inputs 展開）

**state のソースに 1 行も触れずに二枚看板が繋がるなら、wc-bindable プロトコルが
汎用契約として機能している証明になる。** 逆に state 側の改造が必要になった場合、
それはプロトコルの欠陥として別途起票する。

## 7. 実装フェーズ

### Phase 0 — クエリ分解の単独バグ修正（新面なし・単独リリース可）

- `splitUrlTarget` 新設、`Router.navigate` / `Link` 全地点への適用（§4.1）
- 修正されるバグ: フォールバック 404（欠陥 6）/ Link active 不成立（欠陥 7）
- テスト: split の単体（`?` / `#` / 複合 / 空）、フォールバック navigate の
  クエリ付き遷移、Link active のクエリ非感応、`to="?k=v"` の href 組み立て

### Phase 1 — Router 観測面（§3）+ same-match 高速パス（§4.4）

- 内部値コミット + イベント発火（発火順序・変化判定・freeze）
- `applyRoute` への `search` 明示引数と same-match 分岐
- テスト: 発火規範（順序・「イベント前に全値コミット」・guard 拒否時の無発火）、
  same-match で guard / transition / a11y が呼ばれないこと、
  クエリのみ遷移で search-changed のみ発火、fallback ルートの `params = {}` と
  `routeName`（name あり = その値 / 無名 = `""`）、
  freeze 済みオブジェクトの露出、
  **basename 付きでの same-match 成立**（スライス後比較の検証）、
  **初回 commit 前に same-match が適用されないこと**、
  **traverse の same-match で scroll が仕様既定のままであること**
- e2e: `router-state-params.spec.ts` — state バインド経由で typedParams が
  流れること（attach 前後どちらのタイミングでも）

### Phase 2 — replaceUrl（§4.2）

- プロパティ / input / command の追加、Navigation API と フォールバック両経路
- テスト: null-idle 契約（no-op / 自己リセット / 再入ガード）、
  replace が履歴を増やさないこと、`?` での全消去

### Phase 3 — B の撤去とドキュメント（§5）

- 宣言削除、README（en/ja）改稿、inventory 更新、reflection 設計書への注記

### Phase 4 — 旗艦例の書き換え（受け入れ試験を兼ねる）

- `examples/router-spa`: regex getter を `typedParams` バインドに置換、
  `isList` を `routeName` に置換、カテゴリ絞り込み（`?category=`、
  `replaceUrl` + searchParams 読み）を追加してクエリ面のショーケースにする
- 完了条件: **router-spa の `<wcs-state>` 内から `.match(` と `path ===` が
  消えていること**

### フォローアップ（別作業・ユーザー操作含む）

- wcstack-skill の references 追随（router のバインド面変更のため必須）
- `docs/timing-and-firing-contract.md` への §3.4 追記
- `@wcstack/server`（SSR）が router の新面に影響されないかの確認
- リリースノート（§5.3 の 3 項目）

## 8. 決定記録

| # | 決定 | 主理由 |
|---|---|---|
| D1 | params 露出は Router 要素に集約（Route ではなく） | Route は detached で構造的に到達不能（§1.2）。live DOM に居るのは Router だけ |
| D2 | Route の wcBindable 宣言は削除、Core イベント dispatch は存置 | 果たせない約束の撤去。Core 直接消費とテスト観測面は生かす |
| D3 | searchParams は output-only。直接書き込み面は設けない | both-declared の既定 authority="state" が attach 時に URL を破壊する（§4.3） |
| D4 | 書き込みは navigateUrl（push）/ replaceUrl（replace・新設）の null-idle transient に統一 | 実証済み契約の再利用。ループ・初期同期問題が構造的に生じない |
| D5 | クエリはマッチングに関与しない。IRouteMatchResult にも入れない | パス契約の複雑化に実需がない。観測面と書き込み面だけで SPA 要件は満たせる |
| D6 | same-match は guard / transition / a11y をスキップ。判定は basename スライス後 path の共有関数 1 実装（intercept オプション決定と applyRoute 分岐の両所から呼ぶ）・初回 commit 前は不適用 | guard は進入セマンティクス。空遷移・再アナウンスは §1.3 の実測欠陥。スライス前比較は basename 運用で same-match が成立しない |
| D6b | same-match の scroll は navigationType 分岐: push / replace のみ "manual"、traverse は仕様既定（ブラウザ復元）を維持。focusReset は常に "manual" | 打鍵ごとのスクロール飛び防止と、戻る操作のスクロール復元は両立が必要。popstate 非スクロール（ブラウザ復元に任せる）の既存規範と同思想 |
| D7 | searchParams は `Record<string, string>`・last-wins・frozen・順序非依存の変化判定 | スカラー消費前提のフィルタ / バインド面に整合。重複キーは実需が出たら別面 |
| D8 | routeName（最深マッチの name 属性）を露出。fallback 時は fallback ルートの name | これが無いと静的ルート判別だけ文字列比較として state に残る。fallback の name 露出で 404 UI も routeName 分岐で書ける |
| D9 | イベント発火前に全内部値をコミット。発火順は params → route-name → search → path | どのリスナーからも一貫したスナップショットが見える。path は完了信号 |
| D10 | ハッシュは引き続き非関与（分解時に温存のみ） | hashChange 無視の既存規範を維持。実需が出てから |
| D11 | マルチ Router でクエリの書き込み面はページグローバル（分割しない）。読み取り面は per-Router — 各 Router の searchParams は自 Router が最後に処理した commit 時点の値 | URL のクエリは 1 つ。全 Router での search 単独 commit は params / routeName とのスナップショット整合を壊すため棄却。名前空間分割は実需が出てから |

## 9. 未決事項

- **freeze と state 内部の相互作用**: state は露出オブジェクトを参照のまま保持
  する想定であり freeze は読み取りに影響しないはずだが、Phase 1 の統合テストで
  実測確認する。万一 state の updater / diff が frozen で躓く場合は freeze を
  降ろし「変異禁止」を README 規範に格下げする（挙動契約は変えない）。
- **クエリのみ遷移と `<wcs-timer>` 等の再接続**: same-match では DOM を触らない
  ため副作用は無い想定だが、e2e で route 内 I/O ノードの生存を確認する。
