// Internal property names the bundles shorten (esbuild `mangleProps`): about 1 KB of the
// core's gzip size. One build shortens a name the same way in every output, so the add-ons of
// the split build (`features/*`) reach the core through these names too.
//
// Only names nothing outside the build reads or writes belong here. Never:
// - a DOM name, a protocol key (transition-runner, binder, wc-bindable declarations), a config
//   key, a public method, or a field DevTools may reach (`engine`, the registry's `factory` /
//   `arity`);
// - a key of an object shared with @wcstack/state's bundle (the naming ledger's `counter` /
//   `assigned` / `warned`);
// - a built-in's method or property the bundle touches (`resolve`, `apply`, `map`, `has`, a
//   RegExp match's `index`, a stream reader's `read`);
// - a name code reaches by a string (the hook slots: addHook indexes them by name).
// An object the author writes or reads is accessed with quoted keys (a `$stream` definition,
// the `$errorCallback` info). __tests__/bundle.test.ts and split.test.ts run the conformance
// scenarios on builds with this list — they caught `index`, `read`, the hook slots and a
// `$stream` definition's `initial`.
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
  watchRendered resolveConnected rejectConnected receiveInitial report rendered sync update dispose write
  children filters forget resetList applyPass deliverFn delegate
`.trim().split(/\s+/);

export const MANGLE_PROPS = new RegExp(`^(?:${NAMES.join("|")})$`);
