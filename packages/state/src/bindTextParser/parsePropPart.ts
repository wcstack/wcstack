import { DELIMITER, FILTER_SEPARATOR, MODIFIER_SEPARATOR } from "../define";
import { LINT_HINT } from "../errorGuidance";
import { raiseError } from "../raiseError";
import { IParsedBinding, IParsedFilter } from "../types";
import { parseFilters } from "./parseFilters";
import { indexOfOutsideQuotes, splitOutsideQuotes, trimFn } from "./utils";

// 解析の段の形（フィルタは名前と引数だけ — 実関数は束縛計画の段で引く。要件 D16）
type PropPartParseResult = Pick<IParsedBinding, 'propName' | 'propSegments' | 'propModifiers' | 'inFilters'>;

const cacheFilterInfos = new Map<string, IParsedFilter[]>();

/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
export function clearPropPartCacheForTooling(): void {
  cacheFilterInfos.clear();
}

// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners

export function parsePropPart(propPart: string): PropPartParseResult {
  const pos = indexOfOutsideQuotes(propPart, FILTER_SEPARATOR);
  let propText: string = '';
  let filterTexts: string[] = [];
  let filtersText = '';
  let filters: IParsedFilter[] = [];
  if (pos !== -1) {
    propText = propPart.slice(0, pos).trim();
    filtersText = propPart.slice(pos + 1).trim();
    if (cacheFilterInfos.has(filtersText)) {
      filters = cacheFilterInfos.get(filtersText)!;
    } else {
      filterTexts = splitOutsideQuotes(filtersText, FILTER_SEPARATOR).map(trimFn);
      // 診断に埋める原文は**左辺の全文**。`|` より後ろだけを渡すと `value|:` のように
      // 末尾が空の形で空文字になる（解析結果のキャッシュ鍵は従来どおり `filtersText`。
      // 落ちた解析はキャッシュに載らないので、原文を混ぜても鍵は汚れない）
      filters = parseFilters(filterTexts, "input", propPart);
      cacheFilterInfos.set(filtersText, filters);
    }
  } else {
    propText = propPart.trim();
  }

  const modifierParts = propText.split(MODIFIER_SEPARATOR).map(trimFn);
  if (modifierParts.length > 2) {
    // 修飾子の並びは 1 つだけ（要件 B2）。`value#ro#wo` は以前 `ro` だけを残して黙って捨てていた
    raiseError(`[wcs/binding-syntax] "${propText}": a binding takes one modifier list after a single "${MODIFIER_SEPARATOR}" — write "${modifierParts[0]}${MODIFIER_SEPARATOR}${modifierParts.slice(1).join(",")}".${LINT_HINT}`);
  }
  const [propName, propModifiersText] = modifierParts;
  const propSegments = propName.split(DELIMITER).map(trimFn);
  // 明示のプロパティ形（`.name:` — 要件 B5 / D34）だけは先頭の空セグメントが正しい形。
  // それ以外で空のセグメントが残るのは書き間違い: 左辺が空（`": x"` / `"#ro: x"` / `"|trim: x"`）だと
  // `element[""] = value` の expando ができて完全に沈黙し、末尾が空（`"foo.: x"`）だと適用の段で
  // 素の TypeError になる。どちらも解析の段で名指しで落とす（`.: x` 等は下の D34 の検査が受け持つ）
  const isExplicitProperty = propSegments.length > 1 && propSegments[0] === '';
  if (!isExplicitProperty && (propName.length === 0 || propSegments.some((segment) => segment.length === 0))) {
    raiseError(
      `[wcs/binding-syntax] "${propPart}": the left side of a binding must name a property — ` +
      `write "<property>: <path>" (modifiers and input filters come after the name).${LINT_HINT}`,
    );
  }
  const propModifiers = propModifiersText
    ? propModifiersText.split(',').map(trimFn)
    : [];
  return {
    propName,
    propSegments,
    propModifiers,
    inFilters: filters,
  };
}