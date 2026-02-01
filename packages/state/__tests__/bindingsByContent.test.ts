import { describe, it, expect } from 'vitest';

import { getBindingsByContent, setBindingsByContent } from '../src/bindings/bindingsByContent';
import type { IBindingInfo } from '../src/types';
import type { IContent } from '../src/structural/types';

function createContent(): IContent {
  return {
    firstNode: null,
    lastNode: null,
    mountAfter: () => {},
    unmount: () => {}
  };
}

function createBindingInfo(stateName: string): IBindingInfo {
  const node = document.createElement('div');
  return {
    propName: '',
    propSegments: [],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: null,
    stateName,
    filters: [],
    node,
    replaceNode: node,
    bindingType: 'text',
    uuid: null
  };
}

describe('bindingsByContent', () => {
  it('未登録のcontentは空配列を返すこと', () => {
    const content = createContent();
    const bindings = getBindingsByContent(content);
    expect(bindings).toEqual([]);
  });

  it('setBindingsByContentで登録したbindingsが取得できること', () => {
    const content = createContent();
    const bindings = [createBindingInfo('app')];

    setBindingsByContent(content, bindings);

    expect(getBindingsByContent(content)).toBe(bindings);
  });

  it('contentごとに独立して保持されること', () => {
    const contentA = createContent();
    const contentB = createContent();
    const bindingsA = [createBindingInfo('appA')];
    const bindingsB = [createBindingInfo('appB')];

    setBindingsByContent(contentA, bindingsA);
    setBindingsByContent(contentB, bindingsB);

    expect(getBindingsByContent(contentA)).toBe(bindingsA);
    expect(getBindingsByContent(contentB)).toBe(bindingsB);
  });
});
