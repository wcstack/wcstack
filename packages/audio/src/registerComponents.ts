import { config } from "./config.js";
import { WcsAudio } from "./components/Audio.js";
import { WcsVoice } from "./components/Voice.js";
import {
  WcsAnalyser, WcsBiquad, WcsDelay, WcsEnv, WcsGain, WcsLfo, WcsNoise, WcsOsc,
  WcsShaper,
} from "./components/nodes.js";

export function registerComponents(): void {
  const definitions: [string, CustomElementConstructor][] = [
    [config.tagNames.audio, WcsAudio],
    [config.tagNames.voice, WcsVoice],
    [config.tagNames.osc, WcsOsc],
    [config.tagNames.noise, WcsNoise],
    [config.tagNames.biquad, WcsBiquad],
    [config.tagNames.gain, WcsGain],
    [config.tagNames.delay, WcsDelay],
    [config.tagNames.shaper, WcsShaper],
    [config.tagNames.env, WcsEnv],
    [config.tagNames.lfo, WcsLfo],
    [config.tagNames.analyser, WcsAnalyser],
  ];
  for (const [tag, ctor] of definitions) {
    if (!customElements.get(tag)) customElements.define(tag, ctor);
  }
}
