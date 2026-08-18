/**
 * watch.processWatchDeclaration.test.ts
 *
 * `$watch` 宣言の解析・検証・依存グラフ登録（実装計画 A-3）。
 *
 * 受け入れ ID:
 * - P1: 宣言したパスが依存グラフ（staticDependency）に登録される
 * - S1: 宣言バリデーションの全違反ケース（`@` 越境含む）
 */
import { describe, it, expect } from 'vitest';
import { processWatchDeclaration } from '../src/watch/processWatchDeclaration';
import { getWatchEntries, __private__ } from '../src/watch/watchRegistry';
import type { IStateElement } from '../src/components/types';
import type { IState } from '../src/types';

/**
 * setPathInfo の本体挙動（親 → 子の staticDependency チェーン生成）だけを写した最小 fake。
 * 実 State の実装（components/State.ts）と同じ「重複時は break」条件で打ち切る。
 */
const fakeStateElement = (): IStateElement => {
  const staticDependency = new Map<string, string[]>();
  const pathSet = new Set<string>();
  return {
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    staticDependency,
    setPathInfo(path: string) {
      if (pathSet.has(path)) return;
      pathSet.add(path);
      const segments = path.split('.');
      for (let i = segments.length - 1; i > 0; i--) {
        const child = segments.slice(0, i + 1).join('.');
        const parent = segments.slice(0, i).join('.');
        const children = staticDependency.get(parent);
        if (typeof children === 'undefined') {
          staticDependency.set(parent, [child]);
        } else if (!children.includes(child)) {
          children.push(child);
        }
      }
    },
  } as unknown as IStateElement;
};

const noop = () => { /* noop */ };

describe('processWatchDeclaration', () => {
  it('$watch 未宣言なら null を返し registry にも登録しないこと', () => {
    const se = fakeStateElement();
    expect(processWatchDeclaration(se, {} as IState)).toBeNull();
    expect(__private__.registryByStateElement.has(se)).toBe(false);
  });

  it('$watch が空オブジェクトなら null を返すこと（ゼロコスト契約のため watchPaths を作らない）', () => {
    const se = fakeStateElement();
    expect(processWatchDeclaration(se, { $watch: {} } as unknown as IState)).toBeNull();
  });

  it('$watch がオブジェクトでない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processWatchDeclaration(se, { $watch: 'x' } as unknown as IState))
      .toThrow(/\$watch must be an object/);
  });

  it('$watch が null の場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processWatchDeclaration(se, { $watch: null } as unknown as IState))
      .toThrow(/\$watch must be an object/);
  });

  it('ハンドラが関数でない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processWatchDeclaration(se, { $watch: { a: 1 } } as unknown as IState))
      .toThrow(/\$watch entry "a" must be a function/);
  });

  it('パスが空文字の場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processWatchDeclaration(se, { $watch: { '': noop } } as unknown as IState))
      .toThrow(/\$watch entry name must be a non-empty state path/);
  });

  it('パスが "$" で始まる場合はエラーになること（予約名前空間）', () => {
    const se = fakeStateElement();
    expect(() => processWatchDeclaration(se, { $watch: { $streamStatus: noop } } as unknown as IState))
      .toThrow(/\$watch entry "\$streamStatus" must not start with "\$"/);
  });

  it('パスに "@" を含む場合はエラーになること（越境 watch は不採用）', () => {
    const se = fakeStateElement();
    expect(() => processWatchDeclaration(se, { $watch: { 'count@other': noop } } as unknown as IState))
      .toThrow(/must not target another state/);
  });

  it('パスが Object.prototype の継承名の場合はエラーになること', () => {
    for (const path of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const se = fakeStateElement();
      expect(() => processWatchDeclaration(se, {
        $watch: { [path]: noop },
      } as unknown as IState)).toThrow(/must not be a property name inherited from Object\.prototype/);
    }
  });

  it('パスに空セグメントがある場合はエラーになること（"a..b" / 末尾の "."）', () => {
    for (const path of ['a..b', 'a.', '.a']) {
      const se = fakeStateElement();
      expect(() => processWatchDeclaration(se, {
        $watch: { [path]: noop },
      } as unknown as IState)).toThrow(/has an empty path segment/);
    }
  });

  it('ワイルドカード段数が MAX_WILDCARD_DEPTH を超える場合はエラーになること', () => {
    const se = fakeStateElement();
    const path = ['items', ...Array.from({ length: 129 }, () => '*')].join('.');
    expect(() => processWatchDeclaration(se, { $watch: { [path]: noop } } as unknown as IState))
      .toThrow(/exceeds the maximum wildcard depth/);
  });

  it('正常系: entry が宣言順の order 付きで登録され、パス集合が返ること', () => {
    const se = fakeStateElement();
    const first = () => { /* noop */ };
    const second = () => { /* noop */ };
    const paths = processWatchDeclaration(se, {
      $watch: { isLoading: first, 'items.*.price': second },
    } as unknown as IState);

    expect(paths).not.toBeNull();
    expect(Array.from(paths!)).toEqual(['isLoading', 'items.*.price']);
    const entries = getWatchEntries(se);
    expect(entries.get('isLoading')!.order).toBe(0);
    expect(entries.get('isLoading')!.handler).toBe(first);
    expect(entries.get('items.*.price')!.order).toBe(1);
    expect(entries.get('items.*.price')!.pathInfo.wildcardCount).toBe(1);
  });

  it('P1: 宣言したパスが依存グラフに登録されること（headless 購読の成立条件）', () => {
    // setPathInfo は BindingSession からしか呼ばれないため、watch が自分で登録しないと
    // walkDependency がこのパスを知らず、items への代入がバッチに載らない（設計書 §8）。
    const se = fakeStateElement();
    processWatchDeclaration(se, { $watch: { 'items.*.price': noop } } as unknown as IState);

    expect(se.staticDependency.get('items')).toEqual(['items.*']);
    expect(se.staticDependency.get('items.*')).toEqual(['items.*.price']);
  });

  it('ルート直下のパスでは依存チェーンが生えないこと（親が無い）', () => {
    const se = fakeStateElement();
    processWatchDeclaration(se, { $watch: { isLoading: noop } } as unknown as IState);
    expect(se.staticDependency.size).toBe(0);
  });

  it('再宣言で registry が丸ごと置き換わること', () => {
    const se = fakeStateElement();
    processWatchDeclaration(se, { $watch: { a: noop } } as unknown as IState);
    processWatchDeclaration(se, { $watch: { b: noop } } as unknown as IState);
    const entries = getWatchEntries(se);
    expect(entries.has('a')).toBe(false);
    expect(entries.has('b')).toBe(true);
  });
});
