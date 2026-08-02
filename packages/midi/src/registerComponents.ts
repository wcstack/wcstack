import { WcsMidi } from "./components/Midi.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.midi)) {
    customElements.define(config.tagNames.midi, WcsMidi);
  }
}
