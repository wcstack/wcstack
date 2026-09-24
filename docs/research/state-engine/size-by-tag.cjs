// Attribute the minified bytes of packages/state/dist/auto.min.js to feature tags
// through its source map (each generated span up to the next segment goes to the
// segment's source). Approximate: gzip is estimated proportionally, not measured.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const PKG = require("path").resolve(__dirname, "../../../packages/state");
const { decode } = require(PKG + "/node_modules/@jridgewell/sourcemap-codec");

const code = fs.readFileSync(PKG + "/dist/auto.min.js", "utf8");
const map = JSON.parse(fs.readFileSync(PKG + "/dist/auto.min.js.map", "utf8"));
const lines = code.split("\n");
const decoded = decode(map.mappings);

// ordered rules: first match wins. Paths are relative to src/.
const RULES = [
  [/^webComponent\/(volume|volumeLifecycle|volumeShared|mount|mountEntries|mountScope|rootMountBinding|ownKeyShadow)\.ts$/, "C.mount"],
  [/^webComponent\//, "X.component"],
  [/^dcc\//, "X.dcc"],
  [/^(ssr\/|components\/Ssr\.ts|apply\/ssrPropertyStore\.ts|protocol\/ssrSnapshot\.ts|core\/ssrHooks\.ts|features\/ssr\.ts)/, "X.ssr"],
  [/^stream\//, "X.stream"],
  [/^watch\//, "X.watch"],
  [/^scan\//, "X.scan"],
  [/^recursion\//, "X.recursion"],
  [/^list\/(listKeys|mergeKeyedList)\.ts$/, "X.listkeys"],
  [/^list\/swapBaselineList\.ts$/, "X.elemwrite"],
  [/^dependency\/keyedDependency\.ts$/, "C.eq"],
  [/^(devtools\/|platform\/devtoolsSink\.ts|features\/devtools\.ts)/, "X.devtools"],
  [/^propagation\//, "X.propagation"],
  [/^(command\/|token\/|apply\/applyChangeToCommand\.ts)/, "X.cmdtoken"],
  [/^event\/(EventToken|eventTokenHandler|eventTokenRegistry|processEventTokensDeclaration|processOnDeclaration)\.ts$/, "X.evttoken"],
  [/^event\/getInputAttributeMirror\.ts$/, "X.wcbindable"],
  [/^(protocol\/wcBindable|protocol\/wcBindableReader|apply\/applyChangeToWebComponent|bindings\/initialSync|bindings\/DefinitionCoordinator)/, "X.wcbindable"],
  [/^event\//, "C.event"],
  [/^protocol\/binder\.ts$|^bindings\/binder\.ts$/, "X.binder"],
  [/^(protocol\/transitionRunner|apply\/viewTransitionNaming)\.ts$/, "X.viewtransition"],
  [/^(diagnostics\/|pathDiagnostics\.ts|errorGuidance\.ts|core\/diagnosticsHooks\.ts)/, "X.diagnostics"],
  [/^trustedTypes\.ts$/, "X.trustedtypes"],
  [/^(core\/|features\/|bridge\/|entries\/)/, "X.split"],
  [/^formats\//, "C.filter-format"],
  [/^filters\//, "C.filter"],
  [/^(bindTextParser\/|mustache\/|structural\/expandShorthandPaths\.ts|declarationAliases\.ts)/, "C.grammar"],
  [/^(apply\/applyChangeToFor\.ts|list\/|structural\/)/, "C.list"],
  [/^apply\/applyChangeToIf\.ts$/, "C.if"],
  [/^apply\//, "C.bind"],
  [/^(address\/|cache\/|binding\/|bindings\/|updater\/|dependency\/)/, "C.engine(address/cache/binding/updater/dep)"],
  [/^proxy\//, "C.state+getter(proxy)"],
  [/^(components\/State\.ts|stateLoader\/|bootstrapState|registerComponents|defineState|waitForStateInitialize|stateElementByName|buildBindings|config|define\.ts|getCustomElement|polyfills|version)/, "C.init"],
];
function tagOf(src) {
  let s = src.replace(/\\/g, "/");
  const i = s.lastIndexOf("/src/");
  s = i >= 0 ? s.slice(i + 5) : s.replace(/^(\.\.\/)+/, "");
  for (const [re, tag] of RULES) if (re.test(s)) return tag;
  return "other:" + s;
}

const bytesByTag = {};
const bytesBySource = {};
for (let li = 0; li < decoded.length; li++) {
  const segs = decoded[li];
  const line = lines[li] || "";
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    const start = seg[0];
    const end = k + 1 < segs.length ? segs[k + 1][0] : line.length;
    if (seg.length < 2) continue;
    const src = map.sources[seg[1]];
    const n = Buffer.byteLength(line.slice(start, end));
    const t = tagOf(src);
    bytesByTag[t] = (bytesByTag[t] || 0) + n;
    bytesBySource[src] = (bytesBySource[src] || 0) + n;
  }
}
const total = Buffer.byteLength(code);
const gz = zlib.gzipSync(Buffer.from(code), { level: 9 }).length;
const attributed = Object.values(bytesByTag).reduce((a, b) => a + b, 0);
console.log(`auto.min.js ${total} B, gzip ${gz} B, attributed ${attributed} B`);
const rows = Object.entries(bytesByTag).sort((a, b) => b[1] - a[1]);
for (const [t, b] of rows) {
  console.log(`${t.padEnd(44)} ${String(b).padStart(7)}  ${(100 * b / attributed).toFixed(1).padStart(5)}%  ~gz ${Math.round(gz * b / attributed)}`);
}
fs.writeFileSync(path.join(__dirname, "size-by-tag.json"), JSON.stringify({ total, gzip: gz, attributed, bytesByTag, bytesBySource }, null, 1));
