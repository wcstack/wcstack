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
  translateInnerWritePath,
  translateParsedForMount,
  registerMountRecord,
  getMountRecordByScopeRoot,
  getMountRecordByPath,
  getMountRecordsForStateElement,
  cleanupCollectedMountRecord,
  _setMountRecordRefForTesting,
  stateElementHasMounts,
  resetMountIdForTesting,
  findMountRecordForNode,
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
    inFilters: [],
    outFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: document.createElement('div'),
    replaceNode: document.createElement('div'),
  } as IBindingInfo;
}

function record(hostEntries: [string[], string][], stateObject: Record<string, any> = {}, injectedKeys?: Set<string>) {
  const component = document.createElement('my-card');
  return buildMountRecord(
    component,
    'state',
    hostEntries.map(([segments, path]) => hostBinding(['state', ...segments], path)),
    parentStateElement,
    stateObject,
    injectedKeys,
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

  it('規則 2: 部分エントリが明示したキーは、同名の own data key よりツリーが勝つこと（要件 B14 ②）', () => {
    const r = record([[[] as any, 'user'], [['theme'], 'theme']], { theme: { mode: 'own' } });
    expect(translateInnerPath(r, 'theme.mode')).toBe('theme.mode');
    // 明示していない own data key は従来どおり私有
    const r2 = record([[[] as any, 'user']], { theme: { mode: 'own' } });
    expect(translateInnerPath(r2, 'theme.mode')).toBe('user.#m2.theme.mode');
  });

  it('規則 2: 深い部分エントリは、覆っていない兄弟キーの私有性を奪わないこと', () => {
    // `state.a.b: outer.b` は `a.b` だけを覆う。先頭セグメント `a` を「明示されたキー」に
    // してしまうと、`a.c` がツリー（`user.a.c`）に落ちて作者の既定値が消える
    const r = record([[[] as any, 'user'], [['a', 'b'], 'outer.b']], { a: { b: 1, c: 2 } });
    expect(r.mappedKeys.has('a')).toBe(false);
    expect('a' in r.privateSnapshot).toBe(true);
    expect(translateInnerPath(r, 'a.c')).toBe('user.#m1.a.c');
    expect(translateInnerPath(r, 'a')).toBe('user.#m1.a');
  });

  it('規則 2: 深い部分エントリでも、同名の own data key が無ければツリーへ写ること', () => {
    const r = record([[[] as any, 'user'], [['a', 'b'], 'outer.b']]);
    expect(translateInnerPath(r, 'a.b')).toBe('outer.b');
    expect(translateInnerPath(r, 'a.c')).toBe('user.a.c');
  });

  it('規則 2: 部分マウントのみ ＋ 深いエントリでは、own key が無ければ他のキーが 4b で落ちること', () => {
    const r = record([[['a', 'b'], 'outer.b']]);
    expect(translateInnerPath(r, 'a.b')).toBe('outer.b');
    expect(() => translateInnerPath(r, 'a.c')).toThrow(/does not resolve/);
  });

  it('規則 2: メソッドは、ホストが同名を明示しても作者のものであり続けること（B14 ② はデータキーの話）', () => {
    const r = record([[[] as any, 'user'], [['save'], 'other.save']], { save() {} });
    expect(translateInnerPath(r, 'save')).toBe('user.#m1.save');
  });

  it('規則 1: アクセサは積みの注入キーより先に当たり、判定のためのプロパティ読みも起きないこと', () => {
    // `translateInnerPath` は規則 1（`getterKeys` / `setterKeys` の完全一致）と規則 1'（先頭
    // セグメントの一致）を `isPrivateAnchor` より**前**に置く。注入キーと同名のアクセサは
    // そこでマーカー配下に落ちるので、`isPrivateAnchor` の注入短絡までは届かない。
    // 同時に、この経路では作者の getter が判定のために評価されないことも固定する
    let reads = 0;
    const stateObject: Record<string, any> = {};
    Object.defineProperty(stateObject, 'injected', { get() { reads++; return 1; }, enumerable: true, configurable: true });
    const r = record([[[] as any, 'user']], stateObject, new Set(['injected']));
    expect(translateInnerPath(r, 'injected')).toBe('user.#m1.injected');
    // 深いパスは規則 1'（先頭セグメントが getter）でマーカー配下へ
    expect(translateInnerPath(r, 'injected.deep')).toBe('user.#m1.injected.deep');
    expect(reads).toBe(0);
  });

  it('規則 2: 積みで注入された素のデータキーは私有にならずツリーへ落ちること（isPrivateAnchor の注入短絡）', () => {
    // ホストの初期適用が作者のオブジェクトへ書き込んだキー（preCompletionWrites）は作者のもの
    // ではない。アクセサでもメソッドでもなく、部分エントリにも覆われていない（mappedKeys に無い）
    // ので、これを私有に落とさないのは `isPrivateAnchor` の injectedKeys 短絡ただ 1 つ —
    // 短絡を外すと own data key として `user.#m1.profile` へ落ちる
    const r = record([[[] as any, 'user']], { profile: { city: 'Tokyo' } }, new Set(['profile']));
    expect(r.mappedKeys.has('profile')).toBe(false);
    expect(r.getterKeys.has('profile')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.stateObject, 'profile')).toBe(true);
    expect(translateInnerPath(r, 'profile')).toBe('user.profile');
    expect(translateInnerPath(r, 'profile.city')).toBe('user.profile.city');
    expect('profile' in r.privateSnapshot).toBe(false);
  });

  it('規則 1: クラスで書いた state のプロトタイプ getter / setter も作者のアクセサとして扱うこと', () => {
    class Card {
      items = [1, 2, 3];
      get total(): number { return this.items.length; }
      get draft(): string { return ''; }
      set draft(_v: string) { /* noop */ }
      save(): void { /* noop */ }
    }
    const r = record([[[] as any, 'cards.*']], new Card() as any);
    expect([...r.getterKeys].sort()).toEqual(['draft', 'total']);
    expect([...r.setterKeys]).toEqual(['draft']);
    // constructor とプロトタイプメソッドはアクセサではない
    expect(r.getterKeys.has('constructor')).toBe(false);
    expect(r.getterKeys.has('save')).toBe(false);
    // Object.prototype の手前で打ち切るので継承名は拾わない
    expect(r.getterKeys.has('toString')).toBe(false);
    // 規則 1: マーカー配下（ホストのツリー `cards.*.total` に流れない）
    expect(translateInnerPath(r, 'total')).toBe('cards.*.#m1.total');
    expect(translateInnerPath(r, 'draft')).toBe('cards.*.#m1.draft');
    // own のクラスフィールドは従来どおり私有、メソッドも私有
    expect(Object.keys(r.privateSnapshot)).toEqual(['items']);
    expect(translateInnerPath(r, 'save')).toBe('cards.*.#m1.save');
  });

  it('規則 1: 同名の own データプロパティはプロトタイプの getter を隠すこと（解決順と同じ）', () => {
    class Card {
      get total(): number { return 999; }
    }
    const instance = new Card() as any;
    Object.defineProperty(instance, 'total', { value: 7, enumerable: true, writable: true, configurable: true });
    const r = record([[[] as any, 'user']], instance);
    expect(r.getterKeys.has('total')).toBe(false);
    expect(r.privateSnapshot).toEqual({ total: 7 });
    expect(translateInnerPath(r, 'total')).toBe('user.#m1.total');
  });

  it('翻訳を何度呼んでも作者の getter を 1 度も評価しないこと（own / プロトタイプの両方）', () => {
    let evals = 0;
    class Card {
      items = [1, 2, 3];
      get total(): number { evals++; return this.items.length; }
    }
    const proto = record([[[] as any, 'cards.*']], new Card() as any);
    for (let i = 0; i < 5; i++) {
      expect(translateInnerPath(proto, 'total')).toBe('cards.*.#m1.total');
      expect(translateInnerPath(proto, 'total.deep')).toBe('cards.*.#m1.total.deep');
      translateInnerWritePath(proto, 'total');
    }
    expect(evals).toBe(0);

    const own = record([[[] as any, 'user']], { get display() { evals++; return ''; } });
    for (let i = 0; i < 5; i++) {
      expect(translateInnerPath(own, 'display')).toBe('user.#m2.display');
      translateInnerWritePath(own, 'display');
    }
    expect(evals).toBe(0);
  });

  it('規則 2: 積みで注入されたキーは作者のものでなく、ツリー（マウント表）に落ちること', () => {
    const r = record(
      [[[] as any, 'user'], [['theme'], 'theme']],
      { theme: { mode: 'injected-by-host' } },
      new Set(['theme']),
    );
    expect(translateInnerPath(r, 'theme.mode')).toBe('theme.mode');
    // 注入キーは私有スナップショットにも入らない
    expect('theme' in r.privateSnapshot).toBe(false);
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

/** `#ro` 付きのホスト束縛（要件 B14 ①） */
function readonlyRecord(hostEntries: [string[], string, boolean][], stateObject: Record<string, any> = {}) {
  const component = document.createElement('my-card');
  return buildMountRecord(
    component,
    'state',
    hostEntries.map(([segments, path, ro]) => ({ ...hostBinding(['state', ...segments], path), propModifiers: ro ? ['ro'] : [] })),
    parentStateElement,
    stateObject,
  );
}

describe('mount: translateInnerWritePath（要件 B14 ①: #ro のマウント）', () => {
  it('読み取り専用のエントリを通るツリーへの書き込みを名指しで拒否し、読みの翻訳は変えないこと', () => {
    const r = readonlyRecord([[[], 'user', true]]);
    expect(r.entries[0].readonly).toBe(true);
    expect(() => translateInnerWritePath(r, 'name')).toThrow(/\[wcs\/mount-readonly\] <my-card> cannot write "name": it is mounted read-only \("state#ro: user"\)/);
    expect(translateInnerPath(r, 'name')).toBe('user.name');
  });

  it('部分エントリの #ro はそのエントリだけに効き、他のエントリ・私有キー・アクセサ・$ パスは書けること', () => {
    const r = readonlyRecord([[['title'], 'doc.title', true], [['note'], 'doc.note', false]], {
      editing: false,
      get display() { return ''; },
      set display(_v: string) {},
    });
    expect(() => translateInnerWritePath(r, 'title')).toThrow(/\("state\.title#ro: doc\.title"\)/);
    expect(translateInnerWritePath(r, 'note')).toBe('doc.note');
    expect(translateInnerWritePath(r, 'editing')).toBe('#m1.editing');
    expect(translateInnerWritePath(r, 'display')).toBe('#m1.display');
    expect(translateInnerWritePath(r, '$1')).toBe('$1');
  });

  it('どのエントリにも一致しないパスは、読みの翻訳と同じ診断で落ちること', () => {
    const r = readonlyRecord([[['title'], 'doc.title', true]]);
    expect(() => translateInnerWritePath(r, 'other')).toThrow(/does not resolve/);
  });

  it('読み取り専用のエントリを通る束縛の翻訳は ro 修飾子を足し、既にあれば足さないこと', () => {
    const r = readonlyRecord([[[], 'user', true]]);
    const binding = { ...hostBinding(['value'], 'name'), propModifiers: [] as string[] };
    expect(translateParsedForMount(r, binding).propModifiers).toEqual(['ro']);
    const already = { ...hostBinding(['value'], 'name'), propModifiers: ['ro'] };
    expect(translateParsedForMount(r, already).propModifiers).toEqual(['ro']);
    const writable = readonlyRecord([[[], 'user', false]]);
    expect(translateParsedForMount(writable, { ...hostBinding(['value'], 'name'), propModifiers: [] as string[] }).propModifiers).toEqual([]);
  });

  it('ro を足すのは修飾子を読む種別だけで、for / if にはパースで作れない修飾子を足さないこと', () => {
    const r = readonlyRecord([[[], 'user', true]]);
    for (const bindingType of ['prop', 'radio', 'checkbox']) {
      const binding = { ...hostBinding(['value'], 'name'), propModifiers: [] as string[], bindingType } as any;
      expect(translateParsedForMount(r, binding).propModifiers).toEqual(['ro']);
    }
    for (const bindingType of ['for', 'if', 'elseif', 'text', 'event']) {
      const binding = { ...hostBinding([bindingType], 'items'), propModifiers: [] as string[], bindingType } as any;
      expect(translateParsedForMount(r, binding).propModifiers).toEqual([]);
    }
  });

  it('#ro のエントリを 1 つも持たないマウントは hasReadonlyEntries が偽で、書き込み判定を飛ばすこと', () => {
    const plain = readonlyRecord([[[], 'user', false], [['title'], 'doc.title', false]]);
    expect(plain.hasReadonlyEntries).toBe(false);
    expect(translateInnerWritePath(plain, 'title')).toBe('doc.title');
    const ro = readonlyRecord([[[], 'user', false], [['title'], 'doc.title', true]]);
    expect(ro.hasReadonlyEntries).toBe(true);
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

/* ------------------------------------------------------------------ *
 * slice 3 — アクセサの $n 補正と登録簿の細部
 * ------------------------------------------------------------------ */
import { getIndexShiftForMarkerPath } from '../src/webComponent/mount';
import { setStateElementAlias } from '../src/stateElementByName';

describe('mount: getIndexShiftForMarkerPath（getter 内 $n の補正値）', () => {
  it('マーカー無し・未登録接尾は Δ、登録済みアクセサはその indexShift を返すこと', () => {
    const r = record([[[] as any, 'users.*']], {
      get display() { return ''; },
      get 'tags.*.flag'() { return ''; },
    });
    // マーカーを含まないパス → ルートの Δ
    expect(getIndexShiftForMarkerPath(r, 'users.*.name')).toBe(1);
    // 翻訳の副作用でアクセサが登録される
    expect(translateInnerPath(r, 'display')).toBe('users.*.#m1.display');
    expect(translateInnerPath(r, 'tags.*.flag')).toBe('users.*.tags.*.#m1.flag');
    // 現行規則では翻訳で増えるワイルドカード数 = ルート接頭辞の Δ に一致する
    expect(getIndexShiftForMarkerPath(r, 'users.*.#m1.display')).toBe(1);
    expect(getIndexShiftForMarkerPath(r, 'users.*.tags.*.#m1.flag')).toBe(1);
    // マーカーはあるが未登録の接尾 → Δ にフォールバック
    expect(getIndexShiftForMarkerPath(r, 'users.*.#m1.unregistered')).toBe(1);
  });

  it('別記録のマーカー（#m21）の中に自分のマーカー（#m2）が前方一致しても誤ヒットしないこと', () => {
    // #m2 の記録を作る（id 2 まで進める）
    record([[[] as any, 'other']]);
    const r2 = record([[[] as any, 'users.*']], {
      get display() { return ''; },
    });
    expect(r2.marker).toBe('#m2');
    expect(translateInnerPath(r2, 'display')).toBe('users.*.#m2.display');
    // 正しい自分のマーカーパスは登録簿から indexShift を引ける
    expect(getIndexShiftForMarkerPath(r2, 'users.*.#m2.display')).toBe(1);
    // 外側記録 #m21 のマーカーを含み末尾に自分の #m2 が来る入れ子形:
    // indexOf の前方一致だと #m21 の中の #m2 に誤ヒットして親をセグメント途中で
    // 切っていた — セグメント単位の切り出しで登録済み接尾（display）を正しく引く
    const nested = 'a.#m21.users.*.#m2.display';
    r2.accessorBySuffixByMarkerParent.set('a.#m21.users.*.#m2', new Map([
      ['display', { accessorName: 'display', indexShift: 5 }],
    ]));
    expect(getIndexShiftForMarkerPath(r2, nested)).toBe(5);
    // 末尾マーカーが自分のものでないパスは Δ にフォールバック（防御）
    expect(getIndexShiftForMarkerPath(r2, 'a.#m21.leaf')).toBe(1);
    // 末尾がマーカーそのもの（接尾の区切り無し）も Δ にフォールバック（未登録接尾 ""）
    expect(getIndexShiftForMarkerPath(r2, 'users.*.#m2')).toBe(1);
  });
});

describe('mount: setter だけのアクセサ', () => {
  it('規則 1: setter しか無いキーもマーカー配下に写ること', () => {
    const r = record([[[] as any, 'user']], { set title(_v: any) {} });
    expect(translateInnerPath(r, 'title')).toBe('user.#m1.title');
  });
});

describe('mount: setStateElementAlias', () => {
  it('同一要素の再登録は冪等で、別要素への付け替えは throw すること', () => {
    const root = document.createDocumentFragment();
    const a = { name: 'default' } as any;
    const b = { name: 'default' } as any;
    setStateElementAlias(root, a);
    expect(() => setStateElementAlias(root, a)).not.toThrow();
    expect(() => setStateElementAlias(root, b)).toThrow(/already registered/);
  });
});

describe('mount: アクセサ先頭セグメントの深いパス', () => {
  it('規則 1/2: getter / setter を先頭に持つ複数セグメントもマーカー配下に写ること', () => {
    const r = record([[[] as any, 'user']], {
      get profile() { return {}; },
      set title(_v: any) {},
    });
    expect(translateInnerPath(r, 'profile.avatar.url')).toBe('user.#m1.profile.avatar.url');
    expect(translateInnerPath(r, 'title.deep')).toBe('user.#m1.title.deep');
  });
});

describe('mount: setBindingsReadyForScope', () => {
  it('reject する ready は markBindingsBuilt を握って呼び出し側にだけ伝えること', async () => {
    const { setBindingsReadyForScope, getBindingsReady } = await import('../src/stateElementByName');
    const root = document.createDocumentFragment();
    const failure = Promise.reject(new Error('boom'));
    setBindingsReadyForScope(root, failure);
    await expect(getBindingsReady(root)).rejects.toThrow('boom');
    // 内蔵の reject 握り（markBindingsBuilt を走らせない側）が unhandled rejection を出さない
    await new Promise((r) => setTimeout(r));
  });
});

describe('mount: composeMountIndexes（$ API の添字合成）', () => {
  it('接頭辞が増えないパスは素通し、増えるパスは文脈添字を前置し、文脈不足は throw すること', async () => {
    const { composeMountIndexes } = await import('../src/webComponent/mount');
    const r = record([[[] as any, 'users.*']]);
    // 接頭辞 0（$ 系や翻訳で増えない形）
    expect(composeMountIndexes(r, 'tags.*.name', 'tags.*.name', [0], [7])).toEqual([0]);
    // 接頭辞 1: ホスト行の添字を前置
    expect(composeMountIndexes(r, 'tags.*.name', 'users.*.tags.*.name', [0], [3])).toEqual([3, 0]);
    // indexes 未指定は未指定のまま（文脈既定は親 API に委ねる）
    expect(composeMountIndexes(r, 'tags.*.name', 'users.*.tags.*.name', undefined, [3])).toBeUndefined();
    // 文脈が足りない
    expect(() => composeMountIndexes(r, 'tags.*.name', 'users.*.tags.*.name', [0], []))
      .toThrow(/host context provides only 0/);
  });
});

/* ------------------------------------------------------------------ *
 * カバレッジ仕上げ — アクセサ・マーカーの端の形
 * ------------------------------------------------------------------ */
describe('mount: リストそのものの上のアクセサ（接尾なし）', () => {
  it('ツリーのリストへ翻訳されるワイルドカード終端アクセサは loud に throw すること（マーカー終端はオーバーレイが getter を影にする）', () => {
    const r = record([[[] as any, 'users.*']], {
      get 'tags.*'() { return []; },
    });
    // 旧挙動はマーカー終端パス（users.*.tags.*.#m1）を返し、getterPaths に
    // trailing dot の不正パス（users.*.tags.*.#m1.）が載った上、読みは
    // オーバーレイ proxy が返って getter が評価されなかった — サポート外として raise
    expect(() => translateInnerPath(r, 'tags.*')).toThrow(/Wildcard-terminal accessor "tags\.\*"/);
    // 不正な getterPath は登録されない
    expect([...r.addedGetterPaths].every((p) => !p.endsWith('.'))).toBe(true);
  });

  it('私有配列の上のワイルドカード終端アクセサは私有アンカーに閉じて従来どおり通ること', () => {
    const r = record([[[] as any, 'users.*']], {
      tags: [],
      get 'tags.*'() { return []; },
    });
    // 先頭セグメントが own data key → パスごと私有（マーカー終端にならない）
    expect(translateInnerPath(r, 'tags.*')).toBe('users.*.#m1.tags.*');
  });

  it('部分マウントのみ（マーカーが先頭）のアクセサのシフトも引けること', () => {
    const r = record([[['items'], 'rows']], {
      get display() { return ''; },
    });
    expect(translateInnerPath(r, 'display')).toBe('#m1.display');
    expect(getIndexShiftForMarkerPath(r, '#m1.display')).toBe(0);
  });
});

describe('mount: preCompletionWrites（上書き控えの往復）', () => {
  it('最初の上書きだけを控え、restore が作者の値を戻して控えを消すこと', async () => {
    const { rememberOverwrittenValue, restoreOverwrittenValues } = await import('../src/webComponent/preCompletionWrites');
    const el = document.createElement('div');
    const state: Record<string, unknown> = { theme: 'injected-2' };

    rememberOverwrittenValue(el, 'state', 'theme', 'authored');
    rememberOverwrittenValue(el, 'state', 'theme', 'injected-1'); // 2 回目は無視（最初＝作者の値）
    restoreOverwrittenValues(el, 'state', state);
    expect(state.theme).toBe('authored');

    // 控えは消えている（再 restore は何もしない）
    state.theme = 'later';
    restoreOverwrittenValues(el, 'state', state);
    expect(state.theme).toBe('later');
  });

  it('控えの無い要素・プロパティでは restore が何もしないこと', async () => {
    const { rememberOverwrittenValue, restoreOverwrittenValues } = await import('../src/webComponent/preCompletionWrites');
    const el = document.createElement('div');
    const state: Record<string, unknown> = { a: 1 };
    restoreOverwrittenValues(el, 'state', state); // 要素ごと未登録
    rememberOverwrittenValue(el, 'other', 'a', 0);
    restoreOverwrittenValues(el, 'state', state); // プロパティ違い
    expect(state.a).toBe(1);
  });
});

describe('mount: 変換の同値ショートカットの端', () => {
  it('パスが不変なら同一オブジェクトを返すこと（v2: 名前次元が消え、複製する理由が無い）', () => {
    const r = record([[[] as any, 'user']]); // Δ=0
    const binding = hostBinding(['textContent'], '$1');
    const translated = translateBindingForMount(r, binding);
    expect(translated).toBe(binding);
    expect(translated.statePathName).toBe('$1');
  });
});

/* ------------------------------------------------------------------ *
 * イベント添字のスコープ台帳（§4-4 / P2-9 — v2 レビューの修理）
 * ------------------------------------------------------------------ */
describe('mount: translateParsedForMount の for 台帳（indexShiftByLoopElementPath）', () => {
  function forBinding(statePathName: string): IBindingInfo {
    return { ...hostBinding(['textContent'], statePathName), bindingType: 'for' } as IBindingInfo;
  }

  it('Δ=0 の丸ごとマウント（state: user）の for も shift 0 で必ず載ること', () => {
    // 載せないと event/handler.ts が「借用行＝添字 0 本」と誤解し、
    // 自スコープの for の添字が空になる（§4-4 違反）
    const r = record([[[] as any, 'user']]);
    translateBindingForMount(r, forBinding('items'));
    expect(r.indexShiftByLoopElementPath.get('user.items.*')).toBe(0);
  });

  it('同名翻訳（部分マウント state.items: items）の for も shift 0 で載ること', () => {
    const r = record([[['items'], 'items']]);
    translateBindingForMount(r, forBinding('items'));
    expect(r.indexShiftByLoopElementPath.get('items.*')).toBe(0);
  });

  it('行マウント（state: users.*）の for は shift 1 で載ること（従来どおり）', () => {
    const r = record([[[] as any, 'users.*']]);
    translateBindingForMount(r, forBinding('tags'));
    expect(r.indexShiftByLoopElementPath.get('users.*.tags.*')).toBe(1);
  });

  it('私有配列の for（Δ=0）も shift 0 で載ること', () => {
    const r = record([[[] as any, 'user']], { drafts: [] });
    translateBindingForMount(r, forBinding('drafts'));
    expect(r.indexShiftByLoopElementPath.get('user.#m1.drafts.*')).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 入れ子マウントのマーカー解決（v2 レビューの修理）
 * ------------------------------------------------------------------ */
describe('mount: getMountRecordByPath は末尾マーカーで引くこと', () => {
  it('外側の私有キーの上の内側マウント（マーカーが 2 つ並ぶパス）で内側の記録が返ること', () => {
    const parent = { getterPaths: new Set<string>() } as any;
    const outerComponent = document.createElement('my-outer');
    const outerRoot = outerComponent.attachShadow({ mode: 'open' });
    const outer = buildMountRecord(
      outerComponent, 'state', [hostBinding(['state'], 'users.*')], parent, { drafts: [] });
    registerMountRecord(outerRoot, outer);
    // 内側コンポーネントは外側の私有キー drafts をルートにマウントされた形:
    // ホスト配線の statePathName は外側スコープで翻訳済み（users.*.#m1.drafts）
    const innerComponent = document.createElement('my-inner');
    const innerRoot = innerComponent.attachShadow({ mode: 'open' });
    const inner = buildMountRecord(
      innerComponent, 'state', [hostBinding(['state'], translateInnerPath(outer, 'drafts'))], parent, {});
    registerMountRecord(innerRoot, inner);
    expect(inner.markerBasePath).toBe(`users.*.${outer.marker}.drafts.${inner.marker}`);

    // オーバーレイ dispatch（マーカーで終わるパス）は**内側**の記録で解決される。
    // 先頭の # で切ると外側（#m1）が返り誤翻訳になる
    expect(getMountRecordByPath(parent, inner.markerBasePath)).toBe(inner);
    // 内側マーカー配下のアクセサパスも内側の記録
    expect(getMountRecordByPath(parent, `${inner.markerBasePath}.title`)).toBe(inner);
    // 外側のマーカーで終わるパスは従来どおり外側
    expect(getMountRecordByPath(parent, `users.*.${outer.marker}`)).toBe(outer);
  });
});

describe('mount: findMountRecordForNode（Shadow スコープ内の Light DOM マウント）', () => {
  it('rootNode（shadowRoot）直ヒットより、ノードの祖先にある Light DOM スコープ根が優先されること', () => {
    const parent = { getterPaths: new Set<string>() } as any;
    // 外側: Shadow 形（スコープ根 = shadowRoot）
    const outerComponent = document.createElement('my-shadow-scope');
    const outerRoot = outerComponent.attachShadow({ mode: 'open' });
    const outer = buildMountRecord(
      outerComponent, 'state', [hostBinding(['state'], 'users.*')], parent, {});
    registerMountRecord(outerRoot, outer);
    // 内側: 外側 shadow の中の Light DOM 形（スコープ根 = コンポーネント要素自身）
    const innerComponent = document.createElement('my-light-scope');
    outerRoot.appendChild(innerComponent);
    const inner = buildMountRecord(
      innerComponent, 'state', [hostBinding(['state'], 'users.*.friend')], parent, {});
    registerMountRecord(innerComponent, inner);
    const button = document.createElement('button');
    innerComponent.appendChild(button);

    // 内側スコープのノード → 内側の記録（rootNode を先に見ると外側を取り違える）
    expect(findMountRecordForNode(button, outerRoot)).toBe(inner);
    // 外側スコープ直下のノード → 外側の記録
    const span = document.createElement('span');
    outerRoot.appendChild(span);
    expect(findMountRecordForNode(span, outerRoot)).toBe(outer);
  });
});

/**
 * 記録の寿命（B6 — v2 レビューの修理）。記録への強参照は要素キーの WeakMap だけが持ち、
 * 親 state 要素側のマーカー台帳は WeakRef。恒久破棄（route swap / if で捨てた形）で
 * 要素ごと回収可能になり、FinalizationRegistry（cleanupCollectedMountRecord）が
 * マーカーエントリと親 getterPaths への追加分を掃除する。
 * GC は強制できないため、コールバック本体の直接検証と、死んだ参照を差し替えた
 * 遅延 prune の検証で固定する。
 */
describe('mount: 記録の寿命（B6 — 恒久破棄で台帳から回収）', () => {
  it('cleanupCollectedMountRecord が死んだマーカーエントリと親 getterPaths の追加分を掃除すること', () => {
    const byMarker = new Map<string, WeakRef<any>>();
    byMarker.set('#m9', { deref: () => undefined } as unknown as WeakRef<any>);
    const getterPaths = new Set(['users.*.#m9.display', 'other.path']);
    cleanupCollectedMountRecord({
      byMarker,
      marker: '#m9',
      getterPaths,
      addedGetterPaths: new Set(['users.*.#m9.display']),
    });
    expect(byMarker.has('#m9')).toBe(false);
    expect(getterPaths.has('users.*.#m9.display')).toBe(false);
    expect(getterPaths.has('other.path')).toBe(true);
  });

  it('生きている参照は消さず、getterPaths 無し・エントリ無しでも落ちないこと（防御）', () => {
    const live = {} as any;
    const byMarker = new Map<string, WeakRef<any>>([['#m9', { deref: () => live } as unknown as WeakRef<any>]]);
    cleanupCollectedMountRecord({ byMarker, marker: '#m9', getterPaths: undefined, addedGetterPaths: new Set() });
    expect(byMarker.has('#m9')).toBe(true);
    cleanupCollectedMountRecord({ byMarker: new Map(), marker: '#mX', getterPaths: undefined, addedGetterPaths: new Set() });
  });

  it('死んだ WeakRef は getMountRecordByPath が遅延 prune し、列挙からも外れること', () => {
    const parent = { getterPaths: new Set<string>() } as any;
    const component = document.createElement('my-card');
    const r = buildMountRecord(component, 'state', [hostBinding(['state'], 'users.*')], parent, {});
    registerMountRecord(component, r);
    expect(getMountRecordByPath(parent, `users.*.${r.marker}.editing`)).toBe(r);
    expect(getMountRecordsForStateElement(parent)).toEqual([r]);

    // GC を再現: WeakRef を死んだ参照に差し替える
    _setMountRecordRefForTesting(parent, r.marker, { deref: () => undefined } as unknown as WeakRef<any>);
    expect(getMountRecordsForStateElement(parent)).toEqual([]);
    expect(getMountRecordByPath(parent, `users.*.${r.marker}.editing`)).toBeNull();
    // 遅延 prune 済み: 2 回目はエントリ自体が無い経路で null
    expect(getMountRecordByPath(parent, `users.*.${r.marker}.editing`)).toBeNull();
  });

  it('再登録（同一 record・マーカー再利用）が冪等に通り、記録が引き続き解決されること', () => {
    const parent = { getterPaths: new Set<string>() } as any;
    const component = document.createElement('my-card');
    const r = buildMountRecord(component, 'state', [hostBinding(['state'], 'users.*')], parent, {});
    registerMountRecord(component, r);
    registerMountRecord(component, r);
    expect(getMountRecordByPath(parent, `users.*.${r.marker}.x`)).toBe(r);
    expect(getMountRecordsForStateElement(parent)).toEqual([r]);
  });
});
