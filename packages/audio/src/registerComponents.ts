import pkg from "../package.json" with { type: "json" };
import { config } from "./config.js";
import { WcsAudio } from "./components/Audio.js";
import { WcsVoice } from "./components/Voice.js";
import {
  WcsAnalyser, WcsBiquad, WcsDelay, WcsEnv, WcsGain, WcsLfo, WcsNoise, WcsOsc,
  WcsShaper,
} from "./components/nodes.js";
import { defineElements } from "./protocol/defineElement.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  defineElements(registry, `${pkg.name}@${pkg.version}`, [
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
  ]);
}
