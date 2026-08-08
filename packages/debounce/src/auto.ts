// Single-tag bootstrap entry.
//
// Rollup bundles this self-contained into dist/auto.min.js, so a page can
// activate the component with one <script> tag and a single `integrity`
// attribute covers every line that runs. Do not import from a sibling dist
// file here — a relative import would fall outside the entry's SRI hash.
import { bootstrapDebounce } from "./exports";

bootstrapDebounce();
