# @wcstack/credential

`@wcstack/credential` は wcstack エコシステム向けのヘッドレスな Credential Management コンポーネントです。

視覚的な UI ウィジェットではありません。`navigator.credentials.get()`/`.store()` を宣言的コマンド+観測可能stateに変える**非同期プリミティブノード**で、`@wcstack/share`が確立したバッチ3の「薄いcommand」アーキタイプを再利用します。

`@wcstack/state` と組み合わせると、`<wcs-credential>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `get(options)`/`store(credential)`の引数は呼び出しごと
- **出力 state サーフェス**: `value`、`loading`、`error`、`cancelled`

## なぜ存在するか — password/federatedのみ、WebAuthnは明示的にスコープ外

`navigator.credentials`は3種類の資格情報（`password`、`federated`、`publicKey`/WebAuthn）を1つの`get()`/`store()`サーフェスで統一的に扱います。**本パッケージのv1は`publicKey`を完全に除外します。** WebAuthnはattestation・authenticator選択・platform vs cross-platform・RP設定等、遥かに大きなサーフェスであり、専用の別ノードに値します。呼び出し元が`publicKey`オプションを渡した場合、プラットフォームAPIへは**転送せず**、スコープ違反の`error`として表面化させます——本パッケージが誤ってWebAuthnの裏口になることを防ぎます。

> **user gesture不要。** `@wcstack/share`/`@wcstack/fullscreen`と異なり、`navigator.credentials.get()`はuser gestureを必要としません——このノードはページロード時に自動的に呼び出し「サイレントサインイン」フロー（`get({ mediation: "silent" })`）を実現できます。

> **`get()`/`store()`は単一の`_gen`世代ガードを共有します** — v1で許容される簡略化です。実際の認証フローではこの2つは逐次的に使われる（ログイン成功後にstoreする、試行前にgetする）ため、同一要素で自然に並行呼び出しされることは想定しにくいです。もし両方が同一の`<wcs-credential>`に対して並行して起動されたら、後の呼び出しの完了が前の呼び出しの結果を黙って上書きします。実際にこれが問題になったら、Core自体を作り直すのではなく**2つの別々の`<wcs-credential>`インスタンス**（1つはget用、1つはstore用）を使ってください——`docs/multi-promise-io-node-design.md`参照。

## インストール

```bash
npm install @wcstack/credential
```

## クイックスタート

### 1. ページロード時のサイレントサインイン

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/credential/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      user: null,
      async trySilentSignIn() {
        const el = document.querySelector("wcs-credential");
        const credential = await el.get({ password: true, mediation: "silent" });
        if (credential) this.user = credential;
      },
    };
  </script>
</wcs-state>

<wcs-credential data-wcs="value: user"></wcs-credential>
```

### 2. ログイン成功後に資格情報を保存する

```html
<wcs-credential data-wcs="command.store: $command.saveCredential"></wcs-credential>
```

## 観測可能プロパティ（出力）

| プロパティ  | イベント                          | 説明 |
| ----------- | ----------------------------------- | ---- |
| `value`     | `wcs-credential:complete`           | 取得/保存された資格情報、成功前は`null`。 |
| `loading`   | `wcs-credential:loading-changed`    | `get()`/`store()`呼び出し中は`true`。 |
| `error`     | `wcs-credential:error`              | 真のプラットフォーム失敗（正規化された`{ name, message }`）、無ければ`null`。 |
| `cancelled` | `wcs-credential:cancelled-changed`  | ユーザーがブラウザのアカウント選択UIを閉じたら`true`。 |

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `get`    | はい   | `get(options)` — `options.publicKey`はスコープ違反として拒否（転送しない、上記参照）。never-throw: AbortErrorは`cancelled`へ、それ以外は`error`へ。 |
| `store`  | はい   | `store(credential)` — `value`は入力した資格情報をそのままエコーバック（`navigator.credentials.store()`自体は`Promise<void>`でresolveするため）。 |

## 属性 / 入力

**無し。**

## 注意・制限

- **WebAuthn（`publicKey`）はv1スコープ外です** — 将来の`<wcs-webauthn>`ノードで対応予定。
- **`get()`/`store()`は単一の`_gen`を共有します** — 並行呼び出しの注意点と回避策は上記「なぜ存在するか」参照。
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

## ライセンス

MIT
