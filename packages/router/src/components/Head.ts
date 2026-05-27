import { raiseError } from "../raiseError";

/**
 * グローバルHeadスタック
 * 最後に接続されたHeadが優先される
 */
const headStack: Head[] = [];

/**
 * 初期の<head>内容を記憶（最初のHead接続時に保存）
 *
 * 設計仕様: `initialHeadCaptured` は最初の Head 接続時に一度だけ true になる。
 * SPA ライフタイム中の初期 head 状態は、最初の Head が接続された瞬間がベースラインで、
 * それ以降に追加された <head> 要素は「初期値」ではなく「現在の値」として扱う。
 * テストや SPA リセットで初期値を再キャプチャしたい場合は `_resetHeadStack()` を呼ぶ。
 */
const initialHeadValues: Map<string, Element | null> = new Map();
let initialHeadCaptured = false;

/**
 * 要素ごとの `_getKey` 結果のキャッシュ。
 * 初期化時/キャプチャ時に算出し、以降の `_reapplyHead` ループで再計算しないようにする。
 * 要素の属性変更には追随しない（Head 内要素は初期化時に固定される前提）。
 */
const keyCache: WeakMap<Element, string> = new WeakMap();

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
   * 要素の一意キーを生成（WeakMap でキャッシュ）
   */
  private _getKey(el: Element): string {
    const cached = keyCache.get(el);
    if (cached !== undefined) {
      return cached;
    }
    const key = this._computeKey(el);
    keyCache.set(el, key);
    return key;
  }

  /**
   * 要素の一意キーを計算（実体）
   */
  private _computeKey(el: Element): string {
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

    if (tag === 'script') {
      const src = el.getAttribute('src') || '';
      const id = el.getAttribute('id') || '';
      const type = el.getAttribute('type') || '';
      if (src || id) {
        return `script:${src}:${id}:${type}`;
      }
      // インライン script はおおまかな先頭で識別（同等性は完全一致でなく簡易判定）
      return `script::${type}:${el.outerHTML.slice(0, 100)}`;
    }

    if (tag === 'style') {
      const id = el.getAttribute('id') || '';
      const media = el.getAttribute('media') || '';
      if (id) {
        return `style:${id}:${media}`;
      }
      // インライン style はおおまかな先頭で識別（同等性は完全一致でなく簡易判定）
      return `style::${media}:${el.outerHTML.slice(0, 100)}`;
    }

    // その他要素はおおまかに識別（同等性は完全一致でなく簡易判定）
    return `${tag}:${el.outerHTML.slice(0, 100)}`;
  }

  /**
   * head 内の要素を key で引ける Map を構築する。
   * `_reapplyHead` のループ前に一度だけ呼び出し、O(N) lookup に置き換えるためのヘルパ。
   *
   * 設計仕様: 同一 key の要素が複数 `document.head` 内に存在する場合は **first-wins**
   * （DOM 順で最初の要素のみ採用）。これは `_captureInitialHead` および
   * `initialHeadValues` の挙動とも整合する。
   * 重複は基本的にユーザーの記述ミスだが、_getKey の粒度（href/name 等の主要属性のみ）に
   * よる「論理的重複」もあり得るため、サイレントに first-wins とする。
   * 厳密な重複検出が必要な場合は呼び出し側で行う。
   */
  private _buildHeadElementMap(): Map<string, Element> {
    const map = new Map<string, Element>();
    for (const el of Array.from(document.head.children)) {
      const key = this._getKey(el);
      if (!map.has(key)) {
        map.set(key, el);
      }
    }
    return map;
  }

  /**
   * 初期の<head>状態をキャプチャ
   * document.head内の全ての要素をスキャンして保存する
   */
  private _captureInitialHead(): void {
    const head = document.head;
    for (const child of Array.from(head.children)) {
      const key = this._getKey(child);
      if (!initialHeadValues.has(key)) {
        initialHeadValues.set(key, child.cloneNode(true) as Element);
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

    // 現在のheadにある要素のキーも追加（管理下から外れたものを削除するため）
    // 同時に key -> Element の lookup map も構築する（O(N²) を避けるため）
    const headElementMap = this._buildHeadElementMap();
    for (const key of headElementMap.keys()) {
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
        // initialHeadValuesにはnullを保存しないため、has(key)がtrueならinitialは必ず存在しElementである
        targetElement = (initial as Element).cloneNode(true) as Element;
      }

      // headを更新
      const current = headElementMap.get(key) ?? null;
      if (targetElement) {
        if (current) {
          current.replaceWith(targetElement);
        } else {
          document.head.appendChild(targetElement);
        }
        // map を新しい要素に更新（後続の同 key 処理に備える）
        headElementMap.set(key, targetElement);
      } else {
        // 初期値もスタックにもない場合は削除
        current?.remove();
        headElementMap.delete(key);
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
