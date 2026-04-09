import { renderToString } from "./render.js";
import { IWcBindable } from "./types.js";

export class RenderCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "html", event: "wcs-render:html-changed" },
      { name: "loading", event: "wcs-render:loading-changed" },
      { name: "error", event: "wcs-render:error" },
    ],
  };

  private _html: string | null = null;
  private _loading: boolean = false;
  private _error: Error | null = null;

  get html(): string | null {
    return this._html;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): Error | null {
    return this._error;
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this.dispatchEvent(new CustomEvent("wcs-render:loading-changed", {
      detail: loading,
    }));
  }

  private _setHtml(html: string): void {
    this._html = html;
    this.dispatchEvent(new CustomEvent("wcs-render:html-changed", {
      detail: html,
    }));
  }

  private _setError(error: Error | null): void {
    this._error = error;
    this.dispatchEvent(new CustomEvent("wcs-render:error", {
      detail: error,
    }));
  }

  async render(html: string): Promise<string | null> {
    this._setLoading(true);
    this._setError(null);

    try {
      const result = await renderToString(html);
      this._setHtml(result);
      this._setLoading(false);
      return this._html;
    } catch (e: any) {
      this._setError(e instanceof Error ? e : new Error(String(e)));
      this._setLoading(false);
      return null;
    }
  }
}
