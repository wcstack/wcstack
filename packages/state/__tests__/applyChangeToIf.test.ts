import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn().mockReturnValue(null)
}));
vi.mock('../src/structural/createContent', () => ({
  createContent: vi.fn()
}));
vi.mock('../src/structural/contentByNode', () => ({
  getContentByNode: vi.fn()
}));
vi.mock('../src/bindings/bindingsByContent', () => ({
  getBindingsByContent: vi.fn()
}));
vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));

import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { createContent } from '../src/structural/createContent';
import { getContentByNode } from '../src/structural/contentByNode';
import { getBindingsByContent } from '../src/bindings/bindingsByContent';
import { applyChange } from '../src/apply/applyChange';
import type { IBindingInfo } from '../src/types';

const createContentMock = vi.mocked(createContent);
const getContentByNodeMock = vi.mocked(getContentByNode);
const getBindingsByContentMock = vi.mocked(getBindingsByContent);
const applyChangeMock = vi.mocked(applyChange);

function createBindingInfo(node: Node, uuid: string): IBindingInfo {
  return {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: null,
    stateName: 'default',
    filters: [],
    bindingType: 'if',
    uuid,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

describe('applyChangeToIf', () => {
  const state = { $$getByAddress: () => undefined } as any;
  const stateName = 'default';

  beforeEach(() => {
    vi.clearAllMocks();
    getBindingsByContentMock.mockReturnValue([] as any);
  });

  it('contentが未初期化の場合はcreateContentが呼ばれること', () => {
    getContentByNodeMock.mockReturnValue(null);
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-init');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mounted: false,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any);

    applyChangeToIf(bindingInfo, true, state, stateName);

    expect(createContentMock).toHaveBeenCalledWith(bindingInfo, null);
    expect(mountAfterMock).toHaveBeenCalledWith(node);
  });

  it('trueの場合はcontentがマウントされること', () => {
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mounted: false,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any);
    getContentByNodeMock.mockReturnValue(null);

    applyChangeToIf(bindingInfo, true, state, stateName);

    expect(createContentMock).toHaveBeenCalled();
    expect(mountAfterMock).toHaveBeenCalledWith(node);
    expect(unmountMock).not.toHaveBeenCalled();
  });

  it('falseの場合はcontentがアンマウントされること', () => {
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-false');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    getContentByNodeMock.mockReturnValue(content);

    // まずtrueを呼んでlastValueByNodeを設定
    applyChangeToIf(bindingInfo, true, state, stateName);
    // その後falseを呼ぶ
    applyChangeToIf(bindingInfo, false, state, stateName);

    expect(unmountMock).toHaveBeenCalled();
    expect(mountAfterMock).toHaveBeenCalled();
  });

  it('true→falseでunmountが呼ばれること', () => {
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-2');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: false,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    getContentByNodeMock.mockReturnValue(content);

    // true → マウント
    applyChangeToIf(bindingInfo, true, state, stateName);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // false → アンマウント
    applyChangeToIf(bindingInfo, false, state, stateName);
    expect(unmountMock).toHaveBeenCalledTimes(1);
  });

  it('同じ値で連続呼び出しの場合は何もしないこと', () => {
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-3');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    getContentByNodeMock.mockReturnValue(content);

    applyChangeToIf(bindingInfo, true, state, stateName);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // 同じ値で再呼び出し
    applyChangeToIf(bindingInfo, true, state, stateName);
    expect(mountAfterMock).toHaveBeenCalledTimes(1); // 増えない
  });

  it('truthyな値はtrueとして扱われること', () => {
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-4');

    const mountAfterMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mounted: false,
      mountAfter: mountAfterMock,
      unmount: vi.fn()
    } as any);
    getContentByNodeMock.mockReturnValue(null);

    applyChangeToIf(bindingInfo, 'non-empty string', state, stateName);
    expect(mountAfterMock).toHaveBeenCalled();
  });

  it('初期化済みのcontent再マウント時にbindingsが適用されること', () => {
    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-5');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: false,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    createContentMock.mockReturnValue(content as any);

    const bindings = [{ stateName: 'app' }] as any[];
    getBindingsByContentMock.mockReturnValue(bindings as any);

    getContentByNodeMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(content)
      .mockReturnValueOnce(content);

    // 初回は初期化されるためapplyChangeFromBindingsは呼ばれない
    applyChangeToIf(bindingInfo, true, state, stateName);
    expect(applyChangeMock).not.toHaveBeenCalled();

    // falseにしてアンマウント
    applyChangeToIf(bindingInfo, false, state, stateName);
    expect(unmountMock).toHaveBeenCalledTimes(1);

    // 再度trueで再マウントすると、既存contentなのでbindings適用
    applyChangeToIf(bindingInfo, true, state, stateName);
    expect(getBindingsByContentMock).toHaveBeenCalledWith(content as any);
    expect(applyChangeMock).toHaveBeenCalledTimes(bindings.length);
  });
});
