# @wcstack/credential

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/credential` は wcstack エコシステム向けのヘッドレスな Credential Management コンポーネントです。

視覚的な UI ウィジェットではありません。`navigator.credentials.get()`/`.store()` を宣言的コマンド+観測可能stateに変える**非同期プリミティブノード**で、`@wcstack/share`が確立したバッチ3の「薄いcommand」アーキタイプを再利用します。

`@wcstack/state` と組み合わせると、`<wcs-credential>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `get(options)`/`store(credential)`の引数は呼び出しごと
- **command サーフェス**: `get`、`store`、そして 4.25 から `preventSilentAccess`（サインアウト）
- **出力 state サーフェス**: `value`、`loading`、`error`、`cancelled`、そして 4.25 から `supported`

## なぜ存在するか — password/federatedのみ、WebAuthnは明示的にスコープ外

`navigator.credentials`は3種類の資格情報（`password`、`federated`、`publicKey`/WebAuthn）を1つの`get()`/`store()`サーフェスで統一的に扱います。**本パッケージのv1は`publicKey`を完全に除外します。** WebAuthnはattestation・authenticator選択・platform vs cross-platform・RP設定等、遥かに大きなサーフェスであり、専用の別ノードに値します。呼び出し元が`publicKey`オプションを渡した場合、プラットフォームAPIへは**転送せず**、スコープ違反の`error`として表面化させます——本パッケージが誤ってWebAuthnの裏口になることを防ぎます。

> **user gesture不要。** `@wcstack/share`/`@wcstack/fullscreen`と異なり、`navigator.credentials.get()`はuser gestureを必要としません——このノードはページロード時に自動的に呼び出し「サイレントサインイン」フロー（`get({ password: true, mediation: "silent" })`）を実現できます。

> **`get()`/`store()`は1つの operation lane（`latest`）を共有します** — v1で許容される簡略化です。実際の認証フローではこの2つは逐次的に使われる（ログイン成功後にstoreする、試行前にgetする）ため、同一要素で自然に並行呼び出しされることは想定しにくいです。もし両方が同一の`<wcs-credential>`に対して並行して起動されたら、後の呼び出しが前の呼び出しを追い越します: 前の呼び出しの完了は何も書かずに捨てられ、そのpromiseは`null`でresolveします。実際にこれが問題になったら、Core自体を作り直すのではなく**2つの別々の`<wcs-credential>`インスタンス**（1つはget用、1つはstore用）を使ってください——`docs/multi-promise-io-node-design.md`参照。

## インストール

```bash
npm install @wcstack/credential
```

## 対応ブラウザ

4.25 から、この要素はどこで動くかを出力 `supported` で言います。

| ブラウザ | パスワード資格情報 | `supported` |
| -------- | ------------------ | ----------- |
| Chrome・Edge ほか Chromium 系（デスクトップと Android） | あり | `true` |
| Firefox・Safari ほか WebKit 系（macOS と iOS） | 無し — `navigator.credentials` は WebAuthn 用にあるが、`PasswordCredential` クラスが無い | `false` |

つまりこの要素は Chromium 向けの上乗せで、サインインのフォームはこれ無しで動かなければなりません。フォームは、どのブラウザでもパスワードマネージャーが埋められる形にしておきます: 本物の `<form>`、名前やメールアドレスの欄に `autocomplete="username"`、パスワードの欄に `autocomplete="current-password"`（アカウントを作る画面では `"new-password"`）。`supported` が `false` のところでは、パスワードを求める `get()` と `store()` はその場で `capability-missing` で終わります — ブラウザには聞きません。`preventSilentAccess()` は、ブラウザにそのメソッドがあれば（Firefox と Safari にはあります）そのまま渡し、無ければエラーにせず何もしません。

## クイックスタート

### サインイン・サインインの維持・サインアウト

```html
<script type="module" src="https://esm.run/@wcstack/credential/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["getCredential", "storeCredential", "forgetSignIn"],
      $eventTokens: ["credentialArrived"],
      userId: "",             // サインインしている人 — パスワードは持たない
      email: "",
      password: "",
      signInFailed: false,
      canSave: false,         // <wcs-credential> の `supported`
      get signedIn() {
        return this.userId !== "";
      },

      $watch: {
        // ここではパスワード資格情報が使える: 読み込み時に、保存済みのものを UI 無しで求める。
        canSave(supported) {
          if (supported && !this.signedIn) {
            this.$command.getCredential.emit({ password: true, mediation: "silent" });
          }
        },
      },

      $on: {
        // get() が答えた。資格情報はここからサーバーへ渡り、state には書かれない。
        // （store() も 1 つエコーするが、その時点ではもうサインイン済み。）
        credentialArrived(state, event) {
          const credential = event.detail.value;
          if (credential && !state.signedIn) {
            state.signInWith(credential.id, credential.password, false);
          }
        },
      },

      onSubmit() {
        this.signInWith(this.email, this.password, true);
      },

      async signInWith(id, password, offerToSave) {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, password }),
        });
        this.signInFailed = !response.ok;
        if (!response.ok) return;
        this.userId = id;
        this.password = "";
        // ここで初めて — サーバーがこの組を受け入れたので — 保存を持ちかける（できるところでだけ）。
        if (offerToSave && this.canSave) this.$command.storeCredential.emit({ id, password });
      },

      async signOut() {
        await fetch("/api/session", { method: "DELETE" });
        this.userId = "";
        // これが無いと、次に開いたときのサイレント get() が、そのままサインインし直してしまう。
        this.$command.forgetSignIn.emit();
      },
    };
  </script>
</wcs-state>

<wcs-credential
  data-wcs="
    command.get: $command.getCredential;
    command.store: $command.storeCredential;
    command.preventSilentAccess: $command.forgetSignIn;
    eventToken.value: credentialArrived;
    supported: canSave
  "
></wcs-credential>

<template data-wcs="if: signedIn|not">
  <form data-wcs="onsubmit#prevent: onSubmit">
    <input type="email" autocomplete="username" required data-wcs="value: email">
    <input type="password" autocomplete="current-password" required data-wcs="value: password">
    <button>サインイン</button>
    <p data-wcs="hidden: signInFailed|not">メールアドレスかパスワードが違います。</p>
  </form>
</template>
<template data-wcs="if: signedIn">
  <p><span data-wcs="textContent: userId"></span> としてサインイン中。</p>
  <button data-wcs="onclick: signOut">サインアウト</button>
</template>
```

それぞれの部分の役割:

- **読み込み時のサイレントサインイン。** パスワード資格情報のあるブラウザでは `supported` が `true` で届き、`$watch` が 1 回走り、`get({ password: true, mediation: "silent" })` が保存済みの資格情報か `null` で resolve します — 何も表示しません。Firefox と Safari では `supported` は `false` のままで、何も求めず、フォームがそこにあるだけです。このコマンドは `$connectedCallback` からではなく、その `$watch` から emit します: `supported` が届くのは要素が定義され束縛された後で、`command.` の束縛が張られる前に emit したコマンドは失われるからです（`[wcs/command-token-unbound]`）。
- **保存は、サーバーが受け入れた後。** `store()` は `POST /api/session` が成功してから呼び、その前には呼びません: ブラウザは渡されたものをそのまま保存しようとするので、打ち間違えたパスワードを一度保存すると、開くたびにそれが返ってきます。4.25 から `store()` は素の `{ id, password }` を取ります。4.24 までは、自分で作った `PasswordCredential` を渡します。
- **サインアウトは `preventSilentAccess()` を呼ぶ**（4.25 から）。これが無いと、ブラウザは次の読み込みでまた資格情報を渡し、サインアウトしたばかりの利用者がサインインし直されます。
- **パスワードは state のツリーに入らない。** 資格情報はイベント（`eventToken.value`）から受け取り、そのまま渡します。[`value` はパスワードを運ぶ](#value-はパスワードを運ぶ) を参照。

### `value` はパスワードを運ぶ

`value` は、ブラウザが渡した（または `store()` が保存した）`Credential` オブジェクトです。パスワード資格情報の場合、そのオブジェクトは `value.password` にパスワードを平文で持ちます。束縛する — `value: credential` — と、それが state のツリーに入り、ツリーを読むものすべてから見えます: DevTools、親のパスに束縛した `<wcs-storage>`、SSR のスナップショット、state のログ。`value` は、それを意図するところでだけ束縛してください。資格情報を通りすがりに使うには、上のようにイベントから受け取るか、ページに要るものだけを残します:

```js
$on: {
  credentialArrived(state, event) {
    state.savedId = event.detail.value?.id ?? "";   // 資格情報ではなく id だけ
  },
},
```

## 観測可能プロパティ（出力）

| プロパティ  | イベント                          | 説明 |
| ----------- | ----------------------------------- | ---- |
| `value`     | `wcs-credential:complete`           | 取得/保存された資格情報、成功前は`null`（`get()`が見つけなかったときも`null`）。パスワード資格情報はパスワードを運びます — [`value` はパスワードを運ぶ](#value-はパスワードを運ぶ)を参照。 |
| `loading`   | `wcs-credential:loading-changed`    | `get()`/`store()`呼び出し中は`true`。 |
| `error`     | `wcs-credential:error`              | 真のプラットフォーム失敗（正規化された`{ name, message }`）、無ければ`null`。 |
| `cancelled` | `wcs-credential:cancelled-changed`  | ユーザーがブラウザのアカウント選択UIを閉じたら`true`（Credential Management APIは`NotAllowedError`でrejectする）。`error`には含めない。 |
| `errorInfo` | `wcs-credential:error-info-changed` | serializable な失敗 taxonomy（安定 `code` / `phase` / `recoverable`）、または `null`。追加的で `error` の shape は不変。`code` は `capability-missing`（unsupported）・`out-of-scope`（`publicKey`/WebAuthn 試行）・`credential-failed`（真の失敗）。`NotAllowedError` のキャンセルは `cancelled` であり `errorInfo` ではない。 |
| `supported` | `wcs-credential:supported-changed`  | 4.25 から。このページでパスワード資格情報を使えるなら`true`。下記参照。 |

**`supported`**（4.25 から）は、`navigator.credentials` があり、**かつ** `PasswordCredential` がクラスであるときに `true` です — [対応ブラウザ](#対応ブラウザ)を参照。値は読まれるたびにブラウザから読むので、束縛は張られた時点で正しい値を受け取ります。要素は接続されたときにも、最後に流した値（初期値は `false`）と違っていれば `wcs-credential:supported-changed`（`detail` は boolean）を流します。このサイトの資格情報が保存されていることも、利用者がそれを選ぶことも**言いません**: それに答えるのは `get()` です。

**非対応は `capability-missing` であって、失敗ではありません。** 4.25 から、`PasswordCredential` の無いところでは、`password` か `federated` を求める `get()` と、すべての `store()` が、ブラウザを呼ばずに終わります: `error` は `{ name: "NotSupportedError", message: "Password credentials are not supported in this browser." }`、`errorInfo` は `{ code: "capability-missing", phase: "start", recoverable: false, capabilityId: "web.password-credential", … }` です。4.24 までは、呼び出しがブラウザに渡り、`recoverable: true` の `credential-failed` として返っていました — 決してできないブラウザで、ページがやり直そうとする失敗です。`navigator.credentials` 自体が無いところでは、これまでどおり `error` は `{ message: "Credential Management API is not supported in this browser." }`（`capabilityId: "web.credentials"`）です。

**並行制御。** `get()` と `store()` は 1 つの io-core lane を `latest` policy で共有する:
後発の呼び出しが先発を **supersede** する（実際の認証フローでは順次利用される — ログイン後に
store、その前に get — 並行ではない）。並行実行時は後発の結果が勝つ。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `get`    | はい   | `get(options)` — `options.publicKey`はスコープ違反として拒否（転送しない、上記参照）。never-throw: `NotAllowedError`（ユーザーがアカウント選択UIを閉じた）は`cancelled`へ、それ以外は`error`へ。資格情報、無ければ`null`でresolveします。4.25 から、`get(null)`と`get()`は投げずに、何も求めない呼び出しになります。 |
| `store`  | はい   | `store(credential)` — `Credential`のインスタンス、または 4.25 から素の`{ id, password, name?, iconURL? }`。後者からは、与えられたメンバーで要素が`new PasswordCredential(...)`を作ります。`value`は保存した資格情報をエコーバック（`navigator.credentials.store()`自体は`Promise<void>`でresolveするため）。 |
| `preventSilentAccess` | はい | 4.25 から。サインアウト: `navigator.credentials.preventSilentAccess()`を呼びます。以後、利用者がもう一度サインインするまで、`get({ mediation: "silent" })`は資格情報を渡しません。引数無し。成功すると`error`を消し、rejectは`error` / `errorInfo`（`credential-failed`）に入ります。ブラウザにこのメソッドが無いところでは、何もせずにresolveします — サインアウトはどこでも動きます。`value`にも`loading`にも触れず、laneも通りません: 進行中の`get()` / `store()`を追い越さず、追い越されもしません。 |

**`store()` と素のデータ**（4.25 から）。state のメソッドが持っているのは文字列の id とパスワードであって、`PasswordCredential` — Chromium にしか無いクラス — ではありません。そこで `store({ id, password })` がそれを作ります: 引数が `Credential` のインスタンスではなく、`id` と `password` が文字列なら、要素は `new PasswordCredential({ id, password })` を保存し、`name` と `iconURL` は与えられていれば足します。それ以外のものは、そのままブラウザに渡します。コンストラクタが投げた場合（空の `id`）は、ほかの失敗と同じく `error` で終わります。

> **`get` と `store` はボタンに直結せず、state のメソッドを通して配線してください。** `<button data-wcs="onclick: $command.getCredential">` は DOM イベントを第 1 引数にしてトークンを emit するので、要素は `get(event)` として呼ばれ — 何も求めない options なので `null` で resolve します — `store(event)` はブラウザが `TypeError` で拒否します。これらのコマンドが取るのはデータです。メソッドから emit してください（`this.$command.getCredential.emit({ password: true })`）。`preventSilentAccess` は引数を取らないので、`onclick: $command.forgetSignIn` で構いません。

## 属性 / 入力

**無し。**

## `:state()` による CSS スタイリング

`<wcs-credential>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `loading` | `wcs-credential:loading-changed` が `true` で発火（`false` でクリア） |
| `cancelled` | `wcs-credential:cancelled-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-credential:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-credential:state(loading) ~ .spinner   { display: block; }
wcs-credential:state(cancelled) ~ .hint    { display: block; }
form:has(wcs-credential:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-credential>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-credential:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-loading` / `data-wcs-state-cancelled` / `data-wcs-state-error`
  属性にミラーします。Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-credential debug-states></wcs-credential>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **Chromium 限定です** — [対応ブラウザ](#対応ブラウザ)を参照。`supported` を束縛し、パスワードマネージャーが埋められるフォームを残してください。
- **WebAuthn（`publicKey`）はv1スコープ外です** — 将来の`<wcs-webauthn>`ノードで対応予定。
- **`get()`/`store()`は1つの operation lane を共有します** — 並行呼び出しの注意点と回避策は上記「なぜ存在するか」参照。
- `@wcstack/share`/`@wcstack/eyedropper`/`@wcstack/contacts`とアーキタイプを共有: never-throw、AbortController無し。

## ヘッドレス利用（`CredentialCore`）

```typescript
import { CredentialCore } from "@wcstack/credential";

const core = new CredentialCore();
core.addEventListener("wcs-credential:complete", (e) => {
  console.log((e as CustomEvent).detail.value);
});

const credential = await core.get({ password: true });
core.dispose();
```

4.25 から: `core.supported` はいつでも読めます。`core.observe()` は、最後に流した値と違っていれば `wcs-credential:supported-changed` を流します。`core.store({ id, password })` は `PasswordCredential` を作り、`await core.preventSilentAccess()` がサインアウトです。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## ライセンス

MIT
