import { WcsCamera } from "./components/Camera.js";
import { WcsRecorder } from "./components/Recorder.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.camera)) {
    customElements.define(config.tagNames.camera, WcsCamera);
  }
  if (!customElements.get(config.tagNames.recorder)) {
    customElements.define(config.tagNames.recorder, WcsRecorder);
  }
}
