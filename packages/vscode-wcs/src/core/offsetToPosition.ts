/**
 * core/offsetToPosition.ts
 *
 * 生テキスト上の文字オフセットを 1-based の line:column へ写像する。
 * VS Code は LSP document.positionAt が担うため、これは CLI 専用の同等物。
 * pure(DOM / vscode 非依存)。
 */

export interface LineColumn {
  /** 1-based 行番号。 */
  readonly line: number;
  /** 1-based 桁(列)番号。 */
  readonly column: number;
}

/**
 * 改行位置を前計算した写像器を作る(1 ファイルの複数診断を効率よく写像するため)。
 */
export function createPositionMapper(text: string): (offset: number) => LineColumn {
  // 各行の開始オフセット。lineStarts[i] = i 行目(0-based)の先頭 offset。
  // LSP の computeLineOffsets と同じく \n / \r\n / 単独 \r を改行として扱う。
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a /* \n */) {
      lineStarts.push(i + 1);
    } else if (c === 0x0d /* \r */) {
      // \r\n はまとめて 1 改行として扱う(\n 側では push しない)。
      if (text.charCodeAt(i + 1) === 0x0a) i++;
      lineStarts.push(i + 1);
    }
  }
  return (offset: number): LineColumn => {
    const clamped = Math.max(0, Math.min(offset, text.length));
    // lineStarts で clamped 以下の最大要素を二分探索。
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: clamped - lineStarts[lo] + 1 };
  };
}
