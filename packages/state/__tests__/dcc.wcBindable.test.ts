import { describe, it, expect } from 'vitest';
import { createWcBindable, createBindableEventMap } from '../src/dcc/wcBindable';

describe('dcc/wcBindable', () => {
  describe('createWcBindable', () => {
    it('bindablesからwcBindableオブジェクトを生成すること', () => {
      const result = createWcBindable('my-component', ['count', 'name']);
      expect(result).toEqual({
        protocol: 'wc-bindable',
        version: 1,
        properties: [
          { name: 'count', event: 'my-component:count-changed' },
          { name: 'name', event: 'my-component:name-changed' },
        ],
        inputs: [
          { name: 'count' },
          { name: 'name' },
        ],
      });
    });

    it('$bindables は getter/setter 両面を持つため properties と inputs の両方に宣言されること', () => {
      // properties のみだと directional initial sync が output-only と判定し、
      // 親 state → DCC への書き込みが恒久的に抑止される（v1.21.0 の回帰）。
      const result = createWcBindable('my-counter', ['count']);
      const propertyNames = result.properties.map((p) => p.name);
      const inputNames = (result.inputs ?? []).map((i) => i.name);
      expect(inputNames).toEqual(propertyNames);
    });

    it('空のbindablesの場合はpropertiesとinputsが空になること', () => {
      const result = createWcBindable('x-el', []);
      expect(result.properties).toEqual([]);
      expect(result.inputs).toEqual([]);
    });
  });

  describe('createBindableEventMap', () => {
    it('プロパティ名からイベント名へのマップを生成すること', () => {
      const result = createBindableEventMap('my-input', ['value', 'checked']);
      expect(result).toEqual({
        value: 'my-input:value-changed',
        checked: 'my-input:checked-changed',
      });
    });

    it('空のbindablesの場合は空オブジェクトを返すこと', () => {
      const result = createBindableEventMap('x-el', []);
      expect(result).toEqual({});
    });
  });
});
