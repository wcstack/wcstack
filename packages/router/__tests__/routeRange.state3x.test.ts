import { describe, it, expect, beforeAll } from 'vitest';
import './setup';
// @ts-ignore - the committed 3.x bundle (packages/state/dist)
import { bootstrapState } from '../../state/dist/index.esm.js';
import { enterByNavigation, enterLayoutByNavigation, landingThenLeave, settle } from './routeRange.state.shared';

beforeAll(() => bootstrapState());

describe('ルートの範囲と @wcstack/state 3.x（packages/state/dist）', () => {
  it('着地のルートで state が描いた行・枝は、退出すると残らず、戻ると重ならずに戻る（壊れない）', async () => {
    const errors = await landingThenLeave(async (el, items, on) => {
      el.createState('writable', (s: any) => { s.items = items; s.on = on; });
      await settle();
    });
    expect(errors).toEqual([]);
  });

  it('範囲を持ち運ぶ宣言（binder の第 2 引数）は 3.x では無視され、遷移で入ったルートの直下のテンプレートは従来どおり描かれない（ほかの内容と遷移は壊れない）', async () => {
    const { seen, errors } = await enterByNavigation('/q', ['/p/a', '/p/b', '/q', '/p/a'], { items: ['x', 'y'], on: true });
    expect(seen).toEqual(['Q', 'P,A', 'P,B', 'Q', 'P,A']);
    expect(errors.every((e) => e.includes('failed to apply'))).toBe(true);
  });
});

describe('レイアウトの中のルートに遷移で入る（3.x）', () => {
  it('初めての入場で、ルートの内容とレイアウトのテンプレート自身の束縛を束ね、往復で重ならない', async () => {
    const { seen, errors } = await enterLayoutByNavigation(false);
    expect(seen).toEqual([
      'x=[hi] y=[hi] li=[a/b] m=[] lt=[hi]',
      'x=[] y=[] li=[] m=[hi] lt=[]',
      'x=[] y=[] li=[] m=[] lt=[]',
      'x=[hi] y=[hi] li=[a/b] m=[] lt=[hi]',
    ]);
    expect(errors).toEqual([]);
  });
});
