export class FetchBody extends HTMLElement {
  get contentType(): string {
    return this.getAttribute("type") || "application/json";
  }

  get bodyContent(): string {
    return this.textContent?.trim() || "";
  }
}
