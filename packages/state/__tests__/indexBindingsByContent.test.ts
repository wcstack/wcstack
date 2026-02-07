import { describe, it, expect } from 'vitest';

import { getIndexBindingsByContent, setIndexBindingsByContent } from '../src/bindings/indexBindingsByContent';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IContent } from '../src/structural/types';

function createContent(): IContent {
  return {
    firstNode: null,
    lastNode: null,
    mounted: false,
    mountAfter: () => {},
    unmount: () => {}
  };
}

function createBindingInfo(statePathName: string): IBindingInfo {
  const node = document.createElement('div');
  return {
    propName: '',
    propSegments: [],
    propModifiers: [],
    statePathName,
    statePathInfo: getPathInfo(statePathName),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    node,
    replaceNode: node,
    bindingType: 'text',
    uuid: null
  };
}

describe('indexBindingsByContent', () => {
  it('未登録のcontentは空配列を返すこと', () => {
    const content = createContent();
    const bindings = getIndexBindingsByContent(content);
    expect(bindings).toEqual([]);
  });

  it('setIndexBindingsByContentで登録したbindingsが取得できること', () => {
    const content = createContent();
    const bindings = [createBindingInfo('$1')];

    setIndexBindingsByContent(content, bindings);

    expect(getIndexBindingsByContent(content)).toBe(bindings);
  });

  it('contentごとに独立して保持されること', () => {
    const contentA = createContent();
    const contentB = createContent();
    const bindingsA = [createBindingInfo('$1')];
    const bindingsB = [createBindingInfo('$2')];

    setIndexBindingsByContent(contentA, bindingsA);
    setIndexBindingsByContent(contentB, bindingsB);

    expect(getIndexBindingsByContent(contentA)).toBe(bindingsA);
    expect(getIndexBindingsByContent(contentB)).toBe(bindingsB);
  });

  it('空配列を登録した場合も空配列が取得できること', () => {
    const content = createContent();
    const emptyBindings: IBindingInfo[] = [];

    setIndexBindingsByContent(content, emptyBindings);

    expect(getIndexBindingsByContent(content)).toBe(emptyBindings);
  });
});
