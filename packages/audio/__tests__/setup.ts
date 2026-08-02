// Setup file for Vitest.
//
// happy-dom implements neither Web Audio nor ElementInternals. Web Audio is
// supplied per test by FakeAudioContext (injected through config.createContext),
// so this file only shims what must exist before any element is constructed.
import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
