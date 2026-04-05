# state + auth0 + router demo

`@wcstack/state`・`@wcstack/auth0`・`@wcstack/router` を組み合わせた、CDN 非依存のローカルデモです。
ルートガードで `/dashboard` を保護し、認証済みユーザーだけがアクセスできるようにしています。

## ルート構成

| パス | 内容 | ガード |
|------|------|--------|
| `/` | ランディング（ログインボタン・設定表示） | なし |
| `/dashboard` | Auth State・User Profile | `authenticated` が `true` でなければ `/` へリダイレクト |

## 使用するローカルパス

- `/packages/state/dist/auto.js`
- `/packages/auth0/dist/auto.js`
- `/packages/router/dist/auto.js`
- `/examples/state-auth0-router/node_modules/@auth0/auth0-spa-js/dist/auth0-spa-js.production.esm.js`

## 起動手順

```bash
# 1. デモが使うパッケージをビルド
cd packages/state && npm run build && cd ../..
cd packages/auth0 && npm run build && cd ../..
cd packages/router && npm run build && cd ../..

# 2. import map で使う Auth0 SDK をインストール
cd examples/state-auth0-router && npm install && cd ../..

# 3. Auth0 設定を環境変数で渡して起動
# PowerShell
$env:AUTH0_DOMAIN='your-tenant.us.auth0.com'
$env:AUTH0_CLIENT_ID='your-client-id'
$env:AUTH0_AUDIENCE='https://api.example.com'
node examples/state-auth0-router/server.js

# Bash
AUTH0_DOMAIN=your-tenant.us.auth0.com \
AUTH0_CLIENT_ID=your-client-id \
AUTH0_AUDIENCE=https://api.example.com \
node examples/state-auth0-router/server.js
```

ブラウザで `http://localhost:3100` を開いてください。

## Auth0 側で必要な設定

- Allowed Web Origins: `http://localhost:3100`
- Allowed Logout URLs: `http://localhost:3100/`

`AUTH0_POPUP=false` でリダイレクトログインにする場合は、追加で以下も設定してください。

- Allowed Callback URLs: `http://localhost:3100/`

## 環境変数

- `AUTH0_DOMAIN`: 必須
- `AUTH0_CLIENT_ID`: 必須
- `AUTH0_AUDIENCE`: 任意
- `AUTH0_SCOPE`: 任意。未指定時は `openid profile email`
- `AUTH0_POPUP`: 任意。既定値は `true`
- `AUTH0_RETURN_TO`: 任意。未指定時は `http://localhost:3100/`
- `PORT`: 任意。既定値は `3100`

## このデモで確認できること

- `<wcs-route guard="/">` と `guardHandler` による認証ガード
- `<wcs-link>` によるページ間ナビゲーション（active クラス自動付与）
- `<wcs-head>` によるルートごとのタイトル切り替え
- `<wcs-auth>` の `authenticated` / `user` / `token` / `loading` / `error` を `<wcs-state>` に束縛
- `trigger` を使った state 起点のログイン
- SPA フォールバック（`/dashboard` を直接開いても動作）
- `@auth0/auth0-spa-js` を import map でローカル解決
