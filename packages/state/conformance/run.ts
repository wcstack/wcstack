/**
 * Runs conformance scenarios against whichever engine registered `<wcs-state>` in this
 * test file (the current 3.3.0 dist when recording the golden, state-next when comparing).
 * Both engines are driven only through the public element API: setInitialState,
 * connectedCallbackPromise, createState and getBindingsReady.
 */
import type { Api, Scenario } from "./scenarios";
import { defineFixtures } from "./fixtures";

export interface Snapshot {
  label: string;
  dom?: string;
  error?: string;
}

export interface EngineEntry {
  getBindingsReady(root: Node): Promise<void>;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * The user-visible DOM as a string. Engine bookkeeping is ignored: comments (anchors),
 * the data-wcs attribute, whitespace-only text and the order of class tokens. Form
 * controls add their live value / checked state, which innerHTML does not show.
 */
export function serialize(root: Node): string {
  let out = "";
  const visit = (n: Node): void => {
    for (let c = n.firstChild; c !== null; c = c.nextSibling) {
      if (c.nodeType === 3) {
        const t = (c as Text).data.replace(/\s+/g, " ").trim();
        if (t !== "") out += escapeText(t) + "|";
        continue;
      }
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      const tag = el.localName;
      if (tag === "template" || tag === "script" || tag === "style") continue;
      // the element itself is not output; markup written inside it is part of the page
      if (tag === "wcs-state") {
        visit(el);
        continue;
      }
      const attrs: [string, string][] = [];
      for (const a of Array.from(el.attributes)) {
        if (a.name === "data-wcs") continue;
        const v = a.name === "class" ? a.value.split(/\s+/).filter(Boolean).sort().join(" ") : a.value;
        if (a.name === "class" && v === "") continue;
        attrs.push([a.name, v]);
      }
      const any = el as any;
      if (tag === "input" || tag === "textarea" || tag === "select") attrs.push([":value", String(any.value)]);
      if (tag === "input" && (any.type === "checkbox" || any.type === "radio")) attrs.push([":checked", String(any.checked)]);
      // wc-bindable members: what state wrote to the element (or did not)
      const bd = (el.constructor as any).wcBindable;
      if (bd !== null && typeof bd === "object") {
        const names = new Set<string>([...(bd.properties ?? []), ...(bd.inputs ?? [])].map((m: { name: string }) => m.name));
        for (const name of names) {
          const v = any[name];
          attrs.push([`:${name}`, v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)]);
        }
      }
      attrs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      out += `<${tag}${attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("")}>`;
      // an open shadow root (a component's own view)
      if (el.shadowRoot !== null) {
        out += "<#shadow>";
        visit(el.shadowRoot);
        out += "</#shadow>";
      }
      visit(el);
      out += `</${tag}>`;
    }
  };
  visit(root);
  return out;
}

let seq = 0;

export async function runScenario(s: Scenario, engine: EngineEntry): Promise<Snapshot[]> {
  defineFixtures();
  const host = document.createElement(`conformance-host-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = s.html;
  document.body.appendChild(host);
  const out: Snapshot[] = [];
  try {
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(s.state());
    await el.connectedCallbackPromise;
    await engine.getBindingsReady(root);
    await flush();
    out.push({ label: "initial", dom: serialize(root) });
    const api: Api = {
      write: (fn) => el.createState("writable", fn),
      click: (sel) => (root.querySelector(sel) as HTMLElement).click(),
      input: (sel, value) => {
        const i = root.querySelector(sel) as HTMLInputElement;
        i.value = value;
        i.dispatchEvent(new Event("input", { bubbles: true }));
      },
      call: (sel, method, ...args) => (root.querySelector(sel) as any)[method](...args),
      reset: (state) => el.setInitialState(state),
      change: (sel, apply) => {
        const i = root.querySelector(sel) as HTMLInputElement;
        apply(i);
        i.dispatchEvent(new Event("change", { bubbles: true }));
      },
    };
    for (const step of s.steps ?? []) {
      try {
        await step.run(api);
        await flush();
        out.push({ label: step.label, dom: serialize(root) });
      } catch (e) {
        out.push({ label: step.label, error: String((e as Error)?.message ?? e) });
      }
    }
  } catch (e) {
    out.push({ label: "initial", error: String((e as Error)?.message ?? e) });
  } finally {
    host.remove();
  }
  return out;
}
