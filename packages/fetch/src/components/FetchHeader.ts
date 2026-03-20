export class FetchHeader extends HTMLElement {
  connectedCallback(): void {
    this.style.display = "none";
  }

  get headerName(): string {
    return this.getAttribute("name") || "";
  }

  get headerValue(): string {
    return this.getAttribute("value") || "";
  }
}
