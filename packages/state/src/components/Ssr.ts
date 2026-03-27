import { config } from "../config";
import { IState } from "../types";

export interface ISsrElement {
  readonly name: string;
  readonly stateData: IState;
  readonly templates: Map<string, HTMLTemplateElement>;
  readonly hydrateProps: Record<string, Record<string, unknown>>;
  getTemplate(uuid: string): HTMLTemplateElement | null;
}

export class Ssr extends HTMLElement implements ISsrElement {
  private _stateData: IState | null = null;
  private _templates: Map<string, HTMLTemplateElement> | null = null;
  private _hydrateProps: Record<string, Record<string, unknown>> | null = null;

  get name(): string {
    return this.getAttribute('name') || 'default';
  }

  get stateData(): IState {
    if (this._stateData === null) {
      this._stateData = this._loadStateData();
    }
    return this._stateData;
  }

  get templates(): Map<string, HTMLTemplateElement> {
    if (this._templates === null) {
      this._templates = this._loadTemplates();
    }
    return this._templates;
  }

  get hydrateProps(): Record<string, Record<string, unknown>> {
    if (this._hydrateProps === null) {
      this._hydrateProps = this._loadHydrateProps();
    }
    return this._hydrateProps;
  }

  getTemplate(uuid: string): HTMLTemplateElement | null {
    return this.templates.get(uuid) ?? null;
  }

  setStateData(data: IState): void {
    this._stateData = data;
  }

  setHydrateProps(props: Record<string, Record<string, unknown>>): void {
    this._hydrateProps = props;
  }

  private _loadStateData(): IState {
    const script = this.querySelector(
      `script[type="application/json"]:not([data-wcs-ssr-props])`
    );
    if (!script) return {};
    try {
      return JSON.parse(script.textContent || '{}');
    } catch {
      return {};
    }
  }

  private _loadTemplates(): Map<string, HTMLTemplateElement> {
    const map = new Map<string, HTMLTemplateElement>();
    const templates = this.querySelectorAll<HTMLTemplateElement>('template[id]');
    for (const tpl of templates) {
      const id = tpl.getAttribute('id');
      if (id) {
        map.set(id, tpl);
      }
    }
    return map;
  }

  private _loadHydrateProps(): Record<string, Record<string, unknown>> {
    const script = this.querySelector('script[data-wcs-ssr-props]');
    if (!script) return {};
    try {
      return JSON.parse(script.textContent || '{}');
    } catch {
      return {};
    }
  }

  static findByName(root: Node, name: string): ISsrElement | null {
    const tagName = config.tagNames.ssr;
    const parentEl = root instanceof Element
      ? root
      : root instanceof Document
        ? root.documentElement
        : null;
    if (!parentEl) return null;
    const el = parentEl.querySelector(`${tagName}[name="${name}"]`);
    return el as ISsrElement | null;
  }
}
