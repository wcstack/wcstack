import { describe, it, expect } from 'vitest';
import {
  setStreamEntries,
  getStreamEntries,
  abortAllStreams,
  clearStreamRegistry,
  __private__,
} from '../src/stream/streamRegistry';
import type { IStreamEntry } from '../src/stream/types';
import type { IStateElement } from '../src/components/types';

const fakeStateElement = (): IStateElement => ({} as IStateElement);

const createEntry = (name: string, overrides: Partial<IStreamEntry> = {}): IStreamEntry => ({
  name,
  definition: {
    args: null,
    source: (_args, _signal) => (async function* () {})(),
    fold: (_acc, chunk) => chunk,
    initial: undefined,
  },
  status: 'active',
  error: null,
  controller: new AbortController(),
  depAddresses: new Set(),
  ...overrides,
});

describe('streamRegistry', () => {
  it('setStreamEntries で登録した Map が getStreamEntries でそのまま取得できること', () => {
    const se = fakeStateElement();
    const entries = new Map<string, IStreamEntry>([['tokens', createEntry('tokens')]]);
    setStreamEntries(se, entries);
    expect(getStreamEntries(se)).toBe(entries);
    expect(getStreamEntries(se).get('tokens')?.name).toBe('tokens');
  });

  it('未登録の stateElement では空 Map を返し、registry には登録しないこと', () => {
    const se = fakeStateElement();
    const entries = getStreamEntries(se);
    expect(entries.size).toBe(0);
    expect(__private__.registryByStateElement.has(se)).toBe(false);
    // 毎回新しい空 Map（共有インスタンスの汚染なし）
    expect(getStreamEntries(se)).not.toBe(entries);
  });

  it('setStreamEntries は置換登録であること（再 set で旧 Map が差し替わる）', () => {
    const se = fakeStateElement();
    const first = new Map<string, IStreamEntry>([['a', createEntry('a')]]);
    const second = new Map<string, IStreamEntry>([['b', createEntry('b')]]);
    setStreamEntries(se, first);
    setStreamEntries(se, second);
    expect(getStreamEntries(se)).toBe(second);
    expect(getStreamEntries(se).has('a')).toBe(false);
  });

  it('abortAllStreams で controller.abort が呼ばれ、controller=null・status=idle・error=null になること', () => {
    const se = fakeStateElement();
    const entry = createEntry('tokens', { status: 'error', error: new Error('boom') });
    const signal = entry.controller!.signal;
    setStreamEntries(se, new Map([['tokens', entry]]));

    abortAllStreams(se);

    expect(signal.aborted).toBe(true);
    expect(entry.controller).toBeNull();
    expect(entry.status).toBe('idle');
    expect(entry.error).toBeNull();
  });

  it('abortAllStreams は複数 entry をすべて abort すること', () => {
    const se = fakeStateElement();
    const a = createEntry('a');
    const b = createEntry('b');
    const signalA = a.controller!.signal;
    const signalB = b.controller!.signal;
    setStreamEntries(se, new Map([['a', a], ['b', b]]));

    abortAllStreams(se);

    expect(signalA.aborted).toBe(true);
    expect(signalB.aborted).toBe(true);
    expect(a.status).toBe('idle');
    expect(b.status).toBe('idle');
  });

  it('abortAllStreams は controller が null の entry（idle 等）でも throw しないこと', () => {
    const se = fakeStateElement();
    const entry = createEntry('tokens', { controller: null, status: 'idle' });
    setStreamEntries(se, new Map([['tokens', entry]]));

    expect(() => abortAllStreams(se)).not.toThrow();
    expect(entry.controller).toBeNull();
    expect(entry.status).toBe('idle');
  });

  it('abortAllStreams 後も registry は保持されること（未登録 stateElement では no-op）', () => {
    const se = fakeStateElement();
    const entries = new Map<string, IStreamEntry>([['tokens', createEntry('tokens')]]);
    setStreamEntries(se, entries);

    abortAllStreams(se);
    expect(__private__.registryByStateElement.has(se)).toBe(true);
    expect(getStreamEntries(se)).toBe(entries);

    // 未登録 stateElement に対しても throw しない
    expect(() => abortAllStreams(fakeStateElement())).not.toThrow();
  });

  it('clearStreamRegistry で abort されたうえで registry から削除されること', () => {
    const se = fakeStateElement();
    const entry = createEntry('tokens');
    const signal = entry.controller!.signal;
    setStreamEntries(se, new Map([['tokens', entry]]));

    clearStreamRegistry(se);

    expect(signal.aborted).toBe(true);
    expect(entry.controller).toBeNull();
    expect(entry.status).toBe('idle');
    expect(__private__.registryByStateElement.has(se)).toBe(false);
    expect(getStreamEntries(se).size).toBe(0);
  });
});
