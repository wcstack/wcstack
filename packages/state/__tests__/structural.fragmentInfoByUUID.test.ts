import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { setStateElementByName } from '../src/stateElementByName';

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

describe('fragmentInfoByUUID', () => {
  beforeEach(() => {
    setStateElementByName('default', {
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

    setFragmentInfoByUUID(uuid, fragmentInfo);
    expect(getFragmentInfoByUUID(uuid)).toBe(fragmentInfo);

    setFragmentInfoByUUID(uuid, null);
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

    expect(() => setFragmentInfoByUUID(uuid, fragmentInfo)).toThrow(/State element with name "missing-state" not found/);
  });

  it('nodeInfosの依存関係も登録されること', () => {
    const setPathInfo = vi.fn();
    setStateElementByName('default', { setPathInfo } as any);

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

    setFragmentInfoByUUID(uuid, fragmentInfo);

    // Fragment itself
    expect(setPathInfo).toHaveBeenCalledWith('items', 'for');
    // Node inside fragment
    expect(setPathInfo).toHaveBeenCalledWith('other', 'prop');
  });

  it('StateElementが見つからない場合はエラーになること (nodeInfo)', () => {
    const uuid = 'uuid-error-node';
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
      stateName: 'missing-state-node',
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

    expect(() => setFragmentInfoByUUID(uuid, fragmentInfo)).toThrow(/State element with name "missing-state-node" not found/);
  });
});
