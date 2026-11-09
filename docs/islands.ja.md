# wcstack がページを持たないとき

**English**: [islands.md](./islands.md)

wcstack の文書のほとんどは、ページが wcstack のものだと仮定しています: HTML のファイルが 1 つで、状態がそれを一度束縛し、表示するものは `@wcstack/router` が入れる。よくある 2 つのページは、この仮定に合いません。**サーバーが描くサイト**は、自分のテンプレートからページを作って htmx や Turbo で入れ替え、wcstack はそこにいくつかの対話的な部品 —— アイランド —— を足します。**ウィジェット**は別のサイトのページに貼られ、その中には別の版の wcstack を自分で動かしているページもあります。この案内は、そうしたページで何が変わり、wcstack が何をし、ページが何をするかを述べます。継ぎ目アプリ `community-hall` から来ています: htmx 2 で動く市民会館の CMS のサイトに wcstack のアイランドを 5 つ足し、提携先の旅館の Turbo のサイト（自分の問い合わせフォームに wcstack 4.17 を使う）に予約のウィジェットを置いたものです（[seam-apps.md](./seam-apps.md)）。

## 何が変わるか

| ページで | 起きること | すること |
|---|---|---|
| body が入れ替わる（htmx の `hx-boost`、Turbo Drive） | ルートの `<wcs-state>` は古い body と一緒に去り、新しい body のルートが新しいページを束縛します。 | ナビゲーションが入れ替える body の中に、ルートを 1 つ置きます。残す部分（`hx-preserve`、`data-turbo-permanent`）には置きません: 古いルートが残り、新しいページのマークアップは束縛されません。 |
| ページの一部が入れ替わる（`#results` への `hx-get`、Turbo のフレーム） | 新しいマークアップは束縛されません: 状態はページを一度だけ歩きました。4.20 から `diagnostics` add-on が警告します（`[wcs/inserted-unbound]`）。 | 入れた要素を 1 つずつ binder に渡し、捨てるものは手放します（[差し込んだマークアップを渡す](#差し込んだマークアップを渡す)）。 |
| 戻る／進むがキャッシュの写しを戻す（htmx の履歴、Turbo のスナップショットのキャッシュ） | 写しは描いたままのページです: 描き直す元の `<template>` も、更新するコメントの束縛もありません。見た目は正しく、二度と変わりません。4.20 から `diagnostics` add-on が警告します（`[wcs/rendered-copy]`）。 | アイランドのあるページではキャッシュを切ります: `<body>` に `hx-history="false"`、`<meta name="turbo-cache-control" content="no-cache">`。戻るはサーバーからページを読み込みます（往復が 1 回増え、htmx はスナップショットが無いとスクロール位置を戻しません）。 |
| 束縛が描く要素をサーバーが更新する（`hx-swap-oob`） | 束縛された要素が束縛の無い要素に置き換わり、束縛はもう無い古い要素へ書き続けます。 | 1 つの要素の持ち主は 1 人: アイランドが描くか、サーバーが描くか。 |
| `for:` / `if:` のテンプレートの中の htmx の属性 | 行は htmx がページを処理した後で複製されるので、行の中の `hx-get` は htmx に見えません。`hx-*` を変える束縛も見えません（htmx は要素を処理するときにそれを読みます）。 | `hx-*` は wcstack のテンプレートの外に置くか、行に `htmx.process()` を呼びます。 |
| 束縛が応えるイベントで htmx が決める | htmx はイベントの配送の中で動き、wcstack は束縛を 1 マイクロタスク後に当てます。束縛が付ける属性（`attr.data-invalid:`）は、htmx が読むときにはまだ前の値です。 | htmx 自身のイベント（`htmx:confirm`）で決めるか、トリガーに `delay:` を付けます。 |
| サーバーのテンプレートも `{{ }}` を使う | サーバーがページに残した CMS の欄が束縛になってしまいます。 | 状態に `$behavior: { enableMustache: false }` を書き、束縛は `data-wcs` とコメントの束縛（`<!--@@: x-->`）で書きます。4.20 から lint もこの宣言に従います。 |
| 時間をおいて同じ文書に 2 つの `<wcs-state src="x.js">` | 4.19 までは 1 つのオブジェクトを共有し、次のページは前のページが書いた値で始まりました。 | 4.20 から、それぞれがモジュールを評価し直したものを受け取ります。 |
| 入れ替わるページの volume（`mount=`） | 4.19 までは htmx の入れ替えの 2 回に 1 回、新しいページの volume が拒否されました（htmx は古い中身を外す前に新しい中身を入れる）。 | 4.20 から、volume は始めるときに決めます。 |

## ルートの置き場所

ページごとにルートを 1 つ、入れ替わる body の中に置き、そのページのアイランドはすべて自分のキーの下に持たせます（`booking.*`、`filter.*`）。サーバーがそのページについて知っていること —— 描いたレコード、URL の絞り込み —— は、データとして状態に渡します: `$connectedCallback` で読む `<script type="application/json" id="page-seed">`、または `json=` の volume。1 つの文書に別々のルートとして置いたアイランドはぶつかり（`[wcs/second-root]`、`#47`）、どちらが勝つかは読み込みの順で決まります。

サーバーのレイアウトに一度だけ書いて `src=` で読むルートは、4.20 からそのままで構いません: ページごとに新しい状態になります。4.19 までは、状態を inline で書いて factory で作り（inline のモジュールで `export default createSiteState();`）、factory のモジュールを import map に載せます —— inline の状態は `blob:` の URL から評価され、そこでは `"/js/site.js"` が解決できません。

## 差し込んだマークアップを渡す

```js
const binder = () => globalThis[Symbol.for("wcstack.binder")];
const REGIONS = "#results, #booking";   // ページの htmx が入れ替える領域

// htmx: htmx:load は入れ替えが入れた要素ごとに、htmx:beforeCleanupElement は外す要素ごとに起きる
document.addEventListener("htmx:load", (e) => {
  if (e.detail.elt.parentElement?.closest(REGIONS)) binder()?.bind(e.detail.elt);
});
document.addEventListener("htmx:beforeCleanupElement", (e) => {
  // 領域の直下の子 — サーバーが最初に描いた（ページの走査が束縛した）ものも
  if (e.detail.elt.parentElement?.matches(REGIONS)) binder()?.release?.(e.detail.elt);
});

// Turbo のフレーム: フレームの要素は残り、子が入れ替わる
document.addEventListener("turbo:before-frame-render", (e) => {
  for (const el of e.target.children) binder()?.release?.(el);
});
document.addEventListener("turbo:frame-render", (e) => {
  for (const el of e.target.children) binder()?.bind(el);
});
```

- **入れ物ではなく新しいノードを。** ページの走査が歩いた要素は、渡し直されても中身ごとそのままです: `#results` へ入れ替えた後に `#results` を渡しても何も束縛されません。
- **断片の最上位にある `for:` / `if:` のテンプレート**は、渡しても描かれません（`#204`）: その行はテンプレートの横に並び、入れた側の手が届かないためです。要素で包んでください。
- **`release` は二度と戻らないもの向けで、ノードの下に束縛されているものをすべて手放します** —— 渡したものも、ページの走査が最初に束縛したもの（サーバーが最初に描いた結果）も。部分木の束縛の登録を外し、`for:` / `if:` の view を片付けます（4.20 から。binder プロトコルの版 2、`release` add-on —— `@wcstack/state` と `/auto` に入っています）。これが無いと、1 時間結果を入れ替えたページは出したすべての結果を持ち続け、変更のたびにそのすべてへ書き込みます。手放したノードは束縛し直されません。戻すもの（隠してまた見せるパネル）は手放さないでください。
- **`@wcstack/state` を読み込む前**は binder は `undefined` です。それより前に入ったマークアップは最初の走査が束縛します。

規則は state の README（[Inserting markup yourself](../packages/state/README.ja.md#マークアップを自分で差し込む)）に、プロトコルは [binder-protocol-design.md](./binder-protocol-design.md) §10 にあります。

## 自分の wcstack を動かしているページに置くウィジェット

ページは `<wcs-state>` を一度だけ定義します: 最初に評価した `@wcstack/state` の写しが定義し、2 つ目の写しは何もしません（`[wcs/package-twice]`、[timing-and-firing-contract.md §24](./timing-and-firing-contract.md)）。wcstack を動かしているページで `/auto` を読むウィジェットは、そのページの写し —— 版が何であれ —— で動き、ページが版を上げた日や、ウィジェットがより新しいものを要るようになった日に壊れます。マークアップをページの light DOM に置くウィジェットは、ページのルート（`#47`）とページのスタイルシートにも出会います。

ウィジェットに自分の [scoped custom element registry](./scoped-custom-element-registries.md) を持つ shadow root を与え、wcstack のタグはその registry に定義します。どのパッケージの `bootstrapXxx(config, registry)` も第 2 引数に registry を取り、`@wcstack/state` の `bootstrapState(config, registry)` も同じです:

```js
import { bootstrapState } from "https://esm.run/@wcstack/state@4.20.0";
import { bootstrapSse } from "https://esm.run/@wcstack/sse@4.20.0";

let registry = null;
function widgetRegistry() {
  if (registry === null) {
    registry = new CustomElementRegistry();
    bootstrapSse(undefined, registry);
    bootstrapState(undefined, registry);
  }
  return registry;
}

class PartnerWidget extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: "open", customElementRegistry: widgetRegistry() });
    shadow.innerHTML = `<wcs-state src="${new URL("./widget-state.js", import.meta.url)}"></wcs-state>…`;
  }
}
customElements.define("partner-widget", PartnerWidget);
```

- パッケージの主の入口（`bootstrapState` を export する）を import し、`/auto`（ページのグローバルな registry に定義する）は使いません。版は固定します。
- shadow root はウィジェット自身のルートです: そこに状態の木が 1 つ、ページのものと並び、どちらのスタイルシートも相手に届きません。
- **ブラウザ。** scoped registry は Chrome / Edge 146 と Safari 26 が出しています。Firefox はまだ出していません（[scoped-custom-element-registries.md](./scoped-custom-element-registries.md)）。`new CustomElementRegistry()` が投げるところでウィジェットが何をするかを決めてください —— `community-hall` のものは、ページの写しで動く代わりに、会館のサイトのイベントへのリンクを出します。
- **Turbo。** Turbo のスナップショットはページの複製で、複製には shadow root がありません: そこから戻ったウィジェットは `connectedCallback` で始め直します。Turbo のプレビュー（`<html>` の `data-turbo-preview`）はすぐに捨てられるので、そこでは仮の表示にすれば接続を 1 本省けます。

## そうしたサイトの確かめ方

- **lint** は、`{{ }}` がサーバーの構文であるサーバーのテンプレートと、`<wcs-state>` を持たない断片を読みます。4.20 から `enableMustache: false` に従い、束縛はあるが状態の無いファイルを、検査せずに通すのではなく報告します（`wcs/state-absent`）。断片のパスを検査するには、ブラウザが受け取るとおりのページを lint します: サーバーを通して描き、断片をそのページに入れ、結果に `wcs-validate --root=<サイトの公開ディレクトリ>` をかけます。
- **diagnostics add-on**（`@wcstack/state` と `/auto` に入っています）は、何にも束縛されなかった差し込みのマークアップ（`[wcs/inserted-unbound]`）と、描いたページのキャッシュの写し（`[wcs/rendered-copy]`）を報告します。コンソールの警告で落ちる主な流れのテストが、どちらも捕まえます。
- `@wcstack/testing` の**単体テスト**は `mount()` のたびに状態のモジュールを import し直すので、2 つのルートが 1 つのモジュールのオブジェクトを共有することは見えませんでした（4.20 で直りました）。ページからページへの流れはブラウザで確かめます。
