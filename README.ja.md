# wcstack

**もしブラウザにこれが最初からあったら？**

wcstack は「未来のWeb標準を想像し、ライブラリとして実装する」プロジェクトです。リアクティブなデータバインディング、宣言的ルーティング、コンポーネントの自動読み込み — これらがブラウザに最初から組み込まれていたら、どんな形になるでしょうか？

フレームワークではなく、*あるべきだった* HTMLタグの実現を目指しています。

---

## ルール

このプロジェクトには5つの縛りがあります。これが面白さの源泉です。

| # | ルール | 理由 |
|---|--------|------|
| 1 | **CDN一発** | `<script>` タグ1つ。npm不要、バンドラー不要、設定不要。 |
| 2 | **機能はカスタムタグで提供** | すべてがカスタム要素。`<wcs-something>` で表現できないなら、このプロジェクトの範囲外。 |
| 3 | **初期ロード = タグ定義だけ** | スクリプトはカスタム要素を登録するだけ。初期化コードもブートストラップも不要。 |
| 4 | **HTMLのセマンティクスを崩さない** | 式は `data-*` 属性とテキストノードに収まる — HTMLが拡張を許している場所だけを使う。DOM構造とセマンティクスはそのまま。 |
| 5 | **最新のECMAScript** | 最新のJS機能を積極的に採用。ES5へのトランスパイルはしない。未来を作ってるんだから。 |

この縛り、簡単そうに見えるでしょう？　そうでもないです。

HTMLのセマンティクスを崩さないためには、仕様のどこが拡張を許していて、どこが許していないかを深く理解していないと破綻する。すべてをカスタムタグで作るには、ライフサイクル・順序制御・コンポーネント間通信をCustom Elementsの仕組みの中で解決しないといけない。依存ライブラリゼロということは、すべてのアルゴリズムを自分で書くということ。そしてそのすべてが、「ブラウザ組み込みかも」と思えるクオリティでなければならない。

---

## 設計の核心

既存のすべてのフレームワークでは、**コンポーネント**がUIと状態の出会う場所になっている。状態ストアを外部に切り出しても、コンポーネント内に状態を引き込むグルーコードを書くことになる。UIと状態は常にJavaScriptの中で結合する。

wcstack は、文字通り別の **パス** を選んだ。

UIと状態を結びつけている**唯一の契約（コントラクト）**は**パス文字列**です。 — `user.name`、`cart.items.*.subtotal`、`@shared`。フックもインポートも結合のためのコードもありません。コンポーネントのJavaScriptには状態を参照するコードが一切含まれていません。HTMLだけが、すべてのデータ依存関係を宣言的に記述します。

```
State  ← "user.name" →  UI          パスが2つのレイヤーを結ぶ
Comp A ← "@app" →       Comp B      名前付きパスがコンポーネントを横断する
Loop   ← "items.*" →    Template    ワイルドカードがインデックスを抽象化する
```

つまり、UIを作り直しても状態に触れなくていい。状態をリファクタリングしてもDOMに触れなくていい。HTMLを読めばすべてが分かる。REST APIのURLと同じ発想 — シンプルな文字列契約、共有コードなし。

---

## パッケージ

39個の独立したランタイムパッケージ + 1つのツール拡張パッケージ。ランタイム依存ゼロ（SSR用のhappy-domを除く）。ビルド不要。

### もしHTMLにリアクティブなデータバインディングがあったら？

[`@wcstack/state`](packages/state/) — 状態をインラインで宣言し、属性でDOMにバインドする。

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { name: "ウィジェット", price: 500, quantity: 2 },
          { name: "ガジェット", price: 1200, quantity: 1 }
        ]
      },
      removeItem(event, index) {
        this["cart.items"] = this["cart.items"].toSpliced(index, 1);
      },
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.price"] * this["cart.items.*.quantity"];
      },
      get "cart.total"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((a, b) => a + b, 0);
      },
      get "cart.grandTotal"() {
        return this["cart.total"] * (1 + this.taxRate);
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    {{ .name }} &times;
    <input type="number" data-wcs="value: .quantity">
    = <span data-wcs="textContent: .subtotal|locale"></span>
    <button data-wcs="onclick: removeItem">削除</button>
  </div>
</template>
<p>合計: <span data-wcs="textContent: cart.grandTotal|locale(ja-JP)"></span></p>
```

- **パスgetter** — `get "users.*.fullName"()` あらゆる深さの算出プロパティ
- **構造ディレクティブ** — `<template>` による `for`、`if` / `elseif` / `else`
- **40以上のフィルタ** — 比較、算術、文字列、日付、フォーマット
- **双方向バインディング** — `<input>`、`<select>`、`<textarea>` で自動
- **Mustache構文** — テキストノード内の `{{ path|filter }}`
- **Web Componentバインディング** — Shadow DOMとの双方向状態同期

[詳細ドキュメント &rarr;](packages/state/README.ja.md)

---

### もしルーティングがただのHTMLタグだったら？

[`@wcstack/router`](packages/router/) — アプリのナビゲーション構造をマークアップで定義する。

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-layout layout="main-layout">
        <nav slot="header">
          <wcs-link to="/">ホーム</wcs-link>
          <wcs-link to="/products">商品一覧</wcs-link>
        </nav>
        <wcs-route index>
          <wcs-head><title>ホーム</title></wcs-head>
          <app-home></app-home>
        </wcs-route>
        <wcs-route path="products">
          <wcs-route index>
            <product-list></product-list>
          </wcs-route>
          <wcs-route path=":id(int)">
            <product-detail data-bind="props"></product-detail>
          </wcs-route>
        </wcs-route>
      </wcs-layout>
    </wcs-route>
    <wcs-route fallback>
      <error-404></error-404>
    </wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>
```

- **ネストされたルート & レイアウト** — Light DOMで宣言的にUI構造を組み立て
- **型付きパラメータ** — `:id(int)`、`:slug(slug)`、`:date(isoDate)` で自動変換
- **自動バインディング** — `data-bind` でURLパラメータをコンポーネントに注入
- **Head管理** — `<wcs-head>` でルートごとに `<title>` と `<meta>` を切り替え
- **Navigation API** — モダンな標準APIベース、popstateフォールバック付き
- **ルートガード** — 非同期の判定関数でルートを保護

[詳細ドキュメント &rarr;](packages/router/README.ja.md)

---

### もし fetch がタグだったら？

[`@wcstack/fetch`](packages/fetch/) — 宣言的な HTTP 通信をヘッドレス Web Component として。

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      loading: false,
      filterRole: "",
      get usersUrl() {
        const role = this.filterRole;
        return role ? "/api/users?role=" + role : "/api/users";
      },
    };
  </script>
</wcs-state>

<!-- URL が変わると自動的に再フェッチ -->
<wcs-fetch data-wcs="url: usersUrl; value: users; loading: loading"></wcs-fetch>

<template data-wcs="if: loading">
  <p>読み込み中...</p>
</template>
<template data-wcs="for: users">
  <div data-wcs="textContent: .name"></div>
</template>
```

- **CSBC アーキテクチャ** — Core / Shell / Binding Contract 分離
- **wc-bindable-protocol** — React、Vue、Svelte、Solid と薄いアダプタで連携
- **URL 監視** — バインドされた URL の変更で自動再フェッチ
- **trigger プロパティ** — 状態から宣言的に fetch 実行、DOM 参照不要
- **HTML リプレースモード** — htmx 的な `target` 属性でサーバーレンダリング断片を差し替え
- **ヘッドレス Core** — `FetchCore` は Node.js、Deno、Cloudflare Workers で動作

[詳細ドキュメント &rarr;](packages/fetch/README.ja.md)

---

### もしカスタム要素が勝手に読み込まれたら？

[`@wcstack/autoloader`](packages/autoloader/) — タグを書くだけで読み込まれる。登録コード不要。

```html
<script type="importmap">
  {
    "imports": {
      "@components/ui/": "./components/ui/",
      "@components/ui|lit/": "./components/ui-lit/"
    }
  }
</script>

<!-- ./components/ui/button.js から自動読み込み -->
<ui-button></ui-button>

<!-- Litローダーで ./components/ui-lit/card.js から自動読み込み -->
<ui-lit-card></ui-lit-card>
```

- **Import Mapベース** — 名前空間解決、コンポーネントごとの登録不要
- **即時 & 遅延読み込み** — 重要なコンポーネントを先に、残りはオンデマンドで
- **MutationObserver** — 動的に追加された要素も自動検知
- **プラガブルローダー** — Vanilla、Lit、カスタムローダーを混在可能
- **`is` 属性** — カスタマイズされた組み込み要素の `extends` 自動検出

[詳細ドキュメント &rarr;](packages/autoloader/README.ja.md)

---

### もしテンプレートがサーバーでレンダリングされたら？

[`@wcstack/server`](packages/server/) — 同じHTML、サーバーでレンダリング。特別な構文不要。

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(`
  <wcs-state enable-ssr>
    <script type="module">
      export default {
        items: [],
        async $connectedCallback() {
          const res = await fetch("/api/items");
          this.items = await res.json();
        }
      };
    </script>
  </wcs-state>
  <template data-wcs="for: items">
    <div data-wcs="textContent: items.*.name"></div>
  </template>
`);
```

- **ドロップインSSR** — `<wcs-state>` に `enable-ssr` を追加して `renderToString()` を呼ぶだけ
- **自動ハイドレーション** — クライアントがサーバーの続きをシームレスに引き継ぎ、フリッカーなし
- **相対URL自動解決** — `baseUrl` オプションで `fetch("/api/...")` がサーバー上でも動作
- **バージョン安全フォールバック** — バージョン不一致時はDOMをクリーンアップしてCSRにフォールバック
- **`<wcs-ssr>` ハイドレーションデータ** — 状態スナップショット、テンプレート、プロパティを1要素に集約

[詳細ドキュメント &rarr;](packages/server/README.ja.md)

---

### 追加パッケージ

- [`@wcstack/websocket`](packages/websocket/) — `<wcs-ws>` でリアルタイム通信を宣言的に扱い、接続状態や受信データをバインド可能。
- [`@wcstack/upload`](packages/upload/) — ファイルアップロードを宣言的に記述し、進捗・状態管理をフレームワーク非依存で提供。
- [`@wcstack/storage`](packages/storage/) — `<wcs-storage>` で localStorage / sessionStorage と状態を宣言的に同期。
- [`@wcstack/timer`](packages/timer/) — `<wcs-timer>` で時刻経過やポーリングを宣言的な状態変化として扱う。
- [`@wcstack/raf`](packages/raf/) — `<wcs-raf>` で requestAnimationFrame を宣言的に。フレーム tick・一級の `dt`・非表示タブの `suspended` 出力。
- [`@wcstack/geolocation`](packages/geolocation/) — `<wcs-geo>` で位置情報を宣言的に扱い、単発/継続取得、精度、ライブな権限状態を提供。
- [`@wcstack/debounce`](packages/debounce/) — `<wcs-debounce>` と `<wcs-throttle>` で値・シグナルのストリームをまとめる debounce/throttle を宣言的に。
- [`@wcstack/clipboard`](packages/clipboard/) — `<wcs-clipboard>` でクリップボードの読み書き、リッチな `ClipboardItem`、copy/cut/paste 監視、ライブな権限状態を宣言的に。
- [`@wcstack/broadcast`](packages/broadcast/) — `<wcs-broadcast>` で同一オリジンの BroadcastChannel による pub/sub をバインド可能な状態としてタブ間メッセージング。
- [`@wcstack/worker`](packages/worker/) — `<wcs-worker>` で重い処理をバックグラウンドスレッドに退避し、message/error/running 状態をバインド可能に。
- [`@wcstack/sse`](packages/sse/) — `<wcs-sse>` で Server-Sent Events（EventSource）による一方向ストリーミングを、message/接続状態をバインド可能な状態として、名前付きイベント対応で。
- [`@wcstack/intersection`](packages/intersection/) — `<wcs-intersect>` で遅延読み込み・無限スクロール・スクロールスパイを、可視状態をバインド可能な IntersectionObserver として。
- [`@wcstack/wakelock`](packages/wakelock/) — `<wcs-wakelock>` で Screen Wake Lock を宣言的に。バインドした boolean が true の間スクリーンを起こしたままにし、visibility 変化をまたいで再取得する。
- [`@wcstack/resize`](packages/resize/) — `<wcs-resize>` で要素サイズ・コンテナ幅の測定・サイズ依存ロジックを、バインド可能な状態として ResizeObserver で。
- [`@wcstack/speech`](packages/speech/) — `<wcs-speak>`（text-to-speech を command-token として）と `<wcs-listen>`（認識結果を event-token 状態として）で音声を宣言的に。
- [`@wcstack/permission`](packages/permission/) — `<wcs-permission>` で Permissions API を監視し、ライブな `granted`/`denied`/`prompt` 状態を公開。読み取り専用ウォッチャー（コマンドなし）で、`<wcs-geo>` などの機能ノードと組み合わせる。
- [`@wcstack/network`](packages/network/) — `<wcs-network>` で Network Information を監視し、アダプティブ読み込み向けにライブな `effectiveType`/`downlink`/`rtt`/`saveData` 状態を公開。読み取り専用ウォッチャー（コマンド・属性なし）で、非対応（Firefox/Safari）がエッジケースではなく常態。
- [`@wcstack/screen-orientation`](packages/screen-orientation/) — `<wcs-screen-orientation>` で画面の向きを監視し `lock`/`unlock` コマンドを提供、`type`/`angle`/`portrait`/`landscape` を公開。監視は同期のため `_gen` ガード不要、`lock()` は非同期のため必要（監視とは独立）。
- [`@wcstack/fullscreen`](packages/fullscreen/) — `<wcs-fullscreen target="...">` で Fullscreen API を宣言的に。`<wcs-intersect>` の target 解決パターンを再利用し、`active` は解決した target が document の `fullscreenElement` かを追跡。
- [`@wcstack/picture-in-picture`](packages/picture-in-picture/) — `<wcs-pip target="...">`（target は `<video>` 要素）で Picture-in-Picture を宣言的に。`<wcs-fullscreen>` と同じ target 解決パターン。
- [`@wcstack/pointer-lock`](packages/pointer-lock/) — `<wcs-pointer-lock target="...">` でゲームや canvas UI 向けの Pointer Lock を。`movementX`/`movementY` は v1 では意図的に対象外（必要なら後日 `@wcstack/debounce`/`@wcstack/throttle` と組み合わせ）。
- [`@wcstack/share`](packages/share/) — `<wcs-share>` で Web Share API を宣言的に。`share(data)` コマンド、`value`/`loading`/`error`/`cancelled` 状態。`cancelled`（ユーザーが共有シートを閉じた）は `error`（真の失敗）と区別。
- [`@wcstack/eyedropper`](packages/eyedropper/) — `<wcs-eyedropper>` で EyeDropper API（デスクトップのカラーピッカー）を。`open()`/`abort()` コマンド、`value` は `{ sRGBHex }`。`<wcs-share>` と同じ `value`/`loading`/`error`/`cancelled` の形。
- [`@wcstack/contacts`](packages/contacts/) — `<wcs-contacts>` で Contact Picker API を。`select(properties, options)` コマンド（Android Chrome のみ — それ以外は非対応が既定）。`value` は `multiple: false` でも常に配列。
- [`@wcstack/credential`](packages/credential/) — `<wcs-credential>` で Credential Management（パスワード/フェデレーションのみ — WebAuthn は明確に対象外）を。`get(options)`/`store(credential)` コマンドが1つの `_gen` を共有（文書化済みの並行性制限）。
- [`@wcstack/idle`](packages/idle/) — `<wcs-idle>` で Idle Detection を。ジェスチャ必須の `requestPermission()` + `start`/`stop`、`userState`/`screenState`/`active` を公開。権限状態は重複させず `<wcs-permission name="idle-detection">` と組み合わせる。接続時に自動開始しない。
- [`@wcstack/tilt`](packages/tilt/) — `<wcs-tilt>` で Device Orientation を。iOS のジェスチャ必須 `requestPermission()`（他環境では no-op）を吸収し、どこでも同じフローで書ける。`permissionState` はローカルで追跡する3値語彙（対応する Permissions API エントリが存在しない）。
- [`@wcstack/accelerometer`](packages/accelerometer/) / [`@wcstack/gyroscope`](packages/gyroscope/) / [`@wcstack/magnetometer`](packages/magnetometer/) / [`@wcstack/ambient-light-sensor`](packages/ambient-light-sensor/) — Generic Sensor API ファミリ。`<wcs-accelerometer>`/`<wcs-gyroscope>`/`<wcs-magnetometer>` は `x`/`y`/`z` を、`<wcs-ambient-light-sensor>` は単一の `illuminance` スカラーを公開（ブラウザ対応が最も弱く、フィンガープリンティング対策で無効化しているブラウザもある）。4つとも権限状態を重複させず `<wcs-permission name="...">` と組み合わせ、ガード付きセンサーコンストラクタ呼び出し以外に `_gen` ガードは不要（同期的な start/stop）。
- [`@wcstack/notification`](packages/notification/) — `<wcs-notify>` でデスクトップ通知を宣言的に。command-token（`notify`）で表示し、event-token（`clicked`）でクリックを受け取る — 双方向を1タグで。権限は自己完結、モバイル向けに Service Worker フォールバック。
- [`@wcstack/defined`](packages/defined/) — `<wcs-defined>` でカスタム要素の準備完了を。タグ集合の `whenDefined()` を監視し `defined`/`pending`/`missing`/`count`/`total` 状態を公開、タイムアウトによる読み込み失敗検知付き。autoloader の相棒で、CSS `:defined` にできないことを実現。
- [`@wcstack/camera`](packages/camera/) — `<wcs-camera>`（getUserMedia + 組み込みプレビュー）と `<wcs-recorder>`（MediaRecorder）でカメラ撮影・録画を宣言的に。ライブな `MediaStream` は command-token 引数で要素へ直接バインドし、**シリアライズ可能な状態には決して格納しない** — 派生値（権限、録画フラグ、録画した `Blob`/URL）だけが状態を流れる。
- [`@wcstack/signals`](packages/signals/) — シグナルベースのきめ細かいリアクティブ**コア**（`@wcstack/state` の JS ファースト版）。`signal`/`computed`/`effect`、非同期の `resource`/`streamResource`、keyed な `For`/`Index`、同じ wc-bindable IO ノードをシグナル経由で駆動する `bindNode` アダプタ。TC39-Signals 準拠、依存ゼロ。
- [`wcstack-intellisense`](packages/vscode-wcs/) — `<wcs-state>` インラインスクリプト向けの VS Code 言語サポート拡張。

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>
<body>

<wcs-state>
  <script type="module">
    export default {
      count: 0,
      countUp() { this.count++; }
    };
  </script>
</wcs-state>

<p>Count: {{ count }}</p>
<button data-wcs="onclick: countUp">+1</button>

</body>
</html>
```

`<script>` タグ1つ。カスタム要素1つ。あとはHTML。以上。

---

## コンポーネント状態で CSS を切り替える — `:state()`

全 I/O ノードは boolean の出力状態（`loading` / `connected` / `error` / `granted` など）を [CustomStateSet](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet) に反映します。JavaScript を書かずに、CSS だけでコンポーネントの状態に反応できます:

```css
wcs-fetch:state(loading) ~ .spinner    { display: block; }
form:has(wcs-fetch:state(error)) .msg  { display: block; }
wcs-ws:state(connected) ~ .indicator   { color: limegreen; }
wcs-permission:state(denied) ~ .help   { display: block; }
```

各パッケージの README に反映される状態の一覧があります。対応ブラウザは Chrome/Edge 125+・Safari 17.4+・Firefox 126+。非対応ブラウザではスタイルが当たらないだけで、コンポーネントの機能は完全に動作します。SSR 出力には状態がシリアライズされません（初期描画のスタイリングには `wcs-x:not(:defined)` を併用してください）。

デバッグ時はタグに `debug-states` 属性を付けると、状態が `data-wcs-state-*` 属性としてミラーされ、DevTools の Elements パネルでリアルタイムに観測できます（`debugStates` プロパティでも読めます）。本番の CSS はこの属性ではなく `:state()` に書いてください。

---

## プロジェクト構成

```
wcstack/
├── packages/
│   ├── state/         # @wcstack/state
│   ├── router/        # @wcstack/router
│   ├── fetch/         # @wcstack/fetch
│   ├── autoloader/    # @wcstack/autoloader
│   ├── server/        # @wcstack/server
│   ├── storage/       # @wcstack/storage
│   ├── timer/         # @wcstack/timer
│   ├── raf/           # @wcstack/raf
│   ├── geolocation/   # @wcstack/geolocation
│   ├── websocket/     # @wcstack/websocket
│   ├── upload/        # @wcstack/upload
│   ├── debounce/      # @wcstack/debounce
│   ├── clipboard/     # @wcstack/clipboard
│   ├── broadcast/     # @wcstack/broadcast
│   ├── worker/        # @wcstack/worker
│   ├── sse/           # @wcstack/sse
│   ├── intersection/  # @wcstack/intersection
│   ├── wakelock/      # @wcstack/wakelock
│   ├── resize/        # @wcstack/resize
│   ├── speech/        # @wcstack/speech
│   ├── permission/    # @wcstack/permission
│   ├── network/       # @wcstack/network
│   ├── screen-orientation/     # @wcstack/screen-orientation
│   ├── fullscreen/             # @wcstack/fullscreen
│   ├── picture-in-picture/     # @wcstack/picture-in-picture
│   ├── pointer-lock/           # @wcstack/pointer-lock
│   ├── share/                  # @wcstack/share
│   ├── eyedropper/             # @wcstack/eyedropper
│   ├── contacts/               # @wcstack/contacts
│   ├── credential/             # @wcstack/credential
│   ├── idle/                   # @wcstack/idle
│   ├── tilt/                   # @wcstack/tilt
│   ├── accelerometer/          # @wcstack/accelerometer
│   ├── gyroscope/              # @wcstack/gyroscope
│   ├── magnetometer/           # @wcstack/magnetometer
│   ├── ambient-light-sensor/   # @wcstack/ambient-light-sensor
│   ├── notification/  # @wcstack/notification
│   ├── defined/       # @wcstack/defined
│   ├── camera/        # @wcstack/camera
│   ├── signals/       # @wcstack/signals
│   └── vscode-wcs/    # wcstack-intellisense (VS Code拡張)
```

各パッケージは独立してビルド・テスト・公開されます。

`examples/` 配下のデモは、このリポジトリに残っている package に対応します。旧 AI/Auth0 デモは `@csbc-dev/ai-agent` と `@csbc-dev/auth0` へ移動したため、このリポジトリには含めていません。従来の npm package である `@wcstack/ai` と `@wcstack/auth0` は deprecated 扱いです。

## 開発

各パッケージのディレクトリ内で実行します（例: `packages/state/`）:

```bash
npm run build            # dist削除、TypeScriptコンパイル、Rollupバンドル
npm test                 # テスト実行 (Vitest)
npm run test:coverage    # カバレッジ（statements/functions/lines は100%、branches は97%以上）
npm run lint             # ESLint
```

## License

MIT
