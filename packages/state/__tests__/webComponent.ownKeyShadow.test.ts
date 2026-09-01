/**
 * own data key とマウントの衝突報告（docs/state-mount-design.md D19、impl-plan P1-10 / P1-11）。
 * MappingRule と loopContext はモックし、報告の条件と 1 回性だけを固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/webComponent/MappingRule', () => ({
  getPrimaryMappingRules: vi.fn(),
}));
vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn(),
}));

import { warnOwnKeyShadows, clearOwnKeyShadowReportsForTesting } from '../src/webComponent/ownKeyShadow';
import { recordInjectedKey } from '../src/webComponent/preCompletionWrites';
import { getPrimaryMappingRules } from '../src/webComponent/MappingRule';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { setLoopContextSymbol } from '../src/proxy/symbols';

const getPrimaryMappingRulesMock = vi.mocked(getPrimaryMappingRules);
const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);

function pathInfo(path: string) {
  return { path, segments: path.split('.'), wildcardCount: path.split('.').filter((s) => s === '*').length };
}

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

function rootRule(outerPath: string, stateElement: unknown) {
  return { isRoot: true, innerAbsPathInfo: { pathInfo: pathInfo('') }, outerAbsPathInfo: { stateElement, pathInfo: pathInfo(outerPath) } } as any;
}

function partialRule(innerPath: string, outerPath: string) {
  return { isRoot: false, innerAbsPathInfo: { pathInfo: pathInfo(innerPath) }, outerAbsPathInfo: { stateElement: {}, pathInfo: pathInfo(outerPath) } } as any;
}

describe('ownKeyShadow', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let component: Element;

  beforeEach(() => {
    vi.clearAllMocks();
    clearOwnKeyShadowReportsForTesting();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    component = document.createElement('my-card');
    getLoopContextByNodeMock.mockReturnValue(null);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('プライマリ規則が無い（plain）なら何もしないこと', () => {
    getPrimaryMappingRulesMock.mockReturnValue(null);
    warnOwnKeyShadows(component, 'state', { name: '' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('own data key が無い（getter / メソッド / $ 宣言だけ）なら何もしないこと', () => {
    getPrimaryMappingRulesMock.mockReturnValue(new Set([rootRule('user', outerStateElement({ user: { name: 'A' } }))]));
    const state = {
      get display() { return 'x'; },
      save() {},
      $updatedCallback() {},
    };
    warnOwnKeyShadows(component, 'state', state);
    expect(warn).not.toHaveBeenCalled();
  });

  it('部分マウントと同名の own key は「v2 で反転する」と 1 回だけ報告すること', () => {
    getPrimaryMappingRulesMock.mockReturnValue(new Set([partialRule('message', 'user.name')]));
    warnOwnKeyShadows(component, 'state', { message: '' });
    warnOwnKeyShadows(component, 'state', { message: '' });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('[wcs/mount-own-key-shadow]');
    expect(message).toContain('<my-card>.state.message');
    expect(message).toContain('"state.message: user.name"');
    expect(message).toContain('in v2');
  });

  it('完了前の積みで注入されたキーは作者のものとして扱わないこと', () => {
    getPrimaryMappingRulesMock.mockReturnValue(new Set([partialRule('message', 'user.name')]));
    recordInjectedKey(component, 'state', 'message');
    warnOwnKeyShadows(component, 'state', { message: 'from-host' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('2 セグメントの部分規則（state.a.b）は own key の判定に使わないこと', () => {
    getPrimaryMappingRulesMock.mockReturnValue(new Set([partialRule('a.b', 'x.y')]));
    warnOwnKeyShadows(component, 'state', { a: {} });
    expect(warn).not.toHaveBeenCalled();
  });

  it('ルートマウント先が同名キーを持つ own key は「私有が隠す」と報告すること', () => {
    const outer = outerStateElement({ user: { name: 'Alice', email: 'a@x' } });
    getPrimaryMappingRulesMock.mockReturnValue(new Set([rootRule('user', outer)]));
    warnOwnKeyShadows(component, 'state', { name: '', email: '', editing: false });
    // name と email の 2 件。editing はマウント先に無いので私有として正当
    expect(warn).toHaveBeenCalledTimes(2);
    const first = String(warn.mock.calls[0][0]);
    expect(first).toContain('<my-card>.state.name');
    expect(first).toContain('"user.name"');
    expect(first).toContain('(state: user)');
    // マウント先の読みはキーの数に関係なく 1 回
    expect(outer.createState).toHaveBeenCalledTimes(1);
  });

  it('マウント先がオブジェクトでなければ報告しないこと', () => {
    const outer = outerStateElement({ title: 'plain string' });
    getPrimaryMappingRulesMock.mockReturnValue(new Set([rootRule('title', outer)]));
    warnOwnKeyShadows(component, 'state', { length: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('マウント先がワイルドカードでホストにループ文脈が無ければ判定を諦めること', () => {
    const outer = outerStateElement({ 'users.*': { name: 'x' } });
    getPrimaryMappingRulesMock.mockReturnValue(new Set([rootRule('users.*', outer)]));
    getLoopContextByNodeMock.mockReturnValue(null);
    warnOwnKeyShadows(component, 'state', { name: '' });
    expect(warn).not.toHaveBeenCalled();
    expect(outer.createState).not.toHaveBeenCalled();
  });

  it('マウント先がワイルドカードでもホストのループ文脈があれば読むこと', () => {
    const outer = outerStateElement({ 'users.*': { name: 'x' } });
    getPrimaryMappingRulesMock.mockReturnValue(new Set([rootRule('users.*', outer)]));
    getLoopContextByNodeMock.mockReturnValue({ listIndex: { length: 1 } } as any);
    warnOwnKeyShadows(component, 'state', { name: '' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"users.*.name"');
  });

  it('ルートと部分の併用では、部分規則に当たるキーは部分として報告すること', () => {
    const outer = outerStateElement({ user: { name: 'A', theme: 'dark' } });
    getPrimaryMappingRulesMock.mockReturnValue(new Set([rootRule('user', outer), partialRule('theme', 'theme')]));
    warnOwnKeyShadows(component, 'state', { theme: 'light', name: '' });
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('"state.theme: theme"') && m.includes('in v2'))).toBe(true);
    expect(messages.some((m) => m.includes('"user.name"'))).toBe(true);
  });

  it('報告済み台帳をクリアすれば再度報告すること', () => {
    getPrimaryMappingRulesMock.mockReturnValue(new Set([partialRule('message', 'user.name')]));
    warnOwnKeyShadows(component, 'state', { message: '' });
    clearOwnKeyShadowReportsForTesting();
    warnOwnKeyShadows(component, 'state', { message: '' });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
