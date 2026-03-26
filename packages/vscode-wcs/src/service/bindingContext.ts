/**
 * bindingContext.ts
 *
 * data-wcs 属性値内のカーソル位置からバインディングコンテキストを解析する。
 * どの部分（プロパティ名、パス、フィルタ）の補完が必要かを判定する。
 */

/** カーソル位置のバインディングコンテキスト */
export type BindingContext =
  | { kind: 'property'; partial: string }
  | { kind: 'modifier'; propName: string; partial: string }
  | { kind: 'path'; propName: string; partial: string; targetState: string | null }
  | { kind: 'filter'; propName: string; partial: string; targetState: string | null }
  | { kind: 'stateName'; partial: string }
  | { kind: 'none' };

/**
 * data-wcs 属性値とカーソルのオフセットから補完コンテキストを解析する。
 *
 * バインディング構文: `[property][#modifier]: [path][@state][|filter|filter(args)...]`
 * 複数バインディングは `;` で区切る。
 *
 * @param attrValue - data-wcs 属性の値全体
 * @param cursorOffset - 属性値内のカーソル位置（0始まり）
 */
export function getBindingContext(attrValue: string, cursorOffset: number): BindingContext {
  // カーソル位置を含むバインディング式を特定（`;` で分割）
  const bindings = splitBindings(attrValue);
  let currentStart = 0;
  let currentBinding = '';

  for (const binding of bindings) {
    const end = currentStart + binding.length;
    if (cursorOffset <= end) {
      currentBinding = binding;
      break;
    }
    // +1 for the `;` separator
    currentStart = end + 1;
  }

  if (!currentBinding && bindings.length > 0) {
    currentBinding = bindings[bindings.length - 1];
    currentStart = attrValue.length - currentBinding.length;
  }

  const offsetInBinding = cursorOffset - currentStart;
  return parseBindingAtCursor(currentBinding, offsetInBinding);
}

/**
 * `;` でバインディング式を分割する。
 * 括弧内の `;` は無視する。
 */
function splitBindings(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of value) {
    if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (ch === ';' && parenDepth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

/**
 * 単一のバインディング式とカーソル位置からコンテキストを判定する。
 */
function parseBindingAtCursor(binding: string, offset: number): BindingContext {
  const textBeforeCursor = binding.slice(0, offset);

  // `:` の位置を探す（プロパティ部とパス部の境界）
  const colonIndex = binding.indexOf(':');

  if (colonIndex === -1 || offset <= colonIndex) {
    // `:` の前（プロパティ部）
    const trimmed = textBeforeCursor.trimStart();
    const hashIndex = trimmed.indexOf('#');
    if (hashIndex !== -1) {
      return {
        kind: 'modifier',
        propName: trimmed.slice(0, hashIndex),
        partial: trimmed.slice(hashIndex + 1),
      };
    }
    return { kind: 'property', partial: trimmed };
  }

  // プロパティ名を抽出（`#modifier` を除去）
  const propPart = binding.slice(0, colonIndex).trim();
  const propName = propPart.includes('#') ? propPart.slice(0, propPart.indexOf('#')) : propPart;

  // `:` の後（パス + フィルタ部）
  const afterColon = textBeforeCursor.slice(colonIndex + 1).trimStart();

  // `@` を検出して targetState を抽出
  // afterColon のフィルタ前部分から @stateName を取得
  const firstPipeIndex = afterColon.indexOf('|');
  const pathPart = firstPipeIndex !== -1 ? afterColon.slice(0, firstPipeIndex) : afterColon;
  const atIndex = pathPart.indexOf('@');
  const targetState = atIndex !== -1 ? pathPart.slice(atIndex + 1).trim() || null : null;

  // `|` があればフィルタ部
  const lastPipeIndex = afterColon.lastIndexOf('|');
  if (lastPipeIndex !== -1) {
    const filterPart = afterColon.slice(lastPipeIndex + 1).trimStart();
    // 括弧内の場合はフィルタ引数（補完しない）
    if (filterPart.includes('(') && !filterPart.includes(')')) {
      return { kind: 'none' };
    }
    return { kind: 'filter', propName, partial: filterPart, targetState };
  }

  // `@` の直後にカーソルがある場合は state 名補完
  if (atIndex !== -1) {
    const afterAt = pathPart.slice(atIndex + 1);
    return { kind: 'stateName', partial: afterAt.trim() };
  }

  return { kind: 'path', propName, partial: afterColon, targetState };
}
