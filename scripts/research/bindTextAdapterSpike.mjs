// Adapter from the lexer spike's AST (bindTextLexerSpike.mjs) to the shipped parser's output
// shape (IParsedBinding: propName / propSegments / propModifiers / statePathName /
// statePathInfo / inFilters / outFilters / bindingType). A research artifact for the
// next-major survey: it shows what a compatibility layer over the new grammar stage costs and
// where its output deliberately differs from the shipped parser (radio#ro / checkbox|int keep
// their kind; malformed input is reported instead of trimmed). Path info and filter functions
// are injected so that this module carries only the mapping.
import { parseBindText } from './bindTextLexerSpike.mjs';

/**
 * @param {{ getPathInfo: (path: string) => unknown,
 *           builtinFilterFn: (name: string, args: string[]) => (filters: object) => (value: unknown) => unknown,
 *           filtersByIOType: { input: object, output: object },
 *           options?: object }} deps
 */
export function createAdapter({ getPathInfo, builtinFilterFn, filtersByIOType, options }) {
  // Structural cache key: name and arguments as a JSON array, so join('a,b') and join(a,b) differ.
  const fnCache = new Map();
  const toFilterInfo = f => {
    const args = f.args.map(a => a.value);
    const key = `${f.io}:${JSON.stringify([f.name, args])}`;
    let filterFn = fnCache.get(key);
    if (filterFn === undefined) {
      filterFn = builtinFilterFn(f.name, args)(filtersByIOType[f.io]);
      fnCache.set(key, filterFn);
    }
    return { filterName: f.name, args, filterFn };
  };
  const toParsed = b => {
    const kind = b.kind;
    const name = b.prop.name;
    if (kind === 'else') {
      return { propName: 'else', propSegments: ['else'], propModifiers: [], statePathName: '#else', statePathInfo: getPathInfo('#else'),
        inFilters: [], outFilters: [], bindingType: 'else' };
    }
    const statePathName = b.path.text;
    const statePathInfo = getPathInfo(statePathName);
    const outFilters = b.outFilters.map(toFilterInfo);
    if (kind === 'spread') {
      return { propName: '...', propSegments: ['...'], propModifiers: [], statePathName, statePathInfo, inFilters: [], outFilters, bindingType: 'spread' };
    }
    const structural = kind === 'if' || kind === 'elseif' || kind === 'for';
    const form = kind === 'radio' || kind === 'checkbox';
    return {
      propName: name,
      propSegments: structural || form ? [name] : b.prop.segments,
      propModifiers: b.prop.modifiers.map(m => m.value === undefined ? m.name : `${m.name}=${m.value}`),
      statePathName, statePathInfo,
      inFilters: structural ? [] : b.inFilters.map(toFilterInfo),
      outFilters,
      bindingType: kind,
    };
  };
  return {
    /** AST → bindings plus diagnostics; never throws on syntax. */
    parse(text) {
      const ast = parseBindText(text, options);
      return { bindings: ast.bindings.map(toParsed), diagnostics: ast.diagnostics };
    },
    /** The shipped contract: throw on the first error, return the bindings otherwise. */
    parseBindTextsForElement(text) {
      const result = this.parse(text);
      const error = result.diagnostics.find(d => d.code.startsWith('E_'));
      if (error) throw new Error(`[wcs/template-syntax] ${error.code} at ${error.start}: ${error.message}`);
      return result.bindings;
    },
  };
}
