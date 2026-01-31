import { describe, it, expect, afterEach } from 'vitest';
import { getParseBindTextResults } from '../src/bindings/getParseBindTextResults';
import { isCommentNode } from '../src/bindings/isCommentNode';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';

const uuid = 'parsebind-fragment-uuid';

afterEach(() => {
	setFragmentInfoByUUID(uuid, null);
});

describe('bindings.getParseBindTextResults.fragment', () => {
	it('構造フラグメントUUIDが見つからない場合は埋め込みとして処理されること', () => {
		const comment = document.createComment('@@wcs-text: message');
		expect(isCommentNode(comment)).toBe(true);
		const results = getParseBindTextResults(comment);
		expect(results).toHaveLength(1);
		expect(results[0].bindingType).toBe('text');
		expect(results[0].uuid).toBeNull();
	});

	it('構造フラグメントUUIDがある場合はuuidが設定されること', () => {
		const parseBindTextResult: ParseBindTextResult = {
			propName: 'for',
			propSegments: ['for'],
			propModifiers: [],
			statePathName: 'items',
			statePathInfo: getPathInfo('items'),
			stateName: 'default',
			filterTexts: [],
			bindingType: 'for',
			uuid: null,
		};

		setFragmentInfoByUUID(uuid, {
			fragment: document.createDocumentFragment(),
			parseBindTextResult,
			nodeInfos: [],
		});

		const comment = document.createComment(`@@wcs-for: ${uuid}`);
		expect(isCommentNode(comment)).toBe(true);
		const results = getParseBindTextResults(comment);
		expect(results).toHaveLength(1);
		expect(results[0].bindingType).toBe('for');
		expect(results[0].uuid).toBe(uuid);
	});

	it('コメントのバインド文字列が見つからない場合はエラーになること', () => {
		const comment = document.createComment('no-bind-text');
		expect(() => getParseBindTextResults(comment)).toThrow(/Comment node binding text not found/);
	});

	it('コメント/要素以外は空配列になること', () => {
		const textNode = document.createTextNode('plain');
		const results = getParseBindTextResults(textNode);
		expect(results).toEqual([]);
	});
});
