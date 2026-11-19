// The SPA's scripts. Module evaluation follows import order: our element and every I/O package
// first, @wcstack/state LAST (a command emitted before an element is defined is dropped).
import "./styles.css";
import "./components/midori-qty.ts";
import "@wcstack/timer/auto";
import "@wcstack/debounce/auto";
import "@wcstack/storage/auto";
import "@wcstack/fetch/auto";
import "@wcstack/sse/auto";
import "@wcstack/router/auto";
import "@wcstack/state/auto";
