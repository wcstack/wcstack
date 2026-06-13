import { config } from "./config.js";
import type { WcsSpeak } from "./components/Speak.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // A misconfigured triggerAttribute (e.g. one with a space) makes the attribute
  // selector invalid and closest() throw SyntaxError; guard so a bad config
  // disables only this shortcut rather than killing every document click handler.
  let triggerElement: Element | null;
  try {
    triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  } catch {
    return;
  }
  if (!triggerElement) return;

  const speakId = triggerElement.getAttribute(config.triggerAttribute);
  if (!speakId) return;

  // Resolve the registered constructor at call time instead of importing Speak as
  // a value, avoiding a components/Speak.ts ⇄ autoTrigger.ts cycle
  // (Speak.connectedCallback() calls registerAutoTrigger()). instanceof against
  // the customElements registry keeps the same identity guarantee.
  const SpeakCtor = customElements.get(config.tagNames.speak);
  const speakElement = document.getElementById(speakId);
  if (!SpeakCtor || !(speakElement instanceof SpeakCtor)) return;

  // The text to speak comes from the trigger element: an explicit `data-speaktext`
  // attribute wins, otherwise the element's text content. This keeps the
  // click-driven shortcut declarative without inventing a payload channel.
  const explicit = triggerElement.getAttribute("data-speaktext");
  // textContent is always a string for an Element; the cast avoids an
  // unreachable null-coalesce branch. speak() tolerates a non-string anyway.
  // The textContent fallback is trimmed (HTML indentation otherwise leaks leading
  // / trailing whitespace into the utterance); an explicit data-speaktext is kept
  // verbatim so an author can deliberately include surrounding spaces.
  const text = explicit !== null ? explicit : (triggerElement.textContent as string).trim();

  event.preventDefault();
  (speakElement as WcsSpeak).speak(text);
}

export function registerAutoTrigger(): void {
  if (registered) return;
  registered = true;
  document.addEventListener("click", handleClick);
}

export function unregisterAutoTrigger(): void {
  if (!registered) return;
  registered = false;
  document.removeEventListener("click", handleClick);
}
