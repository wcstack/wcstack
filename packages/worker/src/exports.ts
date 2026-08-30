export { bootstrapWorker } from "./bootstrapWorker.js";
export { getConfig } from "./config.js";
export { WorkerCore } from "./core/WorkerCore.js";
export { WcsWorker } from "./components/Worker.js";

export type {
  IWritableConfig, IWritableTagNames, WcsWorkerErrorDetail, WcsWorkerStartOptions,
  WcsWorkerCoreValues, WcsWorkerValues, WcsWorkerInputs,
  WcsWorkerCoreCommands, WcsWorkerCommands
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — the worker is a
// command-driven owner). The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_WORKER_ERROR_CODE } from "./core/workerCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-worker")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/worker"` or a tsconfig `types` entry).
import type { WcsWorker } from "./components/Worker.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-worker": WcsWorker;
  }
}
