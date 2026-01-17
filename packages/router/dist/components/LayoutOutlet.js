import { assignParams } from "../assignParams.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
export class LayoutOutlet extends HTMLElement {
    _layout = null;
    _initialized = false;
    _layoutChildNodes = [];
    constructor() {
        super();
    }
    get layout() {
        if (!this._layout) {
            raiseError(`${config.tagNames.layoutOutlet} has no layout.`);
        }
        return this._layout;
    }
    set layout(value) {
        this._layout = value;
        this.setAttribute('name', value.name);
    }
    get name() {
        return this.layout.name;
    }
    async _initialize() {
        this._initialized = true;
        if (this.layout.enableShadowRoot) {
            this.attachShadow({ mode: 'open' });
        }
        const template = await this.layout.loadTemplate();
        if (this.shadowRoot) {
            this.shadowRoot.appendChild(template.content.cloneNode(true));
            for (const childNode of Array.from(this.layout.childNodes)) {
                this._layoutChildNodes.push(childNode);
                this.appendChild(childNode);
            }
        }
        else {
            const fragmentForTemplate = template.content.cloneNode(true);
            const slotElementBySlotName = new Map();
            fragmentForTemplate.querySelectorAll('slot').forEach((slotElement) => {
                const slotName = slotElement.getAttribute('name') || '';
                if (!slotElementBySlotName.has(slotName)) {
                    slotElementBySlotName.set(slotName, slotElement);
                }
                else {
                    console.warn(`${config.tagNames.layoutOutlet} duplicate slot name "${slotName}" in layout template.`);
                }
            });
            const fragmentBySlotName = new Map();
            const fragmentForChildNodes = document.createDocumentFragment();
            for (const childNode of Array.from(this.layout.childNodes)) {
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
            for (const [slotName, slotElement] of slotElementBySlotName) {
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
    assignParams(params) {
        for (const childNode of this._layoutChildNodes) {
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
export function createLayoutOutlet() {
    return document.createElement(config.tagNames.layoutOutlet);
}
//# sourceMappingURL=LayoutOutlet.js.map