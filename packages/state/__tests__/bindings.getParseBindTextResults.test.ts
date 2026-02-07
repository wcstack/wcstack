import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { getParseBindTextResults } from '../src/bindings/getParseBindTextResults';
import { parseCommentNode } from '../src/bindings/parseCommentNode';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { setStateElementByName } from '../src/stateElementByName';

const uuid = 'bind-test-uuid';

vi.mock('../src/stateElementByName', () => {
  const map = new Map();
  return {
    getStateElementByName: (name: string) => map.get(name) || null,
    setStateElementByName: (name: string, el: any) => {
      if (el === null) map.delete(name);
      else map.set(name, el);
    }
  };
});

describe('getParseBindTextResults', () => {
  beforeEach(() => {
    setStateElementByName('default', {
      setPathInfo: vi.fn(),
    } as any);
  });

  afterEach(() => {
    setFragmentInfoByUUID(uuid, null);
  });

  it('要素ノードのbindTextをパースできること', () => {
    const el = document.createElement('span');
    el.setAttribute('data-bind-state', 'textContent: message');
    const results = getParseBindTextResults(el);
    expect(results).toHaveLength(1);
    expect(results[0].bindingType).toBe('prop');
    expect(results[0].propName).toBe('textContent');
    expect(results[0].statePathName).toBe('message');
  });

  it('バインド属性がない要素ノードでは空配列を返すこと', () => {
    const el = document.createElement('span');
    // data-bind-state属性を設定しない (getAttributeがnullを返す)
    const results = getParseBindTextResults(el);
    expect(results).toHaveLength(0);
  });

  it('コメントノードの埋め込みバインドをパースできること', () => {
    const comment = document.createComment('@@wcs-text: message');
    expect(parseCommentNode(comment)).toBe('message');
    const results = getParseBindTextResults(comment);
    expect(results).toHaveLength(1);
    expect(results[0].bindingType).toBe('text');
    expect(results[0].propName).toBe('textContent');
    expect(results[0].statePathName).toBe('message');
    expect(results[0].uuid).toBeNull();
  });

  it('構造バインディングのUUIDを取得できること', () => {
    const parseBindTextResult: ParseBindTextResult = {
      propName: 'for',
      propSegments: ['for'],
      propModifiers: [],
      statePathName: 'items',
      statePathInfo: getPathInfo('items'),
      stateName: 'default',
      outFilters: [],
      inFilters: [],
      bindingType: 'for',
      uuid: null,
    };

    setFragmentInfoByUUID(uuid, {
      fragment: document.createDocumentFragment(),
      parseBindTextResult,
      nodeInfos: []
    });

    const comment = document.createComment(`@@wcs-for: ${uuid}`);
    expect(parseCommentNode(comment)).toBe(uuid);
    const results = getParseBindTextResults(comment);
    expect(results).toHaveLength(1);
    expect(results[0].bindingType).toBe('for');
    expect(results[0].uuid).toBe(uuid);
  });
});
