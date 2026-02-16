import { describe, it, expect } from 'vitest';
import { applyChangeToWebComponent } from '../src/apply/applyChangeToWebComponent';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

function createBinding(element: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToWebComponent', () => {
  it('propSegmentsが1以下の場合はエラーになること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, ['state']);
    expect(() => applyChangeToWebComponent(binding, dummyContext, 'value'))
      .toThrow(/Invalid propSegments for web component binding/);
  });

  it('firstSegmentのプロパティが存在しない場合はエラーになること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, ['state', 'title']);
    expect(() => applyChangeToWebComponent(binding, dummyContext, 'value'))
      .toThrow(/Property "state" not found on web component/);
  });

  it('WebComponentのouterStateに値を設定できること', () => {
    const el = document.createElement('div') as any;
    el.state = {};
    const binding = createBinding(el, ['state', 'title']);
    applyChangeToWebComponent(binding, dummyContext, 'new-title');
    expect(el.state['title']).toBe('new-title');
  });

  it('ネストしたパスはドット結合されたキーとして設定されること', () => {
    const el = document.createElement('div') as any;
    el.state = {};
    const binding = createBinding(el, ['state', 'user', 'name']);
    applyChangeToWebComponent(binding, dummyContext, 'Alice');
    expect(el.state['user.name']).toBe('Alice');
  });
});
