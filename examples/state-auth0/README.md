# state + auth0 demo

A local demo showing how `@wcstack/state` consumes `@wcstack/auth0` state without using any CDN assets.

## What it uses

- `/packages/state/dist/auto.js`
- `/packages/auth0/dist/auto.js`
- `/examples/state-auth0/node_modules/@auth0/auth0-spa-js/dist/auth0-spa-js.production.esm.js`

## Setup

```bash
# 1. Build the packages used by the demo
cd packages/state && npm run build && cd ../..
cd packages/auth0 && npm run build && cd ../..

# 2. Install the local Auth0 SDK dependency used by the import map
cd examples/state-auth0 && npm install && cd ../..

# 3. Start the demo server with your Auth0 application settings
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

Open `http://localhost:3100`.

## Required Auth0 settings

- Allowed Web Origins: `http://localhost:3100`
- Allowed Logout URLs: `http://localhost:3100/`

If you set `AUTH0_POPUP=false`, also add:

- Allowed Callback URLs: `http://localhost:3100/`

## Environment variables

- `AUTH0_DOMAIN`: required
- `AUTH0_CLIENT_ID`: required
- `AUTH0_AUDIENCE`: optional
- `AUTH0_SCOPE`: optional, defaults to `openid profile email`
- `AUTH0_POPUP`: optional, defaults to `true`
- `AUTH0_RETURN_TO`: optional, defaults to `http://localhost:3100/`
- `PORT`: optional, defaults to `3100`

## What the demo shows

- `authenticated`, `user`, `token`, `loading`, and `error` bound from `<wcs-auth>` into `<wcs-state>`
- login triggered from state via `trigger`
- logout triggered declaratively with `<wcs-auth-logout>`
- local import map resolution for `@auth0/auth0-spa-js`
