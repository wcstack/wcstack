import { getUUID } from "../getUUID.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { ILayout } from "./types.js";

const cache = new Map<string, string>();

/**
 * Layout テンプレートキャッシュをクリアする。
 * テストや長時間 SPA でメモリリークを避けるため、リセットしたい場合に利用する。
 */
export function _clearLayoutCache(): void {
  cache.clear();
}

export class Layout extends HTMLElement implements ILayout {
  private _uuid: string = getUUID();
  constructor() {
    super();
  }

  private async _loadTemplateFromSource(source: string): Promise<string> {
    try {
      const response = await fetch(source);
      if (!response.ok) {
        raiseError(`${config.tagNames.layout} failed to fetch layout from source: ${source}, status: ${response.status}`);
      }
      const templateContent = await response.text();
      cache.set(source, templateContent);
      return templateContent;
    } catch (error) {
      // 元の例外を cause として伝播し、スタックトレースを保持する
      raiseError(
        `${config.tagNames.layout} failed to load layout from source: ${source}, error: ${error}`,
        { cause: error }
      );
    }
  }

  private _loadTemplateFromDocument(id: string): string | null {
    const element = document.getElementById(`${id}`) as HTMLElement | null;
    if (element) {
      if (element instanceof HTMLTemplateElement) {
        return element.innerHTML;
      }
    }
    return null;
  }

  async loadTemplate(): Promise<HTMLTemplateElement> {
    const source = this.getAttribute('src');
    const layoutId = this.getAttribute('layout');
    if (source && layoutId) {
      console.warn(`${config.tagNames.layout} have both "src" and "layout" attributes.`);
    }
    const template = document.createElement('template');
    if (source) {
      if (cache.has(source)) {
        template.innerHTML = cache.get(source) || '';
      } else {
        // _loadTemplateFromSource は内部で cache.set を実行する
        template.innerHTML = await this._loadTemplateFromSource(source) || '';
      }
    } else if (layoutId) {
      const templateContent = this._loadTemplateFromDocument(layoutId);
      if (templateContent) {
        template.innerHTML = templateContent;
      } else {
        console.warn(`${config.tagNames.layout} could not find template with id "${layoutId}".`);
      }
    }
    return template;
  }

  get uuid(): string {
    return this._uuid;
  }

  get enableShadowRoot(): boolean {
    if (this.hasAttribute('enable-shadow-root')) {
      return true;
    } else if (this.hasAttribute('disable-shadow-root')) {
      return false;
    }
    return config.enableShadowRoot;
  }

  get name(): string {
    // Layout 要素が DOM に挿入されないケース（parseで置換）でも name を取れるようにする
    return this.getAttribute('name') || '';
  }
}
