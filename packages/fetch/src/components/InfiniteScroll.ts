import { Fetch } from "./Fetch.js";
import { config } from "../config.js";

/** Frames the page gets after a response to add its rows and move its url on, before the sentinel is looked at again. */
const SETTLE_FRAMES = 3;

/**
 * Runs a `<wcs-fetch>` when this element — a sentinel after a list — comes on screen.
 *
 * An IntersectionObserver reports a change of visibility and nothing else, and an element that only acted on that
 * report did not load in three cases (docs/seam-apps.md, town-archive):
 * - the sentinel reported before the page had written the target's `url` (state binds a moment after the elements
 *   are defined): the request was refused, and the sentinel, still on screen, never reported again;
 * - a page arrived and did not push the sentinel out — a tall window, a zoomed-out page, a short page;
 * - the `url` changed with the sentinel on screen — a filter, with the list emptied — at rest or while a request
 *   was in flight.
 *
 * So, with the sentinel on screen, the element also runs the target's request
 * - when its `url` is written or changed while no request is in flight (the first page; a filter);
 * - when a request ends and the `url` changed while it was in flight (a filter typed meanwhile);
 * - when a request ends without an answer — aborted — and the `url` is another one (a page that aborts the request
 *   on its way when the filter changes);
 * - when a request ends, the page has added rows (the sentinel moved) and moved the `url` on.
 *
 * It never runs a `url` again from there: a failed request waits for the user to scroll away and back, or for the
 * page's retry. And a response that added nothing ends it, whatever the page does to the `url`: a page that counts
 * its page number up on an empty answer does not ask for ever.
 */
export class InfiniteScroll extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["target", "root", "root-margin", "threshold", "disabled"];
  }

  private _observer: IntersectionObserver | null = null;
  private _done: boolean = false;
  // the target last warned about (once per value)
  private _warnedTarget: string | null = null;
  // the root and the margin last warned about (once per value)
  private _warnedRoot: string | null = null;
  private _warnedMargin: string | null = null;
  // the scroll container in use (null: the viewport)
  private _rootElement: Element | null = null;
  // the sentinel's last report
  private _inView: boolean = false;
  // the target whose url and requests it follows
  private _fetch: Fetch | null = null;
  private _urlObserver: MutationObserver | null = null;
  // the url of the request last started on the target (by this element or by the page)
  private _asked: string | null = null;
  // where the sentinel was when that request started
  private _startedAt: number = 0;
  // the url changed while that request was in flight
  private _changedInFlight: boolean = false;
  // that request was answered (a response arrived, an HTTP error too): not aborted, not a network failure
  private _answered: boolean = false;
  // a request has ended and the page is adding its rows (SETTLE_FRAMES)
  private _settling: boolean = false;
  private _onResponse = (): void => {
    this._answered = true;
  };
  private _onLoadingChanged = (event: Event): void => {
    if ((event as CustomEvent).detail) {
      this._started();
    } else {
      this._ended();
    }
  };

  get target(): string {
    return this.getAttribute("target") || "";
  }

  set target(value: string) {
    this.setAttribute("target", value);
  }

  get root(): string | null {
    return this.getAttribute("root");
  }

  set root(value: string | null) {
    if (value === null) {
      this.removeAttribute("root");
    } else {
      this.setAttribute("root", value);
    }
  }

  get rootMargin(): string {
    return this.getAttribute("root-margin") || "0px";
  }

  set rootMargin(value: string) {
    this.setAttribute("root-margin", value);
  }

  get threshold(): number {
    const value = Number(this.getAttribute("threshold") ?? "0");
    return Number.isFinite(value) ? value : 0;
  }

  set threshold(value: number) {
    this.setAttribute("threshold", String(value));
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    if (value) {
      this.setAttribute("disabled", "");
    } else {
      this.removeAttribute("disabled");
    }
  }

  get once(): boolean {
    return this.hasAttribute("once");
  }

  set once(value: boolean) {
    if (value) {
      this.setAttribute("once", "");
    } else {
      this.removeAttribute("once");
    }
  }

  connectedCallback(): void {
    this._observe();
  }

  disconnectedCallback(): void {
    this._disconnectObserver();
    this._follow(null);
  }

  attributeChangedCallback(): void {
    if (this.isConnected) {
      this._observe();
    }
  }

  private _observe(): void {
    this._disconnectObserver();

    if (this._done || this.disabled || !this.target || typeof IntersectionObserver === "undefined") {
      return;
    }

    this._rootElement = this._resolveRoot();
    try {
      this._observer = new IntersectionObserver((entries) => this._report(entries), {
        root: this._rootElement,
        rootMargin: this.rootMargin,
        // (out of 0..1 the browser throws: only the margin is left to refuse)
        threshold: Math.min(1, Math.max(0, this.threshold)),
      });
    } catch (error) {
      // A margin with no unit ("200", "0 0 900 0"): the browser's own exception came out of this callback,
      // uncaught, and no page was loaded (docs/mistake-catalogue.md, "root-margin-unit").
      const margin = this.rootMargin;
      if (this._warnedMargin !== margin) {
        this._warnedMargin = margin;
        console.warn(
          `[@wcstack/fetch] [wcs/root-margin-unit] <${config.tagNames.infiniteScroll} root-margin="${margin}"> is not a margin ` +
          `the browser takes (${(error as Error).message}): write each length with px or %, as "240px 0px". ` +
          `Nothing is observed, so no page is loaded.`,
        );
      }
      return;
    }
    this._observer.observe(this);
  }

  private _disconnectObserver(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._inView = false;
  }

  /** The observer's report: the last entry is the sentinel's state now, and coming on screen runs the request. */
  private _report(entries: IntersectionObserverEntry[]): void {
    this._inView = entries[entries.length - 1].isIntersecting;
    if (this._inView) {
      this._run(true);
    }
  }

  /**
   * Takes the reports the browser has made and not delivered yet, before the sentinel's state is read outside a
   * report. While the user scrolls, the report that a page pushed the sentinel out arrives a frame later than
   * otherwise — after the frames the end of a request waits (Chromium, Firefox): the sentinel read as still on
   * screen, and a page the window did not need was asked for (docs/seam-apps.md, landing town-archive).
   */
  private _sync(): void {
    const pending = this._observer ? this._observer.takeRecords() : [];
    if (pending.length > 0) {
      this._report(pending);
    }
  }

  /**
   * The scroll container: the element with that id, or — as `<wcs-intersect root>` spells it — the first one the
   * value matches as a selector. A root that is given and not found, or that does not scroll, is said once per
   * value: the viewport took its place without a word, and a root that does not clip its content counts
   * everything in it as on screen (`root="main"` loaded page after page).
   */
  private _resolveRoot(): Element | null {
    const name = this.root;
    if (!name) return null;
    let found: Element | null = document.getElementById(name);
    if (!found) {
      try {
        found = document.querySelector(name);
      } catch {
        // not a selector either
      }
    }
    if (this._warnedRoot !== name) {
      const tag = `<${config.tagNames.infiniteScroll} root="${name}">`;
      if (!found) {
        this._warnedRoot = name;
        console.warn(
          `[@wcstack/fetch] [wcs/infinite-scroll-root] ${tag}: no element has that id, and none matches it as a ` +
          `selector, so the viewport is the scroll root.`,
        );
      } else if (doesNotScroll(found)) {
        this._warnedRoot = name;
        console.warn(
          `[@wcstack/fetch] [wcs/infinite-scroll-root] ${tag} is <${found.localName}>, which does not scroll ` +
          `(overflow: visible): everything inside it counts as on screen, so page after page is loaded. Name the ` +
          `element that scrolls, or leave root out for the viewport.`,
        );
      }
    }
    return found;
  }

  private _resolveTarget(): Fetch | null {
    const target = document.getElementById(this.target);
    if (!(target instanceof Fetch)) {
      // Nothing to load from: say so once per target, instead of loading no more pages without a word
      // (docs/mistake-catalogue.md, "infinite-scroll-target").
      if (this._warnedTarget !== this.target) {
        this._warnedTarget = this.target;
        console.warn(
          `[@wcstack/fetch] [wcs/infinite-scroll-target] <${config.tagNames.infiniteScroll} target="${this.target}"> ` +
          `came into view, but no <${config.tagNames.fetch}> has that id, so no page was loaded.`,
        );
      }
      this._follow(null);
      return null;
    }
    this._follow(target);
    return target;
  }

  /** Follows `target`'s url and requests (or stops following, with null). */
  private _follow(target: Fetch | null): void {
    if (this._fetch === target) return;
    this._fetch?.removeEventListener("wcs-fetch:loading-changed", this._onLoadingChanged);
    this._fetch?.removeEventListener("wcs-fetch:response", this._onResponse);
    this._urlObserver?.disconnect();
    this._urlObserver = null;
    this._fetch = target;
    this._settling = false;
    this._changedInFlight = false;
    if (!target) return;
    target.addEventListener("wcs-fetch:loading-changed", this._onLoadingChanged);
    target.addEventListener("wcs-fetch:response", this._onResponse);
    this._urlObserver = new MutationObserver(() => this._urlChanged());
    this._urlObserver.observe(target, { attributes: true, attributeFilter: ["url"] });
  }

  /** Where the sentinel is in what scrolls: rows added before it move it, scrolling does not. */
  private _position(): number {
    return this.getBoundingClientRect().top + (this._rootElement ? this._rootElement.scrollTop : window.scrollY);
  }

  /** A request started on the target (this element's, or the page's own). */
  private _started(): void {
    this._asked = this._fetch!.url;
    this._startedAt = this._position();
    this._changedInFlight = false;
    this._answered = false;
    this._settling = false;
  }

  /**
   * The request ended: once the page has had its frames to add rows and move the url on, the sentinel — if it is
   * still on screen — runs the next request when the url changed while this one was in flight, when this one had no
   * answer (aborted: a url written right after it is the page's own change, not its reaction to a response), or
   * when this one added rows. A response that added nothing ends it there.
   */
  private _ended(): void {
    this._settling = true;
    afterFrames(SETTLE_FRAMES, () => {
      if (!this._settling) return;
      this._settling = false;
      this._sync();
      if (this._inView && (this._changedInFlight || !this._answered || this._position() !== this._startedAt)) {
        this._run(false);
      }
    });
  }

  /**
   * The target's url was written. In flight, and while the page settles after a response, the end of that request
   * decides (_ended). At rest it is the page's own change — the first url, a filter: with the sentinel on screen
   * it is asked for, at once when nothing was asked yet, otherwise once the emptied list is laid out.
   */
  private _urlChanged(): void {
    const target = this._fetch!;
    if (target.loading) {
      this._changedInFlight = true;
      return;
    }
    if (this._settling || !this._inView) return;
    if (this._asked === null) {
      this._run(false);
      return;
    }
    afterFrames(2, () => {
      this._sync();
      if (this._inView) this._run(false);
    });
  }

  /**
   * Runs the target's request. `edge`: the sentinel came on screen (a user who scrolls away and back asks again,
   * also for the same url — the way a failed request is tried again); otherwise only a url not asked yet.
   */
  private _run(edge: boolean): void {
    const target = this._resolveTarget();
    if (!target) {
      return;
    }

    // a request in flight, or no url yet: its end, or the url when it is written, comes back here
    if (target.loading || !target.url) {
      return;
    }

    if (!edge && target.url === this._asked) {
      return;
    }

    this._asked = target.url;
    target.trigger = true;

    if (this.once) {
      this._done = true;
      this._disconnectObserver();
      this._follow(null);
    }
  }
}

/** Calls `fn` after `n` animation frames. */
function afterFrames(n: number, fn: () => void): void {
  requestAnimationFrame(() => (n > 1 ? afterFrames(n - 1, fn) : fn()));
}

/** Whether `element` clips nothing of what is in it: a scroll root must (`overflow` other than `visible`). */
function doesNotScroll(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.overflowX === "visible" && style.overflowY === "visible";
}
