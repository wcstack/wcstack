// Internal property names the bundles shorten (esbuild `mangleProps`): about 1 KB of the
// core's gzip size. Only names nothing outside the bundle reads or writes belong here —
// never a DOM name, a protocol key (transition-runner, binder, wc-bindable declarations),
// a config key, a public method, or a field another bundle or DevTools may reach
// (`engine`, and the filter registry's `factory` / `arity`), nor a key of an object shared
// with @wcstack/state's bundle (the naming ledger's `counter` / `assigned` / `warned`), nor a
// built-in's method or property (`resolve`, `apply`, `map`, `has`, a RegExp match's `index` — the
// bundle test caught that one). An object the author reads is
// written with quoted keys (the `$errorCallback` info). An add-on built as a separate
// bundle must go through public hooks, or be built with the same mangle cache.
// __tests__/bundle.test.ts runs the conformance scenarios on a bundle built with this list.
const NAMES = `
  pattern patterns depth kind lists strategy initial branches parentRow delegated chain owner exclude alive
  propSegments propModifiers propName statePathName inFilters outFilters twoWay untracked
  readUntracked readGetter readData evalGetter applyBinding visitGetter walkDependents walkChange enqueueBound
  enqueue enqueueSlots slotBinding schedule noteRendered callHook callHookDetached
  rootBindings rootLists rootList childList rootValue dirtyLists scheduled frames depthNow slotCount readonlyDepth
  blockKey dependents dependentSet addDependent crossSources indexDependent underGetter indexWatchers
  eqSubs eqIndexWatchers eqIndexKeys rootEqSubs subscribeEq rekeyEq rekeyEqUnder rekeyEqIndex syncListsUnder
  rowRemoved indexChanged invalidate onWrite onIndexChange beforeDrain resetRow forSubtree forAllRows forRowsUnder
  onPatternCreated registerAccessors emitCommand fireEventToken indexesOf resolveApi contextIndexes forMatches
  drainFn untrackedFn eqIndexFn eqFn eqPathFn dependOnFn getAllFn setAllFn resolveFn postUpdateFn
  subscribers elementValue writeBack typeName removeNodes viewOf isUnder rowViews queued applying
  nodePaths scratch lazy specs slots bound cleanups
  bindingType node path row ctx plan list view rows item extra cache slot custom prevent stop init anchor
  first last nodes current token events top parent byPath queue errors filterName setter listener draining
  watchRendered resolveConnected rejectConnected receiveInitial report rendered sync update dispose read write
  children filters forget resetList applyPass deliverFn delegate
`.trim().split(/\s+/);

export const MANGLE_PROPS = new RegExp(`^(?:${NAMES.join("|")})$`);
