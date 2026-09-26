import { config } from "../config";
import { IState } from "../types";
import { VERSION } from "../version";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { getNormalizedTextCommentData } from "../structural/getFragmentNodeInfos";
import { resolveNodePath } from "../structural/resolveNodePath";
import { IFragmentInfo } from "../structural/types";
import { getAllSsrPropertyNodes, getSsrProperties, clearSsrPropertyStore } from "../apply/ssrPropertyStore";
import { HTMLElementBase } from "../platform/HTMLElementBase";

export interface ISsrElement {
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

/**
 * script 要素へ埋め込む JSON を HTML パーサから保護する。
 * HTML 直列化時、script の中身は生のまま出力されるため、state 値に
 * "</script>" や "<!--" を含む文字列があると script を脱出できてしまう。
 * "<" ">" "&" と U+2028/U+2029 を JSON の \uXXXX エスケープへ置換する
 * (JSON.parse では元の文字列と等価に復元される)。
 */
function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * **このドキュメントから到達できる**構造テンプレートの uuid だけを、文書順・幅優先で集める。
 *
 * `fragmentInfoByUUID` はモジュール寿命の台帳で削除の口が無く、`getAllFragmentUUIDs()` を
 * そのまま直列化すると、同じプロセスで描いた**別のドキュメント**のテンプレートまで
 * `<wcs-ssr>` に載る（実測: 同じページを繰り返すと 2 → 12 テンプレートに増え、ページ A の
 * `for: secretItems` がページ B の HTML に混入した）。uuid は単調増加で再利用されないので、
 * 「この文書のプレースホルダから辿れるか」は正確な所属判定になる。
 *
 * 入れ子のテンプレートは親の fragment の中にプレースホルダコメントとして居る（`if` が偽で
 * 一度も描かれていない枝の中身も含む）ので、辿りは fragment へ再帰する。
 */
function collectReachableFragments(scanRoot: Node): Map<string, IFragmentInfo> {
  const found = new Map<string, IFragmentInfo>();
  const pending: Node[] = [scanRoot];
  while (pending.length > 0) {
    for (const placeholder of collectComments(pending.shift() as Node, isPlaceholder)) {
      const data = placeholder.data;
      const uuid = data.slice(data.indexOf(':') + 1);
      // 入れ子のプレースホルダは行ごとに現れるので重複する。台帳に無い uuid（別の
      // レンダリングの痕跡・後始末の順序違い）はそのまま落とす
      if (found.has(uuid)) continue;
      const info = getFragmentInfoByUUID(uuid);
      if (info === null) continue;
      found.set(uuid, info);
      pending.push(info.fragment);
    }
  }
  return found;
}

/**
 * `root` 以下のコメントのうち `match` が真を返すものを文書順で集める。
 *
 * この 1 本に寄せているのは、走査の**途中で DOM を壊す**呼び手が多いからでもある
 * （境界コメントの除去・テキスト束縛の復元・プレースホルダの差し替え）。先に集めてから
 * 触るという規則をここに固定しておくと、各所で TreeWalker を書き写さずに済む。
 */
export function collectComments(root: Node, match: (data: string) => boolean): Comment[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const found: Comment[] = [];
  while (walker.nextNode()) {
    const comment = walker.currentNode as Comment;
    if (match(comment.data)) {
      found.push(comment);
    }
  }
  return found;
}

const isPlaceholder = (data: string): boolean => SSR_PLACEHOLDER_COMMENT.test(data);
export const isBlockStart = (data: string): boolean => SSR_BLOCK_START.test(data);
export const isBlockBoundary = (data: string): boolean => SSR_BLOCK_START.test(data) || SSR_BLOCK_END.test(data);

/**
 * 直列化用のクローン。`getFragmentNodeInfos` がテンプレート登録時に空 Text へ潰した
 * テキスト束縛のコメントを、**クローンの上でだけ**原文へ戻す。
 *
 * 戻さないと `for` / `if` テンプレートの中の `{{ }}` がマークアップから消え、
 * ハイドレーションが束縛を復元できず、その行のテキストが**恒久的に空**になる。
 * 元の fragment は生きているページの正本なので絶対に壊さない。
 */
function cloneFragmentForSnapshot(fragmentInfo: IFragmentInfo): DocumentFragment {
  const clone = fragmentInfo.fragment.cloneNode(true) as DocumentFragment;
  for (const nodeInfo of fragmentInfo.nodeInfos) {
    const commentData = getNormalizedTextCommentData(
      resolveNodePath(fragmentInfo.fragment, nodeInfo.nodePath));
    if (commentData === null) continue;
    // nodePath はこの fragment から採ったもので、クローンは同形。ここまで来た枝は
    // 必ず解決でき、正規化された Text は必ず親を持つ（fragment 直下でも親は fragment）。
    // 同じ位置への置換なので、以降の nodePath は変わらない（正規化と対称）
    const target = resolveNodePath(clone, nodeInfo.nodePath) as Node;
    (target.parentNode as Node).replaceChild(document.createComment(commentData), target);
  }
  return clone;
}

export class Ssr extends HTMLElementBase implements ISsrElement {
  private _stateData: IState | null = null;
  private _templates: Map<string, HTMLTemplateElement> | null = null;
  private _hydrateProps: Record<string, Record<string, unknown>> | null = null;

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

  static find(root: Node): ISsrElement | null {
    const tagName = config.tagNames.ssr;
    const parentEl = root instanceof Element
      ? root
      : root instanceof Document
        ? root.documentElement
        : null;
    if (!parentEl) return null;
    const el = parentEl.querySelector(tagName);
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
    for (const key of Object.keys(raw)) {
      if (key.startsWith('$')) continue;
      // **アクセサは評価しない。** スナップショットが運ぶのはデータで、派生値は
      // クライアントが同じ宣言から作り直す。ここは Object.entries で舐めていたので、
      // own かつ enumerable な getter を**生の state オブジェクト**を this にして
      // 評価していた — proxy の上でしか意味を持たない本体（`this["items.*.n"]` や
      // `this.$getAll(...)`）が、パス getter なら NaN → JSON の null で静かに壊れ、
      // `$getAll` を呼ぶ getter なら TypeError でページ全体の SSR を落としていた
      // （docs/state-recursive-path-impl-plan.md §7）。
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (descriptor !== undefined && typeof descriptor.get === 'function') continue;
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value !== 'function') {
        data[key] = value;
      }
    }
    return data;
  }

  /**
   * @param scanRoot このスナップショットが属するツリー（既定は `ssrEl` の document）。
   *   テンプレートと props はここから到達できるものだけを載せる — モジュール寿命の台帳に
   *   残った**別のレンダリング**の分を混ぜないため（リクエスト間のデータ漏れ）。
   */
  static buildContent(ssrEl: Element, stateData: Record<string, any>, scanRoot?: Node): void {
    const root: Node = scanRoot ?? (ssrEl.ownerDocument as Document);
    // 初期データ JSON
    const jsonScript = document.createElement('script');
    jsonScript.setAttribute('type', 'application/json');
    jsonScript.textContent = escapeJsonForScript(JSON.stringify(stateData));
    ssrEl.appendChild(jsonScript);

    // この文書のプレースホルダから辿れるテンプレートだけを復元して格納
    for (const [uuid, fragmentInfo] of collectReachableFragments(root)) {
      const tpl = document.createElement('template');
      tpl.setAttribute('id', uuid);

      const bindResult = fragmentInfo.parseBindTextResult;
      const bindText = bindResult.bindingType === 'else'
        ? 'else:'
        : `${bindResult.bindingType}: ${bindResult.statePathName}`;
      tpl.setAttribute(config.bindAttributeName, bindText);

      tpl.content.appendChild(cloneFragmentForSnapshot(fragmentInfo));

      ssrEl.appendChild(tpl);
    }

    // 属性で代替不可なプロパティをハイドレーション用に格納。
    // **この文書に今も繋がっているノードだけ**を載せる — props の台帳（apply/ssrPropertyStore）は
    // `buildContent` の末尾でしか空にならないので、`enable-ssr` の無いページを 1 枚描くと
    // 次のレンダリングの props JSON に前のページの値が載っていた（実測）
    const ownerDocument = ssrEl.ownerDocument;
    const ssrNodes = getAllSsrPropertyNodes();
    if (ssrNodes.length > 0) {
      const propsData: Record<string, Record<string, unknown>> = {};
      for (let i = 0; i < ssrNodes.length; i++) {
        const node = ssrNodes[i];
        if (!node.isConnected || node.ownerDocument !== ownerDocument) continue;
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
        propsScript.textContent = escapeJsonForScript(JSON.stringify(propsData));
        ssrEl.appendChild(propsScript);
      }
    }

    clearSsrPropertyStore();
  }

  /**
   * SSR ブロック境界コメント (@@wcs-*-start/end) を除去する
   */
  static removeBlockBoundaryComments(root: Node): void {
    for (const comment of collectComments(root, isBlockBoundary)) {
      comment.remove();
    }
  }

  /**
   * SSR の構造プレースホルダーコメント (@@wcs-for:uuid 等) を除去する
   */
  static removeStructuralComments(root: Node): void {
    for (const comment of collectComments(root, isPlaceholder)) {
      comment.remove();
    }
  }

  /**
   * SSR テキストバインディングコメントを復元する。
   * <!--@@wcs-text-start:path-->text<!--@@wcs-text-end:path-->
   * → <!--@@: path--> (バインディングシステムが認識する形式)
   */
  static restoreTextBindings(root: Node): void {
    for (const comment of collectComments(root, (d) => SSR_TEXT_START.test(d))) {
      const path = (SSR_TEXT_START.exec(comment.data) as RegExpExecArray)[1];
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
    for (const startComment of collectComments(body, isBlockStart)) {
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

    // プレースホルダーコメント (@@wcs-for:uuid 等) をテンプレートに差し替える。
    // **差し替えたテンプレートの中身にも掛ける**（#258）: スナップショットのテンプレートは平らで
    // （入れ子のテンプレートは親の中身にプレースホルダとして居る — collectReachableFragments）、
    // 中身のプレースホルダが指すのはサーバーの uuid。クライアントの台帳には無いので、残すと
    // `text: <uuid>` と解釈され（binding-path-missing）、入れ子の内側が一度も描かれなかった
    // （実 Chromium で実測。同じモジュールでサーバー描画する vitest では台帳が残っていて見えない）
    const restorePlaceholders = (scope: Node): void => {
      for (const comment of collectComments(scope, isPlaceholder)) {
        const tpl = templateByUuid.get(comment.data.split(':')[1]);
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
          restorePlaceholders(restored.content);
          comment.parentNode!.replaceChild(restored, comment);
        }
      }
    };
    restorePlaceholders(body);

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
