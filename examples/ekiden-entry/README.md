# state + router + fetch / upload / storage / debounce demo (a team entry wizard)

みどり市民駅伝 チーム申し込み — a team's entry for a city's relay road race. The UI is in Japanese. Five steps, each with its own URL: the team and its representative, the runners (five to seven rows that can be moved and sorted), the options, a confirmation, and the receipt. The page is almost all form: names typed with an IME and their readings (フリガナ), a phone number and a postal code that take shape as they are typed, an address looked up from the postal code, the browser's autofill, a consent form uploaded per under-age runner, and two form controls the city shares with pages that do not use wcstack.

It was written by a first-time author from the public documents alone, on 4.22.0 ([docs/seam-apps.md](../../docs/seam-apps.md#ekiden-entry-2026-11-14)). What it found became 4.23.0, and this is the app on 4.23 with the workarounds that release made unnecessary taken out: the code that kept another tab's draft and the address lookup away from a field being composed, and the first navigation the guards could not be trusted with. [docs/forms.md](../../docs/forms.md) is the guide written from it.

Packages: `@wcstack/state`, `router`, `fetch`, `upload`, `storage`, `debounce`; `@wcstack/testing` for the headless tests.

## Run it

The packages load from a CDN ([esm.run](https://esm.run), npm `latest`); the server uses Node's built-ins only:

```bash
node examples/ekiden-entry/server.js                # http://localhost:3000/entry/team   (PORT=… to change)
WCS_LOCAL=1 node examples/ekiden-entry/server.js    # the repository's packages/*/dist instead of the CDN
```

The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. The page is in `public/`. The data lives in memory.

| URL | |
|---|---|
| `/`, `/entry` | Continue where the draft was left |
| `/entry/team` | Step 1: the team (name, reading, division) and its representative (name, reading, birth date, address, phone, email) |
| `/entry/runners` | Step 2: five to seven runners — name, reading, birth date, sex, best time, shirt size, a folded section for an emergency contact, a consent form for a runner under 18 |
| `/entry/options` | Step 3: parking, lunches, a message, the receipt's name, how to pay |
| `/entry/confirm`, `/entry/done` | The confirmation and the receipt |
| `/plain` | The two shared controls in a classic `<form method="post">` with no wcstack on the page; the server echoes what it received |

A step that is not reachable yet — `/entry/confirm` with an empty draft — leads to the first step that is not complete.

API: `GET /api/prefectures`, `GET /api/postal/:code` (a code that starts with `999` answers after 2 s), `GET /api/teams/available?name=`, `POST /api/consents` (one file: PDF / JPEG / PNG, 5 MB at most), `DELETE /api/consents/:id`, `POST /api/entries` (201 `{ id, total }`, 409 when the team name is taken, 422 `{ errors: { "<json path>": message } }` — a path may name a field of any step, and a runner by its index). Every `/api/*` request may add `?delay=<ms>`.

Test hooks (`POST`, JSON): `/api/_test/reset`, `/api/_test/fail` (`{ path, status, times }`; status `0` drops the connection), `/api/_test/reject` (`{ errors, times }`: the next entries are answered 422 with these), `/api/_test/take` (`{ name }`).

## Things to try

- Type a name with a Japanese IME: 山田 in 姓 fills ヤマダ in セイ, and the Enter that confirms the conversion does not press 次へ.
- Type a phone number with the IME left on (`０９０１２３４…`): the field is left alone while the text is composed, and becomes `090-1234-5678` when it is confirmed. Put the caret in the middle and type a digit: the caret stays after it.
- Open the wizard in two tabs. Type in one: the other follows. Start composing in a field in one tab and write that field in the other: the composition goes on.
- Let the browser fill the representative's address: the postal code and the phone take the same shape as when typed.
- Add runners up to seven, open one's 緊急連絡先, focus its name and press Alt+↑: the row moves with the focus and the open section.
- `curl -X POST localhost:3000/api/_test/reject -H 'content-type: application/json' -d '{"times":1,"errors":{"rep.phone":"…","runners.2.name":"…"}}'`, then send: the wizard goes to step 1's phone; the runner's message stays with that runner when the rows are sorted.
- Reload on step 3: every field of every step is back. Open `/entry/confirm` in a private window: step 1.
- `/plain`: the same two controls in a form with no wcstack — a value, `required`, a reset, `<fieldset disabled>`.

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| The IME × two-way bindings | A two-way `value:` writes every composition step to the entry. Since 4.23 state does not write a field back while it is composed, so the draft from another tab and the address lookup simply write the entry. What the page does itself: an Enter pressed while composing is not "next" (`e.isComposing`, `keyCode === 229`), and a フリガナ is filled from the reading of each committed conversion (`lib/ime.js` keeps the kana of `compositionupdate`). |
| Fields that change what is typed × the caret | The phone, the postal code, the best time and the kana fields are bound one way (`value#ro:`) and written from an `input` handler that also places the caret; they are not rewritten under the IME. What the entry keeps is the clean value (digits, full-width katakana). |
| Autofill × state | A fill with `input` and `change` is typing. A `change` alone reaches the fields state binds two ways since 4.23; the fields the page writes itself are pulled on `change`, and every field of the step once more before 次へ — a value put in with no event is read then. |
| Rows × a reorder | The runners are objects with an id, moved, never rewritten: the focus, an open `<details>` and what is typed stay with the runner (`$listKeys` matches a restored draft by id). In Safari, which has no `moveBefore()`, the page puts the focus back. |
| An upload × rows that move | The consent uploads live in a list of their own that is never reordered, each pointing at its runner by id. Since 4.23 an upload in a moved row goes on in Chromium and Firefox; in Safari the row is taken out and put back, and a disconnect aborts. |
| A 422 × a field of another step | The server's errors are kept by field path, and a runner's by the runner's id — so a message follows its runner through a sort. The wizard goes to the first step with a message and focuses the field once the router's `path` says the step is there. |
| The router's guards × the draft | A guard reads the draft from local storage inside its function and sends a step that is not reachable to the first incomplete one. It imports its code by a full URL (`await import(new URL("/lib/guards.js", location.href).href)`): a guard is a `blob:` module. On 4.22 the page did this for the first navigation itself, because the route a guard redirected a page load to was not bound. |
| Form-associated custom elements × wc-bindable | `<midori-date>` (和暦 ⇄ 西暦) and `<midori-stepper>` declare `value` in both `properties` and `inputs`, dispatch their event on a user's change, on a reset and on a restore, and need nothing of wcstack: `/plain` uses them in a plain form. |
| A draft × two tabs | One `<wcs-storage>` key holds the entry; the `storage` event brings another tab's change, and the last writer wins. |
| Sending | The entry goes to `<wcs-fetch>` as a new object on every send, `body` before `trigger`: a retry that wrote the same JSON string would go out with no body. |

## Tests

```bash
cd examples/ekiden-entry && npm install && npm test     # vitest: the pure logic, and the real state.js mounted headlessly
```

`tests/entry-logic.test.js` covers fees, ages, normalising and formatting with the caret, kana, steps, placing a server's errors and moving rows; `tests/state.test.js` mounts `public/state.js` with `@wcstack/testing`. The browser checks are `e2e/tests/ekiden-entry.spec.ts` in the repository: real compositions through Chromium's DevTools protocol, autofill of three kinds, the rows, the 422, the draft in two tabs, the guards, and the shared controls.
