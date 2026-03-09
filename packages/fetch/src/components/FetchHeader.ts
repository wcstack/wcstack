export class FetchHeader extends HTMLElement {
  constructor() {
    super();
    this.style.display = "none";
  }

  get headerName(): string {
    return this.getAttribute("name") || "";
  }

  get headerValue(): string {
    return this.getAttribute("value") || "";
  }
}
