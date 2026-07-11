import { describe, it, expect, vi } from 'vitest';
import { processStreamsDeclaration } from '../src/stream/processStreamsDeclaration';
import { getStreamEntries, __private__ } from '../src/stream/streamRegistry';
import type { IStateElement } from '../src/components/types';
import type { IState } from '../src/types';

const fakeStateElement = (): IStateElement => ({
  getterPaths: new Set<string>(),
  setterPaths: new Set<string>(),
} as unknown as IStateElement);

const noopSource = () => (async function* () {})();

describe('processStreamsDeclaration', () => {
  it('$streams 未宣言なら何もせず registry にも登録しないこと', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, {} as IState)).not.toThrow();
    expect(__private__.registryByStateElement.has(se)).toBe(false);
    expect(getStreamEntries(se).size).toBe(0);
  });

  it('$streams がオブジェクトでない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: 'x' } as unknown as IState))
      .toThrow(/\$streams must be an object/);
  });

  it('$streams が null の場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: null } as unknown as IState))
      .toThrow(/\$streams must be an object/);
  });

  it('名前が空文字の場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: { '': { source: noopSource } } } as unknown as IState))
      .toThrow(/\$streams entry name must be a non-empty string/);
  });

  it('名前に DELIMITER(".") を含む場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: { 'a.b': { source: noopSource } } } as unknown as IState))
      .toThrow(/\$streams entry "a\.b" must be a flat property name/);
  });

  it('名前に WILDCARD("*") を含む場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: { 'a*': { source: noopSource } } } as unknown as IState))
      .toThrow(/\$streams entry "a\*" must be a flat property name/);
  });

  it('名前が "$" で始まる場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: { $tokens: { source: noopSource } } } as unknown as IState))
      .toThrow(/\$streams entry "\$tokens" must not start with "\$"/);
  });

  it('getter 宣言済みパスと衝突する場合はエラーになること', () => {
    const se = fakeStateElement();
    se.getterPaths.add('tokens');
    expect(() => processStreamsDeclaration(se, { $streams: { tokens: { source: noopSource } } } as unknown as IState))
      .toThrow(/\$streams entry "tokens" conflicts with a getter/);
  });

  it('setter 宣言済みパスと衝突する場合はエラーになること', () => {
    const se = fakeStateElement();
    se.setterPaths.add('tokens');
    expect(() => processStreamsDeclaration(se, { $streams: { tokens: { source: noopSource } } } as unknown as IState))
      .toThrow(/\$streams entry "tokens" conflicts with a setter/);
  });

  it('定義がオブジェクトでない場合はエラーになること（null 含む）', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: { tokens: 'x' } } as unknown as IState))
      .toThrow(/\$streams entry "tokens" must be an object/);
    expect(() => processStreamsDeclaration(se, { $streams: { tokens: null } } as unknown as IState))
      .toThrow(/\$streams entry "tokens" must be an object/);
  });

  it('source が関数でない場合はエラーになること（欠落含む）', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, { $streams: { tokens: { source: 123 } } } as unknown as IState))
      .toThrow(/\$streams entry "tokens" source must be a function/);
    expect(() => processStreamsDeclaration(se, { $streams: { tokens: {} } } as unknown as IState))
      .toThrow(/\$streams entry "tokens" source must be a function/);
  });

  it('fold が関数でない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, {
      $streams: { tokens: { source: noopSource, fold: 'x', initial: '' } },
    } as unknown as IState)).toThrow(/\$streams entry "tokens" fold must be a function/);
  });

  it('fold があるのに initial が無い場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, {
      $streams: { tokens: { source: noopSource, fold: (acc: string, chunk: string) => acc + chunk } },
    } as unknown as IState)).toThrow(/\$streams entry "tokens" requires "initial" when fold is specified/);
  });

  it('initial: undefined の明示宣言は in 演算子判定で許容されること', () => {
    const se = fakeStateElement();
    const state = {
      $streams: { tokens: { source: noopSource, fold: (_acc: unknown, chunk: unknown) => chunk, initial: undefined } },
    } as unknown as IState;
    expect(() => processStreamsDeclaration(se, state)).not.toThrow();
    expect(getStreamEntries(se).get('tokens')!.definition.initial).toBeUndefined();
  });

  it('args が関数でない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processStreamsDeclaration(se, {
      $streams: { tokens: { source: noopSource, args: 'prompt' } },
    } as unknown as IState)).toThrow(/\$streams entry "tokens" args must be a function/);
  });

  it('フル形宣言から entry を構築して registry に一括登録すること', () => {
    const se = fakeStateElement();
    const args = vi.fn();
    const source = vi.fn();
    const fold = vi.fn((acc: unknown, chunk: unknown) => `${acc}${chunk}`);
    const state = { $streams: { tokens: { args, source, fold, initial: '' } } } as unknown as IState;
    processStreamsDeclaration(se, state);
    const entry = getStreamEntries(se).get('tokens')!;
    expect(entry.name).toBe('tokens');
    expect(entry.definition.args).toBe(args);
    expect(entry.definition.source).toBe(source);
    expect(entry.definition.fold).toBe(fold);
    expect(entry.definition.initial).toBe('');
    expect(entry.status).toBe('idle');
    expect(entry.error).toBeNull();
    expect(entry.controller).toBeNull();
    expect(entry.depAddresses.size).toBe(0);
  });

  it('fold 省略時は latest fold（最新チャンクで置換）を注入し args 省略時は null になること', () => {
    const se = fakeStateElement();
    const state = { $streams: { ticker: { source: noopSource } } } as unknown as IState;
    processStreamsDeclaration(se, state);
    const entry = getStreamEntries(se).get('ticker')!;
    expect(entry.definition.args).toBeNull();
    expect(entry.definition.fold('old', 'new')).toBe('new');
    expect(entry.definition.initial).toBeUndefined();
  });

  it('値プロパティを initial で実体化すること（fold 無しは undefined）', () => {
    const se = fakeStateElement();
    const state = {
      $streams: {
        tokens: { source: noopSource, fold: (_acc: unknown, chunk: unknown) => chunk, initial: 'seed' },
        ticker: { source: noopSource },
      },
    } as unknown as IState;
    processStreamsDeclaration(se, state);
    expect(state.tokens).toBe('seed');
    expect(Object.prototype.hasOwnProperty.call(state, 'ticker')).toBe(true);
    expect(state.ticker).toBeUndefined();
  });

  it('ユーザーが先に宣言した同名プロパティは上書きしないこと', () => {
    const se = fakeStateElement();
    const state = {
      tokens: 'pre-declared',
      $streams: { tokens: { source: noopSource, fold: (_acc: unknown, chunk: unknown) => chunk, initial: '' } },
    } as unknown as IState;
    processStreamsDeclaration(se, state);
    expect(state.tokens).toBe('pre-declared');
  });

  it('複数 entry を 1 つの Map で一括登録すること（空宣言は空 Map 登録）', () => {
    const se = fakeStateElement();
    const state = {
      $streams: {
        tokens: { source: noopSource, fold: (_acc: unknown, chunk: unknown) => chunk, initial: '' },
        ticker: { source: noopSource },
      },
    } as unknown as IState;
    processStreamsDeclaration(se, state);
    const entries = getStreamEntries(se);
    expect(entries.size).toBe(2);
    expect(entries.has('tokens')).toBe(true);
    expect(entries.has('ticker')).toBe(true);

    const se2 = fakeStateElement();
    processStreamsDeclaration(se2, { $streams: {} } as unknown as IState);
    expect(__private__.registryByStateElement.has(se2)).toBe(true);
    expect(getStreamEntries(se2).size).toBe(0);
  });
});
