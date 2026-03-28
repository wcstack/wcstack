import { config } from "../config";
import { IState } from "../types";
import { VERSION } from "../version";
import { getAllFragmentUUIDs, getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { getAllSsrPropertyNodes, getSsrProperties, clearSsrPropertyStore } from "../apply/ssrPropertyStore";

export interface ISsrElement {
  readonly name: string;
  readonly version: string;
  readonly stateData: IState;
  readonly templates: Map<string, HTMLTemplateElement>;
  readonly hydrateProps: Record<string, Record<string, unknown>>;
  getTemplate(uuid: string): HTMLTemplateElement | null;
  verifyVersion(): boolean;
}

// SSR コメントパターン
const SSR_PLACEHOLDER_COMMENT = /^@@wcs-(?:for|if|elseif|else):[^-]/;
const SSR_BLOCK_START = /^@@wcs-(for|if|elseif|else)-start:(.+)$/;
const SSR_BLOCK_END = /^@@wcs-(for|if|elseif|else)-end:(.+)$/;
const SSR_TEXT_START = /^@@wcs-text-start:(.+)$/;

export {
  SSR_PLACEHOLDER_COMMENT,
  SSR_BLOCK_START,
  SSR_BLOCK_END,
  SSR_TEXT_START,
};

export class Ssr extends HTMLElement implements ISsrElement {
  private _stateData: IState | null = null;
  private _templates: Map<string, HTMLTemplateElement> | null = null;
  private _hydrateProps: Record<string, Record<string, unknown>> | null = null;

  get name(): string {
    return this.getAttribute('name') || 'default';
  }

  get version(): string {
    return this.getAttribute('version') || '';
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

  /**
   * サーバーの SSR バージョンとクライアントの state バージョンを検証する。
   * メジャー・マイナーバージョンが一致すればtrue。
   * version 属性がない場合は検証スキップ（true）。
   */
  verifyVersion(): boolean {
    const serverVersion = this.version;
    if (!serverVersion) return true;
    const serverParts = serverVersion.split('.');
    const clientParts = VERSION.split('.');
    // メジャー・マイナーが一致すれば互換
    return serverParts[0] === clientParts[0] && serverParts[1] === clientParts[1];
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

  /**
   * stateData と構造テンプレート・プロパティから <wcs-ssr> の中身を構築する。
   * server パッケージの renderToString から呼ばれる。
   */
  /**
   * wcs-state 要素から $ プレフィックスや関数を除いたデータを抽出する。
   */
  static extractStateData(stateEl: Element): Record<string, any> {
    const raw = (stateEl as any).__state;
    if (!raw || typeof raw !== 'object') return {};
    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!key.startsWith('$') && typeof value !== 'function') {
        data[key] = value;
      }
    }
    return data;
  }

  static buildContent(ssrEl: Element, stateData: Record<string, any>): void {
    // 初期データ JSON
    const jsonScript = document.createElement('script');
    jsonScript.setAttribute('type', 'application/json');
    jsonScript.textContent = JSON.stringify(stateData);
    ssrEl.appendChild(jsonScript);

    // UUID で管理されているテンプレートを復元して格納
    const uuids = getAllFragmentUUIDs();
    for (const uuid of uuids) {
      const fragmentInfo = getFragmentInfoByUUID(uuid);
      if (!fragmentInfo) continue;

      const tpl = document.createElement('template');
      tpl.setAttribute('id', uuid);

      const bindResult = fragmentInfo.parseBindTextResult;
      const bindText = bindResult.bindingType === 'else'
        ? 'else:'
        : `${bindResult.bindingType}: ${bindResult.statePathName}`;
      tpl.setAttribute(config.bindAttributeName, bindText);

      const content = fragmentInfo.fragment.cloneNode(true) as DocumentFragment;
      tpl.content.appendChild(content);

      ssrEl.appendChild(tpl);
    }

    // 属性で代替不可なプロパティをハイドレーション用に格納
    const ssrNodes = getAllSsrPropertyNodes();
    if (ssrNodes.length > 0) {
      const propsData: Record<string, Record<string, unknown>> = {};
      for (let i = 0; i < ssrNodes.length; i++) {
        const node = ssrNodes[i];
        const entries = getSsrProperties(node);
        if (entries.length === 0) continue;
        const id = `wcs-ssr-${i}`;
        (node as Element).setAttribute('data-wcs-ssr-id', id);
        const props: Record<string, unknown> = {};
        for (const entry of entries) {
          props[entry.propName] = entry.value;
        }
        propsData[id] = props;
      }
      if (Object.keys(propsData).length > 0) {
        const propsScript = document.createElement('script');
        propsScript.setAttribute('type', 'application/json');
        propsScript.setAttribute('data-wcs-ssr-props', '');
        propsScript.textContent = JSON.stringify(propsData);
        ssrEl.appendChild(propsScript);
      }
    }

    clearSsrPropertyStore();
  }

  /**
   * SSR ブロック境界コメント (@@wcs-*-start/end) を除去する
   */
  static removeBlockBoundaryComments(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const toRemove: Comment[] = [];
    while (walker.nextNode()) {
      const comment = walker.currentNode as Comment;
      if (SSR_BLOCK_START.test(comment.data) || SSR_BLOCK_END.test(comment.data)) {
        toRemove.push(comment);
      }
    }
    for (const comment of toRemove) {
      comment.remove();
    }
  }

  /**
   * SSR の構造プレースホルダーコメント (@@wcs-for:uuid 等) を除去する
   */
  static removeStructuralComments(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const toRemove: Comment[] = [];
    while (walker.nextNode()) {
      const comment = walker.currentNode as Comment;
      if (SSR_PLACEHOLDER_COMMENT.test(comment.data)) {
        toRemove.push(comment);
      }
    }
    for (const comment of toRemove) {
      comment.remove();
    }
  }

  /**
   * SSR テキストバインディングコメントを復元する。
   * <!--@@wcs-text-start:path-->text<!--@@wcs-text-end:path-->
   * → <!--@@: path--> (バインディングシステムが認識する形式)
   */
  static restoreTextBindings(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const startComments: { comment: Comment, path: string }[] = [];

    while (walker.nextNode()) {
      const comment = walker.currentNode as Comment;
      const match = SSR_TEXT_START.exec(comment.data);
      if (match) {
        startComments.push({ comment, path: match[1] });
      }
    }

    for (const { comment, path } of startComments) {
      const bindComment = document.createComment(`@@: ${path}`);
      comment.parentNode!.insertBefore(bindComment, comment);

      let sibling: Node | null = comment.nextSibling;
      comment.remove();

      const endPattern = `@@wcs-text-end:${path}`;
      while (sibling) {
        const next: Node | null = sibling.nextSibling;
        if (sibling.nodeType === Node.COMMENT_NODE && (sibling as Comment).data === endPattern) {
          sibling.parentNode!.removeChild(sibling);
          break;
        }
        sibling.parentNode!.removeChild(sibling);
        sibling = next;
      }
    }
  }

  /**
   * SSR DOM をクリーンアップし、buildBindings が動作できる状態に戻す。
   * バージョン不一致時のフォールバック用。
   *
   * 1. SSR ブロック境界コメント間のレンダリング済みノードを除去
   * 2. SSR テキストバインディングを @@: 形式に復元
   * 3. プレースホルダーコメントを <wcs-ssr> 内のテンプレートで差し替え
   * 4. data-wcs-ssr-id 属性を除去
   * 5. <wcs-ssr> を除去
   */
  static cleanupDom(root: Document): void {
    const body = document.body;

    // <wcs-ssr> からテンプレート UUID マップを構築（カスタム要素未定義でも動作するよう DOM 直接走査）
    const ssrElements = root.querySelectorAll(config.tagNames.ssr);
    const templateByUuid = new Map<string, HTMLTemplateElement>();
    for (const ssrNode of ssrElements) {
      const templates = ssrNode.querySelectorAll<HTMLTemplateElement>('template[id]');
      for (const tpl of templates) {
        const id = tpl.getAttribute('id');
        if (id) {
          templateByUuid.set(id, tpl);
        }
      }
    }

    // SSR ブロック境界コメント間のレンダリング済みノードと境界コメントを除去
    const walker1 = document.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
    const startComments: Comment[] = [];
    while (walker1.nextNode()) {
      const comment = walker1.currentNode as Comment;
      if (SSR_BLOCK_START.test(comment.data)) {
        startComments.push(comment);
      }
    }
    for (const startComment of startComments) {
      const match = SSR_BLOCK_START.exec(startComment.data)!;
      const type = match[1];
      const info = match[2];
      const endPattern = `@@wcs-${type}-end:${info}`;
      let sibling = startComment.nextSibling;
      while (sibling) {
        const next = sibling.nextSibling;
        if (sibling.nodeType === Node.COMMENT_NODE && (sibling as Comment).data === endPattern) {
          sibling.remove();
          break;
        }
        sibling.remove();
        sibling = next;
      }
      startComment.remove();
    }

    // SSR テキストバインディングを @@: 形式に復元
    Ssr.restoreTextBindings(body);

    // プレースホルダーコメント (@@wcs-for:uuid 等) をテンプレートに差し替え
    const walker2 = document.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
    const placeholders: { comment: Comment, uuid: string }[] = [];
    while (walker2.nextNode()) {
      const comment = walker2.currentNode as Comment;
      if (SSR_PLACEHOLDER_COMMENT.test(comment.data)) {
        const uuid = comment.data.split(':')[1];
        placeholders.push({ comment, uuid });
      }
    }
    for (const { comment, uuid } of placeholders) {
      const tpl = templateByUuid.get(uuid);
      if (tpl) {
        const restored = document.createElement('template') as HTMLTemplateElement;
        const bindAttr = tpl.getAttribute(config.bindAttributeName);
        if (bindAttr) restored.setAttribute(config.bindAttributeName, bindAttr);
        const imported = document.importNode(tpl.content, true);
        if (imported.childNodes.length > 0) {
          restored.content.appendChild(imported);
        } else {
          for (const child of Array.from(tpl.childNodes)) {
            restored.content.appendChild(document.importNode(child, true));
          }
        }
        comment.parentNode!.replaceChild(restored, comment);
      }
    }

    // data-wcs-ssr-id 属性を除去
    const ssrIdElements = root.querySelectorAll('[data-wcs-ssr-id]');
    for (const el of ssrIdElements) {
      el.removeAttribute('data-wcs-ssr-id');
    }

    // <wcs-ssr> を除去
    for (const el of ssrElements) {
      el.remove();
    }
  }
}
