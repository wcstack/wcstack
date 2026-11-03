import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Router } from '../src/components/Router';
import type { IRoute } from '../src/components/types';
import { TRANSITION_RUNNER_KEY } from '../src/protocol/transitionRunner';
import './setup';

/**
 * ナビゲーションの重なりの有界全列挙（docs/formal-methods-study.md §3・§5-1）。
 *
 * 本物の <wcs-router> / <wcs-route> / <wcs-outlet> に、ナビゲーション（リンク・戻る / 進む・クエリだけ）、
 * ガードの決着、view transition のフレームの全順序を深さ DEPTH まで当て、法則を確かめる。偽物にするのは
 * プラットフォームだけ — 裁定者（transition-runner、渡された変更を順にフレームで当てる）とガードの Promise。
 * 法則が要る「利用者が向かった URL」は横のゴーストが持つ。列を長さの順に作るので、法則ごとに最短の反例が残る。
 *
 * happy-dom に Navigation API は無いので、ルーターは popstate の経路を通る: リンクは navigate()（URL を
 * 積んでから当てる）、戻る / 進むは URL を差し替えてから popstate。
 *
 * CI の深さは 4（2,516 列、約 1.5 秒）。4.11.0 のルーターはここで 4.11.2 の 2 件を落とす —
 * `link(/b), link(/a)` で URL /a に画面 b、`link(/g), link(/g), refuse(oldest)` で追い越されたガードの拒否が
 * "/" へ送る。手元で深くするには `NAV_DEPTH=6 npx vitest run __tests__/navigation.exhaustive.test.ts`
 * （160,363 列、約 6 分）。
 */

const DEPTH = Number(process.env.NAV_DEPTH ?? 4);

// "/g" だけがガード付き。拒むと "/" へ送る
const PAGES: Record<string, string> = { '/': 'home', '/a': 'a', '/b': 'b', '/g': 'g' };
const MARKUP = `
  <wcs-router>
    <template>
      <wcs-route path="/"><p data-page="home">home</p></wcs-route>
      <wcs-route path="/a"><p data-page="a">a</p></wcs-route>
      <wcs-route path="/b"><p data-page="b">b</p></wcs-route>
      <wcs-route path="/g"><p data-page="g">g</p></wcs-route>
    </template>
  </wcs-router>
  <wcs-outlet></wcs-outlet>`;

type Action =
  | { readonly kind: 'link'; readonly to: string }
  | { readonly kind: 'traverse'; readonly to: string }
  | { readonly kind: 'query' }
  | { readonly kind: 'frame' }
  | { readonly kind: 'allow' | 'refuse'; readonly which: 'oldest' | 'newest' };

const show = (action: Action): string => {
  switch (action.kind) {
    case 'link': return `link(${action.to})`;
    case 'traverse': return `traverse(${action.to})`;
    case 'allow': case 'refuse': return `${action.kind}(${action.which})`;
    default: return action.kind;
  }
};

interface Guard {
  /** ガードが呼ばれたときの、ゴーストのナビゲーションの番号 */
  readonly navigation: number;
  readonly settle: (result: true | string) => void;
}

interface World {
  readonly router: Router;
  /** 裁定者が預かった変更（渡された順にフレームで当てる） */
  readonly frames: Array<() => void>;
  readonly guards: Guard[];
  /** 利用者が向かった URL（ゴースト） */
  intended: string;
  /** 利用者が始めたナビゲーションの数（ガードのリダイレクトも 1 つ） */
  navigations: number;
  queries: number;
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const shownPages = (): string[] =>
  [...document.querySelectorAll('[data-page]')].map((node) => node.getAttribute('data-page')!);
const currentUrl = (): string => location.pathname + location.search;

async function mount(): Promise<World> {
  // (binder の居ないこのページで差し込んだルートの中身は保留キューに積まれるが、キューは文書の中にあるものしか
  // 持たない — 前の列のルーターの DOM は次に積むときに落ちる。docs/formal-methods-study.md §8 の ⑥)
  document.body.innerHTML = '';
  history.replaceState(null, '', '/a');
  const frames: Array<() => void> = [];
  (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = {
    protocol: 'wcs-transition-runner',
    version: 1,
    naming: 'manual',
    namingLimit: 200,
    accepts: () => true,
    run: (mutate: () => void) => new Promise<void>((resolve, reject) => {
      frames.push(() => {
        try {
          mutate();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }),
  };
  document.body.innerHTML = MARKUP;
  const router = document.querySelector('wcs-router') as Router;
  await router.connectedCallbackPromise;
  const next: World = { router, frames, guards: [], intended: '/a', navigations: 0, queries: 0 };
  const guarded = router.routeChildNodes.find((route: IRoute) => (route as unknown as Element).getAttribute('path') === '/g')!;
  guarded.guardHandler = () => new Promise<true | string>((resolve) => {
    next.guards.push({ navigation: next.navigations, settle: resolve });
  });
  await settle();
  return next;
}

/** 今の状態で打てる手 */
function enabled(w: World): Action[] {
  const actions: Action[] = [
    { kind: 'link', to: '/a' }, { kind: 'link', to: '/b' }, { kind: 'link', to: '/g' },
    { kind: 'traverse', to: '/a' }, { kind: 'traverse', to: '/b' },
    { kind: 'query' },
  ];
  if (w.frames.length > 0) actions.push({ kind: 'frame' });
  if (w.guards.length > 0) actions.push({ kind: 'allow', which: 'oldest' }, { kind: 'refuse', which: 'oldest' });
  if (w.guards.length > 1) actions.push({ kind: 'allow', which: 'newest' }, { kind: 'refuse', which: 'newest' });
  return actions;
}

async function apply(w: World, action: Action): Promise<void> {
  switch (action.kind) {
    case 'link':
      w.navigations += 1;
      w.intended = action.to;
      void w.router.navigate(action.to);
      break;
    case 'traverse':
      w.navigations += 1;
      w.intended = action.to;
      history.replaceState(null, '', action.to);
      window.dispatchEvent(new PopStateEvent('popstate'));
      break;
    case 'query': {
      w.navigations += 1;
      w.queries += 1;
      w.intended = `${location.pathname}?q=${w.queries}`;
      void w.router.navigate(`?q=${w.queries}`);
      break;
    }
    case 'frame':
      w.frames.shift()!();
      break;
    default: {
      const guard = action.which === 'oldest' ? w.guards.shift()! : w.guards.pop()!;
      if (action.kind === 'allow') {
        guard.settle(true);
      } else {
        // 拒否はまだ向かっている先のナビゲーションのときだけ "/" へ送る
        if (guard.navigation === w.navigations) {
          w.navigations += 1;
          w.intended = '/';
        }
        guard.settle('/');
      }
    }
  }
  await settle();
}

/** ガードを古い順に通し、フレームを当て、何も待たなくなるまで進める */
async function drain(w: World): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (w.guards.length > 0) w.guards.shift()!.settle(true);
    else if (w.frames.length > 0) w.frames.shift()!();
    else return;
    await settle();
  }
  throw new Error('drain did not finish');
}

/** 列を当て、最初に破れた法則を `[法則, 反例]` で返す。破れなければ null。次の手の一覧も返す */
async function run(actions: readonly Action[]): Promise<{ violation: [string, string] | null; next: Action[] }> {
  const w = await mount();
  const witness = (law: string, detail: string, upTo = actions.length): [string, string] =>
    [law, `${law}: ${detail} — [${actions.slice(0, upTo).map(show).join(', ')}]`];
  for (const [step, action] of actions.entries()) {
    await apply(w, action);
    // どの時点でも、画面に出るページは高々 1 つ
    const shown = shownPages();
    if (shown.length > 1) return { violation: witness('OnePageAtATime', `画面に ${shown.join(' と ')}`, step + 1), next: [] };
  }
  const next = enabled(w);
  await drain(w);
  // 待つものが無くなったら: URL は利用者が向かった先、画面はその URL のページ、path はその URL
  if (currentUrl() !== w.intended) {
    return { violation: witness('UrlIsWhereTheReaderWent', `URL は ${currentUrl()}、向かった先は ${w.intended}`), next };
  }
  const expected = PAGES[location.pathname];
  const shown = shownPages();
  if (shown.length !== 1 || shown[0] !== expected) {
    return { violation: witness('ScreenIsTheUrl', `URL ${currentUrl()} で画面は [${shown.join(', ')}]`), next };
  }
  if (w.router.path !== location.pathname) {
    return { violation: witness('PathIsTheUrl', `URL ${currentUrl()} で path は ${w.router.path}`), next };
  }
  return { violation: null, next };
}

/** 深さ DEPTH までの全列（長さの順）を回し、法則ごとの最短の反例を返す */
async function shortestWitnesses(): Promise<{ witnesses: Map<string, string>; count: number }> {
  const witnesses = new Map<string, string>();
  let count = 0;
  let layer: Array<{ prefix: Action[]; next: Action[] }> = [{ prefix: [], next: enabled(await mount()) }];
  for (let depth = 1; depth <= DEPTH; depth++) {
    const nextLayer: typeof layer = [];
    for (const { prefix, next } of layer) {
      for (const action of next) {
        const actions = [...prefix, action];
        count += 1;
        const result = await run(actions);
        if (result.violation !== null) {
          const [law, text] = result.violation;
          if (!witnesses.has(law)) witnesses.set(law, text);
          continue; // 破れた列は延ばさない
        }
        nextLayer.push({ prefix: actions, next: result.next });
      }
    }
    layer = nextLayer;
  }
  return { witnesses, count };
}

describe('ルーター — ナビゲーションの重なりの有界全列挙', () => {
  // basename は <base> から読む（無ければ文書の URL — 最初のページが /a だと basename が /a になる）
  const base = document.createElement('base');
  beforeAll(() => {
    base.href = '/';
    document.head.appendChild(base);
    history.replaceState(null, '', '/a');
  });

  afterAll(() => {
    document.body.innerHTML = '';
    delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
    base.remove();
    history.replaceState(null, '', '/');
  });

  it(`${DEPTH} 手までのどの順序でも、待つものが無くなれば URL・画面・path がそろう`, async () => {
    const { witnesses, count } = await shortestWitnesses();
    expect(count).toBeGreaterThan(0);
    expect([...witnesses.values()]).toEqual([]);
  }, 600_000);
});
