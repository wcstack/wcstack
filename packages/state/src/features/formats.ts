/**
 * The formats add-on (@wcstack/state/features/formats): the 38 filters that compute and show a value
 * (display, string shaping, dates — locale-aware —, arithmetic, conversions, missing values).
 */
import { hooks, type Feature } from "../hooks";
import { installFormats } from "../filters/formats";

export const formats: Feature = { name: "formats", hooks, install: installFormats };
export default formats;
