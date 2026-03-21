# state + fetch demo

A demo integrating `@wcstack/state` and `@wcstack/fetch`. It demonstrates fetching a user list, filtering by role, viewing user details, and creating new users via POST.

## Getting Started

```bash
# 1. Build each package
cd packages/state && npm run build && cd ../..
cd packages/fetch && npm run build && cd ../..

# 2. Start the demo server
node examples/state-fetch/server.js
```

Open http://localhost:3000 in your browser.

## Features

- **User List**: Fetches data from `/api/users` and renders a list
- **Role Filter**: Filter by All / Admin / Editor / Viewer
- **Detail View**: Click a user to fetch details from `/api/users/:id`
- **Create User**: Submit a form to POST a new user; the list auto-reloads on success
