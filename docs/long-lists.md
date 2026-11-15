# Long lists

**日本語版**: [long-lists.ja.md](./long-lists.ja.md)

What a page does when a list has thousands of rows: loading it a page at a time, what a row costs, when to render only the rows near the screen, and how to come back to a place in it. It comes from the `town-archive` seam app — a photo archive of 12,000 records with infinite scroll, and a staff table of the same 12,000 in memory ([seam-apps.md](./seam-apps.md)). The numbers were measured in Chromium, Firefox and WebKit. What is said of 4.24 is in the release after 4.23.0.

## 1. What a long list costs

`@wcstack/state` does not slow down with the list. Writing one row of 3,000 (`$update("photos.*.fav", [i], …)`) is about a millisecond of script, the script part of adding a page of 60 cards stays at 5 to 10 ms, and a getter that walks 12,000 rows through `this.photos` takes under 0.1 ms — the array a getter reads is the array itself.

What grows is the browser's work on the document. With a card of about ten elements, a page of 60 takes this long to show, from the write to the next frame:

| | at 120 cards | at 3,000 cards | at 3,000, with two `<wcs-intersect>` around each card |
|---|---|---|---|
| Chromium | 21 ms | 30–34 ms | 40–48 ms |
| Chromium, CPU slowed 4× | 37 ms | 113 ms | 183 ms |
| Firefox | 9–12 ms | 18–19 ms | 32–52 ms |
| WebKit | 19–31 ms | 49–95 ms | 105–145 ms |

So a list that keeps every row in the document is fine at a few hundred rows and noticeable at a few thousand, and an element wrapped around every row counts. Sharing one `IntersectionObserver` between the `<wcs-intersect>` of a list was measured and did not help (40 → 36 ms in Chromium, slower in WebKit): the cost is the elements and the layout, not the observers.

## 2. Loading a page at a time

**Use `<wcs-infinite-scroll>`** with a `manual` `<wcs-fetch>` — the [fetch README §5](../packages/fetch/README.md#5-infinite-scroll-with-wcs-infinite-scroll) has the whole example. Since 4.24 it loads the first page when state writes the url, goes on while a page leaves it on screen (a tall window, a zoomed-out page), does not repeat a failed request, and stops at a response that added nothing. What stays the page's:

- **The url comes from state** (`url: nextUrl`), not from a static attribute for page 1.
- **Advance after the response, on success only.** A failure leaves the page number where it is; the sentinel coming on screen again, or a retry button that writes `trigger`, asks for the same page.
- **Tell the end** — a short page, or the total the server gives — and bind it to `disabled`.
- **The sentinel goes right after the list, above a spinner or a message.** Only rows should move it: a spinner inserted above it when a request starts pushes it out of its margin, a scroll that goes on brings it back, and that is the sentinel coming on screen again — a request that failed in between is asked again.
- **A filter starts the list again, and aborts the page on its way.** A `manual` `<wcs-fetch>` does not abort on a new `url`, so a page asked for the old filter still arrives and its rows land in the new list. Bind `command.abort: $command.cancelPage` on the `<wcs-fetch>`, emit it first, then empty the list:

```js
setFilter(event) {
  this.$command.cancelPage.emit(); // the page on its way is another list's
  this.filter = event.target.value;
  this.items = [];
  this.page = 1;
  this.noMore = false;
},
```

The sentinel asks for the new list's first page by itself. Scroll to the top as well when the user was far down.

**Use `<wcs-intersect target="self">`** when the edge means something else, or when the page decides what an edge means — a list that grows at both ends has a sentinel at each. Then the page does what `<wcs-infinite-scroll>` does ([intersection README](../packages/intersection/README.md#2-infinite-scroll-sentinel), [`examples/state-intersect-fetch`](../examples/state-intersect-fetch)):

- Act on the report (`eventToken.intersecting:`), not on a stored flag: a flag is stale as soon as a page moves the sentinel.
- After each page that lands, `reobserve()` — the observer reports a change of visibility only. Never after a failure.
- Ask for the page the list's length says, not `page++` on each report: reports come on the way in and on the way out.
- A `root` that names nothing is the viewport, and one that does not scroll (`root="main"`) counts everything in it as on screen. Since 4.24 the first is said (`[wcs/intersect-root]`).

## 3. Rows

- **Keep the row objects.** A row is its object: `items.concat(page)` keeps the rows already drawn, and a list rebuilt as copies (`map((p) => ({ ...p }))`, a JSON round trip) rebuilds every row in the document — focus falls to `<body>`, images decode again, every `<wcs-intersect>` starts over. If the rows must be replaced, give the list a key ([state README](../packages/state/README.md)).
- **Write one row.** `this.$update("photos.*.fav", [index], (v) => !v)` touches one row; assigning a new array asks state to compare all of them.
- **A flag per row, not a search per row.** "Is this row's id among the favourites?" as a row getter (`this.favorites.some(…)`) runs for every row each time the favourites change. Keep a `fav` field on the row, set it when the page arrives (one `Set` lookup per row), and when a favourite changes write the rows whose id changed. `$eq` answers "is this row the selected one" for one value; there is no set form of it.
- **Images**: native `loading="lazy"` is enough when lazy loading is all that is wanted. Give the card the photo's shape (`aspect-ratio`) and colour so that nothing moves when the image arrives.
- **Per-row observers** (`<wcs-intersect>` around each card, for "seen" or for what `loading="lazy"` cannot do) cost what §1 shows. `threshold="1"` never reports a card taller than the root — on a phone held sideways most cards are; use `0.5`, or several thresholds and the ratio.
- **Events** are delegated, so 3,000 rows with two handlers each add no listeners. The handler receives the row's index after the event (`star(event, index)`); `event.currentTarget` is the root, not the row. For a ★ on a card that is a link, put the button beside the link, not inside it: a click on a button inside an `<a>` still follows the link, and `stopPropagation()` stops handlers, not the link. Since 4.24 a button after a `<wcs-link>` in a row runs its own handler (before, it ran none, or its neighbour's), and a handler written on `<wcs-link>` itself never runs — the lint says so.

## 4. Rendering only the rows near the screen

When the list on screen can reach thousands of rows — a table of every record, a feed nobody leaves — render a window of it. The seam app's public list holds 60 cards in the document with 3,000 loaded, and a page shows in 5 to 14 ms there; its staff table (`@wcstack/signals`) holds about 45 of 12,000 rows and, with the CPU slowed four times, answers a keystroke in the filter in about 50 ms and a sort in about 100 ms.

- **The row heights have to be known without the document**: fixed (a table: 32 px), or computed from the data (a card: its text block plus the photo's shape at the column's width).
- **The list is a getter that slices**: `get shown() { return this.items.slice(this.first, this.end); }` under `for: shown`, inside a box that has the height of the whole list, moved to where the window starts.
- **The scroll position is not an element.** No wcstack element reports it. Add one passive `scroll` listener in `$connectedCallback`, take one reading per frame, and write it to state; `first` and `end` are getters over it.
- **The container's size is an element**: `<wcs-resize target="self" round data-wcs="width: gridWidth">`. A hidden container reports `0`: ignore it (an accessor pair whose setter keeps the last real width), or the columns collapse while the list is hidden. Since 4.24 a `$watch` on a getter over that width fires for the first width too; before, it did not in Chromium and Firefox.
- **Decide who anchors the scroll.** In the seam app the windowed list stayed glued to the bottom and loaded page after page until it set `overflow-anchor: none` — on `html` and `body` in Chromium, on every element in Firefox — and placed the view itself when rows arrived above. A list that keeps all its rows in the document does not need it.
- **With `@wcstack/signals`**: `For` with a `key`, what changes read through `current()`, `selector()` for the current row, `delegateEvents()` before the table is built, a burst of events folded into one update per frame.

What it costs: find-in-page sees only the rows in the document; a focused row that scrolls out of the window loses the focus; the code is the page's. Below a few hundred rows on screen it is not worth it.

## 5. Coming back

- **Back** restores the scroll position: with the list as the content of a route, the rows, the position and the sentinel are as they were (Chromium, Firefox, WebKit). The list must still hold its rows — keep them in state.
- **A list kept outside the routes** (the [router README](../packages/router/README.md#where-route-content-lives)'s exception): Back restores it too. A link of your own back to it is a push navigation, which scrolls to the top when it has finished — after your `$watch`. Navigate to the row instead: `navigateUrl = "/#photo-" + id`. The browser scrolls to the element with that id and focus moves to it.
- **A reload** is the page's: keep what identifies the place (the filter, the first row on screen) with `<wcs-storage type="session">`, load from there, and scroll to the row when it is drawn.

## 6. What wcstack does not have

Recorded as design questions, not planned: an element that reports the scroll position; a set form of `$eq` ("is this row's key in this set"); an element for the device pixel ratio (`<wcs-media-query>` with `resolution` thresholds is the way today).
