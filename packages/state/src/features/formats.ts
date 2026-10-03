/** The formats add-on (@wcstack/state/features/formats): the 23 formatting filters (locale-aware). */
import type { Feature } from "../hooks";
import { installFormats } from "../filters/formats";

export const formats: Feature = { name: "formats", install: installFormats };
export default formats;
