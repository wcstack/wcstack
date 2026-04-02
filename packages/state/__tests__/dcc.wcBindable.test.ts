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
      });
    });

    it('空のbindablesの場合はpropertiesが空になること', () => {
      const result = createWcBindable('x-el', []);
      expect(result.properties).toEqual([]);
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
