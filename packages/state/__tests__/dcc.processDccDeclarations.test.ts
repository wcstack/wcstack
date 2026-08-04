import { describe, it, expect } from 'vitest';
import { processDccDeclarations } from '../src/dcc/processDccDeclarations';
import { createWcBindable } from '../src/dcc/wcBindable';
import { readBindableDeclaration } from '../src/protocol/wcBindableReader';

describe('dcc/processDccDeclarations', () => {
  it('宣言が無ければ空配列を返すこと', () => {
    expect(processDccDeclarations({} as any)).toEqual({
      bindables: [], commands: [], streamBackedBindables: [],
    });
  });

  it('正常な宣言はそのままの順序で返ること', () => {
    const state = { count: 0, name: '', inc() { /* noop */ }, $bindables: ['count', 'name'], $commands: ['inc'] };
    const result = processDccDeclarations(state as any);
    expect(result.bindables).toEqual(['count', 'name']);
    expect(result.commands).toEqual(['inc']);
  });

  describe.each([
    ['$bindables', (v: unknown) => ({ count: 0, $bindables: v })],
    ['$commands', (v: unknown) => ({ inc() { /* noop */ }, $commands: v })],
  ])('%s の構造検証', (name, make) => {
    it('配列でない宣言はエラーになること', () => {
      expect(() => processDccDeclarations(make('count') as any)).toThrow('must be an array of strings');
    });

    it('空文字列のエントリはエラーになること', () => {
      expect(() => processDccDeclarations(make(['']) as any)).toThrow('must be non-empty strings');
    });

    it('文字列でないエントリはエラーになること', () => {
      expect(() => processDccDeclarations(make([1]) as any)).toThrow('must be non-empty strings');
    });

    it('$始まりのエントリはエラーになること', () => {
      // isInternalProperty により prototype にアクセサ/メソッドが生えないため、
      // 宣言だけが生きて要素側が expando を掴む
      expect(() => processDccDeclarations(make(['$secret']) as any)).toThrow('must not start with "$"');
    });

    it('重複エントリはエラーになること', () => {
      const dup = name === '$bindables' ? ['count', 'count'] : ['inc', 'inc'];
      expect(() => processDccDeclarations(make(dup) as any)).toThrow('is duplicated');
    });
  });

  describe('存在検査', () => {
    it('stateに無い$bindablesエントリはエラーになること', () => {
      expect(() => processDccDeclarations({ $bindables: ['nosuch'] } as any))
        .toThrow('$bindables entry "nosuch" is not declared on the state');
    });

    it('stateに無い$commandsエントリはエラーになること', () => {
      expect(() => processDccDeclarations({ $commands: ['nosuch'] } as any))
        .toThrow('$commands entry "nosuch" is not declared on the state');
    });

    it('メソッドを$bindablesに書いたらエラーになること', () => {
      expect(() => processDccDeclarations({ inc() { /* noop */ }, $bindables: ['inc'] } as any))
        .toThrow('is a method. Declare it in $commands instead');
    });

    it('値プロパティを$commandsに書いたらエラーになること', () => {
      expect(() => processDccDeclarations({ count: 0, $commands: ['count'] } as any))
        .toThrow('is not a method. Declare it in $bindables instead');
    });

    it('プロトタイプチェーン上のメンバも実在として扱われること', () => {
      class Base { get derived() { return 1; } run() { /* noop */ } }
      const state = Object.assign(new Base(), { $bindables: ['derived'], $commands: ['run'] });
      const result = processDccDeclarations(state as any);
      expect(result.bindables).toEqual(['derived']);
      expect(result.commands).toEqual(['run']);
    });

    // $streams の値プロパティはインスタンス側の実体化まで state 上に現れないため、
    // 存在検査では宣言名も「実在」として扱い、アクセサは defineDCC 側で補う（§2.3）。
    it('$streams由来の名前は許可されstreamBackedBindablesに載ること', () => {
      const state = {
        $streams: { ticks: { source: () => [] } },
        $bindables: ['ticks'],
      };
      const result = processDccDeclarations(state as any);
      expect(result.bindables).toEqual(['ticks']);
      expect(result.streamBackedBindables).toEqual(['ticks']);
    });

    it('stateに実体がある$streams名はstreamBackedBindablesに載らないこと', () => {
      const state = {
        ticks: 0,
        $streams: { ticks: { source: () => [] } },
        $bindables: ['ticks'],
      };
      expect(processDccDeclarations(state as any).streamBackedBindables).toEqual([]);
    });

    it('$streamsが非オブジェクトでも存在検査は落ちずに通常のエラーになること', () => {
      // $streams 自体の妥当性検査は processStreamsDeclaration の責務
      expect(() => processDccDeclarations({ $streams: 'nope', $bindables: ['x'] } as any))
        .toThrow('is not declared on the state');
    });
  });

  // 回帰の芯: 重複を通すと readNamedList が null を返し、readBindableDeclaration が
  // 宣言全体を棄却する。すなわち wc-bindable 面が警告なしで丸ごと死ぬ
  // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.5）。
  it('重複名を含む宣言は reader に棄却されるため生成前に落とす必要があること', () => {
    const broken = createWcBindable('t-dup-probe', ['count', 'count']);
    class Broken extends HTMLElement { static wcBindable = broken as any; }
    if (!customElements.get('t-dup-probe')) customElements.define('t-dup-probe', Broken);
    expect(readBindableDeclaration(document.createElement('t-dup-probe'))).toBeNull();

    // 重複を通さなければ reader に受理される
    const sound = createWcBindable('t-sound-probe', ['count'], ['inc']);
    class Sound extends HTMLElement { static wcBindable = sound as any; }
    if (!customElements.get('t-sound-probe')) customElements.define('t-sound-probe', Sound);
    const read = readBindableDeclaration(document.createElement('t-sound-probe'));
    expect(read).not.toBeNull();
    expect(read!.knownProperties.has('count')).toBe(true);
    expect(read!.declaredInputs.has('count')).toBe(true);
    expect(read!.declaredCommands.has('inc')).toBe(true);
  });

  it('$commandsが空なら commands キー自体を生成しないこと', () => {
    expect(createWcBindable('t-nocmd', ['count']).commands).toBeUndefined();
  });

  // callFn は常に initializePromise に chain するため、state 側のメソッドが同期でも
  // 呼び出し側から見た戻り値は Promise。async は一律 true が実態に合う。
  it('生成される commands は一律 async: true であること', () => {
    expect(createWcBindable('t-cmd', [], ['inc', 'reset']).commands).toEqual([
      { name: 'inc', async: true },
      { name: 'reset', async: true },
    ]);
  });
});
