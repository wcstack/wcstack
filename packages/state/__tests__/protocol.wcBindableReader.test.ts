import { describe, expect, it } from 'vitest';
import { getWcBindableDeclaration } from '@wc-bindable/core';
import {
  MIN_WC_BINDABLE_VERSION,
  readBindableDeclaration,
} from '../src/protocol/wcBindableReader';

function validDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: 'wc-bindable',
    version: 1,
    properties: [{ name: 'value', event: 'value-changed' }],
    ...overrides,
  };
}

function targetWith(declaration: unknown): Record<string, unknown> {
  return {
    addEventListener() {},
    removeEventListener() {},
    constructor: { wcBindable: declaration },
  };
}

describe('readBindableDeclaration', () => {
  it.each([
    validDeclaration(),
    validDeclaration({ version: 2, futureMetadata: true }),
    validDeclaration({ version: 0 }),
    validDeclaration({ properties: [{ name: '', event: 'change' }] }),
    validDeclaration({ inputs: [{ name: 'url', attribute: false }] }),
    validDeclaration({ commands: [{ name: 'reload', async: 'yes' }] }),
  ])('固定 upstream helper を oracle として受理結果が一致する', (declaration) => {
    const target = targetWith(declaration);
    const oracleAccepted = getWcBindableDeclaration(target) !== undefined;
    expect(readBindableDeclaration(target) !== null).toBe(oracleAccepted);
  });

  it('version 1のlive declarationとdescriptor indexを返す', () => {
    const property = { name: 'value', event: 'value-changed' };
    const input = { name: 'url', attribute: 'data-url' };
    const command = { name: 'reload', async: true };
    const declaration = validDeclaration({ properties: [property], inputs: [input], commands: [command] });
    const target = targetWith(declaration);

    const result = readBindableDeclaration(target);

    expect(MIN_WC_BINDABLE_VERSION).toBe(1);
    expect(result?.target).toBe(target);
    expect(result?.liveDeclaration).toBe(declaration);
    expect(result?.knownProperties.get('value')).toBe(property);
    expect(result?.declaredInputs.get('url')).toBe(input);
    expect(result?.declaredCommands.get('reload')).toBe(command);
  });

  it('version 2と大きな整数、未知optional fieldを受理する', () => {
    for (const version of [2, Number.MAX_SAFE_INTEGER]) {
      const declaration = validDeclaration({ version, futureMetadata: { enabled: true } });
      expect(readBindableDeclaration(targetWith(declaration))?.liveDeclaration).toBe(declaration);
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1'])(
    '不正なversion %sを拒否する',
    (version) => {
      expect(readBindableDeclaration(targetWith(validDeclaration({ version })))).toBeNull();
    },
  );

  it('consumer-side listener能力だけを要求しdispatchEventは要求しない', () => {
    const target = targetWith(validDeclaration());
    expect('dispatchEvent' in target).toBe(false);
    expect(readBindableDeclaration(target)).not.toBeNull();

    delete target.removeEventListener;
    expect(readBindableDeclaration(target)).toBeNull();

    const targetWithoutAdd = targetWith(validDeclaration());
    delete targetWithoutAdd.addEventListener;
    expect(readBindableDeclaration(targetWithoutAdd)).toBeNull();
  });

  it('function targetもstructural surfaceが揃えば受理する', () => {
    const target = Object.assign(() => {}, {
      addEventListener() {},
      removeEventListener() {},
    });
    Object.defineProperty(target, 'constructor', { value: { wcBindable: validDeclaration() } });
    expect(readBindableDeclaration(target)).not.toBeNull();
  });

  it('target.constructor.wcBindableだけをdiscovery pathに使う', () => {
    const declaration = validDeclaration();
    const target = targetWith(declaration);
    target.wcBindable = validDeclaration({ protocol: 'instance-override' });

    expect(readBindableDeclaration(target)?.liveDeclaration).toBe(declaration);
    expect(readBindableDeclaration({ ...target, constructor: {} })).toBeNull();
  });

  it.each([
    { protocol: 'other' },
    { properties: null },
    { properties: [null] },
    { properties: [{}] },
    { properties: [{ name: 1, event: 'change' }] },
    { properties: [{ name: '', event: 'change' }] },
    { properties: [{ name: 'value', event: 1 }] },
    { properties: [{ name: 'value', event: '' }] },
    { properties: [{ name: 'value', event: 'change', getter: true }] },
    { inputs: null },
    { inputs: [null] },
    { inputs: [{ name: '' }] },
    { inputs: [{ name: 'url', attribute: true }] },
    { commands: null },
    { commands: [null] },
    { commands: [{ name: '' }] },
    { commands: [{ name: 'reload', async: 'yes' }] },
  ])('schema不正を拒否する: $protocol $properties $inputs $commands', (overrides) => {
    expect(readBindableDeclaration(targetWith(validDeclaration(overrides)))).toBeNull();
  });

  it.each([
    { properties: [{ name: 'value', event: 'a' }, { name: 'value', event: 'b' }] },
    { inputs: [{ name: 'url' }, { name: 'url' }] },
    { commands: [{ name: 'reload' }, { name: 'reload' }] },
  ])('各descriptor list内の名前重複を拒否する', (overrides) => {
    expect(readBindableDeclaration(targetWith(validDeclaration(overrides)))).toBeNull();
  });

  it('異なるdescriptor list間の同名はcore規約どおり受理する', () => {
    const declaration = validDeclaration({ inputs: [{ name: 'value' }], commands: [{ name: 'value' }] });
    const result = readBindableDeclaration(targetWith(declaration));
    expect(result?.knownProperties.has('value')).toBe(true);
    expect(result?.declaredInputs.has('value')).toBe(true);
    expect(result?.declaredCommands.has('value')).toBe(true);
  });

  it.each([null, undefined, 0, 'target', true])('任意の非target入力 %s をthrowせず拒否する', (target) => {
    expect(() => readBindableDeclaration(target)).not.toThrow();
    expect(readBindableDeclaration(target)).toBeNull();
  });

  it('discovery中のproperty accessがthrowしても外へ漏らさない', () => {
    const hostileTarget = new Proxy({}, {
      get() {
        throw new Error('hostile target');
      },
    });
    const hostileDeclaration = new Proxy(validDeclaration(), {
      get(target, property, receiver) {
        if (property === 'properties') throw new Error('hostile declaration');
        return Reflect.get(target, property, receiver);
      },
    });
    const hostileDescriptor = Object.defineProperty({}, 'name', {
      get() {
        throw new Error('hostile descriptor');
      },
    });

    expect(readBindableDeclaration(hostileTarget)).toBeNull();
    expect(readBindableDeclaration(targetWith(hostileDeclaration))).toBeNull();
    expect(readBindableDeclaration(targetWith(validDeclaration({ properties: [hostileDescriptor] })))).toBeNull();
  });
});
