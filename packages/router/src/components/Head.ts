import { raiseError } from "../raiseError";

/**
 * グローバルHeadスタック
 * 最後に接続されたHeadが優先される
 */
const headStack: Head[] = [];

/**
 * 初期の<head>内容を記憶（最初のHead接続時に保存）
 */
const initialHeadValues: Map<string, Element | null> = new Map();
let initialHeadCaptured = false;

export class Head extends HTMLElement {
  private _initialized: boolean = false;
  private _childElementArray: Element[] = [];

  constructor() {
    super();
    this.style.display = 'none';
  }

  private _initialize(): void {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    this._childElementArray = Array.from(this.children);
    for (const child of this._childElementArray) {
      this.removeChild(child);
    }
  }

  connectedCallback(): void {
    this._initialize();
    
    // 初回のみ初期状態を保存
    if (!initialHeadCaptured) {
      this._captureInitialHead();
      initialHeadCaptured = true;
    }
    
    // スタックに追加
    headStack.push(this);
    
    // headを再適用
    this._reapplyHead();
  }

  disconnectedCallback(): void {
    // スタックから削除
    const index = headStack.indexOf(this);
    if (index !== -1) {
      headStack.splice(index, 1);
    }
    
    // headを再適用（スタックが空なら初期状態に戻す）
    this._reapplyHead();
  }

  get childElementArray(): Element[] {
    if (!this._initialized) {
      raiseError('Head component is not initialized yet.');
    }
    return this._childElementArray;
  }

  /**
   * 要素の一意キーを生成
   */
  private _getKey(el: Element): string {
    const tag = el.tagName.toLowerCase();

    if (tag === 'title') {
      return 'title';
    }

    if (tag === 'meta') {
      const name = el.getAttribute('name') || '';
      const property = el.getAttribute('property') || '';
      const httpEquiv = el.getAttribute('http-equiv') || '';
      const charset = el.hasAttribute('charset') ? 'charset' : '';
      const media = el.getAttribute('media') || '';
      return `meta:${name}:${property}:${httpEquiv}:${charset}:${media}`;
    }

    if (tag === 'link') {
      const rel = el.getAttribute('rel') || '';
      const href = el.getAttribute('href') || '';
      const media = el.getAttribute('media') || '';
      return `link:${rel}:${href}:${media}`;
    }

    if (tag === 'base') {
      return 'base';
    }

    // script, style等はouterHTMLの先頭で識別（フォールバック）
    return `${tag}:${el.outerHTML.slice(0, 100)}`;
  }

  /**
   * head内で指定のキーに一致する要素を検索
   */
  private _findInHead(key: string): Element | null {
    const head = document.head;
    for (const el of Array.from(head.children)) {
      if (this._getKey(el) === key) {
        return el;
      }
    }
    return null;
  }

  /**
   * 初期の<head>状態をキャプチャ
   */
  private _captureInitialHead(): void {
    // 自身のキーを収集
    const allKeys = new Set<string>();
    for (const child of this._childElementArray) {
      allKeys.add(this._getKey(child));
    }
    
    // 各キーの初期値を保存
    for (const key of allKeys) {
      if (!initialHeadValues.has(key)) {
        const existing = this._findInHead(key);
        initialHeadValues.set(key, existing ? existing.cloneNode(true) as Element : null);
      }
    }
  }

  /**
   * スタック全体からheadを再構築
   * 後のHeadが優先される（上書き）
   */
  private _reapplyHead(): void {
    // 全スタックのHeadが扱うキーを収集
    const allKeys = new Set<string>();
    for (const head of headStack) {
      for (const child of head._childElementArray) {
        allKeys.add(this._getKey(child));
      }
    }
    // 初期値にあるキーも追加
    for (const key of initialHeadValues.keys()) {
      allKeys.add(key);
    }

    // 各キーについて、最も優先度の高い値を決定
    for (const key of allKeys) {
      // スタックを逆順に見て、最初に見つかった値を使用
      let targetElement: Element | null = null;
      for (let i = headStack.length - 1; i >= 0; i--) {
        const head = headStack[i];
        for (const child of head._childElementArray) {
          if (this._getKey(child) === key) {
            targetElement = child.cloneNode(true) as Element;
            break;
          }
        }
        if (targetElement) break;
      }

      // スタックに該当がなければ初期値を使用
      if (!targetElement && initialHeadValues.has(key)) {
        const initial = initialHeadValues.get(key);
        targetElement = initial ? initial.cloneNode(true) as Element : null;
      }

      // headを更新
      const current = this._findInHead(key);
      if (targetElement) {
        if (current) {
          current.replaceWith(targetElement);
        } else {
          document.head.appendChild(targetElement);
        }
      } else {
        // 初期値もスタックにもない場合は削除
        current?.remove();
      }
    }
  }
}

// テスト用にスタックをリセットする関数
export function _resetHeadStack(): void {
  headStack.length = 0;
  initialHeadValues.clear();
  initialHeadCaptured = false;
}
