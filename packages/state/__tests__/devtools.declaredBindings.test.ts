/**
 * devtools.declaredBindings.test.ts — 宣言バインディング列挙（getDeclaredBindings の実装）。
 *
 * declaredScan（devtools 側の簡易パーサ・bindTextParser 非追随）を置き換える正本実装
 * なので、①正本パーサの解釈がそのまま出ること ②DOM 再スキャンでは見えなかった
 * fragment（構造テンプレート内部）が列挙されること、の 2 点を固定する。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { collectDeclaredBindings } from '../src/devtools/declaredBindings';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { setStateElementByName } from '../src/stateElementByName';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';
import { parseBindTextForEmbeddedNode } from '../src/bindTextParser/parseBindTextForEmbeddedNode';
import type { IStateElement } from '../src/components/types';

const FRAGMENT_UUID = 'declared-test-uuid-1';

afterEach(() => {
  setFragmentInfoByUUID(FRAGMENT_UUID, document, null);
  setStateElementByName(document, 'default', null);
  document.body.innerHTML = '';
});

describe('collectDeclaredBindings', () => {
  it('属性・コメントの宣言を正本パーサの解釈で列挙し、壊れた宣言は捨てること', () => {
    const container = document.createElement('div');
    container.innerHTML = [
      '<span data-wcs="textContent: user.name | uc"></span>',
      '<input data-wcs="value#ro: price@cart; onclick: submitOrder">',
      '<i data-wcs="brokenNoSeparator"></i>',
    ].join('');
    container.appendChild(document.createComment('@@:count|fix(0)'));
    container.appendChild(document.createComment('ただのコメント'));
    document.body.appendChild(container);

    const declared = collectDeclaredBindings(container);
    const summary = declared.map((d) => `${d.origin}:${d.propName}:${d.statePathName}@${d.stateName}`);
    expect(summary).toEqual([
      'attribute:textContent:user.name@default',
      'attribute:value:price@cart',
      'attribute:onclick:submitOrder@default',
      'comment:textContent:count@default',
    ]);
    // 修飾子・フィルタも正本パーサの解釈そのまま（簡易パーサでは落ちていた情報）
    const twoway = declared.find((d) => d.statePathName === 'price')!;
    expect(twoway.node).toBeInstanceOf(Element);
    expect(twoway.raw).toContain('value#ro');
    const filtered = declared.find((d) => d.statePathName === 'user.name')!;
    expect(filtered.outFilters.map((f) => f.filterName)).toEqual(['uc']);
  });

  it('レンダリング済み行クローンで宣言が重複しないこと（宣言集合セマンティクス・B1 対策）', () => {
    // 行の実体化（importNode）は data-wcs 属性を保持したままクローンを live DOM に
    // 入れる。宣言タプル dedupe により、行数に関係なく宣言 1 件 = エントリ 1 件。
    const stateElement = { name: 'default', setPathInfo: vi.fn() } as unknown as IStateElement;
    setStateElementByName(document, 'default', stateElement);

    const container = document.createElement('div');
    container.appendChild(document.createComment(`@@wcs-for:${FRAGMENT_UUID}`));
    // 実体化された 3 行ぶんのクローン（テンプレート内容と同一の宣言を持つ）
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('span');
      row.setAttribute('data-wcs', 'textContent: items.*.label');
      container.appendChild(row);
    }
    document.body.appendChild(container);

    const forBinding = parseBindTextsForElement('for: items')[0];
    // 実実装の nodeInfos は要素の data-wcs を属性パーサで解釈した結果を持つ
    //（行クローンの属性と同一タプルになる = dedupe が効く前提の実挙動を写す）
    const innerBinding = parseBindTextsForElement('textContent: items.*.label')[0];
    setFragmentInfoByUUID(FRAGMENT_UUID, document, {
      fragment: document.createDocumentFragment(),
      parseBindTextResult: { ...forBinding, uuid: FRAGMENT_UUID },
      nodeInfos: [{ parseBindTextResults: [innerBinding] }],
    } as never);

    const declared = collectDeclaredBindings(container);
    const labelEntries = declared.filter((d) => d.statePathName === 'items.*.label');
    expect(labelEntries).toHaveLength(1);
    expect(declared.filter((d) => d.bindingType === 'for')).toHaveLength(1);
  });

  it('ネストした構造ディレクティブは到達閉包で 1 回ずつ列挙されること', () => {
    const CHILD_UUID = 'declared-test-uuid-child';
    const stateElement = { name: 'default', setPathInfo: vi.fn() } as unknown as IStateElement;
    setStateElementByName(document, 'default', stateElement);

    const container = document.createElement('div');
    container.appendChild(document.createComment(`@@wcs-for:${FRAGMENT_UUID}`));
    document.body.appendChild(container);

    const forBinding = parseBindTextsForElement('for: items')[0];
    const ifBinding = parseBindTextsForElement('if: items.*.visible')[0];
    const grandChild = parseBindTextForEmbeddedNode('items.*.label');
    // 親 fragment の nodeInfos にネストアンカー（uuid 付き）が載る（実装同型の固定資料）
    setFragmentInfoByUUID(CHILD_UUID, document, {
      fragment: document.createDocumentFragment(),
      parseBindTextResult: { ...ifBinding, uuid: CHILD_UUID },
      nodeInfos: [{ parseBindTextResults: [grandChild] }],
    } as never);
    setFragmentInfoByUUID(FRAGMENT_UUID, document, {
      fragment: document.createDocumentFragment(),
      parseBindTextResult: { ...forBinding, uuid: FRAGMENT_UUID },
      nodeInfos: [{ parseBindTextResults: [{ ...ifBinding, uuid: CHILD_UUID }] }],
    } as never);

    try {
      const declared = collectDeclaredBindings(container);
      const summary = declared.map((d) => `${d.bindingType}:${d.statePathName}`);
      expect(summary.filter((s) => s === 'for:items')).toHaveLength(1);
      expect(summary.filter((s) => s === 'if:items.*.visible')).toHaveLength(1);
      expect(summary.filter((s) => s === 'text:items.*.label')).toHaveLength(1);
    } finally {
      setFragmentInfoByUUID(CHILD_UUID, document, null);
    }
  });

  it('spread は live wcBindable から展開され、未定義要素は spread のまま残ること（§5-1）', () => {
    class DeclaredSpreadTarget extends HTMLElement {
      static wcBindable = {
        protocol: 'wc-bindable',
        version: 1,
        properties: [{ name: 'value', event: 'x-changed' }],
        inputs: [{ name: 'url' }],
        commands: [],
      };
    }
    if (customElements.get('x-declared-spread') === undefined) {
      customElements.define('x-declared-spread', DeclaredSpreadTarget);
    }
    const container = document.createElement('div');
    container.innerHTML = [
      '<x-declared-spread data-wcs="...: fetchX"></x-declared-spread>',
      '<x-declared-undefined data-wcs="...: other"></x-declared-undefined>',
    ].join('');
    document.body.appendChild(container);

    const declared = collectDeclaredBindings(container);
    const expanded = declared.filter((d) => d.statePathName.startsWith('fetchX'));
    expect(expanded.map((d) => d.propName).sort()).toEqual(['url', 'value']);
    expect(expanded.every((d) => d.bindingType !== 'spread')).toBe(true);
    // 未定義カスタム要素への spread は既存契約どおり spread のまま
    const deferred = declared.find((d) => d.statePathName === 'other')!;
    expect(deferred.bindingType).toBe('spread');
  });

  it('活性化でテキストバインディングのアンカーが消えると列挙にも現れないこと（既知の盲点の固定）', () => {
    // binding start は replaceToReplaceNode でコメントを空 Text に差し替える。
    // 宣言列挙はその後の DOM からテキストバインディングを回復できない
    //（ヘッダ / protocol 文書に明記した時系列依存の documenting test）。
    const container = document.createElement('div');
    const anchor = document.createComment('@@:count');
    container.appendChild(anchor);
    document.body.appendChild(container);
    expect(collectDeclaredBindings(container).map((d) => d.statePathName)).toEqual(['count']);

    container.replaceChild(document.createTextNode(''), anchor);
    expect(collectDeclaredBindings(container)).toEqual([]);
  });

  it('未登録の構造アンカーは捨てること（SSR pre-hydration の UUID を誤パースしない）', () => {
    const container = document.createElement('div');
    container.appendChild(document.createComment('@@wcs-for:u3'));
    // 一方で "u3" という名の実プロパティへのテキストバインディングは正しく載る
    container.appendChild(document.createComment('@@:u3'));
    document.body.appendChild(container);

    const declared = collectDeclaredBindings(container);
    expect(declared).toHaveLength(1);
    expect(declared[0].bindingType).toBe('text');
    expect(declared[0].statePathName).toBe('u3');
  });

  it('fragment（構造テンプレート内部）の宣言を列挙し、構造ディレクティブ自体はコメントアンカーから1回だけ載ること', () => {
    // fragment 登録は rootNode 上の state 解決を要求する（setPathInfo 配線のため）
    const stateElement = {
      name: 'default',
      setPathInfo: vi.fn(),
    } as unknown as IStateElement;
    setStateElementByName(document, 'default', stateElement);

    const container = document.createElement('div');
    // 構造ディレクティブのアンカーコメント（活性化後の live DOM にはこれだけが残る）
    container.appendChild(document.createComment(`@@wcs-for:${FRAGMENT_UUID}`));
    document.body.appendChild(container);

    const forBinding = parseBindTextsForElement('for: items')[0];
    const innerBinding = parseBindTextForEmbeddedNode('items.*.label');
    setFragmentInfoByUUID(FRAGMENT_UUID, document, {
      fragment: document.createDocumentFragment(),
      parseBindTextResult: { ...forBinding, uuid: FRAGMENT_UUID },
      nodeInfos: [{ parseBindTextResults: [innerBinding] }],
    } as never);

    const declared = collectDeclaredBindings(container);
    const summary = declared.map((d) => `${d.origin}:${d.bindingType}:${d.statePathName}`);
    // for 自体はアンカー（comment）から 1 回、テンプレート内部は fragment から
    expect(summary).toEqual([
      'comment:for:items',
      'fragment:text:items.*.label',
    ]);
    const fragmentEntry = declared.find((d) => d.origin === 'fragment')!;
    expect(fragmentEntry.node).toBeNull();
  });
});
