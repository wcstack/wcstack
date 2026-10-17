import { assignParams } from "../assignParams.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { ILayout, ILayoutOutlet } from "./types.js";
import { offerToBinder } from "../routeRange.js";
import { warnStrayOutlets } from "../misplacedOutletWarning.js";

/** 何かを置くノードか（空白だけのテキストとコメントは置かない） */
const hasContent = (nodes: Iterable<Node>): boolean => {
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '')) return true;
  }
  return false;
};

/**
 * 既定の `<slot>` の無いテンプレートに、名前付きのスロットの外の子（入れ子のルートとそのページ）を
 * 渡した: 子は表示されない — これまでは何も報告されなかった（docs/seam-apps.md、router-admin）。
 */
function warnNoDefaultSlot(outlet: Element): void {
  console.warn(
    `[@wcstack/router] [wcs/layout-slot-missing] This layout's template has no default <slot>, so what its ` +
    `<${config.tagNames.layout}> holds outside the named slots — the nested routes and their pages — is not shown. ` +
    `Put a <slot></slot> where the page goes.`,
    outlet,
  );
}

export class LayoutOutlet extends HTMLElement implements ILayoutOutlet {
  private _layout: (ILayout & Pick<Element,'childNodes'>) | null = null;
  private _initialized: boolean = false;
  private _initializing: boolean = false;
  private _disconnectedDuringInit: boolean = false;
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
    this._initializing = true;
    try {
      this._initialized = true;
      // attachShadow は冪等にする: 一度 await loadTemplate() 中に切断されると
      // _initialized = false で戻され、再 connect 時に _initialize() が再度走るが、
      // その時点で shadowRoot は既に存在しているため、再度 attachShadow すると
      // InvalidStateError になる。
      if (this.layout.enableShadowRoot && !this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
      }
      const template = await this.layout.loadTemplate();
      // await 中に切断された場合は DOM 副作用を残さず、次回再接続時に再初期化させる
      if (!this.isConnected) {
        this._initialized = false;
        return;
      }
      if (this.shadowRoot) {
        this.shadowRoot.appendChild(template.content.cloneNode(true));
        const unslotted: Node[] = [];
        for(const childNode of Array.from(this.layout.childNodes)) {
          this._layoutChildNodes.push(childNode);
          if (!(childNode instanceof Element) || !childNode.getAttribute('slot')) unslotted.push(childNode);
          this.appendChild(childNode);
        }
        if (!this.shadowRoot.querySelector('slot:not([name]), slot[name=""]') && hasContent(unslotted)) warnNoDefaultSlot(this);
        warnStrayOutlets(this.shadowRoot);
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
        } else if (hasContent(fragmentForChildNodes.childNodes)) {
          warnNoDefaultSlot(this);
        }

        this.appendChild(fragmentForTemplate);
        warnStrayOutlets(this);
      }
      // 置いた後で binder へ渡す（D5）。遷移で入ったルートの内容は router が渡す時点では文書の外で、
      // レイアウトのテンプレート自身の束縛もここでしか渡せない（shadow root の中は対象外）。light DOM は
      // 初期化の前は空なので、子が置いたもの。写して回す（渡した直下の for: が行を足すと番号がずれる）
      offerToBinder(Array.from(this.childNodes));
    } finally {
      this._initializing = false;
    }
  }

  async connectedCallback() {
    // レイアウトの無い outlet: サーバーが描いた <wcs-layout-outlet> がクライアントで upgrade された（router は
    // レイアウトを採用せず、内容を描き直して置き換える — README「Server-side rendering」）。何もしない。
    // 以前は `layout` の getter が throw し、深いリンクのたびに捕まらないエラーが出ていた（docs/seam-apps.md、
    // ssr-news）。outlet は router が作るもので、ページには書かない
    if (this._layout === null) return;
    if (!this._initialized) {
      this._disconnectedDuringInit = false;
      await this._initialize();
      // 初期化中（await 中）に切断された場合は副作用を残さない
      if (this._disconnectedDuringInit || !this.isConnected) {
        return;
      }
    }
  }

  disconnectedCallback() {
    // _initialize 中（await 中）に呼ばれた場合はフラグを立てて再 connect 時に init を許可する
    if (this._initializing) {
      this._disconnectedDuringInit = true;
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