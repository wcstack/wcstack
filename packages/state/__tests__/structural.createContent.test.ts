import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { createContent, createContentFromNodes } from '../src/structural/createContent';
import * as bindingsByContent from '../src/bindings/bindingsByContent.js';
import * as contentByNode from '../src/structural/contentsByNode.js';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';
import { setStateElementByName } from '../src/stateElementByName';

const uuid = 'content-test-uuid';

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

function createBindingInfo(node: Node, overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  return {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: getPathInfo('flag'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'if',
    uuid,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

function setFragment(fragment: DocumentFragment, rowPlan?: null) {
  const parseBindTextResult: ParseBindTextResult = {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: getPathInfo('flag'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    filterTexts: [],
    bindingType: 'if',
    uuid,
  } as ParseBindTextResult;

  setFragmentInfoByUUID(uuid, document, {
    fragment,
    parseBindTextResult,
    nodeInfos: [],
    // rowPlan: null を渡すと従来経路（プラン不適格）を強制する。構造ディレクティブを
    // 含むテンプレートは compileRowPlan が必ず不適格にするため、範囲モードの検証は
    // この経路で行うのが実態に合う（nodeInfos が空のスタブだとプランが成立してしまう）。
    ...(rowPlan === null ? { rowPlan: null } : {}),
  });
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, document, null);
  vi.restoreAllMocks();
});

describe('createContent', () => {
  beforeEach(() => {
    setStateElementByName(document, 'default', {
      setPathInfo: vi.fn(),
    } as any);
  });

  it('uuidがnullの場合はエラーになること', () => {
    const placeholder = document.createComment('placeholder');
    const bindingInfo = createBindingInfo(placeholder, { uuid: null });

    expect(() => createContent(bindingInfo)).toThrow(/BindingInfo\.uuid is null/);
  });

  it('mountAfterでノードを挿入できること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.id = 'span1';
    const span2 = document.createElement('span');
    span2.id = 'span2';
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    expect(container.childNodes.length).toBe(3);
    expect((container.childNodes[1] as HTMLElement).id).toBe('span1');
    expect((container.childNodes[2] as HTMLElement).id).toBe('span2');
  });

  it('unmountでノードを削除できること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);
    expect(container.childNodes.length).toBe(2);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0]).toBe(placeholder);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
  });

  it('firstNode/lastNode が取得できること', () => {
    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.id = 'first';
    const span2 = document.createElement('span');
    span2.id = 'last';
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    const placeholder = document.createComment('placeholder');
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    expect((content.firstNode as HTMLElement).id).toBe('first');
    expect((content.lastNode as HTMLElement).id).toBe('last');
  });

  it('空のfragmentではfirstNode/lastNodeがnullになること', () => {
    const fragment = document.createDocumentFragment();
    const placeholder = document.createComment('placeholder');
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    expect(content.firstNode).toBeNull();
    expect(content.lastNode).toBeNull();
  });

  it('mountAfterで親が無い場合は何もしないこと', () => {
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    expect(span.parentNode).toBe(fragment);
  });

  it('mountedの状態が切り替わること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    expect(content.mounted).toBe(false);

    content.mountAfter(placeholder);
    expect(content.mounted).toBe(true);

    content.unmount();
    expect(content.mounted).toBe(false);
  });

  it('appendToでノードをターゲットに追加できること', () => {
    const container = document.createElement('div');

    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.id = 'a1';
    const span2 = document.createElement('span');
    span2.id = 'a2';
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    const placeholder = document.createComment('placeholder');
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.appendTo(container);

    expect(container.childNodes.length).toBe(2);
    expect((container.childNodes[0] as HTMLElement).id).toBe('a1');
    expect((container.childNodes[1] as HTMLElement).id).toBe('a2');
    expect(content.mounted).toBe(true);
  });

  it('appendTo後にunmountしてノードがフラグメントに戻ること', () => {
    const container = document.createElement('div');

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    const placeholder = document.createComment('placeholder');
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    content.appendTo(container);
    expect(container.childNodes.length).toBe(1);
    expect(content.mounted).toBe(true);

    content.unmount();
    expect(container.childNodes.length).toBe(0);
    expect(content.mounted).toBe(false);
  });

  it('mountAfterでフラグメント一括挿入されること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    const tail = document.createElement('div');
    tail.id = 'tail';
    container.appendChild(placeholder);
    container.appendChild(tail);

    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.id = 's1';
    const span2 = document.createElement('span');
    span2.id = 's2';
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    // placeholder, span1, span2, tail の順
    expect(container.childNodes.length).toBe(4);
    expect((container.childNodes[1] as HTMLElement).id).toBe('s1');
    expect((container.childNodes[2] as HTMLElement).id).toBe('s2');
    expect((container.childNodes[3] as HTMLElement).id).toBe('tail');
  });

  it('unmount後に再度mountAfterできること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    span.id = 'remount';
    fragment.appendChild(span);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    content.mountAfter(placeholder);
    expect(container.childNodes.length).toBe(2);
    expect(content.mounted).toBe(true);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
    expect(content.mounted).toBe(false);

    content.mountAfter(placeholder);
    expect(container.childNodes.length).toBe(2);
    expect(content.mounted).toBe(true);
    expect((container.childNodes[1] as HTMLElement).id).toBe('remount');
  });

  it('マウント済みcontentへmountAfterを再実行してもノード順が変わらないこと', () => {
    // if の true→true 再適用で再突入するケース。旧実装は捕捉済み nextSibling へ
    // 一括 insertBefore していたため先頭ノードが末尾へ回転した(回帰テスト)。
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    for (const id of ['r1', 'r2', 'r3']) {
      const span = document.createElement('span');
      span.id = id;
      fragment.appendChild(span);
    }

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    const ids = () => Array.from(container.children).map((el) => el.id);
    expect(ids()).toEqual(['r1', 'r2', 'r3']);

    content.mountAfter(placeholder);
    expect(ids()).toEqual(['r1', 'r2', 'r3']);

    content.mountAfter(placeholder);
    expect(ids()).toEqual(['r1', 'r2', 'r3']);
  });

  it('位置がずれたノードがある場合はmountAfter再実行で正しい順序に復元されること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    for (const id of ['h1', 'h2', 'h3']) {
      const span = document.createElement('span');
      span.id = id;
      fragment.appendChild(span);
    }

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    // h2 を末尾へ移動させて順序を崩す
    container.appendChild(container.children[1]);
    const ids = () => Array.from(container.children).map((el) => el.id);
    expect(ids()).toEqual(['h1', 'h3', 'h2']);

    content.mountAfter(placeholder);
    expect(ids()).toEqual(['h1', 'h2', 'h3']);
  });

  // --- 範囲モード（トップレベルに構造ディレクティブを持つ行） --------------
  //
  // この形の content は、ネストした if/for が「自分のアンカー直後」に実ノードを
  // 挿すため childNodeArray が実レンジより狭い。終端マーカーでレンジを閉じ、
  // 移動は firstNode..lastNode の DOM レンジで行う。

  /** トップレベルに if プレースホルダを持つフラグメントで content を作る。 */
  function createRangedContent(placeholder: Node) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createComment('@@wcs-if:nested-uuid'));
    setFragment(fragment, null);
    return createContent(createBindingInfo(placeholder));
  }

  it('トップレベルに構造アンカーを持つ行には終端マーカーが付くこと', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const content = createRangedContent(placeholder);
    content.mountAfter(placeholder);

    const marker = content.lastNode as Comment;
    expect(marker.nodeType).toBe(Node.COMMENT_NODE);
    expect(marker.textContent).toContain('wcs-row-end');
    // アンカーではなくマーカーが末尾 = 呼び出し側の位置追跡が実ノードを飛ばさない
    expect(content.firstNode).not.toBe(marker);
  });

  it('構造ディレクティブ以外のコメントが先頭でも範囲モードにならないこと', () => {
    // text バインドのコメント等は実ノードを後ろに挿さないので終端マーカーは不要
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createComment('@@wcs-text:some-uuid'));
    setFragment(fragment, null);
    const content = createContent(createBindingInfo(placeholder));
    content.mountAfter(placeholder);

    expect((content.lastNode as Comment).data).toBe('@@wcs-text:some-uuid');
  });

  it('範囲モードではネストが挿した実ノードも一緒に移動すること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    const tail = document.createComment('tail');
    container.appendChild(placeholder);
    container.appendChild(tail);

    const content = createRangedContent(placeholder);
    content.mountAfter(placeholder);

    // ネストした if がアンカー直後に実ノードを挿した状態を作る
    const nested = document.createElement('span');
    nested.id = 'nested';
    container.insertBefore(nested, content.firstNode!.nextSibling);

    // tail の後ろへ移動 → アンカー・実ノード・マーカーが塊で動くこと
    content.mountAfter(tail);
    const shape = Array.from(container.childNodes).map((n) =>
      n.nodeType === Node.COMMENT_NODE ? `#${n.textContent?.split(':')[0]}` : `<${(n as Element).id}>`);
    expect(shape).toEqual(['#placeholder', '#tail', '#@@wcs-if', '<nested>', '#wcs-row-end']);
  });

  it('範囲モードでも先頭ノードが DOM から外れていれば自分のノードだけ動かすこと', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const content = createRangedContent(placeholder);
    content.mountAfter(placeholder);

    // 先頭ノードだけ外部から外される（レンジ走査の起点を失う）
    (content.firstNode as ChildNode).remove();

    const target = document.createElement('div');
    const anchor = document.createComment('anchor');
    target.appendChild(anchor);
    content.mountAfter(anchor);

    // 例外にならず、自分のトップレベルノードは移動できていること
    expect(content.lastNode!.parentNode).toBe(target);
  });

  it('範囲モードで終端マーカーへ到達できなければ自分のノードだけ動かすこと', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const content = createRangedContent(placeholder);
    content.mountAfter(placeholder);

    // 終端マーカーだけ外部から外される（走査が last に当たらない）
    (content.lastNode as ChildNode).remove();

    const target = document.createElement('div');
    const anchor = document.createComment('anchor');
    target.appendChild(anchor);
    content.mountAfter(anchor);

    expect(content.firstNode!.parentNode).toBe(target);
  });

  it('unmountで子のif/elseif/else contentもアンマウントされること', () => {
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const childNode = document.createComment('child-if');
    const childContent = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: () => {},
      unmount: vi.fn()
    } as any;

    const childBinding = createBindingInfo(childNode, { bindingType: 'if', propName: 'if' });

    contentByNode.setContentByNode(childNode, childContent);
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    expect(bindingsByContent.getBindingsByContent(content)).toHaveLength(1);

    content.unmount();

    expect(childContent.unmount).toHaveBeenCalled();
  });
});

describe('createContentFromNodes', () => {
  it('空配列を渡した場合 firstNode/lastNode が null になる', () => {
    const content = createContentFromNodes([]);
    expect(content.firstNode).toBeNull();
    expect(content.lastNode).toBeNull();
    expect(content.mounted).toBe(true);
  });

  it('ノード配列を渡した場合 firstNode/lastNode が設定される', () => {
    const a = document.createElement('p');
    const b = document.createElement('span');
    const content = createContentFromNodes([a, b]);
    expect(content.firstNode).toBe(a);
    expect(content.lastNode).toBe(b);
    expect(content.mounted).toBe(true);
  });
});
