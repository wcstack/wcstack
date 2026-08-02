// Setup file for Vitest.
//
// happy-dom implements neither the Web MIDI API nor ElementInternals, so each
// test installs its own mock via the helpers in mocks.ts. This file only shims
// what must exist before any element is constructed.
import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
