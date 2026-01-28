import { describe, it, expect } from 'vitest';
import { parsePropPart } from '../src/bindTextParser/parsePropPart';

describe('parsePropPart', () => {
  it('単一プロパティをパースできること', () => {
    const result = parsePropPart('value');
    expect(result.propName).toBe('value');
    expect(result.propSegments).toEqual(['value']);
    expect(result.propModifiers).toEqual([]);
  });

  it('修飾子をパースできること', () => {
    const result = parsePropPart('value#ro,oninput');
    expect(result.propName).toBe('value');
    expect(result.propSegments).toEqual(['value']);
    expect(result.propModifiers).toEqual(['ro', 'oninput']);
  });

  it('ドット区切りのプロパティをパースできること', () => {
    const result = parsePropPart('style.color');
    expect(result.propName).toBe('style.color');
    expect(result.propSegments).toEqual(['style', 'color']);
  });

  it('トリムが効くこと', () => {
    const result = parsePropPart('  class.active  #  ro , wo  ');
    expect(result.propName).toBe('class.active');
    expect(result.propSegments).toEqual(['class', 'active']);
    expect(result.propModifiers).toEqual(['ro', 'wo']);
  });
});
