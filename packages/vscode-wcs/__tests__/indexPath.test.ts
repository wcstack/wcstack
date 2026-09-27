/**
 * indexPath.test.ts — 束縛の数値添字のパスの読まれ方（#355）。
 *
 * 期待値は @wcstack/state の実行時（address/indexPathAccessor.ts の isIndexPath・
 * diagnostics/pathChecks.ts の resolvePathExistence）を同じパスで測った結果に合わせてある。素のパスは
 * その位置に要素がある state で測った（要素の個数は静的に見ないので、要素があるものとして扱う）。
 */
import { describe, it, expect } from 'vitest';
import { isPlainElementPath, isPlainIndexPath, toRowPatternPath } from '../src/service/indexPath';
import type { PathCandidate } from '../src/service/stateAnalyzer';

describe('isPlainIndexPath — 行として読まれない数値添字のパス', () => {
  it.each([
    // 数値添字が 1 つ（実行時の isIndexPath が真）: 行として読む
    ['items.0.v', false],
    ['items.0', false],
    ['items.01.v', false],
    ['items.1e0.v', false],
    ['items.-1.v', false],
    // 数値のキーを持つオブジェクトも実行時は同じ判定（親が配列でなければ素のキーとして読む）
    ['sales.2024.total', false],
    // 数値の区切りが無い・先頭だけが数値（ルートのキー）: 添字ではない
    ['count', false],
    ['user.name', false],
    ['2024.total', false],
    ['.name', false],
    ['.', false],
    // 数値の区切りが 2 つ以上: 素のパス
    ['groups.0.items.0.v', true],
    ['2024.items.0.v', true],
    // * と混ざる・省略パス（items.*.tags.0 に展開される）: 素のパス
    ['items.*.tags.0', true],
    ['.tags.0', true],
  ])('%s → %s', (path, expected) => {
    expect(isPlainIndexPath(path)).toBe(expected);
  });
});

describe('toRowPatternPath — 候補集合と照合する形', () => {
  const pathSet = new Set(['items', 'items.*', 'items.*.v', 'groups', 'groups.*', 'groups.*.items', 'sales', 'sales.2024']);

  it.each([
    ['items.0.v', 'items.*.v'],
    ['items.0', 'items.*'],
    ['items.01.v', 'items.*.v'],
    ['items.1e0.v', 'items.*.v'],
    ['groups.3.items', 'groups.*.items'],
    // 負の添字は行になりえない（実行時も素のキーとして探す）
    ['items.-1.v', 'items.-1.v'],
    // 親がリストでない（数値のキーを持つオブジェクト）は素のキー
    ['sales.2025.total', 'sales.2025.total'],
    // 親が候補に無い
    ['missing.0.v', 'missing.0.v'],
    // 行として読まれないパスは読み替えない
    ['groups.0.items.0.v', 'groups.0.items.0.v'],
    ['items.*.v', 'items.*.v'],
    ['count', 'count'],
  ])('%s → %s', (path, expected) => {
    expect(toRowPatternPath(path, pathSet)).toBe(expected);
  });
});

describe('isPlainElementPath — 素のパスが要素を辿って届くデータか', () => {
  const candidates: PathCandidate[] = [
    { path: 'groups', kind: 'data' },
    { path: 'groups.*', kind: 'list' },
    { path: 'groups.*.items', kind: 'data' },
    { path: 'groups.*.items.*', kind: 'list' },
    { path: 'groups.*.items.*.v', kind: 'data' },
    { path: 'groups.*.items.*.double', kind: 'computed' },
    { path: 'sales', kind: 'data' },
    { path: 'sales.2024', kind: 'data' },
  ];
  const pathSet = new Set(candidates.map(c => c.path));

  it.each([
    // 実行時（resolvePathExistence・素のパス）: 要素があれば存在
    ['groups.0.items.*.v', true],
    ['groups.0.items.0.v', true],
    ['groups.12.items.3', true],
    // 行 getter は素のパスでは読めない（実行時は空で描く。resolvePathExistence を直接呼ぶと見つからないと
    // 判定するが、for: groups.0.items を描くページでは暗黙のアクセサが接頭辞に当たって判定不能に倒れ、
    // 実行時の警告は出ない — state 側の別件）
    ['groups.0.items.*.double', false],
    // 配列のキーの綴りでない添字（実行時も "01" / "1e0" / "-1" は見つからない）
    ['groups.01.items.*.v', false],
    ['groups.1e0.items.*.v', false],
    ['groups.-1.items.*.v', false],
    // 親がリストでない数値のキー
    ['sales.2025.total', false],
    // 要素の下に無いメンバー
    ['groups.0.items.*.nope', false],
  ])('%s → %s', (path, expected) => {
    expect(isPlainElementPath(path, candidates, pathSet)).toBe(expected);
  });
});
