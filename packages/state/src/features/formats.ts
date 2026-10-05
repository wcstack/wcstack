/**
 * The formats add-on (@wcstack/state/features/formats): the 37 filters that compute and show a value
 * (display, string shaping, dates — locale-aware —, arithmetic, conversions, missing values).
 */
import type { Feature } from "../hooks";
import { installFormats } from "../filters/formats";

export const formats: Feature = { name: "formats", install: installFormats };
export default formats;
