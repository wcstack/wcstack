// Setup file for Vitest.
//
// happy-dom does not implement the EyeDropper API (there is no global
// `EyeDropper` constructor), so each test installs its own fake via the
// helpers in mocks.ts. This file is intentionally minimal — see mocks.ts for
// the controllable double.
