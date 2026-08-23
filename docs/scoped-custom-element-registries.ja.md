# wcstack における Scoped Custom Element Registry

- **作成**: 2026-08-23
- **状態**: Phase 0 と Phase 1 は実装済み。Phase 2 と Phase 3 はこの文書で設計し **未着手** —
  Phase 2 は Firefox 待ち、Phase 3 は待つ必要がない。
- **プラットフォーム状況**: Chrome/Edge 146（2026-03）と Safari 26（2025-09）が既定で出荷済み。
  Firefox は未出荷（[bugzilla 1874414](https://bugzilla.mozilla.org/show_bug.cgi?id=1874414)）。
- **English**: [scoped-custom-element-registries.md](./scoped-custom-element-registries.md)

Scoped registry は、シャドウツリーがカスタム要素名を `window.customElements` ではなく自分の
`CustomElementRegistry` で解決できるようにする。同じタグ名を持つ 2 つのコンポーネントが 1 ページ上で共存できる。
この文書は、それに対して wcstack が既に何をしたか、残る 2 フェーズに何が要るかを記録する。

## 1. 全ての判断を支える 3 つの事実

設計は出荷済みの MVP に対して行うこと。旧ドラフトではなく。初期の提案改訂版には、親レジストリへ *chain* する
継承や、テンプレートをスコープへクローンするための `ShadowRoot.createElement()` / `ShadowRoot.importNode()` が
書かれていた。**どちらも出荷されていない。** この機能を検索すると今もそれらのドラフトが出てくるので、
この節で実在する API 面を固定しておく。

1. **継承は無い。**
   [提案](https://wicg.github.io/webcomponents/proposals/Scoped-Custom-Element-Registries.html) は明言している。
   「このレジストリ内の定義はメインドキュメントに適用されず、その逆も同様。レジストリは使用する全要素の定義を
   含まなければならない」。scoped registry を持つツリーは、そこへも定義しない限り wcstack のタグを *1 つも*
   見ない。Phase 1 が必要だったのはこの事実による。
2. **レジストリの関連付けは不変。** MDN いわく「一度 `CustomElementRegistry` オブジェクトに設定されると、
   変更できない」。要素の生成時に確定する（`createElement` のオプション、または scoped registry を持つ文脈で
   パースされること）。よって `initialize()` は「レジストリがまだ `null` のノードにしか設定できない」。
   関連付けを間違えると回復不能であり、単に不便なのではない。
3. **一意性はレジストリ単位。** `define()` が `NotSupportedError` を投げるのは *そのレジストリ* が既に同名か
   同コンストラクタを持つときだけ。同じクラスを global と任意個の scoped registry の両方へ定義してよい。
   「wcstack のタグをあなたのレジストリへ登録する」が成立するのはこの性質のおかげ。

出荷済みの API 面:

| API | 用途 |
|---|---|
| `new CustomElementRegistry()` | 独立したレジストリを作る |
| `attachShadow({ customElementRegistry })` | シャドウルートに関連付ける。`null` は「まだレジストリ無し」 |
| `document.createElement(tag, { customElementRegistry })` | 要素とその子孫をスコープ化。後でどこへ挿しても変わらない |
| `registry.initialize(root)` | サブツリーの **null レジストリ** ノードにこのレジストリを設定し、upgrade する |
| `<template shadowrootmode shadowrootcustomelementregistry>` | 宣言的シャドウルートのレジストリを `null` のままにするようパーサに指示 |
| `Element` / `Document` / `ShadowRoot` の `.customElementRegistry` | 読み取り専用。そのノードを支配するレジストリ |

## 2. ロードマップを決める制約: Firefox

Firefox は scoped registry を出荷していない。wcstack はビルドレス・CDN 前提のスタックで、ページはどこでも
同じに動くことが期待される。ここから規範が 1 つ出る。

> **スコープ化は隔離を改善してよい。意味論を担ってはならない。**

2 つのツリーが同じタグ名を別々に解決することに *挙動* が依存するページは、Firefox で壊れる。しかも優雅にでは
なく、無言で誤ったコンポーネントに束ねられる形で壊れる。したがってスコープ化の上に建てる wcstack の機能は、
`Node.customElementRegistry` が `undefined` のときに何へ縮退するかで評価しなければならない。

これは残り 2 フェーズの直感的な順序を反転させる。

- **Phase 2（DCC のローカル定義）は Firefox 待ち。** その価値はまるごと「同じタグ名が別スコープで別の意味を
  持つ」ことであり、主要エンジンの 1 つが未対応の間はまさに上の規範が禁じる意味論そのものになる。
- **Phase 3（ウィジェット／アイランド）は待つ必要がない。** その価値は「ホストページを汚さない」ことで、
  Firefox では既存の `if (!registry.get(tag))` ガード付き global define ＝今日の挙動へ縮退する。

## 3. 着地済み（Phase 0 / 1）

branch `feat/scoped-custom-element-registry` で実装済み。

**Phase 0 — 壊れるのを止める。** 「このタグは定義済みか」という問いは全て、その問いが対象とするノードに対して
解決するようになった。scoped registry がある以上、この問いにページ全体で通用する答えは無いからである。

| パッケージ | 変更 |
|---|---|
| `state` | [`platform/customElementRegistry.ts`](../packages/state/src/platform/customElementRegistry.ts) が `Node.customElementRegistry` を解決し、全呼び出し元が自分のノードを渡す。DCC は自分のホストを支配するレジストリへ define する — global への define は自分の兄弟にすら適用されなかった。 |
| `defined` | `DefinedCore` が監視するレジストリを受け取り、`<wcs-defined>` は自分のサブツリーが解決するものを渡す。 |
| `autoloader` | 遅延ロードは走査 root のレジストリへ define し、ロード中台帳をレジストリ別に持つ。 |

以降の全てが依存するので、不変条件を 1 つ再掲しておく。

- `Node.customElementRegistry === undefined` は「このプラットフォームに scoped registry が無い」＝
  **global へ fallback する**。未対応環境では挙動が一切変わらない。
- `Node.customElementRegistry === null` は「このノードには意図的にレジストリが無い」＝ **fallback しない**。
  そこで global 定義済みタグを「使える」と報告すると、まだ upgrade されていない要素へ素の own property を
  書き込み、後の upgrade が入れるアクセサを覆い隠す。
  [state-binding-init-races.md](./state-binding-init-races.ja.md) §2 の deferred-apply が防いでいる当の失敗である。

**Phase 1 — 登録先を指定できるようにする。** `registerComponents.ts` を持つ 40 パッケージ全てが定義先レジストリを
受け取り（既定は global）、各 `bootstrapXxx()` が素通しする。`@wcstack/devtools` は意図的に対象外 — 1 タグを
定義して `document.body` へパネルを挿すので、どのツリーでもなくドキュメントのレジストリに属する。

ADR-15 §3.4 の DCC タグ名重複 fail-fast は性質として不変。一意性がレジストリ単位になっただけである。

## 4. Phase 2 — DCC のローカル定義

**Firefox の出荷待ちでブロック。** それ以前に着手しないこと（§2）。

### 何が可能になるか

1 ページに `<my-card data-wc-definition>` の定義が 2 つ、別スコープに、それぞれ自分のテンプレートと state を
持って共存できる。今日これは意図的な決定により即エラーである
（[ADR-15 §3.4](./architecture-hardening/15-state-component-mechanism-consistency.ja.md)）。

### Phase 0 で済んでいること

`defineDCC` は定義先レジストリをホスト要素から解決するので、*既に* scoped registry を持つシャドウルート内に
書かれた DCC は global ではなくそのスコープへ登録される。配管は終わっている。

### 実際に足りていないもの

**wcstack はレジストリを一度も作らない。** Phase 0 はページが既に用意したものを尊重するだけである。DCC の
著者がスコープ化を得るには、誰かが `new CustomElementRegistry()` を呼んで関連付ける必要があり、レジストリの
関連付けが不変（§1.2）である以上、それは `attachShadow()` の時点でなければならない。

wcstack が制御している `attachShadow` 呼び出しが 1 つある。[`defineDCC.ts`](../packages/state/src/dcc/defineDCC.ts)
の `_ensureShadow()` が DCC *インスタンス* のシャドウを attach している。ここでレジストリを渡せば DCC の内部を
本当の意味で private にできる。しかし継承が無いので、新しいレジストリは空から始まる — そのインスタンス自身の
`<wcs-state>` も、テンプレートが使う全 I/O タグも、何にも解決しなくなる。種を蒔けるようにするために Phase 1 が
あるが、*何を* 蒔くかを決めるのが難所である。

### 決定ゲート

- **G1** — DCC インスタンスのシャドウは自分のレジストリを持つか。持たない／定義ごとに opt-in／既定で持つ、の
  どれか。既定 ON は既存の全 DCC の意味を変えるので、ほぼ確実に誤りである。
- **G2** — そこへ何を蒔くか。「wcstack が提供する全部」は簡単だが、全スコープの内側に global 名前空間を
  再導入することになる。「著者が宣言したものだけ」が正しいが新しい著述面であり、今日の wcstack には DCC の
  依存マニフェストが無い。
- **G3** — 一意性がレジストリ単位になったとき、重複名の診断は何を言うべきか。現在の文言（「`X` は既に登録済み」）
  は、読み手が *どの* スコープで衝突したか分からない時点で行動に繋がらなくなる。
- **G4** — Firefox での契約はどうなるか。そこでも同名 DCC 2 つは即エラーであるべきで、つまりスコープ化に依存した
  著者は 3 エンジン中 2 つでしか動かないページを書いたことになる。この機能を「漸進的な隔離のみ（同名は不可）」と
  文書化するか、Baseline 入りを待つかのどちらかである。

Phase 2 をそもそもやる価値があるかを決めるのは G4 である。

## 5. Phase 3 — ウィジェット／アイランド

**ブロックされていない。** 今日実利用者がいるのはこちらのフェーズである。

### 何が可能になるか

wcstack が所有していないページへ wcstack 製ウィジェットを埋め込む際に、グローバルなタグ名を 1 つも占有しない。
既に *別バージョン* の wcstack が動いているページも含む。GTM 検討で買い手 1 位とした「FW 不在ページ層」がこれで、
scoped registry が即座に元を取れる唯一の場所である。

### Phase 1 で済んでいること

`registerComponents(registry)` と `bootstrapXxx(config, registry)` が 40 パッケージ全てで定義先を受け取るので、
スタック全体をスコープへ定義することは既に表現できる。

```js
const registry = new CustomElementRegistry();
bootstrapState(undefined, registry);
bootstrapFetch(undefined, registry);
const shadow = host.attachShadow({ mode: "open", customElementRegistry: registry });
```

### 実際に足りていないもの

1. **集約エントリが無い。** 上のコードは使うパッケージを手で全部並べている。集約できる場所は `wcstack`
   メタパッケージだけだが、これは今日ランタイムを持たない依存マニフェストである。
2. **テンプレートのクローンが未検証。** `state` の構造レンダリング（`for` / `if`）はテンプレート内容をクローン
   する。レジストリは生成時からノードに付いて回り（§1.2）、`createElement` のオプションは「後で DOM のどこへ
   挿入されても」要素をスコープ化する。よって **クローンは挿入先ではなくテンプレート側のレジストリを担う** と
   強く予想され、`initialize()` は `null` レジストリしか埋めないので、そうなると回復不能である。出荷済み MVP に
   これを是正する `ShadowRoot.importNode()` は無い（§1）。Phase 3 の設計に入る前に実ブラウザで計測すること。
   その答えが [`structural/createContent.ts`](../packages/state/src/structural/createContent.ts) を変更する
   必要があるか否かを決める。
3. **Import map はドキュメント単位。** [`importmap.ts`](../packages/autoloader/src/importmap.ts) は
   `document.querySelectorAll('script[type="importmap"]')` を読む。アイランドは自分のモジュールマップを
   持ち込めず、ホストページのものを読む。モジュール解決は本来ドキュメント全体のものなので恐らくこれが正しい
   意味論だが、ウィジェット内の `<wcs-autoloader>` はウィジェットが制御できないマップに対して解決する、という
   ことである。発見されるのではなく明示されるべき点。

### 決定ゲート

- **G5** — `wcstack` にランタイムエントリ（`bootstrapAll(registry)`）を持たせるか、ウィジェットのレシピを
  手書きドキュメントのままにするか。メタパッケージにランタイムを持たせることは、それをインストールする意味を変える。
- **G6** — 構造レンダリングにスコープ対応クローンが要るか。項目 2 の計測待ち。
- **G7** — アイランド内の `<wcs-autoloader>` を対応とするか。するなら誰の import map に対してか。
- **G8** — Firefox での縮退契約は何か。ホストページが既にそのタグを定義していればウィジェットの `define` は
  スキップされ、ウィジェットは無言でホストのバージョン上で動く。パッチレベルの差なら許容でき、メジャーなら
  できないが、wcstack にその違いを検出するバージョン折衝は無い。

### SSR について

scoped registry は並列 SSR を解禁 **しない**。[`render.ts`](../packages/server/src/render.ts) の
`renderToString` にある `Mutex` は 13 個のグローバルを差し替えるために存在し、`customElements` はその 1 つに
過ぎない。一方で将来のハイドレーション経路は提供する — `shadowrootcustomelementregistry` 付きの宣言的
シャドウ DOM が null レジストリのツリーを吐き、クライアントが `registry.initialize()` で関連付ける。
サーバは今日 DSD を出力しないので、これはこの文書ではなくその作業の下流にある。

## 6. やらないこと

- **コア内のどこかでスコープ化を必須にすること。** §2 の通り。全ての利用は opt-in で、global レジストリへ縮退する。
- **`@wcstack/devtools` への scoped registry。** `document.body` へ挿すページ全体のオーバーレイであり、
  ドキュメントのレジストリが正しい対象である。

## 7. 再検討の時期

Phase 3 のゲートは今すぐ開けられる。ブロッカーはブラウザではなく Phase 3 項目 2 の計測である。
Phase 2 は Firefox の出荷待ち。
[bugzilla 1874414](https://bugzilla.mozilla.org/show_bug.cgi?id=1874414) と
[web-features のエントリ](https://web-platform-dx.github.io/web-features-explorer/features/scoped-custom-element-registries/)
を追うこと。
