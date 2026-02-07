import { describe, it, expect } from 'vitest';
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';

describe('fragmentInfoByUUID', () => {
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
});
