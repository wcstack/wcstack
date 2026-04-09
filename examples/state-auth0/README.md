# state + auth0 demo

A local demo combining `@wcstack/state` and `@wcstack/auth0` into an authentication interface.

## What it uses

- `@wcstack/state` via CDN (`esm.run`)
- `@wcstack/auth0` via CDN (`esm.run`)
- `@auth0/auth0-spa-js` via CDN (`esm.run`, resolved through import map)

## Setup

```bash
# Start the demo server with your Auth0 application settings
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
- CDN import map resolution for `@auth0/auth0-spa-js`
