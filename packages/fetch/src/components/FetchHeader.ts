import { reflectAttribute } from "../protocol/inputAttribute.js";

/**
 * `<wcs-fetch-header name value>`: one request header of the `<wcs-fetch>` it sits in, read when a
 * request starts. `name` / `value` are properties too, reflected to the attributes (`null` removes
 * one, `undefined` restores the markup's), so a binding — `data-wcs="value: authHeader"` — sets the
 * header. Without a `value` attribute the header is not sent: a token that is not there yet sends
 * no `Authorization` instead of an empty one. Before this, `value:` wrote an expando the element
 * never read, and the request went out with an empty header (docs/seam-apps.md, router-auth).
 *
 * It declares no `wcBindable`: it is part of `<wcs-fetch>`'s markup, not an I/O node of its own.
 */
export class FetchHeader extends HTMLElement {
  connectedCallback(): void {
    // A value assigned before the element was upgraded sits on the instance and hides the
    // accessor: pass it through the setter (the upgrade-properties pattern, for two members).
    for (const key of ["name", "value"] as const) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = this[key];
        delete (this as Record<string, unknown>)[key];
        this[key] = value;
      }
    }
    this.style.display = "none";
  }

  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: unknown) {
    reflectAttribute(this, "name", value);
  }

  get value(): string {
    return this.getAttribute("value") ?? "";
  }

  set value(value: unknown) {
    reflectAttribute(this, "value", value);
  }

  get headerName(): string {
    return this.name;
  }

  get headerValue(): string {
    return this.value;
  }

  /** Whether the header is sent: it has a name and a `value` attribute (an empty one included). */
  get hasHeader(): boolean {
    return this.name !== "" && this.hasAttribute("value");
  }
}
