import { describe, it, expect } from 'vitest';
import { GuardCancel } from '../src/GuardCancel';

describe('GuardCancel', () => {
  it('GuardCancelクラスが存在すること', () => {
    expect(GuardCancel).toBeDefined();
    expect(typeof GuardCancel).toBe('function');
  });

  it('Errorクラスを継承していること', () => {
    const guardCancel = new GuardCancel('Access denied', '/login');
    expect(guardCancel).toBeInstanceOf(Error);
    expect(guardCancel).toBeInstanceOf(GuardCancel);
  });

  it('メッセージとfallbackPathを持つインスタンスを作成できること', () => {
    const message = 'Access denied';
    const fallbackPath = '/login';
    const guardCancel = new GuardCancel(message, fallbackPath);
    
    expect(guardCancel.message).toBe(message);
    expect(guardCancel.fallbackPath).toBe(fallbackPath);
  });

  it('異なるfallbackPathを設定できること', () => {
    const guardCancel1 = new GuardCancel('Not authenticated', '/login');
    const guardCancel2 = new GuardCancel('Not authorized', '/forbidden');
    const guardCancel3 = new GuardCancel('Session expired', '/');
    
    expect(guardCancel1.fallbackPath).toBe('/login');
    expect(guardCancel2.fallbackPath).toBe('/forbidden');
    expect(guardCancel3.fallbackPath).toBe('/');
  });

  it('エラーとしてthrowできること', () => {
    expect(() => {
      throw new GuardCancel('Unauthorized', '/login');
    }).toThrow(GuardCancel);
  });

  it('throwしたGuardCancelをcatchで受け取れること', () => {
    try {
      throw new GuardCancel('Access denied', '/login');
    } catch (error) {
      expect(error).toBeInstanceOf(GuardCancel);
      expect((error as GuardCancel).message).toBe('Access denied');
      expect((error as GuardCancel).fallbackPath).toBe('/login');
    }
  });
});
