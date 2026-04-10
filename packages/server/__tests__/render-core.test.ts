import { describe, it, expect, vi } from 'vitest';
import * as renderModule from '../src/render';
import { RenderCore } from '../src/RenderCore';

describe('RenderCore', () => {

  describe('static wcBindable', () => {
    it('プロトコル宣言が正しい', () => {
      const { protocol, version, properties } = RenderCore.wcBindable;
      expect(protocol).toBe('wc-bindable');
      expect(version).toBe(1);
      expect(properties).toHaveLength(3);
    });

    it('html プロパティが宣言されている', () => {
      const prop = RenderCore.wcBindable.properties.find(p => p.name === 'html');
      expect(prop).toBeDefined();
      expect(prop!.event).toBe('wcs-render:html-changed');
    });

    it('loading プロパティが宣言されている', () => {
      const prop = RenderCore.wcBindable.properties.find(p => p.name === 'loading');
      expect(prop).toBeDefined();
      expect(prop!.event).toBe('wcs-render:loading-changed');
    });

    it('error プロパティが宣言されている', () => {
      const prop = RenderCore.wcBindable.properties.find(p => p.name === 'error');
      expect(prop).toBeDefined();
      expect(prop!.event).toBe('wcs-render:error');
    });
  });

  describe('初期状態', () => {
    it('html が null', () => {
      const core = new RenderCore();
      expect(core.html).toBeNull();
    });

    it('loading が false', () => {
      const core = new RenderCore();
      expect(core.loading).toBe(false);
    });

    it('error が null', () => {
      const core = new RenderCore();
      expect(core.error).toBeNull();
    });
  });

  describe('render()', () => {
    it('レンダリング結果を html プロパティに格納する', async () => {
      const core = new RenderCore();
      const result = await core.render('<p>Hello</p>');
      expect(result).toContain('<p>Hello</p>');
      expect(core.html).toBe(result);
    });

    it('loading イベントが発火される', async () => {
      const core = new RenderCore();
      const events: boolean[] = [];
      core.addEventListener('wcs-render:loading-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });
      await core.render('<p>test</p>');
      expect(events).toEqual([true, false]);
    });

    it('html-changed イベントが発火される', async () => {
      const core = new RenderCore();
      const handler = vi.fn();
      core.addEventListener('wcs-render:html-changed', handler);
      await core.render('<p>test</p>');
      expect(handler).toHaveBeenCalledOnce();
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toContain('<p>test</p>');
    });

    it('エラー時に error プロパティがセットされる', async () => {
      const spy = vi.spyOn(renderModule, 'renderToString').mockRejectedValueOnce(new Error('render failed'));
      const core = new RenderCore();
      const handler = vi.fn();
      core.addEventListener('wcs-render:error', handler);
      const result = await core.render('<p>fail</p>');
      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(Error);
      expect(core.error!.message).toBe('render failed');
      // render開始時に null（エラークリア）、失敗時にエラーオブジェクトの2回発火
      expect(handler).toHaveBeenCalledTimes(2);
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toBeNull();
      expect((handler.mock.calls[1][0] as CustomEvent).detail).toBeInstanceOf(Error);
      spy.mockRestore();
    });

    it('成功後に loading が false になる', async () => {
      const core = new RenderCore();
      await core.render('<p>done</p>');
      expect(core.loading).toBe(false);
    });

    it('エラー後に loading が false になる', async () => {
      const spy = vi.spyOn(renderModule, 'renderToString').mockRejectedValueOnce(new Error('fail'));
      const core = new RenderCore();
      await core.render('<p>fail</p>');
      expect(core.loading).toBe(false);
      spy.mockRestore();
    });

    it('Error以外のエラーがErrorに変換される', async () => {
      const spy = vi.spyOn(renderModule, 'renderToString').mockRejectedValueOnce('string error');
      const core = new RenderCore();
      const result = await core.render('<p>fail</p>');
      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(Error);
      expect(core.error!.message).toBe('string error');
      spy.mockRestore();
    });
  });

  describe('bind() 互換性', () => {
    it('DEFAULT_GETTER (e => e.detail) でプロパティ値を取得できる', async () => {
      const core = new RenderCore();
      const values: Record<string, any> = {};

      // bind() と同等のロジック
      const { properties } = RenderCore.wcBindable;
      for (const prop of properties) {
        const getter = prop.getter ?? ((e: Event) => (e as CustomEvent).detail);
        core.addEventListener(prop.event, (event) => {
          values[prop.name] = getter(event);
        });
        const current = (core as any)[prop.name];
        if (current !== undefined) {
          values[prop.name] = current;
        }
      }

      await core.render('<p>bind test</p>');

      expect(values.html).toContain('<p>bind test</p>');
      expect(values.loading).toBe(false);
      expect(values.error).toBeNull(); // error イベントは未発火、初期値 null が sync される
    });
  });
});
