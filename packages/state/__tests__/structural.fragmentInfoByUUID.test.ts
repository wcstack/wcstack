import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { setStateElement } from '../src/stateElementByName';

vi.mock('../src/stateElementByName', () => {
  const map = new Map();
  return {
    getStateElement: (rootNode: Node) => map.get(rootNode) || null,
    setStateElement: (rootNode: Node, el: any) => {
      if (el === null) map.delete(rootNode);
      else map.set(rootNode, el);
    }
  };
});

describe('fragmentInfoByUUID', () => {
  beforeEach(() => {
    setStateElement(document, {
      setPathInfo: vi.fn(),
    } as any);
  });

  it('set/getできること', () => {
    const uuid = 'uuid-1';
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

    const fragmentInfo = {
      fragment: document.createDocumentFragment(),
      parseBindTextResult,
      nodeInfos: []
    };

    setFragmentInfoByUUID(uuid, document, fragmentInfo);
    expect(getFragmentInfoByUUID(uuid)).toBe(fragmentInfo);

    setFragmentInfoByUUID(uuid, document, null);
    expect(getFragmentInfoByUUID(uuid)).toBeNull();
  });

  it('StateElementが見つからない場合はエラーになること (fragment)', () => {
    const uuid = 'uuid-error-fragment';
    const parseBindTextResult: ParseBindTextResult = {
      propName: 'for',
      propSegments: ['for'],
      propModifiers: [],
      statePathName: 'items',
      statePathInfo: getPathInfo('items'),
      stateName: 'missing-state',
      outFilters: [],
      inFilters: [],
      bindingType: 'for',
      uuid: null,
    };

    const fragmentInfo = {
      fragment: document.createDocumentFragment(),
      parseBindTextResult,
      nodeInfos: []
    };

    const orphanRoot = document.createElement('div');
    expect(() => setFragmentInfoByUUID(uuid, orphanRoot, fragmentInfo)).toThrow(/No state tree found on this root/);
  });

  it('nodeInfosの依存関係も登録されること', () => {
    const setPathInfo = vi.fn();
    setStateElement(document, { setPathInfo } as any);

    const uuid = 'uuid-node-infos';
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

    const nodeParseBindTextResult: ParseBindTextResult = {
      propName: 'value',
      propSegments: ['value'],
      propModifiers: [],
      statePathName: 'other',
      statePathInfo: getPathInfo('other'),
      stateName: 'default',
      outFilters: [],
      inFilters: [],
      bindingType: 'prop',
      uuid: null,
    };

    const fragmentInfo = {
      fragment: document.createDocumentFragment(),
      parseBindTextResult,
      nodeInfos: [{
        node: document.createComment('test'),
        parseBindTextResults: [nodeParseBindTextResult]
      }]
    };

    setFragmentInfoByUUID(uuid, document, fragmentInfo);

    // Fragment itself
    expect(setPathInfo).toHaveBeenCalledWith('items', 'for');
    // Node inside fragment
    expect(setPathInfo).toHaveBeenCalledWith('other', 'prop');
  });

});
