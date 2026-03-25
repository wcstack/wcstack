/**
 * stateAnalyzer.ts
 *
 * HTML 内の <wcs-state> スクリプトからオブジェクトリテラルを解析し、
 * バインディング用のパス候補を生成する。
 *
 * TypeScript の AST パーサを使用せず、軽量な正規表現ベースで解析する。
 * 完全な精度は求めず、補完候補として有用なパスを高速に生成することを優先。
 */

/** パス候補 */
export interface PathCandidate {
  /** ドット区切りパス（例: "users.*.name"） */
  path: string;
  /** パスの種別（method は検証専用、補完候補には出さない） */
  kind: 'data' | 'computed' | 'method' | 'list';
  /** 値の型ヒント（推定） */
  typeHint?: string;
}

/**
 * export default { ... } のオブジェクトリテラルからパス候補を生成する。
 *
 * @param scriptContent - <script type="module"> の内容
 * @returns パス候補の配列
 */
export function analyzeStatePaths(scriptContent: string): PathCandidate[] {
  const objectContent = extractDefaultExportObject(scriptContent);
  if (!objectContent) return [];

  const paths: PathCandidate[] = [];
  const topLevelProps = parseTopLevelProperties(objectContent);

  for (const prop of topLevelProps) {
    if (prop.kind === 'method') {
      // メソッドはパス補完には含めないが、検証用に登録
      paths.push({ path: prop.name, kind: 'method' });
      continue;
    }

    if (prop.kind === 'getter') {
      // computed getter: "users.*.ageCategory" のようなパス
      paths.push({ path: prop.name, kind: 'computed' });
      continue;
    }

    // データプロパティ
    paths.push({ path: prop.name, kind: 'data', typeHint: prop.typeHint });

    // 配列の場合、ワイルドカードパスと子パス、組み込みプロパティを生成
    if (prop.value && isArrayLiteral(prop.value)) {
      paths.push({ path: `${prop.name}.*`, kind: 'list' });
      paths.push({ path: `${prop.name}.length`, kind: 'data', typeHint: 'number' });
      const elementProps = extractArrayElementProperties(prop.value);
      for (const childProp of elementProps) {
        paths.push({
          path: `${prop.name}.*.${childProp.name}`,
          kind: 'data',
          typeHint: childProp.typeHint,
        });
      }
    }

    // オブジェクトの場合、子パスを生成
    if (prop.value && isObjectLiteral(prop.value)) {
      const childProps = parseTopLevelProperties(extractObjectContent(prop.value));
      for (const childProp of childProps) {
        if (childProp.kind === 'data') {
          paths.push({
            path: `${prop.name}.${childProp.name}`,
            kind: 'data',
            typeHint: childProp.typeHint,
          });

          // ネストした配列
          if (childProp.value && isArrayLiteral(childProp.value)) {
            paths.push({ path: `${prop.name}.${childProp.name}.*`, kind: 'list' });
            paths.push({ path: `${prop.name}.${childProp.name}.length`, kind: 'data', typeHint: 'number' });
            const grandchildProps = extractArrayElementProperties(childProp.value);
            for (const gc of grandchildProps) {
              paths.push({
                path: `${prop.name}.${childProp.name}.*.${gc.name}`,
                kind: 'data',
                typeHint: gc.typeHint,
              });
            }
          }
        }
      }
    }
  }

  return paths;
}

// ============================================================
// Internal helpers
// ============================================================

interface PropertyInfo {
  name: string;
  kind: 'data' | 'getter' | 'method';
  value?: string;
  typeHint?: string;
}

interface SimpleProperty {
  name: string;
  typeHint?: string;
}

/**
 * `export default { ... }` からオブジェクトリテラルの中身を抽出する。
 */
function extractDefaultExportObject(script: string): string | null {
  // defineState({ ... }) または { ... } を検出
  const match = script.match(/export\s+default\s+(?:defineState\s*\(\s*)?(\{)/);
  if (!match) return null;

  const startIndex = script.indexOf(match[1], match.index!);
  return extractBracedContent(script, startIndex);
}

/**
 * オブジェクトリテラルのトップレベルプロパティを解析する。
 * トークンベースでスキャンし、ネストされた括弧をスキップする。
 */
function parseTopLevelProperties(objectContent: string): PropertyInfo[] {
  const props: PropertyInfo[] = [];
  const regex = /(?:get\s+(?:"([^"]+)"|'([^']+)'|(\w+))\s*\(\s*\))|(?:(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{)|(?:(?:"([^"]+)"|'([^']+)'|(\w+))\s*:\s*)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(objectContent)) !== null) {
    // getter: get "path"() or get path()
    const getterName = match[1] ?? match[2] ?? match[3];
    if (getterName) {
      props.push({ name: getterName, kind: 'getter' });
      continue;
    }

    // method: name(args) {
    const methodName = match[4];
    if (methodName) {
      props.push({ name: methodName, kind: 'method' });
      // メソッド本体をスキップ
      const braceStart = objectContent.indexOf('{', match.index + match[0].length - 1);
      if (braceStart !== -1) {
        const body = extractBracedContent(objectContent, braceStart);
        regex.lastIndex = braceStart + body.length + 2; // +2 for { and }
      }
      continue;
    }

    // data property: name: value
    const propName = match[5] ?? match[6] ?? match[7];
    if (propName) {
      const valueStartIndex = match.index + match[0].length;
      const value = extractFullValue(objectContent, valueStartIndex);
      // JSDoc @type アノテーションがあれば優先、なければ値から推定
      const jsdocType = extractJsDocType(objectContent, match.index);
      const typeHint = jsdocType ?? inferTypeHint(value);
      props.push({ name: propName, kind: 'data', value, typeHint });
      // 値の末尾までスキップ
      regex.lastIndex = valueStartIndex + value.length;
    }
  }

  return props;
}

/**
 * プロパティ値のフルテキストを抽出する（ネストされた括弧を追跡）。
 */
function extractFullValue(content: string, startIndex: number): string {
  let depth = 0;
  let i = startIndex;
  const len = content.length;
  let inString: string | null = null;

  while (i < len) {
    const ch = content[i];

    if (inString) {
      if (ch === inString && !isEscaped(content, i)) {
        inString = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) {
      break;
    }
    i++;
  }

  return content.slice(startIndex, i).trim();
}

/**
 * `{ ... }` の中身（外側の括弧を除く）を抽出する。
 */
function extractBracedContent(text: string, openBraceIndex: number): string {
  let depth = 0;
  let inString: string | null = null;

  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (ch === inString && !isEscaped(text, i)) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex + 1, i);
      }
    }
  }

  return text.slice(openBraceIndex + 1);
}

/**
 * 値が配列リテラルかどうかを判定する。
 */
function isArrayLiteral(value: string): boolean {
  return value.trimStart().startsWith('[');
}

/**
 * 値がオブジェクトリテラルかどうかを判定する。
 */
function isObjectLiteral(value: string): boolean {
  return value.trimStart().startsWith('{');
}

/**
 * オブジェクトリテラルの中身を抽出する。
 */
function extractObjectContent(value: string): string {
  const trimmed = value.trim();
  const start = trimmed.indexOf('{');
  if (start === -1) return '';
  return extractBracedContent(trimmed, start);
}

/**
 * 配列リテラルの最初の要素がオブジェクトの場合、そのプロパティを抽出する。
 */
function extractArrayElementProperties(value: string): SimpleProperty[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return [];

  // 最初のオブジェクトリテラル { ... } を探す
  const objectStart = trimmed.indexOf('{');
  if (objectStart === -1) return [];

  const objectContent = extractBracedContent(trimmed, objectStart);

  // オブジェクトの全プロパティを行単位で解析
  const props: SimpleProperty[] = [];
  const allProps = parseTopLevelProperties(objectContent);
  for (const prop of allProps) {
    if (prop.kind === 'data') {
      props.push({ name: prop.name, typeHint: prop.typeHint });
    }
  }

  return props;
}

/**
 * プロパティの直前にある JSDoc `@type` コメントから型ヒントを抽出する。
 *
 * 対応パターン:
 * - `/** @type {string} * /`
 * - `/** @type {boolean|null} * /`
 * - `/** @type {number[]} * /`
 *
 * Union 型の場合、null/undefined を除いた主要な型を返す。
 */
function extractJsDocType(content: string, propIndex: number): string | undefined {
  // プロパティの直前の空白・改行をスキップして JSDoc コメントを探す
  const before = content.slice(Math.max(0, propIndex - 200), propIndex);
  const jsdocMatch = before.match(/\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*$/);
  if (!jsdocMatch) return undefined;

  const typeExpr = jsdocMatch[1].trim();
  return normalizeJsDocType(typeExpr);
}

/**
 * JSDoc 型表現を正規化して型ヒントに変換する。
 * Union 型はそのまま保持する（例: "boolean|null"）。
 */
function normalizeJsDocType(typeExpr: string): string | undefined {
  const parts = typeExpr.split('|').map(p => p.trim());
  const normalized = parts.map(p => {
    const lower = p.toLowerCase();
    if (lower === 'string') return 'string';
    if (lower === 'number') return 'number';
    if (lower === 'boolean') return 'boolean';
    if (lower === 'null') return 'null';
    if (lower === 'undefined') return 'null';
    if (lower.endsWith('[]') || lower.startsWith('array')) return 'array';
    if (lower === 'object') return 'object';
    return null;
  }).filter(p => p !== null) as string[];

  if (normalized.length === 0) return undefined;

  // 重複を除去してソートして結合
  const unique = [...new Set(normalized)].sort();
  return unique.join('|');
}

/**
 * 位置 i の文字がバックスラッシュでエスケープされているかを判定する。
 * 連続するバックスラッシュ（`\\`）を正しくカウントする。
 */
function isEscaped(text: string, i: number): boolean {
  let backslashCount = 0;
  let j = i - 1;
  while (j >= 0 && text[j] === '\\') {
    backslashCount++;
    j--;
  }
  return backslashCount % 2 === 1;
}

/**
 * 値の先頭部分から型を推定する。
 */
function inferTypeHint(valueStart: string): string | undefined {
  const v = valueStart.trim().replace(/,\s*$/, '');
  if (/^-?\d+\.\d/.test(v)) return 'number';
  if (/^-?\d/.test(v)) return 'number';
  if (/^["'`]/.test(v)) return 'string';
  if (v === 'true' || v === 'false') return 'boolean';
  if (v === 'null') return 'null';
  if (v.startsWith('[')) return 'array';
  if (v.startsWith('{')) return 'object';
  return undefined;
}
