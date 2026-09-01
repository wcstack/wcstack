/**
 * Phase 2 のマウント記録（webComponent/mount.ts）— 設計書 §4-1 / §5、impl-plan §3-0。
 * 変換規則（R1・最長接頭辞・D20 マーカー・4b の throw）と登録簿を固定する。
 * まだ配線されていない（P2-2）: このテストが Phase 2 の意味論の正本になる。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMountRecord,
  translateInnerPath,
  translateBindingForMount,
  registerMountRecord,
  getMountRecordByScopeRoot,
  getMountRecordByPath,
  stateElementHasMounts,
  resetMountIdForTesting,
} from '../src/webComponent/mount';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const parentStateElement = { name: 'default' } as any;

function hostBinding(propSegments: string[], statePathName: string): IBindingInfo {
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName,
    statePathInfo: getPathInfo(statePathName),
    stateName: 'default',
    inFilters: [],
    outFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: document.createElement('div'),
    replaceNode: document.createElement('div'),
  } as IBindingInfo;
}

function record(hostEntries: [string[], string][], stateObject: Record<string, any> = {}) {
  const component = document.createElement('my-card');
  return buildMountRecord(
    component,
    'state',
    hostEntries.map(([segments, path]) => hostBinding(['state', ...segments], path)),
    parentStateElement,
    stateObject,
  );
}

beforeEach(() => {
  resetMountIdForTesting();
});

describe('mount: buildMountRecord', () => {
  it('ルートエントリと部分エントリを持ち、Δ とマーカーパスが決まること', () => {
    const r = record([[[] as any, 'users.*'], [['theme'], 'theme']]);
    expect(r.rootEntry).not.toBeNull();
    expect(r.delta).toBe(1);
    expect(r.marker).toBe('#m1');
    expect(r.markerBasePath).toBe('users.*.#m1');
    // 最長接頭辞一致のため長い順に整列
    expect(r.entries.map((e) => e.innerSegments.length)).toEqual([1, 0]);
    expect(r.partialFirstSegments.has('theme')).toBe(true);
  });

  it('部分マウントのみでは Δ=0 でマーカーはトップレベルに置かれること', () => {
    const r = record([[['items'], 'rows']]);
    expect(r.rootEntry).toBeNull();
    expect(r.delta).toBe(0);
    expect(r.markerBasePath).toBe('#m1');
  });

  it('同じ内側パスを 2 つの規則が指すと throw すること（M6）', () => {
    expect(() => record([[['x'], 'a'], [['x'], 'b']])).toThrow(/Duplicate mapping rule/);
    expect(() => record([[[] as any, 'a'], [[] as any, 'b']])).toThrow(/Duplicate mapping rule/);
  });

  it('ホストバインディングが無ければ throw すること', () => {
    expect(() => buildMountRecord(document.createElement('my-c'), 'state', [], parentStateElement, {}))
      .toThrow(/without host bindings/);
  });
});

describe('mount: translateInnerPath（§4-1 の解決規則）', () => {
  it('規則 3: ルートマウントはあらゆるパスを接頭辞付きでツリーへ写すこと', () => {
    const r = record([[[] as any, 'user']]);
    expect(translateInnerPath(r, 'name')).toBe('user.name');
    expect(translateInnerPath(r, 'a.b.c')).toBe('user.a.b.c');
  });

  it('規則 3: 部分規則が最長接頭辞で勝つこと', () => {
    const r = record([[[] as any, 'user'], [['theme'], 'theme'], [['theme', 'deep'], 'other.deep']]);
    expect(translateInnerPath(r, 'theme.mode')).toBe('theme.mode');
    expect(translateInnerPath(r, 'theme.deep.x')).toBe('other.deep.x');
    expect(translateInnerPath(r, 'theme')).toBe('theme');
    expect(translateInnerPath(r, 'name')).toBe('user.name');
  });

  it('規則 3: 行マウント（state: . 相当）はワイルドカード接頭辞で写すこと', () => {
    const r = record([[[] as any, 'users.*']]);
    expect(translateInnerPath(r, 'name')).toBe('users.*.name');
    expect(translateInnerPath(r, 'tags.*.name')).toBe('users.*.tags.*.name');
  });

  it('規則 2: own data key（部分規則が覆わないもの）は私有としてマーカー配下に写すこと', () => {
    const r = record([[[] as any, 'users.*']], { editing: false, draft: { title: '' } });
    expect(translateInnerPath(r, 'editing')).toBe('users.*.#m1.editing');
    expect(translateInnerPath(r, 'draft.title')).toBe('users.*.#m1.draft.title');
  });

  it('規則 2: 部分規則が覆う own data key はツリーに落ちること（積みの取り違え防止・D19 と同じ）', () => {
    const r = record([[[] as any, 'user'], [['theme'], 'theme']], { theme: { mode: 'injected' } });
    expect(translateInnerPath(r, 'theme.mode')).toBe('theme.mode');
  });

  it('規則 1: メソッドと単純 getter はマーカー配下に写すこと', () => {
    const r = record([[[] as any, 'user']], {
      save() {},
      get display() { return ''; },
    });
    expect(translateInnerPath(r, 'save')).toBe('user.#m1.save');
    expect(translateInnerPath(r, 'display')).toBe('user.#m1.display');
  });

  it('規則 1: ツリーのリストの上のワイルドカード getter は、ワイルドカードの直後にマーカーを挟むこと', () => {
    const r = record([[[] as any, 'group']], {
      get 'children.*.label'() { return ''; },
    });
    // ループ文脈（group.children.*）と listIndex の arity が素の wildcard getter と同じに保たれる
    expect(translateInnerPath(r, 'children.*.label')).toBe('group.children.*.#m1.label');
    // getter でない行フィールドは素通し
    expect(translateInnerPath(r, 'children.*.name')).toBe('group.children.*.name');
  });

  it('規則 1: 私有配列の上のワイルドカード getter は配列ごとマーカー配下に閉じること', () => {
    const r = record([[[] as any, 'user']], {
      drafts: [],
      get 'drafts.*.title'() { return ''; },
    });
    expect(translateInnerPath(r, 'drafts.*.title')).toBe('user.#m1.drafts.*.title');
    expect(translateInnerPath(r, 'drafts')).toBe('user.#m1.drafts');
    expect(translateInnerPath(r, 'drafts.*.body')).toBe('user.#m1.drafts.*.body');
  });

  it('規則 4b: 部分マウントのみで一致しないキーは throw すること（M20）', () => {
    const r = record([[['theme'], 'theme']]);
    expect(() => translateInnerPath(r, 'name')).toThrow(/does not resolve/);
    expect(() => translateInnerPath(r, 'name')).toThrow(/mounted prefixes: theme/);
  });

  it('規則 4b: ワイルドカード getter のツリー部が一致しない形も throw すること', () => {
    const r = record([[['theme'], 'theme']], {
      get 'items.*.label'() { return ''; },
    });
    expect(() => translateInnerPath(r, 'items.*.label')).toThrow(/does not resolve/);
  });

  it('$ と # で始まるパスは翻訳しないこと', () => {
    const r = record([[[] as any, 'user']]);
    expect(translateInnerPath(r, '$1')).toBe('$1');
    expect(translateInnerPath(r, '$streamStatus.load')).toBe('$streamStatus.load');
    expect(translateInnerPath(r, '#else')).toBe('#else');
  });
});

describe('mount: translateBindingForMount', () => {
  it('変換した複製を返し、stateName を親のものに揃えること', () => {
    const r = record([[[] as any, 'users.*']]);
    const binding = hostBinding(['textContent'], 'name');
    (binding as any).stateName = 'anything';
    const translated = translateBindingForMount(r, binding);
    expect(translated).not.toBe(binding);
    expect(translated.statePathName).toBe('users.*.name');
    expect(translated.statePathInfo).toBe(getPathInfo('users.*.name'));
    expect(translated.stateName).toBe('default');
    // 元の binding は不変（パース結果キャッシュを汚さない）
    expect(binding.statePathName).toBe('name');
  });

  it('パスも stateName も変わらなければ同一オブジェクトを返すこと', () => {
    const r = record([[[] as any, 'user']]);
    const binding = hostBinding(['textContent'], '$1');
    const translated = translateBindingForMount(r, binding);
    expect(translated).toBe(binding);
  });

  it('Δ>0 のマウントでは $n がスコープ相対に繰り上がること（§4-4）', () => {
    const r = record([[[] as any, 'users.*']]);
    const translated = translateBindingForMount(r, hostBinding(['textContent'], '$1'));
    expect(translated.statePathName).toBe('$2');
    // Δ=0 なら不変
    const r0 = record([[[] as any, 'user']]);
    expect(translateBindingForMount(r0, hostBinding(['textContent'], '$1')).statePathName).toBe('$1');
  });
});

describe('mount: 登録簿', () => {
  it('スコープ根とマーカーの両方から引けること', () => {
    const stateElement = { name: 'default' } as any;
    const component = document.createElement('my-row');
    const shadowRoot = component.attachShadow({ mode: 'open' });
    const r = buildMountRecord(component, 'state', [hostBinding(['state'], 'users.*')], stateElement, {});
    expect(stateElementHasMounts(stateElement)).toBe(false);

    registerMountRecord(shadowRoot, r);

    expect(getMountRecordByScopeRoot(shadowRoot)).toBe(r);
    expect(getMountRecordByScopeRoot(component)).toBeNull();
    expect(stateElementHasMounts(stateElement)).toBe(true);
    expect(getMountRecordByPath(stateElement, `users.*.${r.marker}.editing`)).toBe(r);
    expect(getMountRecordByPath(stateElement, 'users.*.name')).toBeNull();
    expect(getMountRecordByPath(stateElement, 'users.*.#zz.name')).toBeNull();
  });

  it('マーカー照会は対象の state element に閉じること', () => {
    const a = { name: 'default' } as any;
    const b = { name: 'default' } as any;
    const componentA = document.createElement('my-a');
    const rootA = componentA.attachShadow({ mode: 'open' });
    const r = buildMountRecord(componentA, 'state', [hostBinding(['state'], 'user')], a, {});
    registerMountRecord(rootA, r);

    expect(getMountRecordByPath(a, `user.${r.marker}.x`)).toBe(r);
    expect(getMountRecordByPath(b, `user.${r.marker}.x`)).toBeNull();
    expect(stateElementHasMounts(b)).toBe(false);
  });
});
