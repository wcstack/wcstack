// Setup file for Vitest.
//
// happy-dom does not implement DeviceOrientationEvent.requestPermission (the
// iOS-only static method), so each test installs its own controllable fake via
// the helpers in mocks.ts. This file is intentionally minimal.
