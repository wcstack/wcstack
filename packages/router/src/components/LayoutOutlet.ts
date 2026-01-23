import { assignParams } from "../assignParams.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { ILayout, ILayoutOutlet } from "./types.js";

export class LayoutOutlet extends HTMLElement implements ILayoutOutlet {
  private _layout: (ILayout & Pick<Element,'childNodes'>) | null = null;
  private _initialized: boolean = false;
  private _layoutChildNodes: Node[] = [];
  constructor() {
    super();
  }

  get layout(): ILayout {
    if (!this._layout) {
      raiseError(`${config.tagNames.layoutOutlet} has no layout.`);
    }
    return this._layout;
  }
  set layout(value: ILayout) {
    this._layout = value;
    this.setAttribute('name', value.name);
  }
  
  get name(): string {
    return this.layout.name;
  }

  private async _initialize(): Promise<void> {
    this._initialized = true;
    if (this.layout.enableShadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    const template = await this.layout.loadTemplate();
    if (this.shadowRoot) {
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      for(const childNode of Array.from(this.layout.childNodes)) {
        this._layoutChildNodes.push(childNode);
        this.appendChild(childNode);
      }
    } else {
      const fragmentForTemplate = template.content.cloneNode(true) as DocumentFragment;
      const slotElementBySlotName: Map<string, Element> = new Map();
      fragmentForTemplate.querySelectorAll('slot').forEach((slotElement) => {
        const slotName = slotElement.getAttribute('name') || '';
        if (!slotElementBySlotName.has(slotName)) {
          slotElementBySlotName.set(slotName, slotElement);
        } else {
          console.warn(`${config.tagNames.layoutOutlet} duplicate slot name "${slotName}" in layout template.`);
        }
      });

      const fragmentBySlotName: Map<string, DocumentFragment> = new Map();
      const fragmentForChildNodes = document.createDocumentFragment();
      for(const childNode of Array.from(this.layout.childNodes)) {
        this._layoutChildNodes.push(childNode);
        if (childNode instanceof Element) {
          const slotName = childNode.getAttribute('slot') || '';
          if (slotName.length > 0 && slotElementBySlotName.has(slotName)) {
            if (!fragmentBySlotName.has(slotName)) {
              fragmentBySlotName.set(slotName, document.createDocumentFragment());
            }
            fragmentBySlotName.get(slotName)?.appendChild(childNode);
            continue;
          }
        }
        fragmentForChildNodes.appendChild(childNode);
      }
      for(const [slotName, slotElement] of slotElementBySlotName) {
        const fragment = fragmentBySlotName.get(slotName);
        if (fragment) {
          slotElement.replaceWith(fragment);
        }
      }
      const defaultSlot = slotElementBySlotName.get('');
      if (defaultSlot) {
        defaultSlot.replaceWith(fragmentForChildNodes);
      }

      this.appendChild(fragmentForTemplate);
    }
  } 

  async connectedCallback() {
    if (!this._initialized) {
      await this._initialize();
    }
  }

  assignParams(params: Record<string, any>): void {
    for(const childNode of this._layoutChildNodes) {
      if (childNode instanceof Element) {
        childNode.querySelectorAll('[data-bind]').forEach((e) => {
          // 子要素にパラメータを割り当て
          assignParams(e, params);
        });
        if (childNode.hasAttribute('data-bind')) {
          // 子要素にパラメータを割り当て
          assignParams(childNode, params);
        }
      }
    }
  }
}

export function createLayoutOutlet(): LayoutOutlet {
  return document.createElement(config.tagNames.layoutOutlet) as LayoutOutlet;
}