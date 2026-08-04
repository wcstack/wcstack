import { describe, it, expect } from 'vitest';
import { processBindablesDeclaration } from '../src/dcc/processBindablesDeclaration';
import { createWcBindable } from '../src/dcc/wcBindable';
import { readBindableDeclaration } from '../src/protocol/wcBindableReader';

describe('dcc/processBindablesDeclaration', () => {
  it('$bindablesが未宣言なら空配列を返すこと', () => {
    expect(processBindablesDeclaration({} as any)).toEqual([]);
  });

  it('正常な宣言はそのままの順序で返ること', () => {
    expect(processBindablesDeclaration({ $bindables: ['count', 'name'] } as any))
      .toEqual(['count', 'name']);
  });

  it('配列でない宣言はエラーになること', () => {
    expect(() => processBindablesDeclaration({ $bindables: 'count' } as any))
      .toThrow('must be an array of strings');
  });

  it('空文字列のエントリはエラーになること', () => {
    expect(() => processBindablesDeclaration({ $bindables: [''] } as any))
      .toThrow('must be non-empty strings');
  });

  it('文字列でないエントリはエラーになること', () => {
    expect(() => processBindablesDeclaration({ $bindables: [1] } as any))
      .toThrow('must be non-empty strings');
  });

  it('$始まりのエントリはエラーになること', () => {
    // isInternalProperty により prototype にアクセサが生えないため、
    // 宣言だけが生きて要素側が expando を掴む
    expect(() => processBindablesDeclaration({ $bindables: ['$secret'] } as any))
      .toThrow('must not start with "$"');
  });

  it('重複エントリはエラーになること', () => {
    expect(() => processBindablesDeclaration({ $bindables: ['count', 'count'] } as any))
      .toThrow('is duplicated');
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
    const sound = createWcBindable('t-sound-probe', ['count']);
    class Sound extends HTMLElement { static wcBindable = sound as any; }
    if (!customElements.get('t-sound-probe')) customElements.define('t-sound-probe', Sound);
    const read = readBindableDeclaration(document.createElement('t-sound-probe'));
    expect(read).not.toBeNull();
    expect(read!.knownProperties.has('count')).toBe(true);
    expect(read!.declaredInputs.has('count')).toBe(true);
  });
});
