/**
 * フィルタ引数リストのパース。`filter(a, b)` の `a, b` 部分を受け取る。
 *
 * トリムの規則は「**クォートの外側だけ**」。`fix( 2 )` のような書き癖を吸収するために
 * 素の引数は前後をトリムするが、クォートは「ここは literal」という宣言なので中身の
 * 空白は残す。両方まとめてトリムしていたため `pad(5, ' ')` が空文字パディング
 * （＝無変化）に化けており、空白区切りの `join(' / ')` も指定できなかった。
 */

/** 引数 1 つを確定する。クォート由来の文字が入った範囲より外側だけをトリムする。 */
function finalizeArg(text: string, firstQuoteStart: number, lastQuoteEnd: number): string {
  // 先頭側: 最初のクォート文字より前だけが削れる（クォートが無ければ全体が対象）
  const startLimit = firstQuoteStart === -1 ? text.length : firstQuoteStart;
  let start = 0;
  while (start < startLimit && /\s/.test(text[start])) {
    start++;
  }
  // 末尾側: 最後のクォート文字より後ろだけが削れる（クォートが無ければ全体が対象）
  const endLimit = lastQuoteEnd === -1 ? 0 : lastQuoteEnd;
  let end = text.length;
  while (end > endLimit && /\s/.test(text[end - 1])) {
    end--;
  }
  return text.slice(start, end);
}

export function parseFilterArgs(argsText: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let hasQuote = false;
  let firstQuoteStart = -1;
  let lastQuoteEnd = -1;

  const flush = (): void => {
    args.push(finalizeArg(current, firstQuoteStart, lastQuoteEnd));
    current = '';
    hasQuote = false;
    firstQuoteStart = -1;
    lastQuoteEnd = -1;
  };

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        if (firstQuoteStart === -1) {
          firstQuoteStart = current.length;
        }
        current += char;
        lastQuoteEnd = current.length;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasQuote = true;
    } else if (char === ',') {
      flush();
    } else {
      current += char;
    }
  }

  const last = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
  if (last || hasQuote) {
    args.push(last);
  }

  return args;
}
