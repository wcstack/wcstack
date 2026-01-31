import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { getFragmentInfoByUUID, setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { config } from '../src/config';

vi.mock('../src/getUUID', () => ({
  getUUID: () => 'uuid-collect'
}));

describe('collectStructuralFragments', () => {
  afterEach(() => {
    setFragmentInfoByUUID('uuid-collect', null);
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

    collectStructuralFragments(root);

    const first = root.firstChild as Comment;
    expect(first.nodeType).toBe(Node.COMMENT_NODE);
    expect(first.data).toBe(`@@${config.commentForPrefix}:uuid-collect`);

    const info = getFragmentInfoByUUID('uuid-collect');
    expect(info).not.toBeNull();
    expect(info?.parseBindTextResult.bindingType).toBe('for');
    expect(info?.nodeInfos.length).toBe(1);
  });

  it('構造系以外のバインドはスキップされること', () => {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'textContent: message');
    root.appendChild(template);

    collectStructuralFragments(root);

    expect(root.firstChild).toBe(template);
    expect(getFragmentInfoByUUID('uuid-collect')).toBeNull();
  });

  it('templateのバインドが空または非template要素はスキップされること', () => {
    const root = document.createElement('div');
    const nonTemplate = document.createElement('span');
    nonTemplate.setAttribute(config.bindAttributeName, 'for: items');

    const emptyTemplate = document.createElement('template');
    emptyTemplate.setAttribute(config.bindAttributeName, '');

    root.appendChild(nonTemplate);
    root.appendChild(emptyTemplate);

    collectStructuralFragments(root);

    expect(root.childNodes[0]).toBe(nonTemplate);
    expect(root.childNodes[1]).toBe(emptyTemplate);
    expect(getFragmentInfoByUUID('uuid-collect')).toBeNull();
  });

  it('非template要素をスキップしつつtemplateを処理できること', () => {
    const root = document.createElement('div');
    const nonTemplate = document.createElement('span');
    nonTemplate.textContent = 'skip';

    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'if: ok');

    root.appendChild(nonTemplate);
    root.appendChild(template);

    collectStructuralFragments(root);

    const first = root.childNodes[0] as HTMLElement;
    const second = root.childNodes[1] as Comment;
    expect(first).toBe(nonTemplate);
    expect(second.nodeType).toBe(Node.COMMENT_NODE);
    expect(second.data).toBe(`@@${config.commentIfPrefix}:uuid-collect`);
  });

  it('acceptNodeのFILTER_SKIPが実行されること', () => {
    const originalCreateTreeWalker = document.createTreeWalker.bind(document);
    const root = document.createElement('div');

    document.createTreeWalker = ((
      _root: Node,
      _whatToShow: number,
      filter: NodeFilter
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
      collectStructuralFragments(root);
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
      collectStructuralFragments(root);
    } finally {
      document.createTreeWalker = originalCreateTreeWalker as any;
    }
  });

  it('bindTextのフォールバック分岐が実行されること', async () => {
    vi.resetModules();
    vi.doMock('../src/bindTextParser/parseBindTextsForElement', () => ({
      parseBindTextsForElement: () => [{ bindingType: 'for' }]
    }));

    const { collectStructuralFragments: collectWithMock } = await import('../src/structural/collectStructuralFragments');

    const root = document.createElement('div');
    const template = document.createElement('template');
    let calls = 0;
    template.getAttribute = vi.fn((_name: string) => {
      calls += 1;
      return calls === 1 ? 'for: items' : '';
    }) as any;

    root.appendChild(template);

    collectWithMock(root);

    expect(calls).toBeGreaterThanOrEqual(2);

    vi.doUnmock('../src/bindTextParser/parseBindTextsForElement');
  });
});
