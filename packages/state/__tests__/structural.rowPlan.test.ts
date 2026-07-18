/**
 * structural.rowPlan.test.ts — RowPlan コンパイルと plan 実体化経路のテスト。
 *
 * docs/state-row-instantiation-redesign.md §3-1/§3-2/§5。
 * - compileRowPlan の適格性マトリクス（不適格 1 つでテンプレート丸ごと null）
 * - plan 経路の実体化（binding 複製・indexBindings 分類・known 台帳の単一値昇格）
 * - directional config 変更での再コンパイル
 * - 防御分岐（nodePath 不整合・attach 失敗・observable ポリシー）
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const overrides = vi.hoisted(() => ({
  policy: null as null | (() => any),
  attachEvent: null as null | (() => boolean),
}));

vi.mock('../src/bindings/initialSync', async () => {
  const actual = await vi.importActual('../src/bindings/initialSync') as any;
  return {
    ...actual,
    resolveInitialSyncPolicy: (binding: any) =>
      overrides.policy !== null ? overrides.policy() : actual.resolveInitialSyncPolicy(binding),
  };
});
vi.mock('../src/event/handler', async () => {
  const actual = await vi.importActual('../src/event/handler') as any;
  return {
    ...actual,
    attachEventHandler: (binding: any) =>
      overrides.attachEvent !== null ? overrides.attachEvent() : actual.attachEventHandler(binding),
  };
});

import { compileRowPlan } from '../src/structural/rowPlan';
import { createContent } from '../src/structural/createContent';
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { getIndexBindingsByContent } from '../src/bindings/indexBindingsByContent';
import { getBindingsByContent } from '../src/bindings/bindingsByContent';
import { getBindingSessionByContent } from '../src/bindings/bindingSessionByContent';
import { setStateElementByName } from '../src/stateElementByName';
import { createLoopContextStack } from '../src/list/loopContext';
import { getPathInfo } from '../src/address/PathInfo';
import { config, setConfig } from '../src/config';
import { setLoopContextSymbol, getByAddressSymbol } from '../src/proxy/symbols';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';
import type { IStateElement } from '../src/components/types';
import type { IFragmentInfo } from '../src/structural/types';

const uuid = 'row-plan-test-uuid';

function forParseResult(): ParseBindTextResult {
  return {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'for',
    uuid,
  } as ParseBindTextResult;
}

function fragmentInfoOf(fragment: DocumentFragment, nodeInfos = getFragmentNodeInfos(fragment)): IFragmentInfo {
  return { fragment, parseBindTextResult: forParseResult(), nodeInfos };
}

function fragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function createMockStateElement(): IStateElement {
  let version = 0;
  return {
    name: 'default',
    initializePromise: Promise.resolve(),
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    loopContextStack: createLoopContextStack(),
    cache: new Map(),
    mightChangeByPath: new Map(),
    dynamicDependency: new Map<string, string[]>(),
    staticDependency: new Map<string, string[]>(),
    get version() { return version; },
    setPathInfo() {},
    addStaticDependency() {},
    addDynamicDependency() {},
    createState(_mutability, callback) {
      return callback({
        [setLoopContextSymbol]: (_loopContext: any, cb: () => any) => cb(),
        [getByAddressSymbol]: () => undefined,
      } as any);
    },
    async createStateAsync(_mutability, callback) {
      return callback({
        [setLoopContextSymbol]: (_loopContext: any, cb: () => any) => cb(),
        [getByAddressSymbol]: () => undefined,
      } as any);
    },
    nextVersion() { version += 1; return version; },
  };
}

function forBindingInfo(node: Node): IBindingInfo {
  return {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'for',
    uuid,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

function registerFragment(fragment: DocumentFragment, nodeInfos = getFragmentNodeInfos(fragment)) {
  setStateElementByName(document, 'default', createMockStateElement());
  setFragmentInfoByUUID(uuid, document, { fragment, parseBindTextResult: forParseResult(), nodeInfos });
}

afterEach(() => {
  overrides.policy = null;
  overrides.attachEvent = null;
  setFragmentInfoByUUID(uuid, document, null);
  setStateElementByName(document, 'default', null);
  setConfig({ enableDirectionalInitialSync: true });
});

describe('compileRowPlan の適格性', () => {
  it('text / prop / event のみのテンプレートはプラン適格になること', () => {
    const fragment = fragmentFromHtml('<li><a data-wcs="onclick: onPick"></a><span data-wcs="className: items.*.v"></span></li>');
    fragment.querySelector('li')!.appendChild(document.createComment('@@wcs-text: items.*.label'));
    const info = fragmentInfoOf(fragment);
    const plan = compileRowPlan(info);
    expect(plan).not.toBeNull();
    expect(plan!.directional).toBe(true);
    expect(plan!.slots.map((s) => s.isEvent)).toEqual([true, false, false]);
    expect(plan!.slots.every((s) => s.policy.observable === false)).toBe(true);
    // event は authority none / prop・text は state
    expect(plan!.slots.map((s) => s.authority)).toEqual(['none', 'state', 'state']);
  });

  it('$1 スロットは isIndexBinding に分類されること', () => {
    const fragment = fragmentFromHtml('<span data-wcs="title: $1"></span>');
    const plan = compileRowPlan(fragmentInfoOf(fragment));
    expect(plan).not.toBeNull();
    expect(plan!.slots[0].isIndexBinding).toBe(true);
  });

  it('構造ディレクティブ（ネスト for 等）を含むテンプレートは不適格になること', () => {
    const fragment = fragmentFromHtml('<span></span>');
    const nodeInfos = [{ nodePath: [0], parseBindTextResults: [{ ...forParseResult(), bindingType: 'for' as const }] }];
    expect(compileRowPlan(fragmentInfoOf(fragment, nodeInfos))).toBeNull();
  });

  it('radio / checkbox / spread のスロットは不適格になること', () => {
    const fragment = fragmentFromHtml('<input>');
    for (const bindingType of ['radio', 'checkbox', 'spread'] as const) {
      const nodeInfos = [{ nodePath: [0], parseBindTextResults: [{ ...forParseResult(), propName: 'value', bindingType }] }];
      expect(compileRowPlan(fragmentInfoOf(fragment, nodeInfos))).toBeNull();
    }
  });

  it('nodePath が解決できないテンプレートは不適格になること', () => {
    const fragment = fragmentFromHtml('<span></span>');
    const nodeInfos = [{ nodePath: [7], parseBindTextResults: [] }];
    expect(compileRowPlan(fragmentInfoOf(fragment, nodeInfos))).toBeNull();
  });

  it('text スロットのノードが Text でない場合は不適格になること', () => {
    const fragment = fragmentFromHtml('<span></span>');
    const nodeInfos = [{
      nodePath: [0],
      parseBindTextResults: [{ ...forParseResult(), propName: 'textContent', bindingType: 'text' as const, statePathName: 'items.*.v', statePathInfo: getPathInfo('items.*.v') }],
    }];
    expect(compileRowPlan(fragmentInfoOf(fragment, nodeInfos))).toBeNull();
  });

  it('カスタム要素へのバインディングを含むテンプレートは不適格になること', () => {
    const fragment = fragmentFromHtml('<my-widget data-wcs="className: items.*.v"></my-widget>');
    expect(compileRowPlan(fragmentInfoOf(fragment))).toBeNull();
  });

  it('command / eventToken 名前空間の prop は不適格になること', () => {
    const command = fragmentFromHtml('<span data-wcs="command.play: doPlay"></span>');
    expect(compileRowPlan(fragmentInfoOf(command))).toBeNull();
    const token = fragmentFromHtml('<span data-wcs="eventToken.changed: onChanged"></span>');
    expect(compileRowPlan(fragmentInfoOf(token))).toBeNull();
  });

  it('双方向可能な prop（input value）は不適格になること', () => {
    const fragment = fragmentFromHtml('<input data-wcs="value: items.*.v">');
    expect(compileRowPlan(fragmentInfoOf(fragment))).toBeNull();
  });

  it('不正な修飾子（policy 解決が throw）は不適格になること', () => {
    const fragment = fragmentFromHtml('<span data-wcs="className#bogus=1: items.*.v"></span>');
    expect(compileRowPlan(fragmentInfoOf(fragment))).toBeNull();
  });

  it('authority が auto に解決される prop は不適格になること', () => {
    const fragment = fragmentFromHtml('<span data-wcs="className#init=auto: items.*.v"></span>');
    expect(compileRowPlan(fragmentInfoOf(fragment))).toBeNull();
  });

  it('observable なポリシー（防御分岐）は不適格になること', () => {
    overrides.policy = () => ({ authority: 'state', syncOn: 'call', observable: true });
    const fragment = fragmentFromHtml('<span data-wcs="className: items.*.v"></span>');
    expect(compileRowPlan(fragmentInfoOf(fragment))).toBeNull();
  });
});

describe('createContent の plan 経路', () => {
  it('plan 経路で binding が複製され indexBindings が分類されること', () => {
    const fragment = fragmentFromHtml('<span data-wcs="className: items.*.v; title: $1; lang: items.*.w"></span>');
    registerFragment(fragment);

    const content = createContent(forBindingInfo(document.createComment('for')));
    const bindings = getBindingsByContent(content);
    expect(bindings).toHaveLength(3);
    // 行不変フィールドはテンプレートから複製・node は clone 側のノード
    expect(bindings[0].propName).toBe('className');
    expect(bindings[0].node).not.toBe(fragment.firstChild);
    expect(getIndexBindingsByContent(content).map((b) => b.statePathName)).toEqual(['$1']);
    // プランはキャッシュされる
    expect(getFragmentInfoByUUID(uuid)!.rowPlan).not.toBeNull();
  });

  it('known 台帳の単一値昇格: plan 行 anchor への後続 remember が Map 昇格で共存すること', () => {
    const fragment = fragmentFromHtml('<span data-wcs="className: items.*.v"></span>');
    registerFragment(fragment);
    const content = createContent(forBindingInfo(document.createComment('for')));
    const bindings = getBindingsByContent(content);
    const session = getBindingSessionByContent(content)!;

    // 同一 anchor に別 binding を defensive initialize（remember 経路）
    const extra: IBindingInfo = { ...bindings[0], propName: 'title' };
    const initialized = session.initialize([extra], { registerAddress: false });
    expect(initialized).toEqual([extra]);
    // 既存の plan binding も新しい binding もどちらも session が知っている
    expect(session.getRecord(bindings[0])).not.toBeNull();
    expect(session.getRecord(extra)).not.toBeNull();
    // 2 回目の initialize は remember 済みとして dedupe される（Map 経路）
    expect(session.initialize([extra], { registerAddress: false })).toEqual([]);
  });

  it('directional config が変わると再コンパイルされること', () => {
    const fragment = fragmentFromHtml('<span data-wcs="className: items.*.v"></span>');
    registerFragment(fragment);
    createContent(forBindingInfo(document.createComment('for')));
    const first = getFragmentInfoByUUID(uuid)!.rowPlan;
    expect(first).not.toBeNull();
    expect(first!.directional).toBe(true);

    setConfig({ enableDirectionalInitialSync: false });
    createContent(forBindingInfo(document.createComment('for')));
    const second = getFragmentInfoByUUID(uuid)!.rowPlan;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second!.directional).toBe(false);
  });

  it('プラン適格でも clone 側で nodePath が解決できなければ raiseError すること（防御）', () => {
    const fragment = fragmentFromHtml('<span></span>');
    registerFragment(fragment, [{ nodePath: [9], parseBindTextResults: [] }]);
    // compile を経ない stale なプランを直接注入（compile は同一 fragment で検証済みのため
    // 実運用では到達しない防御分岐）
    getFragmentInfoByUUID(uuid)!.rowPlan = { directional: config.enableDirectionalInitialSync, slots: [] };
    expect(() => createContent(forBindingInfo(document.createComment('for')))).toThrow(/Node not found by path/);
  });

  it('event スロットの attach 失敗は record を failed にして throw を伝播すること', () => {
    overrides.attachEvent = () => { throw new Error('attach boom'); };
    const fragment = fragmentFromHtml('<a data-wcs="onclick: onPick"></a>');
    registerFragment(fragment);
    expect(() => createContent(forBindingInfo(document.createComment('for')))).toThrow(/attach boom/);
  });

  it('不適格テンプレート（双方向 prop + $1）は従来経路で indexBindings 分類されること', () => {
    const fragment = fragmentFromHtml('<input data-wcs="value: items.*.v"><span data-wcs="title: $1"></span>');
    registerFragment(fragment);
    const content = createContent(forBindingInfo(document.createComment('for')));
    expect(getFragmentInfoByUUID(uuid)!.rowPlan).toBeNull();
    expect(getIndexBindingsByContent(content).map((b) => b.statePathName)).toEqual(['$1']);
    expect(getBindingsByContent(content)).toHaveLength(2);
  });
});
