import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/structural/fragmentInfoByUUID', () => ({
  getFragmentInfoByUUID: vi.fn()
}));
vi.mock('../src/bindings/initializeBindings', () => ({
  initializeBindingsByFragment: vi.fn()
}));
vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn().mockReturnValue(null)
}));
vi.mock('../src/structural/createContent', () => ({
  createContent: vi.fn()
}));
vi.mock('../src/bindings/bindingsByContent', () => ({
  getBindingsByContent: vi.fn(),
  setBindingsByContent: vi.fn()
}));
vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { getFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { initializeBindingsByFragment } from '../src/bindings/initializeBindings';
import { createContent } from '../src/structural/createContent';
import { getBindingsByContent } from '../src/bindings/bindingsByContent';
import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';

const getFragmentInfoByUUIDMock = vi.mocked(getFragmentInfoByUUID);
const initializeBindingsByFragmentMock = vi.mocked(initializeBindingsByFragment);
const createContentMock = vi.mocked(createContent);
const getBindingsByContentMock = vi.mocked(getBindingsByContent);
const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

describe('applyChangeToIf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('UUIDに対応するfragmentInfoがない場合はエラーになること', () => {
    getFragmentInfoByUUIDMock.mockReturnValue(null);
    const node = document.createComment('if');
    expect(() => applyChangeToIf(node, 'unknown-uuid', true)).toThrow(/Fragment with UUID "unknown-uuid" not found/);
  });

  it('trueの場合はcontentがマウントされること', () => {
    const fragment = document.createDocumentFragment();
    const nodeInfos: any[] = [];
    getFragmentInfoByUUIDMock.mockReturnValue({ fragment, nodeInfos });

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    });

    const container = document.createElement('div');
    const node = document.createComment('if');
    container.appendChild(node);

    applyChangeToIf(node, 'test-uuid', true);

    expect(initializeBindingsByFragmentMock).toHaveBeenCalled();
    expect(createContentMock).toHaveBeenCalled();
    expect(mountAfterMock).toHaveBeenCalledWith(node);
    expect(unmountMock).not.toHaveBeenCalled();
  });

  it('falseの場合はcontentがマウントされないこと', () => {
    const fragment = document.createDocumentFragment();
    const nodeInfos: any[] = [];
    getFragmentInfoByUUIDMock.mockReturnValue({ fragment, nodeInfos });

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    });

    const node = document.createComment('if');
    applyChangeToIf(node, 'test-uuid', false);

    expect(mountAfterMock).not.toHaveBeenCalled();
  });

  it('true→falseでunmountが呼ばれること', () => {
    const fragment = document.createDocumentFragment();
    const nodeInfos: any[] = [];
    getFragmentInfoByUUIDMock.mockReturnValue({ fragment, nodeInfos });

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    });

    const container = document.createElement('div');
    const node = document.createComment('if');
    container.appendChild(node);

    // true → マウント
    applyChangeToIf(node, 'test-uuid-2', true);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // false → アンマウント
    applyChangeToIf(node, 'test-uuid-2', false);
    expect(unmountMock).toHaveBeenCalledTimes(1);
  });

  it('同じ値で連続呼び出しの場合は何もしないこと', () => {
    const fragment = document.createDocumentFragment();
    const nodeInfos: any[] = [];
    getFragmentInfoByUUIDMock.mockReturnValue({ fragment, nodeInfos });

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    });

    const container = document.createElement('div');
    const node = document.createComment('if');
    container.appendChild(node);

    applyChangeToIf(node, 'test-uuid-3', true);
    expect(mountAfterMock).toHaveBeenCalledTimes(1);

    // 同じ値で再呼び出し
    applyChangeToIf(node, 'test-uuid-3', true);
    expect(mountAfterMock).toHaveBeenCalledTimes(1); // 増えない
  });

  it('truthyな値はtrueとして扱われること', () => {
    const fragment = document.createDocumentFragment();
    const nodeInfos: any[] = [];
    getFragmentInfoByUUIDMock.mockReturnValue({ fragment, nodeInfos });

    const mountAfterMock = vi.fn();
    createContentMock.mockReturnValue({
      firstNode: null,
      lastNode: null,
      mountAfter: mountAfterMock,
      unmount: vi.fn()
    });

    const container = document.createElement('div');
    const node = document.createComment('if');
    container.appendChild(node);

    applyChangeToIf(node, 'test-uuid-4', 'non-empty string');
    expect(mountAfterMock).toHaveBeenCalled();
  });

  it('初期化済みのcontent再マウント時にbindingsが適用されること', () => {
    const fragment = document.createDocumentFragment();
    const nodeInfos: any[] = [];
    getFragmentInfoByUUIDMock.mockReturnValue({ fragment, nodeInfos });

    const mountAfterMock = vi.fn();
    const unmountMock = vi.fn();
    const content = {
      firstNode: null,
      lastNode: null,
      mountAfter: mountAfterMock,
      unmount: unmountMock
    };
    createContentMock.mockReturnValue(content as any);

    const bindings = [{ stateName: 'app' }] as any[];
    getBindingsByContentMock.mockReturnValue(bindings as any);

    const container = document.createElement('div');
    const node = document.createComment('if');
    container.appendChild(node);

    // 初回は初期化されるためapplyChangeFromBindingsは呼ばれない
    applyChangeToIf(node, 'test-uuid-5', true);
    expect(applyChangeFromBindingsMock).not.toHaveBeenCalled();

    // falseにしてアンマウント
    applyChangeToIf(node, 'test-uuid-5', false);
    expect(unmountMock).toHaveBeenCalledTimes(1);

    // 再度trueで再マウントすると、既存contentなのでbindings適用
    applyChangeToIf(node, 'test-uuid-5', true);
    expect(getBindingsByContentMock).toHaveBeenCalledWith(content as any);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith(bindings as any);
  });
});
