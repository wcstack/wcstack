/**
 * innerState の R1（own data key ＝ 私有）— ルートマウント下だけに適用される
 * （docs/state-mount-design.md D4 / D19、impl-plan P1-10）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn(),
}));
vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn(),
}));
vi.mock('../src/webComponent/MappingRule', () => ({
  getOuterAbsolutePathInfo: vi.fn(),
  hasRootMappingRule: vi.fn(),
  getPrimaryMappingRules: vi.fn(() => null),
}));
vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn(),
}));

import { createInnerState } from '../src/webComponent/innerState';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getOuterAbsolutePathInfo, getPrimaryMappingRules, hasRootMappingRule } from '../src/webComponent/MappingRule';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { setLoopContextSymbol } from '../src/proxy/symbols';

const getOuterAbsolutePathInfoMock = vi.mocked(getOuterAbsolutePathInfo);
const hasRootMappingRuleMock = vi.mocked(hasRootMappingRule);

function createProxy(rootMounted: boolean, partialFirstSegments: string[] = []) {
  const component = document.createElement('div') as any;
  component.state = {
    editing: false,
    draft: { title: 'first' },
    theme: { mode: 'injected' },
    get display() { return 'D'; },
  };
  const rules = new Set<any>([{ isRoot: true, innerAbsPathInfo: { pathInfo: { segments: [''] } } }]);
  for (const segment of partialFirstSegments) {
    rules.add({ isRoot: false, innerAbsPathInfo: { pathInfo: { segments: [segment] } } });
  }
  vi.mocked(getPrimaryMappingRules).mockReturnValue(rules);
  const innerStateElement = {
    boundComponentStateProp: 'state',
    getterPaths: new Set(['display']),
    setterPaths: new Set(),
  } as any;
  vi.mocked(getStateElementByWebComponent).mockReturnValue(innerStateElement);
  vi.mocked(getAbsolutePathInfo).mockImplementation((el: any, pathInfo: any) => ({ stateElement: el, pathInfo }) as any);
  vi.mocked(getLoopContextByNode).mockReturnValue(null);
  hasRootMappingRuleMock.mockReturnValue(rootMounted);
  return { component, proxy: createInnerState(component, 'state') };
}

/** 親 state を読む形のマッピング結果（outer パスの値を返す） */
function outerFor(path: string, value: unknown) {
  const stateProxy: any = {
    [setLoopContextSymbol]: (_ctx: unknown, cb: () => void) => cb(),
    [path]: value,
  };
  return {
    stateElement: { createState: vi.fn((_mode: string, cb: (state: any) => void) => cb(stateProxy)) },
    pathInfo: { path, wildcardCount: 0 },
  } as any;
}

describe('innerState: R1（ルートマウント下の own data key は私有）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('own data key はマッピングを見ずにローカルで読み書きできること', () => {
    const { proxy } = createProxy(true);

    expect(proxy.editing).toBe(false);
    expect('editing' in proxy).toBe(true);
    proxy.editing = true;
    expect(proxy.editing).toBe(true);
    expect(getOuterAbsolutePathInfoMock).not.toHaveBeenCalled();
  });

  it('先頭が私有キーのドットパスは has が偽で、getByAddress に親から降りてもらうこと', () => {
    const { proxy } = createProxy(true);

    expect('draft.title' in proxy).toBe(false);
    expect(proxy['draft.title']).toBeUndefined();
    expect(getOuterAbsolutePathInfoMock).not.toHaveBeenCalled();
    // 親アドレスの読みは素のオブジェクト
    expect(proxy.draft.title).toBe('first');
  });

  it('getter は私有キーではなく規則 1（ローカル評価）で解決されること', () => {
    const { proxy } = createProxy(true);
    expect(proxy.display).toBe('D');
    expect(getOuterAbsolutePathInfoMock).not.toHaveBeenCalled();
  });

  it('own data key でないキーはマッピング（ツリー）に落ちること', () => {
    const { proxy } = createProxy(true);
    getOuterAbsolutePathInfoMock.mockReturnValue(outerFor('user.name', 'Alice'));

    expect(proxy.name).toBe('Alice');
    expect('name' in proxy).toBe(true);
    expect(getOuterAbsolutePathInfoMock).toHaveBeenCalled();
  });

  it('部分規則が覆うキーは own data key があってもマッピングに落ちること（積みの取り違え防止）', () => {
    const { proxy } = createProxy(true, ['theme']);
    getOuterAbsolutePathInfoMock.mockReturnValue(outerFor('theme.mode', 'dark'));

    expect(proxy['theme.mode']).toBe('dark');
    expect(getOuterAbsolutePathInfoMock).toHaveBeenCalled();
    // 覆われていないキーは引き続き私有
    expect(proxy.editing).toBe(false);
  });

  it('プライマリ規則の集合が引けないモックでも own data key は私有のままであること', () => {
    const { proxy } = createProxy(true);
    vi.mocked(getPrimaryMappingRules).mockReturnValue(null);
    const component = document.createElement('div') as any;
    component.state = { editing: true };
    vi.mocked(getStateElementByWebComponent).mockReturnValue({
      boundComponentStateProp: 'state', getterPaths: new Set(), setterPaths: new Set(),
    } as any);
    const bare = createInnerState(component, 'state');
    expect(bare.editing).toBe(true);
    expect(proxy.editing).toBe(false);
    expect(getOuterAbsolutePathInfoMock).not.toHaveBeenCalled();
  });

  it('ルートマウントでなければ own data key でもマッピングが勝つこと（1.x の既存挙動）', () => {
    const { proxy } = createProxy(false);
    getOuterAbsolutePathInfoMock.mockReturnValue(outerFor('user.editing', 'from-host'));

    expect(proxy.editing).toBe('from-host');
    expect(getOuterAbsolutePathInfoMock).toHaveBeenCalled();
  });
});
