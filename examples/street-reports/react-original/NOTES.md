# NOTES — みどり市 道路・公園の不具合 受付台帳

## How to run

```
npm install
npm run build:react                      # → react-app/dist
npm run start:react                      # PORT=5800, APP_DIR=react-app/dist
npm run e2e:react                        # chromium (default)
npm run e2e:react -- --project=firefox   # or --project=webkit
npm run unit:react                       # Vitest
npm run dev:react                        # Vite dev server on 5815, proxies /api and /photos to 5800
```

## Versions installed

| package | version | kind |
|---|---|---|
| react / react-dom | 19.3.1 | runtime |
| react-router | 8.5.3 (current major) | runtime |
| vite | 8.3.8 | dev |
| @vitejs/plugin-react | 6.3.0 | dev |
| vitest | 5.1.1 | dev |
| jsdom | 29.1.1 | dev |
| @testing-library/react / dom / user-event | 16.3.3 / 10.4.2 / 14.6.13 | dev |
| @playwright/test | 1.61.1 (exact) | dev |

Node 22.19.0, npm 11.19.1. React Router 8 declares Node ≥ 22.22 in `engines`; it builds and runs fine on
22.19 (we only use the browser bundle), but upgrade Node if npm's engine warnings matter to you.

One root `package.json` holds every dependency; `react-app/vite.config.js` sets the Vite root and the
Vitest config.

## Choices

**App structure** (`react-app/src`, ~2,300 lines without tests)
- `lib/` is framework-free: `api.js` (fetch client, `ApiError`), `format.js` (dates always in
  Asia/Tokyo through `Intl`, so output does not depend on the machine's time zone), `validation.js`,
  `stats.js` (aggregation and sorting), `labels.js`.
- `hooks/`: `useFetch` (GET in `useEffect`, an `AbortController` per request, and a result applied only
  if it matches the latest url and attempt; old data stays visible while the next request runs),
  `useDebouncedValue`, `useLocalStorage` (JSON plus `storage` event sync across tabs),
  `useDocumentTitle`, `useDelayedFlag` (shows 読み込み中… only after 250 ms), `useNow` (ticks every 10 s),
  `useEventSource` (uses `useEffectEvent`), `useBeforeUnloadGuard`.
- Context: `ThemeContext`, `StaffContext` (staff list plus the current member, kept in localStorage),
  `ToastContext` (`useReducer` queue, portal), `ReportsStore` (`useReducer` summary behind the badge).
  React 19 `<Context value>` and `use(Context)`.
- Routing: `createBrowserRouter` + `RouterProvider`. Components fetch their own data (no loaders or
  actions). The stats route uses `React.lazy` + `Suspense`. The route error boundary sits inside the
  layout, so the header stays usable when a page fails.
- **Error boundary reset**: 再読み込み resets it, and so does a change of *pathname*. A change of search
  only does not reset it, so `/stats?boom=1` → nav 統計 (`/stats`) still shows the fallback until
  再読み込み is clicked. That is how the spec's "再読み込み recovers after the URL no longer has boom"
  can be tested.
- **Detail page** is keyed by id (`<ReportDetail key={id}>`), so each report starts from clean state and
  the old request is aborted on unmount. While a report is loading, 前の通報 / 次の通報 point to id−1 /
  id+1. Ids are contiguous and the API has no delete, and this lets staff keep flipping quickly; once
  the report loads, the server's `prevId` / `nextId` replace them.
- **Optimistic updates** (detail PATCH, board moves, bulk): the UI changes first, the badge counts move
  optimistically too, and a failure rolls back and shows the toast 更新に失敗しました. A `409` replaces
  the local values with the server's (detail: a notice 他の職員が更新しました).
- **Event streams (header badge vs. board)**: two independent subscriptions. `ReportsStore` holds one
  `EventSource` for the whole session (every `report` event refetches `/api/reports/summary`; the
  previous refetch is aborted). The board opens its **own** `EventSource` while mounted and closes it on
  unmount. So the server sees 1 open stream off the board and 2 on it. The e2e checks exactly that over
  three round trips. Both also close on `pagehide` and reopen on a bfcache `pageshow`.
  Own changes are reflected immediately (optimistic delta) and confirmed by the stream's refetch.
- **Toast limit**: "at most 3 visible (older ones wait)". I read this as a FIFO queue: the three oldest
  are shown, later ones wait for a free slot, the newest is last, and each toast's 4 s timer starts when
  it becomes visible.
- **新着**: the threshold is read once on mount (`useState` initializer) from
  `street-reports:lastSeen`, and the list's unmount cleanup writes "now". This works under StrictMode's
  simulated unmount, and nothing is written while the list is shown.
- **Search**: the text is local state, and once it settles (`useDebouncedValue`, 300 ms) it is written
  to the URL with `replace`, dropping `page`. If `q` changes from outside (Back, 条件をクリア), the field
  is synced while rendering, not in an effect. Selects, paging and 条件をクリア push history entries,
  so Back restores the previous filter.
- **Selection** is derived state keyed by the filter string, so changing filters or the page clears it
  without an effect.
- **New-report form**: `useReducer` with values, touched fields, the submit attempt and server errors.
  Each error message keeps a reserved line, so a message that appears on blur cannot push 登録 out from
  under the pointer in the middle of a click (that was a real bug the e2e suite found). The draft
  (`street-reports:draft`) is saved 400 ms after the last change. 破棄して移動 in the leave dialog
  discards the draft as well, which is what 破棄 says. The leave guard uses `useBlocker` (pathname
  changes only) plus `beforeunload` while the form is dirty.
- **Board focus**: after ←/→ the card remounts in another column. The state update runs in `flushSync`,
  then the same card's same button is focused (or the other one if that button is now disabled).
- Theme: if nothing is stored, the default follows `prefers-color-scheme`. A tiny inline script in
  `index.html` applies the stored theme before first paint.
- Labels: status 新規/確認済み/対応中/完了, priority 1 低 / 2 中 / 3 高, theme button text
  `テーマ: ライト` / `テーマ: ダーク` (shows the current theme).

**Server**
- No dependencies, in-memory data, seeded PRNG. `reset` also closes open event streams, and the server
  does not log the closing of a stream from before the reset ("generation" counter), so one test's
  leftovers never show up in the next test's log.
- **Added test hook**: a request with header `X-Test-No-Log: 1` is served but not logged. The suite's
  own API calls (made to compute expected values) use it, so the log holds exactly what the app sent.
- `/photos/<n>.svg` are generated SVGs (12 variants).

**E2E suite**
- Each worker starts `node server/server.js` on `PORT_BASE + parallelIndex` and stops it **by PID**
  at teardown. The spec said `workerIndex`, but `workerIndex` keeps growing whenever a worker restarts
  after a failure, so it can leave the port range. `parallelIndex` is always `0…workers-1`.
- Chromium is the default project: the config decides once in the runner process (no `--project` →
  chromium only) and passes that to workers through an env var.
- Fixtures: `api` (an auto fixture: `POST /api/_test/reset` before every test, plus helpers for the log,
  fail, delay and clock), and `consoleMessages` (an auto fixture: collects console errors and warnings,
  and fails the test on any uncaught `pageerror`).
- Waiting is done only with web-first assertions, `expect.poll`, `waitForResponse` / `waitForRequest` /
  `waitForEvent`, and `page.clock` (`setFixedTime` where only `Date` matters; `install` +
  `fastForward` / `pauseAt` / `runFor` for timers). `pressSequentially(..., { delay: 60 })` is typing
  speed, not a wait. `nextFrames()` (two `requestAnimationFrame`s) lets a pending React commit land after
  a slow response settles, before checking that nothing changed.
- No retries; workers = 4 (`E2E_WORKERS` overrides).

## data-testid

None. Everything is located by role, label, placeholder or text.

## Known fragile spots

- **Firefox console noise**: Firefox logs "The connection to …/api/events was interrupted while the page
  was loading" whenever a full page load (`page.goto`) cuts an open EventSource. It fires before
  `pagehide`, so the app cannot prevent it. The console fixture ignores exactly this message for
  `/api/events`.
- **Firefox `page.reload()`** in Playwright 1.61 creates a new history entry and drops
  `history.state`. The one test that checks Back after a reload uses `reloadPage()` (which calls
  `location.reload()`), and that behaves like the user's reload button in all three browsers.
- **WebKit reload while loading**: reloading while requests or the event stream handshake are still in
  flight makes WebKit report "… due to access control checks" as page errors. The SPA-reload test waits
  until the page has settled (data shown, streams open according to the server log) before reloading.
- The toast test pauses the fake clock (`pauseAt`). With a paused clock `requestAnimationFrame` does not
  run, so `nextFrames()` must not be used there.
- The leave guard test uses `history.back()` through `page.evaluate`, not `page.goBack()`: a blocked
  navigation never "finishes", so `goBack()` would wait for it.
- Expected values come from the API at test time (titles, counts, export numbers), not from hard-coded
  data, except a few seed facts: report 18 has 4 photos, 27 has photos and comments, 117 is `new`, and the
  next new id is 121.

## E2E tests — the user-visible intent of each

**List** (`e2e/list.spec.js`)
- *shows the first page: 20 rows, the total, newest first* — a staff member opening the list sees the 20 newest reports, 全 n 件 and 1 / m ページ, with dates as YYYY/MM/DD.
- *status and category filters write the URL, survive a reload, and Back restores the previous filter* — filtered views can be shared and bookmarked, survive a reload, and Back undoes the last filter.
- *debounced search sends exactly one request for the final text, resets the page and adds no history entries* — typing searches once, for what was finally typed, starting from page 1, without filling the history.
- *a slow response for an earlier search never replaces the results of a later one* — results always belong to the text currently in the box.
- *paging with 前へ / 次へ and the deep link ?status=new&page=2* — paging works, buttons disable at the ends, and a deep link opens the right page.
- *changing a filter resets the page to 1* — a new filter never leaves the user on a page that no longer makes sense.
- *shows the empty state and 条件をクリア restores the full list* — no results is stated clearly and one click returns to everything.
- *shows the error state and 再試行 loads the list* — a server failure is explained and recoverable without reloading.
- *shows 読み込み中… while a slow response is pending* — slow loads show progress (`aria-busy`) instead of a frozen page.
- *row selection drives the header checkbox through unchecked, mixed and checked* — the header checkbox reflects and controls the page's selection, and filtering clears it.
- *bulk 自分に割り当て sends one request, shows the name and clears the selection* — assigning several reports to yourself is a single action that shows your name at once and sticks.
- *a failed bulk update rolls back and shows a toast* — a failed bulk change visibly reverts and says so.
- *新着 markers: none on the first visit, new reports marked on return, cleared after the next visit* — staff can spot reports that arrived since they last left the list.
- *pressing / focuses the search field unless the user is typing* — keyboard users jump to search with `/`, and `/` still types normally inside a field.
- *sets the document title* — the browser tab says 通報一覧 | みどり市 不具合受付.

**Detail** (`e2e/detail.spec.js`)
- *a deep link shows every field and sets the document title* — a shared link shows the whole report, its controls, photos, comments and neighbour links, with a descriptive tab title.
- *unknown and non-numeric ids show 通報が見つかりません* — bad links explain themselves and lead back to the list, and a non-numeric id is not even requested.
- *a status change sends one PATCH, survives a reload, and the header badge follows* — changing the status saves once, persists, and the 新規 n 件 badge updates immediately.
- *a 409 conflict shows 他の職員が更新しました and the server values* — concurrent edits are not silently overwritten; the user sees the current values.
- *a failing PATCH rolls back and shows a toast* — a failed change visibly reverts and says so.
- *quick 次の通報 clicks with a delayed first response end on the last report requested* — flipping quickly never ends on a stale report.
- *adding a comment: counter, disabled states, Ctrl+Enter, textarea emptied and focused* — commenting is quick: n / 500 counter, 送信 only when valid, Ctrl+Enter works, and the user can keep typing.
- *a failing comment keeps the text and shows an error next to the form* — nothing typed is lost on failure, and a retry works.
- *the relative time of a comment keeps ticking* — たった今 becomes 1 分前, 1 時間前, then a date, without a reload.
- *the photo lightbox: opens from a thumbnail, traps focus, arrows, Escape, focus returns, page does not scroll* — photos can be browsed in an accessible modal and closing returns the user to where they were.

**New report** (`e2e/new-report.spec.js`)
- *validates on blur and on submit, focusing the first invalid field* — mistakes are reported where they are (`aria-invalid` and a description), and submitting puts the cursor on the first problem.
- *the 種別 select resets and changes its options when カテゴリ changes* — a subcategory never mismatches its category.
- *匿名の通報 hides the reporter fields and leaves them out of the request* — anonymous reports really send no reporter data.
- *a successful submit: one POST even on a double click, navigation, toast, first in the list* — registering creates exactly one report, confirms it and shows it at the top of the list.
- *a server 422 message is shown at its field* — server-side rules (duplicate open address) appear like client validation.
- *the draft is restored after a reload, 破棄 clears it, and a successful submit removes it* — work in progress survives a reload, can be thrown away, and does not come back after submitting.
- *the leave guard asks on a nav link and on Back; 編集に戻る keeps values, 破棄して移動 leaves, a clean form leaves freely* — unsaved input is never lost by accident, and an empty form never nags.

**Board** (`e2e/board.spec.js`)
- *shows four columns with counts and cards ordered by priority, then latest update* — the board shows the workload per status with the most urgent cards first.
- *moving a card is optimistic, sends one PATCH, updates the counts, and the focus follows the card* — moving a card is instant, saved once, and keyboard users stay on the card they moved.
- *a failing move rolls back with a toast* — a failed move visibly reverts and says so.
- *a change made in another browser context moves the card within 2 s and updates the header badge* — the board and badge show colleagues' changes live.
- *自分の担当のみ shows only the current staff member’s cards and follows the 担当者 select* — staff can focus on their own cards, even after switching who they are.
- *leaving and returning three times leaks no event streams* — navigating around does not pile up server connections.

**Stats** (`e2e/stats.spec.js`)
- *presets write the range to the URL and the numbers match the export* — the totals, category bars, average handling time and table are correct for the chosen period, and the period is shareable.
- *an inverted range shows a message and sends no request* — an impossible range is explained instead of queried.
- *clicking a column header sorts the table and toggles aria-sort* — the table can be sorted either way, and assistive tech is told how.
- */stats?boom=1 shows the error fallback and 再読み込み recovers once the URL no longer has boom* — a crashing page shows a friendly fallback inside the working shell and can be recovered.

**Global** (`e2e/global.spec.js`)
- *the theme toggle sets data-theme, persists over a reload, and a second tab follows* — the theme is remembered and consistent across tabs.
- *the 担当者 choice defaults to the first staff member and persists over a reload* — the app remembers who is using it.
- *the nav marks the active link with aria-current="page"* — users (and screen readers) know where they are, including on detail pages.
- */ redirects to /reports and unknown paths show the not-found page with a link home* — the root goes to the list, and bad URLs lead back.
- *toasts disappear after 4 seconds or via ×, and at most 3 are shown at once* — notifications are brief, dismissible and never flood the screen.
- *every route survives a reload (SPA fallback)* — any URL can be reloaded or opened directly.
- *the first load of each route sends each GET exactly once* — no duplicate requests (StrictMode-safe effects).
- *the console stays clean through a walk across all routes* — no errors or warnings during normal use.

## Results at hand-off (this machine)

| run | result | duration (Playwright / wall) |
|---|---|---|
| chromium #1 | 50 passed | 10.5 s / 12 s |
| chromium #2 | 50 passed | 10.5 s / 12 s |
| chromium #3 | 50 passed | 10.7 s / 12 s |
| firefox | 50 passed | 18.3 s / 20 s |
| webkit | 50 passed | 23.0 s / 24 s |
| extra: chromium `--repeat-each=4` | 200 passed | 39.8 s |
| extra: firefox + webkit `--repeat-each=2` | 200 passed | 1.3 min |
| unit (Vitest) | 20 passed | ~7 s |
