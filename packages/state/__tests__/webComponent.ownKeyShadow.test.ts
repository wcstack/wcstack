/**
 * own data key とマウントの衝突報告（docs/state-mount-design.md D19 / §4-3）。
 *
 * v2: 報告は warnOwnKeyShadowsForMount（厳格 R1 — 作者の own data key は私有で、
 * マウント先の同名キー／同名の部分エントリを隠す）だけ。v1 の warnOwnKeyShadows
 * （マッピングが勝つ挙動＋反転予告）は機構ごと削除された（P2-7）。
 * loopContext はモックし、報告の条件と 1 回性だけを固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn(),
  setLoopContextByNode: vi.fn(),
}));

import { warnOwnKeyShadowsForMount, clearOwnKeyShadowReportsForTesting } from '../src/webComponent/ownKeyShadow';
import { buildMountRecord } from '../src/webComponent/mount';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { setLoopContextSymbol } from '../src/proxy/symbols';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);

/** マウント先の値を返す親 state 要素のモック。createState の呼び出し回数も数える */
function outerStateElement(valueByPath: Record<string, unknown>) {
  const createState = vi.fn((_mode: string, cb: (state: any) => void) => {
    const stateProxy: any = {
      [setLoopContextSymbol]: (_ctx: unknown, inner: () => void) => inner(),
      ...valueByPath,
    };
    cb(stateProxy);
  });
  return { createState };
}

function mountHostBinding(propSegments: string[], statePathName: string): IBindingInfo {
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

describe('ownKeyShadow: v2 マウント（warnOwnKeyShadowsForMount）', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let component: Element;

  function mountRecord(entries: [string[], string][], stateObject: Record<string, any>, stateElement: any = { name: 'default', ...outerStateElement({}) }) {
    return buildMountRecord(
      component,
      'state',
      entries.map(([segments, path]) => mountHostBinding(['state', ...segments], path)),
      stateElement,
      stateObject,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearOwnKeyShadowReportsForTesting();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    component = document.createElement('my-mount-card');
    getLoopContextByNodeMock.mockReturnValue(null);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const warnings = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[wcs/mount-own-key-shadow]'));

  it('私有キーが無ければ（アクセサ・メソッドだけ）何もしないこと', () => {
    const r = mountRecord([[[] as any, 'user']], { get display() { return ''; }, save() {} });
    warnOwnKeyShadowsForMount(r);
    expect(warnings()).toEqual([]);
  });

  it('部分エントリと同名の作者キーは「私有が部分エントリを隠す」と報告すること（厳格 R1）', () => {
    const r = mountRecord([[[] as any, 'user'], [['theme'], 'theme']], { theme: { mode: 'own' } });
    warnOwnKeyShadowsForMount(r);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('hides the mounted entry "state.theme: theme"');
  });

  it('同じ (tag, prop, key) の報告は 1 回だけで、クリアすれば再度報告すること', () => {
    const r = mountRecord([[[] as any, 'user'], [['theme'], 'theme']], { theme: {} });
    warnOwnKeyShadowsForMount(r);
    warnOwnKeyShadowsForMount(r);
    expect(warnings()).toHaveLength(1);

    clearOwnKeyShadowReportsForTesting();
    warnOwnKeyShadowsForMount(r);
    expect(warnings()).toHaveLength(2);
  });

  it('部分マウントのみ（ルート無し）で部分に当たらない私有キーは報告しないこと', () => {
    const r = mountRecord([[['theme'], 'theme']], { editing: 'no' });
    warnOwnKeyShadowsForMount(r);
    expect(warnings()).toEqual([]);
  });

  it('ルート先が同名キーを持てば「私有がツリーを隠す」と報告すること', () => {
    const r = mountRecord([[[] as any, 'user']], { name: '' }, { name: 'default', ...outerStateElement({ user: { name: 'Alice' } }) });
    warnOwnKeyShadowsForMount(r);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('hides the mounted tree key "user.name"');
  });

  it('ルート先が同名キーを持たなければ報告しないこと', () => {
    const r = mountRecord([[[] as any, 'user']], { editing: 'no' }, { name: 'default', ...outerStateElement({ user: { name: 'Alice' } }) });
    warnOwnKeyShadowsForMount(r);
    expect(warnings()).toEqual([]);
  });

  it('ルート先がオブジェクトでなければ報告しないこと', () => {
    const r = mountRecord([[[] as any, 'user']], { name: '' }, { name: 'default', ...outerStateElement({ user: 'primitive' }) });
    warnOwnKeyShadowsForMount(r);
    expect(warnings()).toEqual([]);
  });

  it('ルート先がワイルドカードでホストにループ文脈が無ければ createState を呼ばず諦めること', () => {
    const stateElement = { name: 'default', createState: vi.fn() };
    const r = mountRecord([[[] as any, 'users.*']], { name: '' }, stateElement);
    warnOwnKeyShadowsForMount(r);
    expect(stateElement.createState).not.toHaveBeenCalled();
    expect(warnings()).toEqual([]);
  });

  it('ルート先がワイルドカードでもホストのループ文脈があれば読むこと', () => {
    getLoopContextByNodeMock.mockReturnValue({ listIndex: { indexes: [0] } } as any);
    const r = mountRecord([[[] as any, 'users.*']], { name: '' }, { name: 'default', ...outerStateElement({ 'users.*': { name: 'Row' } }) });
    warnOwnKeyShadowsForMount(r);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('hides the mounted tree key "users.*.name"');
  });
});
