import { describe, it, expect } from 'vitest';
import { expandShorthandPaths, expandShorthandInBindAttribute } from '../src/structural/expandShorthandPaths';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';
import { config } from '../src/config';
import { bootstrapState } from '../src/bootstrapState';
import { State } from '../src/components/State';

describe('expandShorthandPaths', () => {
  function createFragment(...nodes: Node[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
      fragment.appendChild(node);
    }
    return fragment;
  }

  describe('コメントノードの展開', () => {
    it('.name を forPath.*.name に展開すること', () => {
      const comment = document.createComment('@@: .name');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*.name');
    });

    it('. 単体を forPath.* に展開すること', () => {
      const comment = document.createComment('@@: .');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*');
    });

    it('.name | filter を forPath.*.name | filter に展開すること', () => {
      const comment = document.createComment('@@: .name|uc');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*.name|uc');
    });

    // 展開はテキスト連結のみでパス部を解釈しない（素通し性のピン — 旧 `@state` fixture の v2 置換）
    it('ワイルドカード付き相対パスをそのまま連結して展開すること', () => {
      const comment = document.createComment('@@: .tags.*');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*.tags.*');
    });

    // 最初の `|` 以降（引数・空白・二つ目のフィルタ込み）は 1 バイトも触らない（素通し性のピン）
    it('フィルタ引数・複数フィルタ付き suffix を変更せず素通しすること', () => {
      const comment = document.createComment('@@: .name|slice(0, 3)|uc');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*.name|slice(0, 3)|uc');
    });

    it('キーワード付きコメント @@wcs-text: .name を展開すること', () => {
      const comment = document.createComment(`@@${config.commentTextPrefix}: .name`);
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'items');

      expect(comment.data).toBe(`@@${config.commentTextPrefix}: items.*.name`);
    });

    it('非ショートハンドのコメントは変更しないこと', () => {
      const comment = document.createComment('@@: users.*.name');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*.name');
    });

    it('@@プレフィックスのない通常コメントは変更しないこと', () => {
      const comment = document.createComment('this is a regular comment');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('this is a regular comment');
    });

    it('ネストしたパスの forPath で展開すること', () => {
      const comment = document.createComment('@@: .total');
      const fragment = createFragment(comment);

      expandShorthandPaths(fragment, 'users.*.orders');

      expect(comment.data).toBe('@@: users.*.orders.*.total');
    });
  });

  describe('要素属性の展開', () => {
    it('単一バインディングの属性を展開すること', () => {
      const el = document.createElement('span');
      el.setAttribute(config.bindAttributeName, 'textContent: .name');
      const fragment = createFragment(el);

      expandShorthandPaths(fragment, 'users');

      expect(el.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.name');
    });

    it('複数バインディングの属性を展開すること', () => {
      const el = document.createElement('span');
      el.setAttribute(config.bindAttributeName, 'textContent: .name; class.active: .isActive');
      const fragment = createFragment(el);

      expandShorthandPaths(fragment, 'users');

      expect(el.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.name;class.active: users.*.isActive');
    });

    it('非ショートハンドの属性値は変更しないこと', () => {
      const el = document.createElement('span');
      el.setAttribute(config.bindAttributeName, 'textContent: users.*.name');
      const fragment = createFragment(el);

      expandShorthandPaths(fragment, 'users');

      expect(el.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.name');
    });

    it('data-wcs属性のない要素は影響を受けないこと', () => {
      const el = document.createElement('span');
      el.textContent = 'hello';
      const fragment = createFragment(el);

      expandShorthandPaths(fragment, 'users');

      expect(el.getAttribute(config.bindAttributeName)).toBeNull();
      expect(el.textContent).toBe('hello');
    });

    it('フィルタ付きの属性値を展開すること', () => {
      const el = document.createElement('span');
      el.setAttribute(config.bindAttributeName, 'textContent: .name|uc|trim');
      const fragment = createFragment(el);

      expandShorthandPaths(fragment, 'users');

      expect(el.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.name|uc|trim');
    });

    it('. 単体のバインディングを展開すること', () => {
      const el = document.createElement('span');
      el.setAttribute(config.bindAttributeName, 'textContent: .');
      const fragment = createFragment(el);

      expandShorthandPaths(fragment, 'items');

      expect(el.getAttribute(config.bindAttributeName)).toBe('textContent: items.*');
    });
  });

  describe('テンプレート要素のスキップ', () => {
    it('ネストしたtemplate要素の内容には入らないこと', () => {
      const innerTemplate = document.createElement('template');
      const innerComment = document.createComment('@@: .innerName');
      innerTemplate.content.appendChild(innerComment);

      const fragment = createFragment(innerTemplate);

      expandShorthandPaths(fragment, 'users');

      // template要素自体はスキップされるため、内側のコメントは変更されない
      expect(innerComment.data).toBe('@@: .innerName');
    });
  });

  describe('コメントとElementの混在', () => {
    it('コメントと要素の両方を展開すること', () => {
      const comment = document.createComment('@@: .name');
      const el = document.createElement('div');
      el.setAttribute(config.bindAttributeName, 'textContent: .age');

      const fragment = createFragment(comment, el);

      expandShorthandPaths(fragment, 'users');

      expect(comment.data).toBe('@@: users.*.name');
      expect(el.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.age');
    });
  });
});

describe('expandShorthandInBindAttribute', () => {
  it('単一バインディングを展開すること', () => {
    const result = expandShorthandInBindAttribute('for: .orders', 'users');
    expect(result).toBe('for: users.*.orders');
  });

  it('非ショートハンドは変更しないこと', () => {
    const result = expandShorthandInBindAttribute('for: orders', 'users');
    expect(result).toBe('for: orders');
  });

  it('. 単体を展開すること', () => {
    const result = expandShorthandInBindAttribute('if: .', 'users');
    expect(result).toBe('if: users.*');
  });

  it('フィルタ付きを展開すること', () => {
    const result = expandShorthandInBindAttribute('if: .isActive|not', 'users');
    expect(result).toBe('if: users.*.isActive|not');
  });

  it('末尾セミコロンの空パートを正しく処理すること', () => {
    const result = expandShorthandInBindAttribute('textContent: .name;', 'users');
    expect(result).toBe('textContent: users.*.name;');
  });

  it('コロンなしのパートを正しく処理すること', () => {
    const result = expandShorthandInBindAttribute('textContent: .name;invalidpart', 'users');
    expect(result).toBe('textContent: users.*.name;invalidpart');
  });

  // N6: shorthand チャネル経由の `@` — 展開は素通しし、パース時に移行ヒント付き parse error に落ちる
  it('@ 入り相対パスは素通しで展開され、パース時に移行ヒント付き parse error になること', () => {
    const expanded = expandShorthandInBindAttribute('textContent: .name@cart', 'users');
    expect(expanded).toBe('textContent: users.*.name@cart');
    expect(() => parseBindTextsForElement(expanded)).toThrow(/removed in v2/);
    expect(() => parseBindTextsForElement(expanded)).toThrow(/mount/);
  });
});

/**
 * 区切りの走査は**引用符の外だけ**（要件 B1）。素の `split(';')` / `indexOf(':')` /
 * `indexOf('|')` を重ねていたので、`defaults('00:00')` のようなごく普通のフィルタ引数で
 * 短縮展開が起きず、`for` 行が**無言で 1 つも描画されない**ことがあった
 * （`getBindingsReady` は reject せず、コンソールに `[wcs/binding-path-missing]` が出るだけ。
 *  lint と VS Code 拡張は自前の短縮展開で正しく解決するので緑のまま = ランタイムとの乖離）。
 */
describe('expandShorthandInBindAttribute — 引用符の中の区切り文字（要件 B1）', () => {
  it("フィルタ引数の `:` を左右の区切りと誤認しないこと（`defaults('00:00')`）", () => {
    const result = expandShorthandInBindAttribute("value|defaults('00:00'): .startTime", 'items');
    expect(result).toBe("value|defaults('00:00'): items.*.startTime");
  });

  it("右辺のフィルタ引数の `:` でも展開されること（`join(': ')`）", () => {
    const result = expandShorthandInBindAttribute("textContent: .parts|join(': ')", 'items');
    expect(result).toBe("textContent: items.*.parts|join(': ')");
  });

  it("フィルタ引数の `;` をバインディングの区切りと誤認しないこと", () => {
    const result = expandShorthandInBindAttribute("textContent: .parts|join(';')", 'items');
    expect(result).toBe("textContent: items.*.parts|join(';')");
  });

  it("引用符の中の `|` をフィルタの区切りと誤認しないこと", () => {
    const result = expandShorthandInBindAttribute("textContent: .parts|join('|')", 'items');
    expect(result).toBe("textContent: items.*.parts|join('|')");
  });

  it('引用符の中のリテラルを書き換えないこと', () => {
    // 素の走査だと `;x: .b` が 2 本目のバインディングに見え、引数の中の `.b` まで展開していた
    const result = expandShorthandInBindAttribute("value: .a|defaults(';x: .b')", 'items');
    expect(result).toBe("value: items.*.a|defaults(';x: .b')");
  });

  it('引用符を含むフィルタと普通のバインディングが同居しても両方正しく展開されること', () => {
    const result = expandShorthandInBindAttribute("value|defaults('00:00'): .startTime;textContent: .label", 'items');
    expect(result).toBe("value|defaults('00:00'): items.*.startTime;textContent: items.*.label");
  });

  it('展開後がパーサを通ること（走査の規準が正本と一致していること）', () => {
    const expanded = expandShorthandInBindAttribute("value|defaults('00:00'): .startTime", 'items');
    const [parsed] = parseBindTextsForElement(expanded);
    expect(parsed.statePathName).toBe('items.*.startTime');
    expect(parsed.inFilters[0].filterName).toBe('defaults');
    expect(parsed.inFilters[0].args).toEqual(['00:00']);
  });
});

/**
 * 指摘者が報告した再現そのもの: 短縮パスが展開されないと `.startTime` のまま残り、
 * `[wcs/binding-path-missing]` がコンソールに出るだけで **`for` の行が 1 つも描画されない**。
 * `getBindingsReady` は reject しないので、ページは静かに空になる。
 */
describe('for 行 × 引用符入りフィルタ引数（無言で 0 行になる形）', () => {
  it("value|defaults('00:00'): .startTime の for が行を描画すること", async () => {
    bootstrapState();
    const host = document.createElement('esp-host');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML =
      `<wcs-state></wcs-state><ul>` +
      `<template data-wcs="for: items"><li>` +
      `<input data-wcs="value|defaults('00:00'): .startTime">` +
      `</li></template></ul>`;
    document.body.appendChild(host);
    const element = shadowRoot.querySelector('wcs-state') as State;
    element.setInitialState({ items: [{ startTime: '09:30' }, { startTime: '17:45' }] });
    await element.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await new Promise((r) => setTimeout(r));
    await new Promise((r) => setTimeout(r));

    const inputs = Array.from(shadowRoot.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.value)).toEqual(['09:30', '17:45']);
    host.remove();
  });
});
