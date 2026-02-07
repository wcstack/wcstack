import { describe, it, expect } from 'vitest';
import { calcWildcardLen } from '../src/address/calcWildcardLen';
import { getPathInfo } from '../src/address/PathInfo';

describe('calcWildcardLen', () => {
  it('pathInfoにワイルドカードがない場合は0を返すこと', () => {
    const pathInfo = getPathInfo('count');
    const targetPathInfo = getPathInfo('items.*.name');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(0);
  });

  it('targetPathInfoにワイルドカードがない場合は0を返すこと', () => {
    const pathInfo = getPathInfo('items.*');
    const targetPathInfo = getPathInfo('count');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(0);
  });

  it('両方にワイルドカードがない場合は0を返すこと', () => {
    const pathInfo = getPathInfo('count');
    const targetPathInfo = getPathInfo('total');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(0);
  });

  it('単一ワイルドカードがtargetに含まれる場合は1を返すこと', () => {
    const pathInfo = getPathInfo('items.*');
    const targetPathInfo = getPathInfo('items.*.name');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(1);
  });

  it('単一ワイルドカードがtargetに含まれない場合はintersectionで計算すること', () => {
    const pathInfo = getPathInfo('users.*');
    const targetPathInfo = getPathInfo('items.*.name');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(0);
  });

  it('共通ワイルドカードが複数ある場合はその数を返すこと', () => {
    const pathInfo = getPathInfo('users.*.orders.*');
    const targetPathInfo = getPathInfo('users.*.orders.*.total');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(2);
  });

  it('pathInfo.id < targetPathInfo.idの順序で処理されること', () => {
    // getPathInfoはidを昇順で採番するため、先に作成した方がidが小さい
    const pathInfo = getPathInfo('a.*.b.*');
    const targetPathInfo = getPathInfo('a.*.b.*.c');
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(2);
  });

  it('pathInfo.id >= targetPathInfo.idの順序で処理されること', () => {
    // targetPathInfoを先に作成してidを小さくする
    const targetPathInfo = getPathInfo('x.*.y.*.z');
    const pathInfo = getPathInfo('x.*.y.*.w');
    expect(pathInfo.id).toBeGreaterThan(targetPathInfo.id);
    expect(calcWildcardLen(pathInfo, targetPathInfo)).toBe(2);
  });

  it('同じ引数で2回呼ぶとキャッシュから返されること', () => {
    const pathInfo = getPathInfo('c1.*.c2.*');
    const targetPathInfo = getPathInfo('c1.*.c2.*.c3');
    const first = calcWildcardLen(pathInfo, targetPathInfo);
    const second = calcWildcardLen(pathInfo, targetPathInfo);
    expect(first).toBe(2);
    expect(second).toBe(2);
  });

  it('キャッシュ済みのpath1に対して別のpath2で呼ぶとintersectionが再計算されること', () => {
    const pathInfo = getPathInfo('d1.*.d2.*');
    const target1 = getPathInfo('d1.*.d2.*.d3');
    const target2 = getPathInfo('d1.*.d4.*.d5');
    expect(calcWildcardLen(pathInfo, target1)).toBe(2);
    expect(calcWildcardLen(pathInfo, target2)).toBe(1);
  });
});
