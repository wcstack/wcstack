import { describe, it, expect, beforeEach } from 'vitest';
import { getPathInfo } from '../src/address/PathInfo';
import { DELIMITER, WILDCARD } from '../src/define';

describe('PathInfo', () => {
  describe('getPathInfo', () => {
    it('関数が存在すること', () => {
      expect(getPathInfo).toBeDefined();
      expect(typeof getPathInfo).toBe('function');
    });

    it('キャッシュから同じインスタンスを返すこと', () => {
      const path = 'users.name';
      const pathInfo1 = getPathInfo(path);
      const pathInfo2 = getPathInfo(path);
      expect(pathInfo1).toBe(pathInfo2);
    });
  });

  describe('単純なパス', () => {
    it('単一セグメントのパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users');
      expect(pathInfo.path).toBe('users');
      expect(pathInfo.segments).toEqual(['users']);
      expect(pathInfo.wildcardPositions).toEqual([]);
      expect(pathInfo.wildcardPaths).toEqual([]);
      expect(pathInfo.wildcardParentPaths).toEqual([]);
      // 単一セグメントの場合、親は存在しない
      expect(pathInfo.parentPathInfo).toBeNull();
    });

    it('複数セグメントのパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.name');
      expect(pathInfo.path).toBe('users.name');
      expect(pathInfo.segments).toEqual(['users', 'name']);
      expect(pathInfo.wildcardPositions).toEqual([]);
      expect(pathInfo.parentPathInfo).not.toBeNull();
      expect(pathInfo.parentPathInfo?.path).toBe('users');
    });

    it('3階層のパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.profile.name');
      expect(pathInfo.path).toBe('users.profile.name');
      expect(pathInfo.segments).toEqual(['users', 'profile', 'name']);
      expect(pathInfo.wildcardPositions).toEqual([]);
    });

    it('空のパスを正しく処理すること', () => {
      const pathInfo = getPathInfo('');
      expect(pathInfo.path).toBe('');
      expect(pathInfo.segments).toEqual(['']);
      expect(pathInfo.wildcardPositions).toEqual([]);
      expect(pathInfo.parentPathInfo).toBeNull();
    });

    it('先頭にドットがあるパスを正しく処理すること', () => {
      const pathInfo = getPathInfo('.users');
      expect(pathInfo.path).toBe('.users');
      expect(pathInfo.segments).toEqual(['', 'users']);
    });

    it('末尾にドットがあるパスを正しく処理すること', () => {
      const pathInfo = getPathInfo('users.');
      expect(pathInfo.path).toBe('users.');
      expect(pathInfo.segments).toEqual(['users', '']);
    });
  });

  describe('ワイルドカードを含むパス', () => {
    it('単一ワイルドカードのパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.*');
      expect(pathInfo.path).toBe('users.*');
      expect(pathInfo.segments).toEqual(['users', '*']);
      expect(pathInfo.wildcardPositions).toEqual([1]);
      expect(pathInfo.wildcardPaths).toEqual(['users.*']);
      expect(pathInfo.wildcardParentPaths).toEqual(['users']);
    });

    it('ワイルドカードの後にプロパティがあるパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.*.name');
      expect(pathInfo.path).toBe('users.*.name');
      expect(pathInfo.segments).toEqual(['users', '*', 'name']);
      expect(pathInfo.wildcardPositions).toEqual([1]);
      expect(pathInfo.wildcardPaths).toEqual(['users.*']);
      expect(pathInfo.wildcardParentPaths).toEqual(['users']);
    });

    it('複数のワイルドカードを含むパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.*.posts.*');
      expect(pathInfo.path).toBe('users.*.posts.*');
      expect(pathInfo.segments).toEqual(['users', '*', 'posts', '*']);
      expect(pathInfo.wildcardPositions).toEqual([1, 3]);
      expect(pathInfo.wildcardPaths).toEqual(['users.*', 'users.*.posts.*']);
      expect(pathInfo.wildcardParentPaths).toEqual(['users', 'users.*.posts']);
    });

    it('複数のワイルドカードとプロパティを含むパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.*.posts.*.title');
      expect(pathInfo.path).toBe('users.*.posts.*.title');
      expect(pathInfo.segments).toEqual(['users', '*', 'posts', '*', 'title']);
      expect(pathInfo.wildcardPositions).toEqual([1, 3]);
      expect(pathInfo.wildcardPaths).toEqual(['users.*', 'users.*.posts.*']);
      expect(pathInfo.wildcardParentPaths).toEqual(['users', 'users.*.posts']);
    });

    it('先頭がワイルドカードのパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('*.name');
      expect(pathInfo.path).toBe('*.name');
      expect(pathInfo.segments).toEqual(['*', 'name']);
      expect(pathInfo.wildcardPositions).toEqual([0]);
      expect(pathInfo.wildcardPaths).toEqual(['*']);
      expect(pathInfo.wildcardParentPaths).toEqual(['']);
    });

    it('3階層のワイルドカードを含むパスを正しくパースすること', () => {
      const pathInfo = getPathInfo('users.*.posts.*.comments.*');
      expect(pathInfo.path).toBe('users.*.posts.*.comments.*');
      expect(pathInfo.segments).toEqual(['users', '*', 'posts', '*', 'comments', '*']);
      expect(pathInfo.wildcardPositions).toEqual([1, 3, 5]);
      expect(pathInfo.wildcardPaths).toEqual([
        'users.*',
        'users.*.posts.*',
        'users.*.posts.*.comments.*'
      ]);
      expect(pathInfo.wildcardParentPaths).toEqual([
        'users',
        'users.*.posts',
        'users.*.posts.*.comments'
      ]);
    });
  });

  describe('parentPathInfo', () => {
    it('空のパスの場合はnullを返すこと', () => {
      const pathInfo = getPathInfo('');
      expect(pathInfo.parentPathInfo).toBeNull();
    });

    it('親が存在する場合は正しい親PathInfoを返すこと', () => {
      const pathInfo = getPathInfo('users.name');
      const parent = pathInfo.parentPathInfo;
      expect(parent).not.toBeNull();
      expect(parent?.path).toBe('users');
      expect(parent?.segments).toEqual(['users']);
    });

    it('複数階層の親を正しく辿れること', () => {
      const pathInfo = getPathInfo('users.profile.name');
      const parent1 = pathInfo.parentPathInfo;
      expect(parent1?.path).toBe('users.profile');
      
      const parent2 = parent1?.parentPathInfo;
      expect(parent2?.path).toBe('users');
      
      const parent3 = parent2?.parentPathInfo;
      // 単一セグメントの親は存在しない
      expect(parent3).toBeNull();
      
      const parent4 = parent3?.parentPathInfo;
      // 親がないためundefined
      expect(parent4).toBeUndefined();
    });

    it('ワイルドカードを含むパスの親を正しく取得すること', () => {
      const pathInfo = getPathInfo('users.*.name');
      const parent = pathInfo.parentPathInfo;
      expect(parent?.path).toBe('users.*');
      expect(parent?.segments).toEqual(['users', '*']);
    });

    it('parentPathInfoが同じパスで同じインスタンスを返すこと', () => {
      const pathInfo1 = getPathInfo('users.name');
      const pathInfo2 = getPathInfo('users.email');
      expect(pathInfo1.parentPathInfo).toBe(pathInfo2.parentPathInfo);
    });

    it('parentPathInfoがキャッシュされること', () => {
      const pathInfo = getPathInfo('users.profile.name');
      const parent1 = pathInfo.parentPathInfo;
      const parent2 = pathInfo.parentPathInfo;
      expect(parent1).toBe(parent2);
    });
  });

  describe('wildcardPathInfos', () => {
    it('ワイルドカードがない場合は空配列を返すこと', () => {
      const pathInfo = getPathInfo('users.name');
      expect(pathInfo.wildcardPathInfos).toEqual([]);
    });

    it('単一ワイルドカードの場合は自身を返すこと', () => {
      const pathInfo = getPathInfo('users.*');
      expect(pathInfo.wildcardPathInfos).toHaveLength(1);
      expect(pathInfo.wildcardPathInfos[0]).toBe(pathInfo);
    });

    it('ワイルドカードの後にプロパティがある場合は正しいPathInfoを返すこと', () => {
      const pathInfo = getPathInfo('users.*.name');
      expect(pathInfo.wildcardPathInfos).toHaveLength(1);
      expect(pathInfo.wildcardPathInfos[0].path).toBe('users.*');
      expect(pathInfo.wildcardPathInfos[0]).toBe(getPathInfo('users.*'));
    });

    it('複数のワイルドカードの場合は全てのPathInfoを返すこと', () => {
      const pathInfo = getPathInfo('users.*.posts.*');
      expect(pathInfo.wildcardPathInfos).toHaveLength(2);
      expect(pathInfo.wildcardPathInfos[0].path).toBe('users.*');
      expect(pathInfo.wildcardPathInfos[1]).toBe(pathInfo);
    });

    it('3階層のワイルドカードの場合は全てのPathInfoを返すこと', () => {
      const pathInfo = getPathInfo('users.*.posts.*.comments.*');
      expect(pathInfo.wildcardPathInfos).toHaveLength(3);
      expect(pathInfo.wildcardPathInfos[0].path).toBe('users.*');
      expect(pathInfo.wildcardPathInfos[1].path).toBe('users.*.posts.*');
      expect(pathInfo.wildcardPathInfos[2]).toBe(pathInfo);
    });
  });

  describe('wildcardParentPathInfos', () => {
    it('ワイルドカードがない場合は空配列を返すこと', () => {
      const pathInfo = getPathInfo('users.name');
      expect(pathInfo.wildcardParentPathInfos).toEqual([]);
    });

    it('単一ワイルドカードの親PathInfoを返すこと', () => {
      const pathInfo = getPathInfo('users.*');
      expect(pathInfo.wildcardParentPathInfos).toHaveLength(1);
      expect(pathInfo.wildcardParentPathInfos[0].path).toBe('users');
    });

    it('複数のワイルドカードの親PathInfoを返すこと', () => {
      const pathInfo = getPathInfo('users.*.posts.*');
      expect(pathInfo.wildcardParentPathInfos).toHaveLength(2);
      expect(pathInfo.wildcardParentPathInfos[0].path).toBe('users');
      expect(pathInfo.wildcardParentPathInfos[1].path).toBe('users.*.posts');
    });

    it('ワイルドカードの親PathInfoがキャッシュから取得されること', () => {
      const pathInfo = getPathInfo('users.*.name');
      const wildcardParent = pathInfo.wildcardParentPathInfos[0];
      const directAccess = getPathInfo('users');
      expect(wildcardParent).toBe(directAccess);
    });
  });

  describe('エッジケース', () => {
    it('連続するドットを正しく処理すること', () => {
      const pathInfo = getPathInfo('users..name');
      expect(pathInfo.path).toBe('users..name');
      expect(pathInfo.segments).toEqual(['users', '', 'name']);
    });

    it('非常に長いパスを処理できること', () => {
      const longPath = Array(100).fill('segment').join('.');
      const pathInfo = getPathInfo(longPath);
      expect(pathInfo.segments).toHaveLength(100);
      expect(pathInfo.path).toBe(longPath);
    });

    it('特殊文字を含むセグメントを処理できること', () => {
      const pathInfo = getPathInfo('user-name.first_name');
      expect(pathInfo.segments).toEqual(['user-name', 'first_name']);
    });

    it('数字を含むセグメントを処理できること', () => {
      const pathInfo = getPathInfo('user123.address0.zip');
      expect(pathInfo.segments).toEqual(['user123', 'address0', 'zip']);
    });
  });
});
