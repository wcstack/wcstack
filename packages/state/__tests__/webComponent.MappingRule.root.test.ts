/**
 * MappingRule のルート規則（`data-wcs="state: path"` — 内側パスが空の丸ごとマウント）。
 * docs/state-mount-design.md §3-2 / D5（最長接頭辞一致）、impl-plan P1-1 / P1-4。
 *
 * 依存はモックするが、PathInfo は「同じパスは同じオブジェクト」「cumulativePathInfoSet に
 * 自分と接頭辞を持つ」という正本の性質を再現する（最長接頭辞の判定がそれに乗るため）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn(),
}));
vi.mock('../src/address/PathInfo', () => ({
  getPathInfo: vi.fn(),
}));
vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => ({
  getAbsoluteStateAddressByBinding: vi.fn(),
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn(),
}));
vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn(),
  setOuterStateElementByWebComponent: vi.fn(),
}));
vi.mock('../src/bindings/BindingSession', () => ({
  getBindingSession: vi.fn(() => null),
}));
vi.mock('../src/list/getListIndexByBindingInfo', () => ({
  getListIndexByBindingInfo: vi.fn(() => null),
}));

import {
  buildPrimaryMappingRule,
  getOuterAbsolutePathInfo,
  getPrimaryInnerPaths,
  getPrimaryMappingRules,
  hasRootMappingRule,
} from '../src/webComponent/MappingRule';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getPathInfo } from '../src/address/PathInfo';
import { getAbsoluteStateAddressByBinding } from '../src/binding/getAbsoluteStateAddressByBinding';
import { getStateElementByName } from '../src/stateElementByName';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { IBindingInfo } from '../src/binding/types';

const pathInfoCache = new Map<string, any>();
function pi(path: string): any {
  const cached = pathInfoCache.get(path);
  if (cached) return cached;
  const segments = path === '' ? [''] : path.split('.');
  const info = { path, segments, cumulativePathInfoSet: new Set<any>() };
  pathInfoCache.set(path, info);
  if (path !== '') {
    for (let i = 1; i <= segments.length; i++) {
      info.cumulativePathInfoSet.add(pi(segments.slice(0, i).join('.')));
    }
  }
  return info;
}

const absCache = new WeakMap<object, Map<string, any>>();
function abs(stateElement: object, pathInfo: any): any {
  let byPath = absCache.get(stateElement);
  if (!byPath) {
    byPath = new Map();
    absCache.set(stateElement, byPath);
  }
  let info = byPath.get(pathInfo.path);
  if (!info) {
    info = { stateElement, pathInfo };
    byPath.set(pathInfo.path, info);
  }
  return info;
}

const innerEl = { name: 'inner' } as any;
const outerEl = { name: 'default' } as any;

function binding(component: Element, propSegments: string[], statePathName: string): IBindingInfo {
  return { propName: propSegments.join('.'), propSegments, statePathName, stateName: 'default', node: component, replaceNode: component } as any;
}

describe('MappingRule: ルート規則', () => {
  let component: Element;

  beforeEach(() => {
    vi.clearAllMocks();
    component = document.createElement('div');
    document.body.appendChild(component);
    vi.mocked(getPathInfo).mockImplementation(pi);
    vi.mocked(getAbsolutePathInfo).mockImplementation(abs);
    vi.mocked(getAbsoluteStateAddressByBinding).mockImplementation((b: IBindingInfo) => ({
      absolutePathInfo: abs(outerEl, pi(b.statePathName)),
    }) as any);
    vi.mocked(getStateElementByName).mockReturnValue(outerEl);
    vi.mocked(getStateElementByWebComponent).mockReturnValue(innerEl);
  });

  const outer = (innerPath: string, registerSubscriber = true) =>
    getOuterAbsolutePathInfo(component, abs(innerEl, pi(innerPath)), registerSubscriber);

  it('1 セグメント（state: user）はルート規則になり、内側パスに接頭辞ゼロで一致すること', () => {
    buildPrimaryMappingRule(component, 'state', [binding(component, ['state'], 'user')]);

    expect(hasRootMappingRule(component)).toBe(true);
    const rules = getPrimaryMappingRules(component)!;
    expect(rules.size).toBe(1);
    expect([...rules][0].isRoot).toBe(true);
    // ルート規則は $postUpdate("") に意味が無いので再接続の読み直し対象に含めない
    expect(getPrimaryInnerPaths(component)).toEqual([]);

    expect(outer('name')!.pathInfo.path).toBe('user.name');
    expect(outer('a.b')!.pathInfo.path).toBe('user.a.b');
    expect(outer('name')!.stateElement).toBe(outerEl);
  });

  it('ルート規則と部分規則の併用では、部分規則がより長い接頭辞で勝つこと', () => {
    buildPrimaryMappingRule(component, 'state', [
      binding(component, ['state'], 'user'),
      binding(component, ['state', 'theme'], 'theme'),
    ]);

    expect(outer('theme.mode')!.pathInfo.path).toBe('theme.mode');
    expect(outer('theme')!.pathInfo.path).toBe('theme');
    expect(outer('name')!.pathInfo.path).toBe('user.name');
    expect(getPrimaryInnerPaths(component)).toEqual(['theme']);
  });

  it('部分規則どうしでも最長接頭辞が勝つこと', () => {
    buildPrimaryMappingRule(component, 'state', [
      binding(component, ['state', 'a'], 'x'),
      binding(component, ['state', 'a', 'b'], 'y'),
    ]);

    expect(outer('a.b.c')!.pathInfo.path).toBe('y.c');
    expect(outer('a.z')!.pathInfo.path).toBe('x.z');
    expect(hasRootMappingRule(component)).toBe(false);
  });

  it('同じ内側パスを 2 つの規則が指せば構築時に throw すること（ルート・部分とも）', () => {
    expect(() => buildPrimaryMappingRule(component, 'state', [
      binding(component, ['state'], 'a'),
      binding(component, ['state'], 'b'),
    ])).toThrow(/Duplicate mapping rule for web component/);

    const another = document.createElement('div');
    expect(() => buildPrimaryMappingRule(another, 'state', [
      binding(another, ['state', 'x'], 'b'),
      binding(another, ['state', 'x'], 'c'),
    ])).toThrow(/Duplicate mapping rule for web component/);
  });

  it('規則の無いコンポーネントでは偽 / null / 空を返すこと', () => {
    const plain = document.createElement('div');
    expect(hasRootMappingRule(plain)).toBe(false);
    expect(getPrimaryMappingRules(plain)).toBeNull();
    expect(getPrimaryInnerPaths(plain)).toEqual([]);
  });

  it('参照専用の導出でもルート規則で翻訳できること', () => {
    buildPrimaryMappingRule(component, 'state', [binding(component, ['state'], 'row')]);

    expect(outer('name', false)!.pathInfo.path).toBe('row.name');
    // memo されていないので、もう一度導出しても同じ結果
    expect(outer('name', false)!.pathInfo.path).toBe('row.name');
  });
});
