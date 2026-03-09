export class FetchBody extends HTMLElement {
  constructor() {
    super();
    this.style.display = "none";
  }

  get contentType(): string {
    return this.getAttribute("type") || "application/json";
  }

  get bodyContent(): string {
    return this.textContent?.trim() || "";
  }
}
