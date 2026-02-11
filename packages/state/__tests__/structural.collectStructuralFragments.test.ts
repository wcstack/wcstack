import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { getFragmentInfoByUUID, setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { config } from '../src/config';
import { setStateElementByName } from '../src/stateElementByName';

let uuidCounter = 0;
vi.mock('../src/getUUID', () => ({
  getUUID: () => `uuid-collect-${uuidCounter++}`
}));

vi.mock('../src/stateElementByName', () => {
  const map = new Map();
  return {
    getStateElementByName: (_rootNode: Node, name: string) => map.get(name) || null,
    setStateElementByName: (_rootNode: Node, name: string, el: any) => {
      if (el === null) map.delete(name);
      else map.set(name, el);
    }
  };
});

describe('collectStructuralFragments', () => {
  beforeEach(() => {
    setStateElementByName(document, 'default', {
      setPathInfo: vi.fn(),
    } as any);
  });

  afterEach(() => {
    // Clean up all UUIDs
    for (let i = 0; i < uuidCounter; i++) {

      setFragmentInfoByUUID(`uuid-collect-${i}`, document, null);
    }
    uuidCounter = 0;
    document.body.innerHTML = '';
  });

  it('templateをコメントに置換しfragmentInfoを登録すること', () => {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'for: items');

    const inner = document.createElement('span');
    inner.setAttribute(config.bindAttributeName, 'textContent: message');
    template.content.appendChild(inner);

    root.appendChild(template);

    collectStructuralFragments(root, root);

    const first = root.firstChild as Comment;
    expect(first.nodeType).toBe(Node.COMMENT_NODE);
    expect(first.data).toBe(`@@${config.commentForPrefix}:uuid-collect-0`);

    const info = getFragmentInfoByUUID('uuid-collect-0');
    expect(info).not.toBeNull();
    expect(info?.parseBindTextResult.bindingType).toBe('for');
    expect(info?.nodeInfos.length).toBe(1);
  });

  it('構造系以外のバインドはスキップされること', () => {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'textContent: message');
    root.appendChild(template);

    collectStructuralFragments(root, root);

    expect(root.firstChild).toBe(template);
    expect(getFragmentInfoByUUID('uuid-collect-0')).toBeNull();
  });

  it('templateのバインドが空または非template要素はスキップされること', () => {
    const root = document.createElement('div');
    const nonTemplate = document.createElement('span');
    nonTemplate.setAttribute(config.bindAttributeName, 'for: items');

    const emptyTemplate = document.createElement('template');
    emptyTemplate.setAttribute(config.bindAttributeName, '');

    root.appendChild(nonTemplate);
    root.appendChild(emptyTemplate);

    collectStructuralFragments(root, root);

    expect(root.childNodes[0]).toBe(nonTemplate);
    expect(root.childNodes[1]).toBe(emptyTemplate);
    expect(getFragmentInfoByUUID('uuid-collect-0')).toBeNull();
  });

  it('非template要素をスキップしつつtemplateを処理できること', () => {
    const root = document.createElement('div');
    const nonTemplate = document.createElement('span');
    nonTemplate.textContent = 'skip';

    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'if: ok');

    root.appendChild(nonTemplate);
    root.appendChild(template);

    collectStructuralFragments(root, root);

    const first = root.childNodes[0] as HTMLElement;
    const second = root.childNodes[1] as Comment;
    expect(first).toBe(nonTemplate);
    expect(second.nodeType).toBe(Node.COMMENT_NODE);
    expect(second.data).toBe(`@@${config.commentIfPrefix}:uuid-collect-0`);
  });

  it('acceptNodeのFILTER_SKIPが実行されること', () => {
    const originalCreateTreeWalker = document.createTreeWalker.bind(document);
    const root = document.createElement('div');

    document.createTreeWalker = ((
      _root: Node,
      _whatToShow: number,
      filter: any
    ) => {
      const nonTemplate = document.createElement('span');
      const emptyTemplate = document.createElement('template');
      emptyTemplate.setAttribute(config.bindAttributeName, '');

      filter.acceptNode(nonTemplate);
      filter.acceptNode(emptyTemplate);

      return {
        currentNode: _root,
        nextNode: () => false
      } as any;
    }) as any;

    try {
      collectStructuralFragments(root, root);
    } finally {
      document.createTreeWalker = originalCreateTreeWalker as any;
    }
  });

  it('mockしたTreeWalkerでwhileループ内のbindText取得が実行されること', () => {
    const originalCreateTreeWalker = document.createTreeWalker.bind(document);
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'for: items');
    root.appendChild(template);

    let called = false;
    document.createTreeWalker = ((
      _root: Node,
      _whatToShow: number,
      _filter: NodeFilter
    ) => {
      if (_root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        return { currentNode: _root, nextNode: () => false } as any;
      }
      return {
        currentNode: template,
        nextNode: () => {
          if (called) return false;
          called = true;
          return true;
        }
      } as any;
    }) as any;

    try {
      collectStructuralFragments(root, root);
    } finally {
      document.createTreeWalker = originalCreateTreeWalker as any;
    }
  });

  it('bindTextのフォールバック分岐が実行されること', async () => {
    vi.resetModules();
    vi.doMock('../src/bindTextParser/parseBindTextsForElement', () => ({
      parseBindTextsForElement: () => [{ bindingType: 'for', stateName: 'default' }]
    }));

    const { setStateElementByName } = await import('../src/stateElementByName');
    setStateElementByName(document, 'default', {
      setPathInfo: vi.fn(),
    } as any);

    const { collectStructuralFragments: collectWithMock } = await import('../src/structural/collectStructuralFragments');

    const root = document.createElement('div');
    const template = document.createElement('template');
    let calls = 0;
    template.getAttribute = vi.fn((_name: string) => {
      calls += 1;
      return calls === 1 ? 'for: items' : '';
    }) as any;

    root.appendChild(template);

    collectWithMock(root, root);

    expect(calls).toBeGreaterThanOrEqual(2);

    vi.doUnmock('../src/bindTextParser/parseBindTextsForElement');
  });

  it('if-else構造が正しく処理されること', () => {
    const root = document.createElement('div');
    
    const ifTemplate = document.createElement('template');
    ifTemplate.setAttribute(config.bindAttributeName, 'if: condition');
    ifTemplate.content.appendChild(document.createTextNode('if content'));
    
    const elseTemplate = document.createElement('template');
    elseTemplate.setAttribute(config.bindAttributeName, 'else:');
    elseTemplate.content.appendChild(document.createTextNode('else content'));
    
    root.appendChild(ifTemplate);
    root.appendChild(elseTemplate);

    collectStructuralFragments(root, root);

    // if コメントノードが生成されている
    const ifComment = root.childNodes[0] as Comment;
    expect(ifComment.nodeType).toBe(Node.COMMENT_NODE);
    expect(ifComment.data).toContain(config.commentIfPrefix);

    // if の fragmentInfo を取得
    const ifUuid = ifComment.data.split(':')[1];
    const ifInfo = getFragmentInfoByUUID(ifUuid);
    expect(ifInfo).not.toBeNull();
    expect(ifInfo?.parseBindTextResult.bindingType).toBe('if');
  });

  it('if-elseif-else構造が正しく処理されること', () => {
    const root = document.createElement('div');
    
    const ifTemplate = document.createElement('template');
    ifTemplate.setAttribute(config.bindAttributeName, 'if: cond1');
    ifTemplate.content.appendChild(document.createTextNode('if content'));
    
    const elseifTemplate = document.createElement('template');
    elseifTemplate.setAttribute(config.bindAttributeName, 'elseif: cond2');
    elseifTemplate.content.appendChild(document.createTextNode('elseif content'));
    
    const elseTemplate = document.createElement('template');
    elseTemplate.setAttribute(config.bindAttributeName, 'else:');
    elseTemplate.content.appendChild(document.createTextNode('else content'));
    
    root.appendChild(ifTemplate);
    root.appendChild(elseifTemplate);
    root.appendChild(elseTemplate);

    collectStructuralFragments(root, root);

    // if コメントが生成されている
    const ifComment = root.childNodes[0] as Comment;
    expect(ifComment.nodeType).toBe(Node.COMMENT_NODE);
    expect(ifComment.data).toContain(config.commentIfPrefix);
    
    // if の fragmentInfo を取得
    const ifUuid = ifComment.data.split(':')[1];
    const ifInfo = getFragmentInfoByUUID(ifUuid);
    expect(ifInfo).not.toBeNull();
    expect(ifInfo?.parseBindTextResult.bindingType).toBe('if');
  });

  it('複数elseifでelseチェーンが連結されること', () => {
    const root = document.createElement('div');

    const ifTemplate = document.createElement('template');
    ifTemplate.setAttribute(config.bindAttributeName, 'if: cond1');
    ifTemplate.content.appendChild(document.createTextNode('if content'));

    const elseifTemplate1 = document.createElement('template');
    elseifTemplate1.setAttribute(config.bindAttributeName, 'elseif: cond2');
    elseifTemplate1.content.appendChild(document.createTextNode('elseif content 1'));

    const elseifTemplate2 = document.createElement('template');
    elseifTemplate2.setAttribute(config.bindAttributeName, 'elseif: cond3');
    elseifTemplate2.content.appendChild(document.createTextNode('elseif content 2'));

    const elseTemplate = document.createElement('template');
    elseTemplate.setAttribute(config.bindAttributeName, 'else:');
    elseTemplate.content.appendChild(document.createTextNode('else content'));

    root.appendChild(ifTemplate);
    root.appendChild(elseifTemplate1);
    root.appendChild(elseifTemplate2);
    root.appendChild(elseTemplate);

    collectStructuralFragments(root, root);

    // DOM上にはifのプレースホルダと最初のelseプレースホルダのみが残る
    expect(root.childNodes.length).toBe(2);
    const elseComment1 = root.childNodes[1] as Comment;
    expect(elseComment1.data).toContain(config.commentElsePrefix);

    const elseUuid1 = elseComment1.data.split(':')[1];
    const elseInfo1 = getFragmentInfoByUUID(elseUuid1);
    expect(elseInfo1?.nodeInfos.length).toBe(2); // elseif1 + else(elseif2)

    const elseComment2 = elseInfo1?.fragment.childNodes[1] as Comment;
    const elseUuid2 = elseComment2.data.split(':')[1];
    const elseInfo2 = getFragmentInfoByUUID(elseUuid2);
    expect(elseInfo2?.nodeInfos.length).toBe(2); // elseif2 + else
  });

  it('elseが先行するifなしで使われた場合はエラーになること', () => {
    const root = document.createElement('div');
    
    const elseTemplate = document.createElement('template');
    elseTemplate.setAttribute(config.bindAttributeName, 'else:');
    elseTemplate.content.appendChild(document.createTextNode('else content'));
    
    root.appendChild(elseTemplate);

    expect(() => collectStructuralFragments(root, root)).toThrow(/else.*without preceding/);
  });

  it('elseifが先行するifなしで使われた場合はエラーになること', () => {
    const root = document.createElement('div');
    
    const elseifTemplate = document.createElement('template');
    elseifTemplate.setAttribute(config.bindAttributeName, 'elseif: cond2');
    elseifTemplate.content.appendChild(document.createTextNode('elseif content'));
    
    root.appendChild(elseifTemplate);

    expect(() => collectStructuralFragments(root, root)).toThrow(/elseif.*without preceding/);
  });

  it('forテンプレート内の空白テキストノードが除去されること', () => {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'for: items');

    // テンプレート内に空白テキストノードと要素を混在
    template.content.appendChild(document.createTextNode('\n  '));
    const span = document.createElement('span');
    span.textContent = 'item';
    template.content.appendChild(span);
    template.content.appendChild(document.createTextNode('\n'));

    root.appendChild(template);
    collectStructuralFragments(root, root);

    const info = getFragmentInfoByUUID('uuid-collect-0');
    expect(info).not.toBeNull();
    // 空白テキストノードが除去され、spanのみ残ること
    expect(info?.fragment.childNodes.length).toBe(1);
    expect(info?.fragment.childNodes[0].nodeName).toBe('SPAN');
  });

  it('ifテンプレート内の空白テキストノードが除去されること', () => {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'if: flag');

    template.content.appendChild(document.createTextNode('  '));
    const div = document.createElement('div');
    template.content.appendChild(div);
    template.content.appendChild(document.createTextNode('\t\n'));

    root.appendChild(template);
    collectStructuralFragments(root, root);

    const info = getFragmentInfoByUUID('uuid-collect-0');
    expect(info).not.toBeNull();
    expect(info?.fragment.childNodes.length).toBe(1);
    expect(info?.fragment.childNodes[0]).toBe(div);
  });

  it('SVG内のtemplateが正しく処理されること', () => {
    const root = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'for: items');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '10');
    circle.setAttribute('cy', '10');
    circle.setAttribute('r', '5');
    template.content.appendChild(circle);

    svg.appendChild(template);
    root.appendChild(svg);

    collectStructuralFragments(root, root);

    // SVG内のtemplateがコメントに置換されていること
    const comment = svg.firstChild as Comment;
    expect(comment.nodeType).toBe(Node.COMMENT_NODE);
    expect(comment.data).toBe(`@@${config.commentForPrefix}:uuid-collect-0`);

    const info = getFragmentInfoByUUID('uuid-collect-0');
    expect(info).not.toBeNull();
    expect(info?.parseBindTextResult.bindingType).toBe('for');
    expect(info?.fragment.firstChild).toBe(circle);
  });

  it('SVG内の複数のtemplateが正しく処理されること', () => {
    const root = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    const ifTemplate = document.createElement('template');
    ifTemplate.setAttribute(config.bindAttributeName, 'if: visible');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ifTemplate.content.appendChild(rect);

    const forTemplate = document.createElement('template');
    forTemplate.setAttribute(config.bindAttributeName, 'for: points');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    forTemplate.content.appendChild(circle);

    svg.appendChild(ifTemplate);
    svg.appendChild(forTemplate);
    root.appendChild(svg);

    collectStructuralFragments(root, root);

    // 両方のtemplateがコメントに置換されていること
    expect(svg.childNodes.length).toBe(2);
    expect(svg.childNodes[0].nodeType).toBe(Node.COMMENT_NODE);
    expect(svg.childNodes[1].nodeType).toBe(Node.COMMENT_NODE);

    const ifInfo = getFragmentInfoByUUID('uuid-collect-0');
    const forInfo = getFragmentInfoByUUID('uuid-collect-1');
    expect(ifInfo?.parseBindTextResult.bindingType).toBe('if');
    expect(forInfo?.parseBindTextResult.bindingType).toBe('for');
  });

  describe('ドットショートハンドパス展開', () => {
    it('forテンプレート内のコメントノードのショートハンドが展開されること', () => {
      const root = document.createElement('div');
      const template = document.createElement('template');
      template.setAttribute(config.bindAttributeName, 'for: users');

      // Mustacheコメント形式のショートハンド
      const comment = document.createComment('@@: .name');
      template.content.appendChild(comment);

      root.appendChild(template);
      collectStructuralFragments(root, root);

      const info = getFragmentInfoByUUID('uuid-collect-0');
      expect(info).not.toBeNull();
      // コメントが展開されていること
      const fragmentComment = info?.fragment.firstChild as Comment;
      expect(fragmentComment.data).toBe('@@: users.*.name');
    });

    it('forテンプレート内の要素属性のショートハンドが展開されること', () => {
      const root = document.createElement('div');
      const template = document.createElement('template');
      template.setAttribute(config.bindAttributeName, 'for: items');

      const span = document.createElement('span');
      span.setAttribute(config.bindAttributeName, 'textContent: .label');
      template.content.appendChild(span);

      root.appendChild(template);
      collectStructuralFragments(root, root);

      const info = getFragmentInfoByUUID('uuid-collect-0');
      expect(info).not.toBeNull();
      const fragmentSpan = info?.fragment.querySelector('span');
      expect(fragmentSpan?.getAttribute(config.bindAttributeName)).toBe('textContent: items.*.label');
    });

    it('ネストしたforテンプレートで正しく展開されること', () => {
      const root = document.createElement('div');
      const outerTemplate = document.createElement('template');
      outerTemplate.setAttribute(config.bindAttributeName, 'for: users');

      // 内側: for: .orders (→ users.*.orders)
      const innerTemplate = document.createElement('template');
      innerTemplate.setAttribute(config.bindAttributeName, 'for: .orders');

      const span = document.createElement('span');
      span.setAttribute(config.bindAttributeName, 'textContent: .total');
      innerTemplate.content.appendChild(span);

      outerTemplate.content.appendChild(innerTemplate);
      root.appendChild(outerTemplate);

      collectStructuralFragments(root, root);

      // 外側テンプレート
      const outerInfo = getFragmentInfoByUUID('uuid-collect-0');
      expect(outerInfo).not.toBeNull();

      // 内側テンプレートのコメントを取得
      const innerComment = outerInfo?.fragment.firstChild as Comment;
      expect(innerComment.nodeType).toBe(Node.COMMENT_NODE);
      const innerUuid = innerComment.data.split(':')[1];
      const innerInfo = getFragmentInfoByUUID(innerUuid);
      expect(innerInfo).not.toBeNull();

      // 内側のspanの属性が users.*.orders.*.total に展開されていること
      const fragmentSpan = innerInfo?.fragment.querySelector('span');
      expect(fragmentSpan?.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.orders.*.total');
    });

    it('for内のifテンプレートでforPathが継承されること', () => {
      const root = document.createElement('div');
      const forTemplate = document.createElement('template');
      forTemplate.setAttribute(config.bindAttributeName, 'for: users');

      const ifTemplate = document.createElement('template');
      ifTemplate.setAttribute(config.bindAttributeName, 'if: .isActive');

      const span = document.createElement('span');
      span.setAttribute(config.bindAttributeName, 'textContent: .name');
      ifTemplate.content.appendChild(span);

      forTemplate.content.appendChild(ifTemplate);
      root.appendChild(forTemplate);

      collectStructuralFragments(root, root);

      // forテンプレートの情報
      const forInfo = getFragmentInfoByUUID('uuid-collect-0');
      expect(forInfo).not.toBeNull();

      // ifテンプレートのコメントを取得
      const ifComment = forInfo?.fragment.firstChild as Comment;
      expect(ifComment.nodeType).toBe(Node.COMMENT_NODE);
      const ifUuid = ifComment.data.split(':')[1];
      const ifInfo = getFragmentInfoByUUID(ifUuid);
      expect(ifInfo).not.toBeNull();
      // ifのパスが展開されていること
      expect(ifInfo?.parseBindTextResult.statePathName).toBe('users.*.isActive');

      // if内のspanも展開されていること
      const fragmentSpan = ifInfo?.fragment.querySelector('span');
      expect(fragmentSpan?.getAttribute(config.bindAttributeName)).toBe('textContent: users.*.name');
    });

    it('forなしのifテンプレートではショートハンド展開が行われないこと', () => {
      const root = document.createElement('div');
      const ifTemplate = document.createElement('template');
      ifTemplate.setAttribute(config.bindAttributeName, 'if: condition');

      const span = document.createElement('span');
      span.setAttribute(config.bindAttributeName, 'textContent: .name');
      ifTemplate.content.appendChild(span);

      root.appendChild(ifTemplate);
      collectStructuralFragments(root, root);

      const info = getFragmentInfoByUUID('uuid-collect-0');
      expect(info).not.toBeNull();
      // forPathがないので展開されない
      const fragmentSpan = info?.fragment.querySelector('span');
      expect(fragmentSpan?.getAttribute(config.bindAttributeName)).toBe('textContent: .name');
    });
  });
});
