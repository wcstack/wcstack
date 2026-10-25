// Builds a component's shadow tree with DOM calls. `shadowRoot.innerHTML = "…"` is a Trusted Types sink, refused
// under `require-trusted-types-for 'script'` in Chromium, Firefox and Safari (docs/csp.md §7).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  const target = tag === "template" ? el.content : el;
  for (const child of children) target.append(typeof child === "string" ? document.createTextNode(child) : child);
  return el;
}
