// The browser tests' ports (playwright.config.ts and the fixtures read them). The example's port base is 8500:
// the repository's e2e spec (e2e/tests/lending-desk.spec.ts) runs a static server on 8500 + 10 × the worker
// index and the API on the next port; `npm run check` here uses 8505–8507, so both can run at once. The
// everyday `npm run dev` / `npm start` use 3000 (static), 3001 (API) and 5173 (Vite).
export const PROD = 8505;
export const API = 8506;
export const DEV = 8507;
