/**
 * ssr-snapshot プロトコルの読み手（getSsrSnapshotBuilder）の形の検査。
 * 「読めない形は null」（無言で壊れた builder を呼ばない）を固定する。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getSsrSnapshotBuilder, SSR_SNAPSHOT_BUILDER_KEY } from '../src/protocol/ssrSnapshot';

const g = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete g[SSR_SNAPSHOT_BUILDER_KEY];
});

describe('getSsrSnapshotBuilder', () => {
  it('未設置なら null', () => {
    expect(getSsrSnapshotBuilder()).toBeNull();
  });

  it('protocol が違えば null', () => {
    g[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'other', version: 1, build() {} };
    expect(getSsrSnapshotBuilder()).toBeNull();
  });

  it('version が数値でない・1 未満なら null', () => {
    g[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'wcs-ssr-snapshot', version: '1', build() {} };
    expect(getSsrSnapshotBuilder()).toBeNull();
    g[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'wcs-ssr-snapshot', version: 0, build() {} };
    expect(getSsrSnapshotBuilder()).toBeNull();
  });

  it('build が関数でなければ null', () => {
    g[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'wcs-ssr-snapshot', version: 1, build: 'x' };
    expect(getSsrSnapshotBuilder()).toBeNull();
  });

  it('正しい形なら本体を返すこと', () => {
    const builder = { protocol: 'wcs-ssr-snapshot', version: 1, build() {} };
    g[SSR_SNAPSHOT_BUILDER_KEY] = builder;
    expect(getSsrSnapshotBuilder()).toBe(builder);
  });
});
