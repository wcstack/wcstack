# state + auth0 demo

`@wcstack/state` と `@wcstack/auth0` を組み合わせた、認証のローカルデモです。

## 使用パッケージ

- `@wcstack/state` — CDN (`esm.run`) 経由
- `@wcstack/auth0` — CDN (`esm.run`) 経由
- `@auth0/auth0-spa-js` — CDN (`esm.run`) 経由（import map で解決）

## 起動手順

```bash
# Auth0 設定を環境変数で渡して起動
# PowerShell
$env:AUTH0_DOMAIN='your-tenant.us.auth0.com'
$env:AUTH0_CLIENT_ID='your-client-id'
$env:AUTH0_AUDIENCE='https://api.example.com'
node examples/state-auth0/server.js

# Bash
AUTH0_DOMAIN=your-tenant.us.auth0.com \
AUTH0_CLIENT_ID=your-client-id \
AUTH0_AUDIENCE=https://api.example.com \
node examples/state-auth0/server.js
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

- `<wcs-auth>` の `authenticated` / `user` / `token` / `loading` / `error` を `<wcs-state>` に束縛
- `trigger` を使った state 起点のログイン
- `<wcs-auth-logout>` を使った宣言的ログアウト
- `@auth0/auth0-spa-js` を import map で CDN 解決
