# state + intersection + fetch demo (infinite scroll from two I/O nodes)

An infinite-scroll feed built from two I/O nodes that do not know each other: a
`<wcs-intersect>` sentinel and a `<wcs-fetch>`. `@wcstack/state` is the only place that
knows both. The sentinel reports visibility through an **event token**, state decides
whether a page is due, and a **command token** runs `<wcs-fetch>`. Each response comes
back as another event token and is appended to the feed in state.

It sits between its two sister demos:

| Demo | Who loads the page | What it shows |
|---|---|---|
| [`infinite-scroll`](../../packages/fetch/examples/infinite-scroll) | `<wcs-infinite-scroll target="page-fetch">` runs `<wcs-fetch>` itself | The all-in-one tag: the sentinel is wired to the fetch in markup |
| **this demo** | state, through a command token, when the sentinel's event token says it is in view | Composing two I/O nodes through state: event token in, decision in state, command token out |
| [`state-intersect-scroll`](../state-intersect-scroll) | a `$stream` source that calls `fetch()` | The low-level path: switchMap cancellation and bounded retry written in the producer |

## Run

Packages load from the CDN ([esm.run](https://esm.run)); only Node.js is needed.

```bash
node examples/state-intersect-fetch/server.js
```

Open http://localhost:3000 and scroll.

Failure injection, to see the Retry button:

```bash
# page 2 fails once
FAIL_PAGE=2 node examples/state-intersect-fetch/server.js

# every page fails with 40% probability
FLAKY=0.4 node examples/state-intersect-fetch/server.js
```

## Data flow

```text
$connectedCallback ──────────────────────────────┐
                                                  v
<wcs-intersect> ──eventToken.intersecting──> $on.sentinelChanged
   (target="self", 240px margin)                   │ in view, not loading, no error, not the end?
                                                  v
                                         $command.loadPage.emit()
                                                  │ command.fetch
                                                  v
                                   <wcs-fetch manual url=pageUrl>.fetch()
                                                  │ wcs-fetch:response (eventToken.value)
                                                  v
                                         $on.pageArrived
                                            items = items.concat(page); page++
                                            short page → noMore
                                                  │ (end of the update: rows rendered)
                                                  v
                                         $watch.items → $command.rearm.emit()
                                                  │ command.reobserve
                                                  v
                                   <wcs-intersect>.reobserve() → reports where it is now
```

## Points

- **Neither element knows the other.** `<wcs-intersect>` only reports visibility
  (`eventToken.intersecting: sentinelChanged`) and accepts `command.reobserve`.
  `<wcs-fetch>` only takes `url`, reports `loading` / `error` / each response
  (`eventToken.value: pageArrived`) and accepts `command.fetch`. The rules — when a page is
  due, what "the end" is, what to do after an error — are all in the state.
- **Page 1 does not wait for the sentinel.** `<wcs-intersect>` starts observing as soon as
  it is defined, which is before the state is bound, and an IntersectionObserver reports
  only *changes* after its first callback. A first report that arrives before the event
  token is subscribed is lost, and the sentinel would then sit in view with nothing to say.
  `$connectedCallback` asks for page 1 once the bindings exist. (The `infinite-scroll`
  demo solves the same race differently: a static page-1 `url` on its `<wcs-fetch>`.)
- **Enter edges while a page loads are ignored.** `<wcs-fetch>` runs the `latest` policy: a
  new `fetch()` aborts the request in flight. An extra enter edge would abort page N and
  ask for page N again, so the handler checks `fetching` (the bound `loading`) first.
- **`manual` and the url getter.** `pageUrl` always names the next page. Because the
  element is `manual`, rewriting `url` never fetches by itself; only `loadPage` does. By the
  time the next enter edge arrives, the update that advanced `page` has already written the
  new `url`.
- **Re-arm after each page.** The sentinel reports changes only. When a page lands and the
  sentinel is still in view (a tall window, a fast scroll), nothing would change. The
  `$watch` on `items` runs at the end of the update that appended the rows — after they are
  rendered — and asks the sentinel to report where it is now (`reobserve()`). A short page
  sets `noMore`, and it stops.
- **Errors stop at a Retry button.** `wcs-fetch:response` also fires for an HTTP error
  (`value` is `null`); `pageArrived` skips it and leaves `page` where it is. While the error
  shows, sentinel edges are ignored, so a layout shift cannot retry in a loop. Retry emits
  `loadPage` for the same page. Automatic, bounded retry is what the `$stream` version
  (`state-intersect-scroll`) adds.
- **Script order.** The two I/O packages load before `@wcstack/state`, so both elements are
  defined before state subscribes them to command tokens: an emit to an element defined
  late is not replayed ([examples/README.md](../README.md)).

## Tests

[`e2e/tests/state-intersect-fetch.spec.ts`](../../e2e/tests/state-intersect-fetch.spec.ts):
page 1 loads without scrolling and each page loads exactly once up to the end; a tall window
fills itself through `reobserve()`; an error waits for Retry and does not retry on scroll.

```bash
cd e2e
npx playwright test state-intersect-fetch
```
