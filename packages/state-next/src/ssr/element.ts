/**
 * `<wcs-ssr>` (`config.tagNames.ssr`): the server's snapshot before a `<wcs-state enable-ssr>` —
 * `version`, the state's data (a JSON `<script>`) and the page-level templates. The SSR add-on
 * defines the tag; this class only reads the snapshot (the add-on hydrates from it and removes it).
 */
import { config } from "../config";
import { VERSION } from "../version";

export interface ISsrElement {
  /** The @wcstack/state version that rendered the page. */
  readonly version: string;
  /** The state's data the server rendered with. */
  readonly stateData: Record<string, any>;
  /** The page-level templates, by id. */
  readonly templates: Map<string, HTMLTemplateElement>;
  /** Always empty: every binding is applied when the client adopts the server's DOM (3.x kept a value table here). */
  readonly hydrateProps: Record<string, Record<string, unknown>>;
  getTemplate(id: string): HTMLTemplateElement | null;
  /** The snapshot is adoptable: the same major.minor as this build. */
  verifyVersion(): boolean;
}

const majorMinor = (v: string): string => v.split(".").slice(0, 2).join(".");

export class Ssr extends HTMLElement implements ISsrElement {
  /** The first snapshot element under `root`, or null. */
  static find(root: Node): ISsrElement | null {
    return ((root as ParentNode).querySelector?.(config.tagNames.ssr) as Ssr | null) ?? null;
  }

  get version(): string {
    return this.getAttribute("version") ?? "";
  }

  get stateData(): Record<string, any> {
    const script = this.querySelector('script[type="application/json"]');
    return script === null ? {} : JSON.parse(script.textContent || "{}");
  }

  get templates(): Map<string, HTMLTemplateElement> {
    const map = new Map<string, HTMLTemplateElement>();
    for (const t of Array.from(this.children)) if (t.localName === "template") map.set(t.id, t as HTMLTemplateElement);
    return map;
  }

  get hydrateProps(): Record<string, Record<string, unknown>> {
    return {};
  }

  getTemplate(id: string): HTMLTemplateElement | null {
    return this.templates.get(id) ?? null;
  }

  verifyVersion(): boolean {
    return majorMinor(this.version) === majorMinor(VERSION);
  }
}

/** Defines `<wcs-ssr>` in `registry` (once per registry). */
export function defineSsr(registry: CustomElementRegistry): void {
  const tag = config.tagNames.ssr;
  if (registry.get(tag) === undefined) registry.define(tag, class extends Ssr {});
}
