// The stepper in a page without wcstack: plain DOM, typed through HTMLElementTagNameMap.
import "./components/midori-qty.ts";

const qty = document.querySelector("midori-qty");
const out = document.querySelector<HTMLOutputElement>("#out");
const count = document.querySelector<HTMLOutputElement>("#count");
if (!qty || !out || !count) throw new Error("qty-test: markup missing");
let n = 0;
qty.addEventListener("midori-qty:change", (e) => {
  out.value = String(e.detail);
  count.value = String(++n);
});
document.querySelector("#set")?.addEventListener("click", () => {
  qty.value = 4;
  out.value = String(qty.value);
});
document.querySelector("#range")?.addEventListener("click", () => {
  qty.max = 3;
  out.value = String(qty.value);
});
