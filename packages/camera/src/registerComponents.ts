import { WcsCamera } from "./components/Camera.js";
import { WcsRecorder } from "./components/Recorder.js";
import { config } from "./config.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(config.tagNames.camera)) {
    registry.define(config.tagNames.camera, WcsCamera);
  }
  if (!registry.get(config.tagNames.recorder)) {
    registry.define(config.tagNames.recorder, WcsRecorder);
  }
}
