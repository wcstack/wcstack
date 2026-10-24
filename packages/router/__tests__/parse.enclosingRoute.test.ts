/**
 * ルートの親と `<wcs-guard-handler>` の付き先は、囲むルートで決まる（docs/mistake-catalogue.md）。
 * 以前は「それまでに解析したルートの一覧の最後」で決めていたため、前の兄弟（とその子孫）が親に化けた:
 * 要素や `<wcs-layout>` の中のルートが前のルートの下のパスになるか、絶対パスなら throw し、入れ子の
 * ルートの後に置いたガードは外側でなく子のルートを守った。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '../src/parse';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import './setup';

const GUARD = '<wcs-guard-handler><script type="module">export default () => true;</script></wcs-guard-handler>';

async function parseMarkup(markup: string): Promise<{ paths: string[]; guarded: string[]; errors: string[] }> {
  const router = document.createElement('wcs-router') as Router;
  document.body.appendChild(router);
  const template = document.createElement('template');
  template.innerHTML = markup;
  (router as any)._template = template;
  const paths: string[] = [];
  const guarded: string[] = [];
  const initialize = Route.prototype.initialize;
  vi.spyOn(Route.prototype, 'initialize').mockImplementation(function (this: Route, ...args: Parameters<Route['initialize']>) {
    initialize.apply(this, args);
    paths.push(this.absolutePath);
  });
  vi.spyOn(Route.prototype, 'enableGuard').mockImplementation(function (this: Route) {
    guarded.push(this.absolutePath);
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await parse(router);
  return { paths, guarded, errors: error.mock.calls.map((c) => String(c[0])) };
}

describe('parse — 囲むルート', () => {
  beforeEach(() => {
    document.body.innerHTML = '<template id="main"><slot></slot></template>';
    vi.restoreAllMocks();
  });

  it('要素の中のルートは、前の兄弟のルートではなく囲むルートの下に入ること', async () => {
    const { paths } = await parseMarkup(
      '<wcs-route path="/p"><wcs-route path="a"></wcs-route><div><wcs-route path="b"></wcs-route></div></wcs-route>',
    );
    expect(paths).toEqual(['/p', '/p/a', '/p/b']);
  });

  it('前のルートの後の <wcs-layout> の中の絶対パスのルートは、親を持たずに解析されること（以前は throw した）', async () => {
    const { paths } = await parseMarkup(
      '<wcs-route path="/admin"><wcs-route path="users"></wcs-route></wcs-route>' +
      '<wcs-layout layout="main"><wcs-route path="/about"></wcs-route></wcs-layout>',
    );
    expect(paths).toEqual(['/admin', '/admin/users', '/about']);
  });

  it('ルートの中のレイアウトの子のルートは、前の兄弟ではなく囲むルートの下に入ること', async () => {
    const { paths } = await parseMarkup(
      '<wcs-route path="/admin"><wcs-route path="users"></wcs-route>' +
      '<wcs-layout layout="main"><wcs-route path="settings"></wcs-route></wcs-layout></wcs-route>',
    );
    expect(paths).toEqual(['/admin', '/admin/users', '/admin/settings']);
  });

  it('入れ子のルートの後に置いたガードも、囲むルートを守ること', async () => {
    const { guarded, errors } = await parseMarkup(
      '<wcs-route path="/parent"><wcs-route path="child"></wcs-route>' + GUARD + '</wcs-route>',
    );
    expect(guarded).toEqual(['/parent']);
    expect(errors).toEqual([]);
  });

  it('ルートの中の要素に置いたガードも、囲むルートを守ること', async () => {
    const { guarded, errors } = await parseMarkup(
      '<wcs-route path="/parent"><wcs-route path="child"></wcs-route><section>' + GUARD + '</section></wcs-route>',
    );
    expect(guarded).toEqual(['/parent']);
    expect(errors).toEqual([]);
  });

  it('ルートの外で前のルートの後に置いたガードは、そのルートを守り続け、中へ移すよう console.error で知らせること', async () => {
    const { guarded, errors } = await parseMarkup('<wcs-route path="/a"></wcs-route>' + GUARD + '<wcs-route path="/b"></wcs-route>');
    expect(guarded).toEqual(['/a']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('[wcs/guard-handler-ignored]');
    expect(errors[0]).toContain('guards the route before it, "/a"');
  });

  it('前にルートの無いルートの外のガードは、何も守らないと console.error で知らせること', async () => {
    const { guarded, errors } = await parseMarkup(GUARD + '<wcs-route path="/a"></wcs-route>');
    expect(guarded).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('guards nothing');
  });

  it('module のスクリプトの無いガードは、ルートを閉じる側に倒し（guard を有効にしてリダイレクト）、その先を console.error で知らせること', async () => {
    const failed = vi.spyOn(Route.prototype, 'notifyGuardHandlerLoadFailed');
    const { guarded, errors } = await parseMarkup(
      '<wcs-route path="/a"><wcs-guard-handler><script>export default () => true;</script></wcs-guard-handler></wcs-route>',
    );
    expect(guarded).toEqual(['/a']);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('route "/a" has no <script type="module">');
    expect(errors[0]).toContain('redirected to "/"');
  });

  it('module のスクリプトの無いガードの知らせは、guard 属性のリダイレクト先を名指すこと', async () => {
    const { errors } = await parseMarkup('<wcs-route path="/a" guard="/login"><wcs-guard-handler></wcs-guard-handler></wcs-route>');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('redirected to "/login"');
  });
});
