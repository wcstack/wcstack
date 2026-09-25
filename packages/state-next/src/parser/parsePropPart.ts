import { DELIMITER, FILTER_SEPARATOR, MODIFIER_SEPARATOR } from "./define";
import { parseFilters } from "./parseFilters";
import { raiseError } from "./raiseError";
import { ParsedBinding, ParsedFilter } from "./types";
import { indexOfOutsideQuotes, splitOutsideQuotes, trimFn } from "./utils";

// 解析の段の形（フィルタは名前と引数だけ — 実関数はエンジンが引く。要件 D16）
export type PropPartParseResult = Pick<ParsedBinding, 'propName' | 'propSegments' | 'propModifiers' | 'inFilters'>;

/**
 * 入力フィルタ列の解析結果のキャッシュ（鍵は `|` より後ろの原文）。同じ原文は**同じ配列**を返す —
 * 消費側は返された `inFilters` を変更しないこと。落ちた解析は載らない。
 * （`@wcstack/state` の tooling 専用の解放口 `clearPropPartCacheForTooling` は移植しない）
 */
const cacheFilterInfos = new Map<string, ParsedFilter[]>();

// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path:
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners

/** Port of `@wcstack/state` `src/bindTextParser/parsePropPart.ts` (behaviour unchanged). */
export function parsePropPart(propPart: string): PropPartParseResult {
  const pos = indexOfOutsideQuotes(propPart, FILTER_SEPARATOR);
  let propText: string = '';
  let filterTexts: string[] = [];
  let filtersText = '';
  let filters: ParsedFilter[] = [];
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

  // **不変条件**: ここから下の `split` は素で走らせてよい。`propText` は「引用符外の最初の `|`
  // より前」のスライスであり、引用符を含みうるのは入力フィルタの引数（`|` の後ろ）だけなので、
  // `#` も `,` も `.` も引用符の中に現れない。**修飾子の値に引用符を許す拡張（例
  // `value#fmt('a,b'): x`）を入れるなら、この 3 つも `splitOutsideQuotes` に替えること**。
  const modifierParts = propText.split(MODIFIER_SEPARATOR).map(trimFn);
  if (modifierParts.length > 2) {
    // 修飾子の並びは 1 つだけ（要件 B2）。`value#ro#wo` は以前 `ro` だけを残して黙って捨てていた
    raiseError(`[wcs/binding-syntax] "${propText}": one modifier list — write "${modifierParts[0]}${MODIFIER_SEPARATOR}${modifierParts.slice(1).join(",")}".`);
  }
  const [propName, propModifiersText] = modifierParts;
  const propSegments = propName.split(DELIMITER).map(trimFn);
  // 明示のプロパティ形（`.name:` — 要件 B5 / D34）だけは先頭の空セグメントが正しい形。
  // それ以外で空のセグメントが残るのは書き間違い: 左辺が空（`": x"` / `"#ro: x"` / `"|trim: x"`）だと
  // `element[""] = value` の expando ができて完全に沈黙し、末尾が空（`"foo.: x"`）だと適用の段で
  // 素の TypeError になる。どちらも解析の段で名指しで落とす（`.: x` 等は D34 の検査が受け持つ）
  const isExplicitProperty = propSegments.length > 1 && propSegments[0] === '';
  if (!isExplicitProperty && (propName.length === 0 || propSegments.some((segment) => segment.length === 0))) {
    raiseError(`[wcs/binding-syntax] "${propPart}": the left side of a binding must name a property.`);
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
