# state + auth0 + router demo

A local demo combining `@wcstack/state`, `@wcstack/auth0`, and `@wcstack/router` into an authentication-guarded SPA.
A route guard protects `/dashboard` so only authenticated users can access it.

## Routes

| Path | Content | Guard |
|------|---------|-------|
| `/` | Landing page (login button, config display) | None |
| `/dashboard` | Auth State & User Profile | Redirects to `/` unless `authenticated` is `true` |

## What it uses

- `@wcstack/state` via CDN (`esm.run`)
- `@wcstack/auth0` via CDN (`esm.run`)
- `@wcstack/router` via CDN (`esm.run`)
- `@auth0/auth0-spa-js` via CDN (`esm.run`, resolved through import map)

## Setup

```bash
# Start the demo server with your Auth0 application settings
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

- `<wcs-route guard="/">` with `guardHandler` for authentication-based route protection
- `<wcs-link>` for page navigation with automatic active class
- `<wcs-head>` for per-route title management
- `authenticated`, `user`, `token`, `loading`, and `error` bound from `<wcs-auth>` into `<wcs-state>`
- login triggered from state via `trigger`
- SPA fallback (directly opening `/dashboard` works correctly)
- CDN import map resolution for `@auth0/auth0-spa-js`
