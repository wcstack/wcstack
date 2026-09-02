import { describe, it, expect } from 'vitest';
import {
  markWebComponentStatePropDeclared,
  isWebComponentStatePropDeclared,
  isWebComponentComplete,
} from '../src/webComponent/completeWebComponent';

describe('completeWebComponent: 宣言台帳（丸ごとマウントの完了前ガード）', () => {
  it('初期状態では未宣言であること', () => {
    const component = document.createElement('div');
    expect(isWebComponentStatePropDeclared(component, 'state')).toBe(false);
  });

  it('宣言後は真になり、完了台帳とは独立であること', () => {
    const component = document.createElement('div');
    markWebComponentStatePropDeclared(component, 'state');
    expect(isWebComponentStatePropDeclared(component, 'state')).toBe(true);
    expect(isWebComponentComplete(component, 'state')).toBe(false);
  });

  it('stateProp ごと・要素ごとに独立であること', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    markWebComponentStatePropDeclared(a, 'state');
    markWebComponentStatePropDeclared(a, 'other');
    expect(isWebComponentStatePropDeclared(a, 'other')).toBe(true);
    expect(isWebComponentStatePropDeclared(b, 'state')).toBe(false);
  });

  it('二度宣言しても冪等であること', () => {
    const component = document.createElement('div');
    markWebComponentStatePropDeclared(component, 'state');
    markWebComponentStatePropDeclared(component, 'state');
    expect(isWebComponentStatePropDeclared(component, 'state')).toBe(true);
  });
});
