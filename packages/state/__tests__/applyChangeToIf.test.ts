import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn().mockReturnValue(null)
}));
vi.mock('../src/structural/createContent', () => ({
  createContent: vi.fn()
}));
vi.mock('../src/structural/contentsByNode', () => ({
  getContentsByNode: vi.fn()
}));
vi.mock('../src/structural/activateContent', () => ({
  activateContent: vi.fn(),
  deactivateContent: vi.fn()
}));
vi.mock('../src/bindings/bindingsByContent', () => ({
  getBindingsByContent: vi.fn()
}));
vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));

import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { createContent } from '../src/structural/createContent';
import { getContentsByNode } from '../src/structural/contentsByNode';
import { getBindingsByContent } from '../src/bindings/bindingsByContent';
import { applyChange } from '../src/apply/applyChange';
import { activateContent, deactivateContent } from '../src/structural/activateContent';
import { config } from '../src/config';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const createContentMock = vi.mocked(createContent);
const getContentsByNodeMock = vi.mocked(getContentsByNode);
const getBindingsByContentMock = vi.mocked(getBindingsByContent);
const applyChangeMock = vi.mocked(applyChange);
const activateContentMock = vi.mocked(activateContent);
const deactivateContentMock = vi.mocked(deactivateContent);

function createBindingInfo(node: Node, uuid: string): IBindingInfo {
  return {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: getPathInfo('flag'),
    stateName: 'default',
    outFilters: [{ filterName: 'not', args: [], filterFn: (v: any) => !v }],
    inFilters: [],
    bindingType: 'if',
    uuid,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

describe('applyChangeToIf', () => {
  const state = { $$getByAddress: () => undefined } as any;
  const context: IApplyContext = {
    stateName: 'default',
    stateElement: {} as any,
    state,
    appliedBindingSet: new Set(),
  };
  let originalDebug: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    getBindingsByContentMock.mockReturnValue([] as any);
    originalDebug = config.debug;
    config.debug = true;
  });

  afterEach(() => {
    config.debug = originalDebug;
  });

  it('contentが未初期化の場合はcreateContentが呼ばれること', () => {
    getContentsByNodeMock.mockReturnValue([]);
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

    applyChangeToIf(bindingInfo, context, true);

    expect(createContentMock).toHaveBeenCalledWith(bindingInfo);
    expect(mountAfterMock).toHaveBeenCalledWith(node);
    expect(activateContentMock).toHaveBeenCalledWith(expect.anything(), null, context);
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
    getContentsByNodeMock.mockReturnValue([]);

    applyChangeToIf(bindingInfo, context, true);

    expect(createContentMock).toHaveBeenCalled();
    expect(mountAfterMock).toHaveBeenCalledWith(node);
    expect(activateContentMock).toHaveBeenCalledWith(expect.anything(), null, context);
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
    getContentsByNodeMock.mockReturnValue([content]);

    // まずtrueを呼んでlastValueByNodeを設定
    applyChangeToIf(bindingInfo, context, true);
    // その後falseを呼ぶ
    applyChangeToIf(bindingInfo, context, false);

    expect(unmountMock).toHaveBeenCalled();
    expect(deactivateContentMock).toHaveBeenCalledWith(content as any);
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
    getContentsByNodeMock.mockReturnValue([content]);

    // true → マウント
    applyChangeToIf(bindingInfo, context, true);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // false → アンマウント
    applyChangeToIf(bindingInfo, context, false);
    expect(unmountMock).toHaveBeenCalledTimes(1);
    expect(deactivateContentMock).toHaveBeenCalledWith(content as any);
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
    getContentsByNodeMock.mockReturnValue([content]);

    applyChangeToIf(bindingInfo, context, true);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // 同じ値で再呼び出し
    applyChangeToIf(bindingInfo, context, true);
    expect(mountAfterMock).toHaveBeenCalledTimes(2);
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
    getContentsByNodeMock.mockReturnValue([]);

    applyChangeToIf(bindingInfo, context, 'non-empty string');
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

    getContentsByNodeMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([content])
      .mockReturnValueOnce([content]);

    // 初回は初期化されるためapplyChangeFromBindingsは呼ばれない
    applyChangeToIf(bindingInfo, context, true);
    expect(applyChangeMock).not.toHaveBeenCalled();
    expect(activateContentMock).toHaveBeenCalledWith(content as any, null, context);

    // falseにしてアンマウント
    applyChangeToIf(bindingInfo, context, false);
    expect(unmountMock).toHaveBeenCalledTimes(1);
    expect(deactivateContentMock).toHaveBeenCalledWith(content as any);

    // 再度trueで再マウントすると、既存contentなのでbindings適用
    applyChangeToIf(bindingInfo, context, true);
    expect(activateContentMock).toHaveBeenCalledWith(content as any, null, context);
  });

  it('debug=falseの場合はログ出力されないこと（mount）', () => {
    config.debug = false;
    const consoleSpy = vi.spyOn(console, 'log');

    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-debug-false-mount');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mounted: false,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any);
    getContentsByNodeMock.mockReturnValue([]);

    applyChangeToIf(bindingInfo, context, true);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('debug=falseの場合はログ出力されないこと（unmount）', () => {
    config.debug = false;
    const consoleSpy = vi.spyOn(console, 'log');

    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-debug-false-unmount');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    getContentsByNodeMock.mockReturnValue([content]);

    // trueを呼んでから
    applyChangeToIf(bindingInfo, context, true);
    // falseを呼ぶ
    applyChangeToIf(bindingInfo, context, false);

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(unmountMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('debug=falseの場合はログ出力されないこと（unchanged）', () => {
    config.debug = false;
    const consoleSpy = vi.spyOn(console, 'log');

    const node = document.createComment('if');
    const bindingInfo = createBindingInfo(node, 'test-uuid-debug-false-unchanged');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    getContentsByNodeMock.mockReturnValue([content]);

    applyChangeToIf(bindingInfo, context, true);
    applyChangeToIf(bindingInfo, context, true);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('接続状態が変わった場合は値が同じでも再マウントされること', () => {
    const node = document.createComment('if');
    // isConnectedをモックする
    let isConnectedValue = false;
    Object.defineProperty(node, 'isConnected', {
      get: () => isConnectedValue,
      configurable: true
    });

    const bindingInfo = createBindingInfo(node, 'test-uuid-reconnect');

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    } as any;
    getContentsByNodeMock.mockReturnValue([content]);

    // 切断状態でtrueを設定
    isConnectedValue = false;
    applyChangeToIf(bindingInfo, context, true);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // 接続状態に変更
    isConnectedValue = true;

    // 同じtrueでも接続状態が変わったので再度処理される
    applyChangeToIf(bindingInfo, context, true);
    expect(mountAfterMock).toHaveBeenCalledTimes(2);
  });
});
