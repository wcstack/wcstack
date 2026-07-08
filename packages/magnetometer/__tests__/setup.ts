// Setup file for Vitest.
//
// happy-dom does not implement the Generic Sensor API (Accelerometer /
// Gyroscope / Magnetometer / AmbientLightSensor), so each test installs its
// own FakeSensor via the helpers in mocks.ts. This file is intentionally
// minimal — see mocks.ts for the controllable fake.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
