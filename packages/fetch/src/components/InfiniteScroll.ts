import { Fetch } from "./Fetch.js";
import { config } from "../config.js";

export class InfiniteScroll extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["target", "root", "root-margin", "threshold", "disabled"];
  }

  private _observer: IntersectionObserver | null = null;
  private _done: boolean = false;
  // the target last warned about (once per value)
  private _warnedTarget: string | null = null;

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

    this._observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        this._triggerFetch();
      }
    }, {
      root: this._resolveRoot(),
      rootMargin: this.rootMargin,
      threshold: this.threshold,
    });
    this._observer.observe(this);
  }

  private _disconnectObserver(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  private _resolveRoot(): Element | Document | null {
    if (!this.root) return null;
    return document.getElementById(this.root) || null;
  }

  private _triggerFetch(): void {
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
      return;
    }

    if (target.loading) {
      return;
    }

    target.trigger = true;

    if (this.once) {
      this._done = true;
      this._disconnectObserver();
    }
  }
}