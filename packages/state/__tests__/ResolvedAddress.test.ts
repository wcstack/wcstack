import { describe, it, expect } from 'vitest';
import { getResolvedAddress } from '../src/address/ResolvedAddress';

describe('ResolvedAddress', () => {
  it('同じパスはキャッシュで同一インスタンスを返すこと', () => {
    const a = getResolvedAddress('users.name');
    const b = getResolvedAddress('users.name');
    expect(a).toBe(b);
  });

  it('ワイルドカードなしのパスを解析できること', () => {
    const resolved = getResolvedAddress('count');
    expect(resolved.path).toBe('count');
    expect(resolved.segments).toEqual(['count']);
    expect(resolved.wildcardType).toBe('none');
    expect(resolved.wildcardIndexes).toEqual([]);
    expect(resolved.pathInfo.path).toBe('count');
  });

  it('未解決ワイルドカードはcontextになること', () => {
    const resolved = getResolvedAddress('users.*.name');
    expect(resolved.path).toBe('users.*.name');
    expect(resolved.segments).toEqual(['users', '*', 'name']);
    expect(resolved.wildcardType).toBe('context');
    expect(resolved.wildcardIndexes).toEqual([null]);
    expect(resolved.pathInfo.path).toBe('users.*.name');
  });

  it('数値インデックスのみはallになること', () => {
    const resolved = getResolvedAddress('users.0.name');
    expect(resolved.path).toBe('users.0.name');
    expect(resolved.segments).toEqual(['users', '0', 'name']);
    expect(resolved.wildcardType).toBe('all');
    expect(resolved.wildcardIndexes).toEqual([0]);
    expect(resolved.pathInfo.path).toBe('users.*.name');
  });

  it('ワイルドカード混在はpartialになること', () => {
    const resolved = getResolvedAddress('users.*.posts.0');
    expect(resolved.path).toBe('users.*.posts.0');
    expect(resolved.segments).toEqual(['users', '*', 'posts', '0']);
    expect(resolved.wildcardType).toBe('partial');
    expect(resolved.wildcardIndexes).toEqual([null, 0]);
    expect(resolved.pathInfo.path).toBe('users.*.posts.*');
  });

  it('予約語のようなパスでも解析できること', () => {
    const resolved = getResolvedAddress('constructor');
    expect(resolved.path).toBe('constructor');
    expect(resolved.wildcardType).toBe('none');
  });
});
