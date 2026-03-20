export class FetchBody extends HTMLElement {
  constructor() {
    super();
    // スロットなしのShadow DOMでlight DOM（bodyテキスト）の描画を抑制
    this.attachShadow({ mode: "open" });
  }

  get contentType(): string {
    return this.getAttribute("type") || "application/json";
  }

  get bodyContent(): string {
    return this.textContent?.trim() || "";
  }
}
