export class FetchHeader extends HTMLElement {
  get headerName(): string {
    return this.getAttribute("name") || "";
  }

  get headerValue(): string {
    return this.getAttribute("value") || "";
  }
}
