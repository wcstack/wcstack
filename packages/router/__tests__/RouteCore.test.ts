import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteCore } from '../src/core/RouteCore';
import './setup';

describe('RouteCore', () => {
  it('EventTargetを継承している', () => {
    const core = new RouteCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });

  // docs/router-state-contract-design.md §5.1 / D2 — detached な Route の宣言は
  // data-wcs から構造的に到達不能な「果たせない約束」なので宣言しない。
  // 観測面は Router.wcBindable に集約された。再導入をここで防ぐ。
  it('wcBindable 宣言を持たないこと（死接面の撤去）', () => {
    expect((RouteCore as any).wcBindable).toBeUndefined();
  });

  it('初期状態が正しい', () => {
    const core = new RouteCore();
    expect(core.params).toEqual({});
    expect(core.typedParams).toEqual({});
    expect(core.active).toBe(false);
    expect(core.path).toBe('');
    expect(core.name).toBe('');
    expect(core.parentCore).toBeNull();
    expect(core.isFallbackRoute).toBe(false);
  });

  describe('parsePath', () => {
    it('静的パスを解析できる', () => {
      const core = new RouteCore();
      core.parsePath('/users');
      expect(core.path).toBe('/users');
      expect(core.segmentInfos).toHaveLength(2); // '', 'users'
      expect(core.segmentInfos.map(s => s.type)).toEqual(['static', 'static']);
    });

    it('パラメータ付きパスを解析できる', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');
      expect(core.segmentInfos).toHaveLength(3);
      expect(core.segmentInfos.map(s => s.type)).toEqual(['static', 'static', 'param']);
      expect(core.paramNames).toEqual(['id']);
    });

    it('型付きパラメータを解析できる', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id(int)');
      expect(core.segmentInfos[2].paramType).toBe('int');
    });

    it('catch-allパスを解析できる', () => {
      const core = new RouteCore();
      core.parsePath('/files/*');
      expect(core.segmentInfos).toHaveLength(3);
      expect(core.segmentInfos[2].type).toBe('catch-all');
    });

    it('catch-all以降のセグメントは無視される', () => {
      const core = new RouteCore();
      core.parsePath('/files/*/ignored');
      expect(core.segmentInfos).toHaveLength(3);
    });

    it('indexオプションで空セグメントを追加できる', () => {
      const core = new RouteCore();
      core.parsePath('', { isIndex: true });
      expect(core.segmentInfos).toHaveLength(1);
      expect(core.segmentInfos[0].isIndex).toBe(true);
    });

    it('nameオプションを設定できる', () => {
      const core = new RouteCore();
      core.parsePath('/test', { name: 'test-route' });
      expect(core.name).toBe('test-route');
    });

    it('guardオプションを設定できる', () => {
      const core = new RouteCore();
      core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
      expect((core as any)._hasGuard).toBe(true);
      expect((core as any)._guardFallbackPath).toBe('/login');
    });
  });

  describe('weight', () => {
    it('静的セグメントの重みは2', () => {
      const core = new RouteCore();
      core.parsePath('/users');
      // '' + 'users' = 2 + 2 = 4
      expect(core.weight).toBe(4);
    });

    it('パラメータセグメントの重みは1', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');
      // '' + 'users' + ':id' = 2 + 2 + 1 = 5
      expect(core.weight).toBe(5);
    });

    it('catch-allの重みは0', () => {
      const core = new RouteCore();
      core.parsePath('/files/*');
      // '' + 'files' + '*' = 2 + 2 + 0 = 4
      expect(core.weight).toBe(4);
    });
  });

  describe('parent-child relationship', () => {
    it('親Coreを設定して絶対パスを計算できる', () => {
      const parent = new RouteCore();
      parent.parsePath('/parent');

      const child = new RouteCore();
      child.parentCore = parent;
      child.parsePath('child');

      expect(child.absolutePath).toBe('/parent/child');
    });

    it('absoluteSegmentInfosが親と結合される', () => {
      const parent = new RouteCore();
      parent.parsePath('/parent');

      const child = new RouteCore();
      child.parentCore = parent;
      child.parsePath('child/:id');

      expect(child.absoluteSegmentInfos).toHaveLength(4);
      expect(child.absoluteSegmentInfos.map(s => s.segmentText)).toEqual(['', 'parent', 'child', ':id']);
    });

    it('absoluteParamNamesが親と結合される', () => {
      const parent = new RouteCore();
      parent.parsePath('/users/:userId');

      const child = new RouteCore();
      child.parentCore = parent;
      child.parsePath('posts/:postId');

      expect(child.absoluteParamNames).toEqual(['userId', 'postId']);
    });

    it('absoluteWeightが親と合計される', () => {
      const parent = new RouteCore();
      parent.parsePath('/parent');
      // '' + 'parent' = 4

      const child = new RouteCore();
      child.parentCore = parent;
      child.parsePath('child');
      // 'child' = 2

      expect(child.absoluteWeight).toBe(6);
    });

    it('absoluteSegmentCountが親と合計される', () => {
      const parent = new RouteCore();
      parent.parsePath('/parent');

      const child = new RouteCore();
      child.parentCore = parent;
      child.parsePath('child');

      expect(child.absoluteSegmentCount).toBe(3);
    });

    it('相対パスで親がない場合はエラー', () => {
      const core = new RouteCore();
      core.parsePath('relative');
      expect(() => core.absolutePath).toThrow('is relative but has no parent route');
    });

    it('絶対パスで親がある場合はエラー', () => {
      const parent = new RouteCore();
      parent.parsePath('/parent');

      const child = new RouteCore();
      child.parentCore = parent;
      child.parsePath('/absolute');
      expect(() => child.absolutePath).toThrow('is absolute but has a parent route');
    });

    it('fallbackルートはparent検証をスキップ', () => {
      const core = new RouteCore();
      core.parsePath('', { isFallback: true });
      expect(() => core.absolutePath).not.toThrow();
    });
  });

  describe('setParams / clearParams', () => {
    it('setParamsでパラメータが設定される', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');
      core.setParams({ id: '123' }, { id: 123 });

      expect(core.params).toEqual({ id: '123' });
      expect(core.typedParams).toEqual({ id: 123 });
      expect(core.active).toBe(true);
    });

    it('clearParamsでパラメータがクリアされる', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');
      core.setParams({ id: '123' }, { id: 123 });
      core.clearParams();

      expect(core.params).toEqual({});
      expect(core.typedParams).toEqual({});
      expect(core.active).toBe(false);
    });

    it('setParams時にイベントが自身にディスパッチされる', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');

      const events: any[] = [];
      core.addEventListener('wcs-route:params-changed', (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      core.setParams({ id: '123' }, { id: 123 });

      expect(events).toHaveLength(1);
      expect(events[0].params).toEqual({ id: '123' });
      expect(events[0].typedParams).toEqual({ id: 123 });
    });

    it('target指定時はイベントがtargetにディスパッチされる', () => {
      const target = new EventTarget();
      const core = new RouteCore(target);
      core.parsePath('/users/:id');

      const coreEvents: any[] = [];
      const targetEvents: any[] = [];
      core.addEventListener('wcs-route:params-changed', () => coreEvents.push(true));
      target.addEventListener('wcs-route:params-changed', () => targetEvents.push(true));

      core.setParams({ id: '123' }, { id: 123 });

      expect(coreEvents).toEqual([]);
      expect(targetEvents).toEqual([true]);
    });

    it('setParamsでactiveがfalse→trueになる時にactive-changedイベントが発火する', () => {
      const target = new EventTarget();
      const core = new RouteCore(target);
      core.parsePath('/users/:id');

      const events: boolean[] = [];
      target.addEventListener('wcs-route:active-changed', (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      core.setParams({ id: '1' }, { id: 1 });
      // 同じactive状態のままsetParamsしても発火しない
      core.setParams({ id: '2' }, { id: 2 });

      expect(events).toEqual([true]);
    });

    it('clearParamsでactiveがtrue→falseになる時にactive-changedイベントが発火する', () => {
      const target = new EventTarget();
      const core = new RouteCore(target);
      core.parsePath('/users/:id');

      const events: boolean[] = [];
      target.addEventListener('wcs-route:active-changed', (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      core.setParams({ id: '1' }, { id: 1 });
      core.clearParams();
      // 既にinactive状態でclearParamsしても発火しない
      core.clearParams();

      expect(events).toEqual([true, false]);
    });
  });

  describe('shouldChange', () => {
    it('パラメータが異なる場合trueを返す', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');
      core.setParams({ id: '123' }, { id: 123 });

      expect(core.shouldChange({ id: '456' })).toBe(true);
    });

    it('パラメータが同じ場合falseを返す', () => {
      const core = new RouteCore();
      core.parsePath('/users/:id');
      core.setParams({ id: '123' }, { id: 123 });

      expect(core.shouldChange({ id: '123' })).toBe(false);
    });
  });

  describe('guardCheck', () => {
    it('guardがない場合は何もしない', async () => {
      const core = new RouteCore();
      core.parsePath('/test');
      await expect(core.guardCheck({ path: '/test', routes: [], params: {}, typedParams: {}, lastPath: '' })).resolves.toBeNull();
    });

    it('guardHandlerがtrueを返す場合は通過（データ無し = null）', async () => {
      const core = new RouteCore();
      core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
      core.guardHandler = vi.fn().mockResolvedValue(true);

      await expect(core.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' })).resolves.toBeNull();
    });

    it('guardHandler が空でない文字列を返す場合は、そのパスを fallbackPath とする GuardCancel をスローすること（動的リダイレクト）', async () => {
      const core = new RouteCore();
      core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
      core.guardHandler = vi.fn().mockResolvedValue('/login?next=%2Fprotected');

      await expect(core.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' }))
        .rejects.toMatchObject({ fallbackPath: '/login?next=%2Fprotected' });
    });

    it('guardHandler が空文字を返す場合は guard 属性のパスへ（falsy 規範）', async () => {
      const core = new RouteCore();
      core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
      core.guardHandler = vi.fn().mockResolvedValue('');

      await expect(core.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' }))
        .rejects.toMatchObject({ fallbackPath: '/login' });
    });

    it('guardHandler が undefined / null を返す場合も guard 属性のパスへ（従来どおり falsy は拒否）', async () => {
      for (const value of [undefined, null]) {
        const core = new RouteCore();
        core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
        core.guardHandler = vi.fn().mockResolvedValue(value);

        await expect(core.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' }))
          .rejects.toMatchObject({ fallbackPath: '/login' });
      }
    });

    it('guardHandler がオブジェクトを返す場合は許可し、そのオブジェクトをロード済みデータとして返すこと', async () => {
      const core = new RouteCore();
      core.parsePath('/users/:id', { hasGuard: true, guardFallback: '/login' });
      const user = { id: 5, name: 'Ada' };
      core.guardHandler = vi.fn().mockResolvedValue({ user });

      const data = await core.guardCheck({ path: '/users/5', routes: [], params: { id: '5' }, typedParams: { id: 5 }, lastPath: '/' });
      expect(data).toEqual({ user });
      expect((data as any).user).toBe(user);
    });

    it('guardHandler の第 3 引数に params / typedParams / searchParams / routeName の frozen スナップショットが渡ること', async () => {
      const core = new RouteCore();
      core.parsePath('/users/:id', { hasGuard: true, guardFallback: '/login' });
      const handler = vi.fn().mockResolvedValue(true);
      core.guardHandler = handler;
      const params = { id: '5' };
      const typedParams = { id: 5 };
      const routes = [{ name: 'user-detail' }] as any;

      await core.guardCheck({ path: '/users/5', routes, params, typedParams, lastPath: '/', search: '?tab=posts&tab=likes' });

      expect(handler).toHaveBeenCalledTimes(1);
      const [toPath, fromPath, context] = handler.mock.calls[0];
      expect(toPath).toBe('/users/5');
      expect(fromPath).toBe('/');
      expect(context.params).toEqual({ id: '5' });
      expect(context.typedParams).toEqual({ id: 5 });
      expect(context.searchParams).toEqual({ tab: 'likes' });
      expect(context.routeName).toBe('user-detail');
      // frozen スナップショット — 元の matchResult とは別オブジェクト
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.params)).toBe(true);
      expect(context.params).not.toBe(params);
      expect(() => { (context.params as any).id = '6'; }).toThrow();
    });

    it('第 3 引数は search 無し・無名ルートでも組み立てられること（searchParams = {} / routeName = ""）', async () => {
      const core = new RouteCore();
      core.parsePath('/about', { hasGuard: true, guardFallback: '/' });
      const handler = vi.fn().mockResolvedValue(true);
      core.guardHandler = handler;

      await core.guardCheck({ path: '/about', routes: [], params: {}, typedParams: {}, lastPath: '/' });

      const context = handler.mock.calls[0][2];
      expect(context.searchParams).toEqual({});
      expect(context.routeName).toBe('');
    });

    it('guardHandlerがfalseを返す場合はGuardCancelをスロー', async () => {
      const core = new RouteCore();
      core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
      core.guardHandler = vi.fn().mockResolvedValue(false);

      await expect(core.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' })).rejects.toThrow('Navigation cancelled by guard.');
    });

    it('notifyGuardHandlerLoadFailedが呼ばれた後にguardCheckはGuardCancelをスローすること', async () => {
      const core = new RouteCore();
      core.parsePath('/protected', { hasGuard: true, guardFallback: '/login' });
      core.notifyGuardHandlerLoadFailed();

      await expect(
        core.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' })
      ).rejects.toThrow('Navigation cancelled: guard handler failed to load.');
    });
  });

  describe('segmentCount', () => {
    it('indexパスのsegmentCountは0', () => {
      const core = new RouteCore();
      core.parsePath('', { isIndex: true });
      expect(core.segmentCount).toBe(0);
    });

    it('通常パスのsegmentCountはcatch-allを除いたセグメント数', () => {
      const core = new RouteCore();
      core.parsePath('/files/*');
      expect(core.segmentCount).toBe(2); // '' + 'files', * is not counted
    });
  });

  describe('isRelative', () => {
    it('/で始まるパスはfalse', () => {
      const core = new RouteCore();
      core.parsePath('/absolute');
      expect(core.isRelative).toBe(false);
    });

    it('/で始まらないパスはtrue', () => {
      const core = new RouteCore();
      core.parsePath('relative');
      expect(core.isRelative).toBe(true);
    });
  });

});
