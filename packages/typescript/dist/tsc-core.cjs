"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/tscCore.ts
var tscCore_exports = {};
__export(tscCore_exports, {
  WCS_PREAMBLE: () => WCS_PREAMBLE,
  WCS_PREAMBLE_LENGTH: () => WCS_PREAMBLE_LENGTH,
  createWcsLanguagePlugin: () => createWcsLanguagePlugin,
  stripWcsImport: () => stripWcsImport
});
module.exports = __toCommonJS(tscCore_exports);

// src/language/htmlParse.ts
function parseWcsScriptBlocks(html, stateTagName = "wcs-state") {
  const blocks = [];
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }
    const mountPath = extractAttribute(wcsMatch.tagContent, "mount");
    pos = wcsMatch.end;
    const wcsCloseIdx = findCloseTag(html, pos, stateTagName);
    const wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
    while (pos < wcsEnd) {
      if (html.startsWith("<!--", pos)) {
        const commentEnd = html.indexOf("-->", pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }
      const scriptMatch = matchOpenTag(html, pos, "script");
      if (scriptMatch === null) {
        pos++;
        continue;
      }
      const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
      if (typeAttr?.toLowerCase() !== "module") {
        pos = scriptMatch.end;
        continue;
      }
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) {
        pos = contentStart;
        break;
      }
      const contentEnd = scriptCloseIdx;
      blocks.push({
        contentStart,
        contentEnd,
        content: html.slice(contentStart, contentEnd),
        mountPath
      });
      pos = html.indexOf(">", scriptCloseIdx) + 1;
      if (pos === 0) break;
    }
    pos = wcsEnd;
    if (wcsCloseIdx !== -1) {
      const closeEnd = html.indexOf(">", wcsCloseIdx);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }
  }
  return blocks;
}
function matchOpenTag(html, pos, tagName) {
  if (html[pos] !== "<") return null;
  const nameStart = pos + 1;
  const nameEnd = nameStart + tagName.length;
  if (nameEnd > html.length) return null;
  const slice = html.slice(nameStart, nameEnd);
  if (slice.toLowerCase() !== tagName.toLowerCase()) return null;
  const charAfter = html[nameEnd];
  if (charAfter !== ">" && charAfter !== " " && charAfter !== "	" && charAfter !== "\n" && charAfter !== "\r" && charAfter !== "/") {
    return null;
  }
  let i = nameEnd;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  while (i < html.length) {
    const ch = html[i];
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
    } else if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
    } else if (ch === "'") {
      inSingleQuote = true;
    } else if (ch === '"') {
      inDoubleQuote = true;
    } else if (ch === ">") {
      return {
        start: pos,
        end: i + 1,
        tagContent: html.slice(nameEnd, i)
      };
    }
    i++;
  }
  return null;
}
function findCloseTag(html, startPos, tagName) {
  const pattern = "</" + tagName;
  const patternLower = pattern.toLowerCase();
  const htmlLower = html.toLowerCase();
  let pos = startPos;
  while (pos < html.length) {
    const idx = htmlLower.indexOf(patternLower, pos);
    if (idx === -1) return -1;
    const afterIdx = idx + pattern.length;
    if (afterIdx < html.length) {
      const ch = html[afterIdx];
      if (ch === ">" || ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        return idx;
      }
    }
    pos = idx + 1;
  }
  return -1;
}
function extractAttribute(tagContent, attrName) {
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
    "i"
  );
  const match = tagContent.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

// src/language/preamble.ts
var WCS_PREAMBLE = `
// --- @wcstack/state type preamble (auto-injected by vscode-wcs) ---
type _IsAny<T> = 0 extends (1 & T) ? true : false;
type _IsPlainObject<T> =
  _IsAny<T> extends true ? false :
  T extends
    | string | number | boolean | null | undefined | symbol | bigint
    | Function | Date | RegExp | Error
    | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
    | Promise<any> | readonly any[]
    ? false
    : T extends Record<string, any> ? true : false;
type _DataKeys<T> = {
  [K in keyof T & string]:
    K extends \`$\${string}\` ? never :
    _IsAny<T[K]> extends true ? K : T[K] extends Function ? never : K;
}[keyof T & string];
type _WcsPaths<T, D extends readonly any[] = []> =
  D["length"] extends 4 ? never :
  { [K in _DataKeys<T>]:
    | K
    | (T[K] extends readonly (infer E)[]
        ? _IsPlainObject<E> extends true
          ? \`\${K}.*\` | _WcsSubPaths<E, \`\${K}.*.\`, [...D, 0]>
          : \`\${K}.*\`
        : _IsPlainObject<T[K]> extends true
          ? _WcsSubPaths<T[K], \`\${K}.\`, [...D, 0]>
          : never)
  }[_DataKeys<T>];
type _WcsSubPaths<T, P extends string, D extends readonly any[]> =
  _WcsPaths<T, D> extends infer R extends string ? \`\${P}\${R}\` : never;
type _WcsPathValue<T, P extends string> =
  P extends keyof T ? T[P]
  : P extends \`\${infer K}.*\`
    ? K extends keyof T ? T[K] extends readonly (infer E)[] ? E : never : never
  : P extends \`\${infer K}.\${infer R}\`
    ? K extends keyof T
      ? T[K] extends readonly (infer E)[]
        ? R extends \`*.\${infer S}\` ? _WcsPathValue<E, S> : R extends "*" ? E : never
        : T[K] extends Record<string, any> ? _WcsPathValue<T[K], R> : never
      : never
    : never;
type _WcsPathAccessor<T> = { [P in _WcsPaths<T>]: _WcsPathValue<T, P> };
type _WcsStreamStatus = "idle" | "active" | "done" | "error";
interface WcsStateApi {
  $getAll<V = any>(path: string, indexes?: number[]): V[];
  $setAll<V = any>(path: string, indexes: number[], value: V | ((current: V, ...indexes: number[]) => V | undefined)): number;
  $setAll<V = any>(path: string, indexes: number[], values: readonly V[], options: { spread: true }): number;
  $postUpdate(path: string): void;
  $resolve(path: string, indexes: number[], value?: any): any;
  $trackDependency(path: string): void;
  $untrackDependency<T>(fn: () => T): T;
  readonly $stateElement: HTMLElement;
  readonly $command: Record<string, { emit(...args: any[]): any }>;
  readonly $streamStatus: Record<string, _WcsStreamStatus>;
  readonly $streamError: Record<string, unknown>;
  readonly [key: \`$streamStatus.\${string}\`]: _WcsStreamStatus;
  readonly [key: \`$streamError.\${string}\`]: unknown;
  readonly $1: number; readonly $2: number; readonly $3: number;
  readonly $4: number; readonly $5: number; readonly $6: number;
  readonly $7: number; readonly $8: number; readonly $9: number;
}
type _WcsThis<T> = T & WcsStateApi & _WcsPathAccessor<T>;
// $listKeys: { "<listPath>": "<field>" | (row) => key }\uFF08list/listKeys.ts\uFF09\u3002
// \u30AD\u30FC\u6307\u5B9A\u306E\u95A2\u6570\u5F15\u6570\u306B\u6587\u8108\u578B\u3092\u4E0E\u3048\u308B\u305F\u3081\u3060\u3051\u306E\u5BA3\u8A00\uFF08noImplicitAny \u4E0B\u306E\u507D\u30A8\u30E9\u30FC\u56DE\u907F\uFF09\u3002
type _WcsListKeys = Record<string, string | ((row: any) => unknown)>;
// $watch: { "<path>": (cur, prev, ...indexes) => void }\uFF08watch/processWatchDeclaration.ts\uFF09\u3002
// \u30CF\u30F3\u30C9\u30E9\u5F15\u6570\u306B\u6587\u8108\u578B\u3092\u4E0E\u3048\u308B\u305F\u3081\u3060\u3051\u306E\u5BA3\u8A00\uFF08$listKeys \u3068\u540C\u3058\u7406\u7531\uFF09\u3002
// this \u306F ThisType<_WcsThis<T>> \u306B\u3088\u308A state \u578B\u306B\u306A\u308B\u3002
type _WcsWatch = Record<string, (cur: any, prev: any, ...indexes: number[]) => void>;
function defineState<T extends Record<string, any>>(
  def: T & { $listKeys?: _WcsListKeys; $watch?: _WcsWatch } & ThisType<_WcsThis<T>>
): T { return def; }
// --- end preamble ---
`;
var WCS_PREAMBLE_LENGTH = WCS_PREAMBLE.length;

// src/language/plugin.ts
var fullFeatures = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true
};
function pathOfScriptId(id) {
  return typeof id === "string" ? id : id.path;
}
function createWcsLanguagePlugin(stateTagName = "wcs-state", options = {}) {
  const tscMode = options.mode === "tsc";
  const build = (html) => {
    const blocks = parseWcsScriptBlocks(html, stateTagName);
    if (blocks.length === 0) return tscMode ? createWcsHtmlVirtualCodeForTsc([], html) : void 0;
    return tscMode ? createWcsHtmlVirtualCodeForTsc(blocks, html) : createWcsHtmlVirtualCode(blocks, html);
  };
  return {
    getLanguageId(id) {
      const path = pathOfScriptId(id);
      if (path.endsWith(".html") || path.endsWith(".htm")) {
        return "html";
      }
      return void 0;
    },
    createVirtualCode(_id, languageId, snapshot, _ctx) {
      if (languageId !== "html") return void 0;
      return build(snapshot.getText(0, snapshot.getLength()));
    },
    updateVirtualCode(_id, _virtualCode, newSnapshot, _ctx) {
      return build(newSnapshot.getText(0, newSnapshot.getLength()));
    },
    typescript: tscMode ? {
      extraFileExtensions: [
        {
          extension: "html",
          isMixedContent: true,
          scriptKind: 7
          /* ts.ScriptKind.Deferred */
        }
      ],
      // tsc: 合成スクリプト 1 本をこのファイルのサービススクリプトにする。
      // getExtraServiceScripts は**定義しない** — proxyCreateProgram は存在するだけで
      // 「not available in this use case」を出力する。
      getServiceScript(root) {
        const combined = root.embeddedCodes?.find((code) => code.id === COMBINED_SCRIPT_ID);
        if (combined === void 0) return void 0;
        return {
          code: combined,
          extension: ".ts",
          scriptKind: 3
          /* ts.ScriptKind.TS */
        };
      }
    } : {
      extraFileExtensions: [
        {
          extension: "html",
          isMixedContent: true,
          scriptKind: 7
          /* ts.ScriptKind.Deferred */
        }
      ],
      getServiceScript(_root) {
        return void 0;
      },
      getExtraServiceScripts(fileName, root) {
        const scripts = [];
        for (const embedded of root.embeddedCodes ?? []) {
          if (embedded.id.startsWith("wcs-script-")) {
            scripts.push({
              fileName: fileName + ".__" + embedded.id + ".ts",
              code: embedded,
              extension: ".ts",
              scriptKind: 3
              // ts.ScriptKind.TS
            });
          }
        }
        return scripts;
      }
    }
  };
}
var COMBINED_SCRIPT_ID = "wcs-combined";
function createWcsHtmlVirtualCodeForTsc(blocks, html) {
  const { code, mappings } = blocks.length === 0 ? { code: "", mappings: [] } : buildCombinedScript(blocks);
  const combined = {
    id: COMBINED_SCRIPT_ID,
    languageId: "typescript",
    snapshot: {
      getText(start, end) {
        return code.slice(start, end);
      },
      getLength() {
        return code.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings
  };
  return {
    id: "root",
    languageId: "html",
    snapshot: {
      getText(start, end) {
        return html.slice(start, end);
      },
      getLength() {
        return html.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings: [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [html.length],
      data: htmlFeatures
    }],
    embeddedCodes: [combined]
  };
}
var IMPORT_STATEMENT_RE = /import\s+(?:[\s\S]*?\sfrom\s*)?['"][^'"]+['"]\s*;?/g;
function buildCombinedScript(blocks) {
  let code = WCS_PREAMBLE;
  const mappings = [];
  const map = (sourceOffset, generatedOffset, length) => {
    if (length <= 0) return;
    mappings.push({ sourceOffsets: [sourceOffset], generatedOffsets: [generatedOffset], lengths: [length], data: fullFeatures });
  };
  const bodies = blocks.map((block) => {
    const stripped = stripWcsImport(block.content);
    const userCode = stripped.replace(IMPORT_STATEMENT_RE, (match, offset) => {
      map(block.contentStart + offset, code.length, match.length);
      code += match + "\n";
      return " ".repeat(match.length);
    });
    return { block, userCode };
  });
  bodies.forEach(({ block, userCode }, index) => {
    code += "{\n";
    const decl = `const __wcs_state_${index} = `;
    const exportMatch = /export\s+default\s+/.exec(userCode);
    if (exportMatch === null) {
      map(block.contentStart, code.length, userCode.length);
      code += userCode;
    } else {
      const before = userCode.slice(0, exportMatch.index);
      const afterExport = userCode.slice(exportMatch.index + exportMatch[0].length);
      const afterExportSource = block.contentStart + exportMatch.index + exportMatch[0].length;
      map(block.contentStart, code.length, before.length);
      code += before + decl;
      if (/\bdefineState\s*\(/.test(userCode)) {
        map(afterExportSource, code.length, afterExport.length);
        code += afterExport;
      } else {
        const trailingMatch = afterExport.match(/(\s*;?\s*)$/);
        const trailing = trailingMatch ? trailingMatch[0] : "";
        const objectPart = afterExport.slice(0, afterExport.length - trailing.length);
        code += "defineState(";
        map(afterExportSource, code.length, objectPart.length);
        code += objectPart + ")";
        map(afterExportSource + objectPart.length, code.length, trailing.length);
        code += trailing;
      }
    }
    code += `
void __wcs_state_${index};
}
`;
  });
  return { code, mappings };
}
var htmlFeatures = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: false,
  format: false
};
function createWcsHtmlVirtualCode(blocks, html) {
  const embeddedCodes = blocks.map(
    (block, index) => createScriptVirtualCode(block, index)
  );
  return {
    id: "root",
    languageId: "html",
    snapshot: {
      getText(start, end) {
        return html.slice(start, end);
      },
      getLength() {
        return html.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings: [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [html.length],
      data: htmlFeatures
    }],
    embeddedCodes
  };
}
function createScriptVirtualCode(block, index) {
  const userCode = stripWcsImport(block.content);
  const { code: wrappedCode, mappings } = wrapWithDefineState(userCode, block);
  return {
    id: `wcs-script-${index}`,
    languageId: "typescript",
    snapshot: {
      getText(start, end) {
        return wrappedCode.slice(start, end);
      },
      getLength() {
        return wrappedCode.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings
  };
}
function wrapWithDefineState(userCode, block) {
  const alreadyWrapped = /\bdefineState\s*\(/.test(userCode);
  if (alreadyWrapped) {
    const code2 = WCS_PREAMBLE + userCode;
    return {
      code: code2,
      mappings: [{
        sourceOffsets: [block.contentStart],
        generatedOffsets: [WCS_PREAMBLE_LENGTH],
        lengths: [block.content.length],
        data: fullFeatures
      }]
    };
  }
  const exportDefaultRe = /export\s+default\s+/;
  const match = exportDefaultRe.exec(userCode);
  if (!match) {
    const code2 = WCS_PREAMBLE + userCode;
    return {
      code: code2,
      mappings: [{
        sourceOffsets: [block.contentStart],
        generatedOffsets: [WCS_PREAMBLE_LENGTH],
        lengths: [block.content.length],
        data: fullFeatures
      }]
    };
  }
  const exportEnd = match.index + match[0].length;
  const before = userCode.slice(0, exportEnd);
  const after = userCode.slice(exportEnd);
  const trailingMatch = after.match(/(\s*;?\s*)$/);
  const objectPart = trailingMatch ? after.slice(0, after.length - trailingMatch[0].length) : after;
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const wrapPrefix = "defineState(";
  const wrapSuffix = ")";
  const code = WCS_PREAMBLE + before + wrapPrefix + objectPart + wrapSuffix + trailing;
  const preambleLen = WCS_PREAMBLE_LENGTH;
  const mappings = [{
    sourceOffsets: [
      block.contentStart,
      // before の HTML 開始位置
      block.contentStart + exportEnd,
      // objectPart の HTML 開始位置
      block.contentStart + exportEnd + objectPart.length
      // trailing の HTML 開始位置
    ],
    generatedOffsets: [
      preambleLen,
      // before の仮想コード開始位置
      preambleLen + before.length + wrapPrefix.length,
      // objectPart の仮想コード開始位置
      preambleLen + before.length + wrapPrefix.length + objectPart.length + wrapSuffix.length
      // trailing
    ],
    lengths: [
      before.length,
      objectPart.length,
      trailing.length
    ],
    data: fullFeatures
  }];
  return { code, mappings };
}
function stripWcsImport(code) {
  return code.replace(
    /import\s*\{[^}]*\}\s*from\s*['"](?:@wcstack\/state|https?:\/\/[^'"]*\/@wcstack\/state(?:@[^'"/]*)?(?:\/[^'"]*)?)['"];?[ \t]*/g,
    (match) => match.replace(/[^\n]/g, " ")
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WCS_PREAMBLE,
  WCS_PREAMBLE_LENGTH,
  createWcsLanguagePlugin,
  stripWcsImport
});
//# sourceMappingURL=tsc-core.cjs.map
