import { describe, it, expect } from 'vitest';
import { builtinParamTypes } from '../src/builtinParamTypes';

describe('builtinParamTypes', () => {
  it('全てのタイプが定義されていること', () => {
    expect(builtinParamTypes.int).toBeDefined();
    expect(builtinParamTypes.float).toBeDefined();
    expect(builtinParamTypes.bool).toBeDefined();
    expect(builtinParamTypes.uuid).toBeDefined();
    expect(builtinParamTypes.slug).toBeDefined();
    expect(builtinParamTypes.isoDate).toBeDefined();
    expect(builtinParamTypes.any).toBeDefined();
  });

  describe('int', () => {
    const type = builtinParamTypes.int;

    it('typeNameがintであること', () => {
      expect(type.typeName).toBe('int');
    });

    it('整数をパースできること', () => {
      expect(type.parse('123')).toBe(123);
      expect(type.parse('0')).toBe(0);
      expect(type.parse('-456')).toBe(-456);
    });

    it('小数を含む場合はundefinedを返すこと', () => {
      expect(type.parse('123.45')).toBeUndefined();
    });

    it('数字以外を含む場合はundefinedを返すこと', () => {
      expect(type.parse('123a')).toBeUndefined();
      expect(type.parse('abc')).toBeUndefined();
    });
  });

  describe('float', () => {
    const type = builtinParamTypes.float;

    it('typeNameがfloatであること', () => {
      expect(type.typeName).toBe('float');
    });

    it('整数をパースできること', () => {
      expect(type.parse('123')).toBe(123);
      expect(type.parse('-456')).toBe(-456);
    });

    it('小数をパースできること', () => {
      expect(type.parse('123.45')).toBe(123.45);
      expect(type.parse('-123.45')).toBe(-123.45);
      expect(type.parse('0.1')).toBe(0.1);
    });

    it('数字以外を含む場合はundefinedを返すこと', () => {
      expect(type.parse('123.45a')).toBeUndefined();
      expect(type.parse('abc')).toBeUndefined();
    });
  });

  describe('bool', () => {
    const type = builtinParamTypes.bool;

    it('typeNameがboolであること', () => {
      expect(type.typeName).toBe('bool');
    });

    it('true/falseをパースできること', () => {
      expect(type.parse('true')).toBe(true);
      expect(type.parse('false')).toBe(false);
    });

    it('1/0をパースできること', () => {
      expect(type.parse('1')).toBe(true);
      expect(type.parse('0')).toBe(false);
    });

    it('それ以外はundefinedを返すこと', () => {
      expect(type.parse('yes')).toBeUndefined();
      expect(type.parse('no')).toBeUndefined();
      expect(type.parse('True')).toBeUndefined(); // ケースセンシティブ
    });
  });

  describe('uuid', () => {
    const type = builtinParamTypes.uuid;

    it('typeNameがuuidであること', () => {
      expect(type.typeName).toBe('uuid');
    });

    it('UUIDをパースできること', () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      expect(type.parse(validUUID)).toBe(validUUID);
    });

    it('大文字のUUIDもパースできること', () => {
      const validUUID = '123E4567-E89B-12D3-A456-426614174000';
      expect(type.parse(validUUID)).toBe(validUUID);
    });

    it('無効な形式はundefinedを返すこと', () => {
      expect(type.parse('123e4567-e89b-12d3-a456-42661417400')).toBeUndefined(); // 短い
      expect(type.parse('123e4567-e89b-12d3-a456-42661417400z')).toBeUndefined(); // 不正文字
      expect(type.parse('invalid-uuid')).toBeUndefined();
    });
  });

  describe('slug', () => {
    const type = builtinParamTypes.slug;

    it('typeNameがslugであること', () => {
      expect(type.typeName).toBe('slug');
    });

    it('英数字とハイフンをパースできること', () => {
      expect(type.parse('hello-world-123')).toBe('hello-world-123');
      expect(type.parse('hello')).toBe('hello');
    });

    it('連続するハイフンはパースしないこと (現状の実装による)', () => {
      // 正規表現 /^[a-z0-9]+(?:-[a-z0-9]+)*$/ は連続ハイフンを許可しない
      expect(type.parse('hello--world')).toBeUndefined();
    });

    it('先頭・末尾のハイフンはパースしないこと', () => {
      expect(type.parse('-hello')).toBeUndefined();
      expect(type.parse('hello-')).toBeUndefined();
    });

    it('大文字を含む場合はundefinedを返すこと', () => {
      expect(type.parse('Hello-World')).toBeUndefined();
    });

    it('記号を含む場合はundefinedを返すこと', () => {
      expect(type.parse('hello_world')).toBeUndefined();
    });
  });

  describe('isoDate', () => {
    const type = builtinParamTypes.isoDate;

    it('typeNameがisoDateであること', () => {
      expect(type.typeName).toBe('isoDate');
    });

    it('有効な日付をパースできること', () => {
      const result = type.parse('2024-01-23');
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).getFullYear()).toBe(2024);
      expect((result as Date).getMonth()).toBe(0); // 0-indexed
      expect((result as Date).getDate()).toBe(23);
    });

    it('無効な月はundefinedを返すこと', () => {
      expect(type.parse('2024-13-01')).toBeUndefined(); // 13月
    });

    it('無効な日はundefinedを返すこと', () => {
      expect(type.parse('2024-02-30')).toBeUndefined(); // うるう年でも2月30日はない
      expect(type.parse('2024-02-31')).toBeUndefined();
    });

    it('うるう年の2/29は有効であること', () => {
      const result = type.parse('2024-02-29'); // 2024はうるう年
      expect(result).toBeDefined();
    });

    it('平年の2/29はundefinedを返すこと', () => {
      expect(type.parse('2023-02-29')).toBeUndefined(); // 2023は平年
    });

    it('フォーマット違反はundefinedを返すこと', () => {
      expect(type.parse('2024/01/23')).toBeUndefined();
      expect(type.parse('24-01-23')).toBeUndefined();
    });
  });

  describe('any', () => {
    const type = builtinParamTypes.any;

    it('typeNameがanyであること', () => {
      expect(type.typeName).toBe('any');
    });

    it('任意の文字列をパースできること', () => {
      expect(type.parse('hello')).toBe('hello');
      expect(type.parse('123')).toBe('123');
      expect(type.parse('hello/world')).toBe('hello/world');
    });

    it('空文字はundefinedを返すこと（現在の正規表現 /^.+$/ に基づく）', () => {
      expect(type.parse('')).toBeUndefined();
    });
  });
});
