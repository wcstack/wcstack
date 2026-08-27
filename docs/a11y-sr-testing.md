# Manual screen-reader verification for the a11y features

Screen-reader behavior is deliberately **not** automated (a11y-design D11): the
e2e suite pins everything Playwright can assert in Chromium (`activeElement`
identity, `scrollY`, ARIA attributes, live-region text content), and what a
reader actually *speaks* is verified by hand with the steps below. Run them
once per release that touches the router's a11y surface, the state list
renderer, or the live-region examples.

Readers: **NVDA** (Windows, free) with Firefox or Chrome; **VoiceOver**
(macOS, built in, `Cmd+F5`) with Safari. Serve the repo root
(`cd e2e && npm run serve`) and use the fixtures/examples below.

## 1. Route announcement — `announce="title"`

Page: `/e2e/fixtures/router-a11y-optin.html`

1. Load the page. The reader must announce the page title once (browser
   behavior), and **nothing extra** from the router — the live region is empty
   on first render.
2. Activate the "about" link. After the content swaps, the reader must
   announce "About — a11y fixture" (the new `document.title`) exactly once.
3. Go back. It must announce "Home — a11y fixture" once.
4. Repeat navigation quickly several times: no double announcements, no
   stale titles.

## 2. Focus policy — `focus="heading"`

Same page.

1. Activate "about". Reader focus must move to the `<h1>` "About" and the
   reader must speak it (typically "About, heading level 1").
2. `Tab` must move from that heading to the next focusable element inside or
   after the route content, not restart from the page top.
3. Remove both attributes (`/e2e/fixtures/router-a11y.html`): after a
   navigation, focus must reset to the body (reader reads from the top on next
   `Tab`) — the browser default, untouched.

## 3. `aria-current` on links

Either fixture. Move the reader's focus/virtual cursor over the nav links:
the link for the page you are on must be read with "current page"; the other
must not. Navigate and re-check — the marker must move with you.

## 4. Focus survives a list reorder — `moveBefore`

Page: `/e2e/fixtures/state-move-before.html`

1. `Tab` into the input of row "two", type something.
2. With focus still in the input, activate the swap button **with the
   reader's activation gesture** (NVDA: `Enter` on the button via object nav;
   VoiceOver: `VO+Space`) or by script — the point is not to click with the
   mouse while focus is in the input.
3. Focus must remain in the same input (the reader does not announce a focus
   loss), the typed text is intact, and the row now sits at position 4.

## 5. Live feeds — `role="log"`

Pages: `examples/websocket-chat/*` (needs its own server), or
`examples/state-notification-chat`.

1. New appended messages must be announced politely — after the reader
   finishes its current utterance, not interrupting it.
2. The announcement must be the new entry only, never the whole log re-read.
3. state-sse-dashboard: while updates are paused, the reader must go quiet;
   numbers on screen stay readable.

## 6. Reduced motion — `<wcs-raf reduced-motion="pause">`

Not reader-specific: enable "reduce motion" in the OS (Windows: Settings >
Accessibility > Visual effects > Animation effects off; macOS: System
Settings > Accessibility > Display > Reduce motion) and confirm an opted-in
raf loop stops (`suspended` state chip in the tilt-maze HUD) and resumes when
the preference is turned back off — without reloading the page.

## Recording results

Note reader + browser + OS versions and any deviation in the release PR.
A reader-specific quirk that contradicts the design gets an issue referencing
[a11y-design.md](./a11y-design.md); do not code around one reader silently.
