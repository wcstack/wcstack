/**
 * commandArgumentValidator.ts — `wcs/command-event-argument` (warning): a command that takes data, wired straight to
 * an event.
 *
 * `on*: $command.<name>` emits the token with `(event, ...listIndexes)` (state's engine.ts `emitCommand`), and every
 * `command.<method>: $command.<name>` subscriber is called with those arguments as they are (dom/wc.ts
 * `attachCommand`: `target[method](...args)`). For a command that takes no argument that is the short way to wire a
 * button. For one that takes data the event lands in the data's place, and the failure shows far from its cause (the
 * stamp-rally seam app): `<wcs-screen-orientation>`'s `lock(event)` and `<wcs-share>`'s `share(event)` end as the
 * browser's TypeError in `error`, `<wcs-contacts>`'s `select(event)` likewise, and `<wcs-credential>`'s `get(event)`
 * resolves `null` without a word.
 *
 * Reported at the `on*:` binding, when a subscriber of its token in the document is a built-in tag's command whose
 * method declares parameters — the catalog records each command's `Function.length` (generated/builtinTags.generated.ts
 * `commandArity`, from the built class). Not reported:
 *   - a command that ignores a first argument that is not the kind of value it takes (`EVENT_TOLERANT_COMMANDS`, each
 *     with its reason): `<wcs-fetch>`'s `fetch`, `<wcs-ws>`'s `close`, `<wcs-idle>`'s `start`, `<wcs-notify>`'s `close`
 *   - a native element's command (`command.showModal:` on a `<dialog>`): the `native-commands` add-on calls it with no
 *     arguments when the first one is an `Event`
 *   - a command of an element the page defines itself: what its method takes is not known here
 *   - a token emitted from a script (`this.$command.x.emit(…)`): the arguments are the author's
 *
 * pure (no DOM, no vscode).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { parseBindTextWithPositions } from '../core/parser/positionalParser.js';
import { findIgnoredRanges } from '../language/htmlParse.js';
import { findAllBindAttributes } from './bindingValidator.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';

const COMMAND_PREFIX = '$command.';

/**
 * The commands that declare parameters and still take an `Event` in the first one's place without harm, as
 * `<tag>.<method>`, each with why: the element ignores a first argument that is not the kind of value it takes, so a
 * button wired straight to the token does what calling the command with no argument does. A command joins this list
 * when its element does that — not because its parameter is optional (`<wcs-credential>`'s `get(options?)` reads the
 * event as its options and resolves `null`).
 */
const EVENT_TOLERANT_COMMANDS: ReadonlyMap<string, string> = new Map([
  // fetch(url?, init?): a url that is not a string is ignored, and the element's own url is fetched (4.24 — the fetch
  // README, "Commands")
  ['wcs-fetch.fetch', 'a url that is not a string is ignored'],
  // close(code?, reason?): a code that is not a number is ignored (4.25 — up to 4.24 `WebSocket.close(event)` threw
  // `InvalidAccessError`). A "Disconnect" button wired straight to the token is the natural form
  ['wcs-ws.close', 'a code that is not a number is ignored'],
  // start(threshold?): a threshold that is not a number is ignored, and the element's `threshold` applies (4.25)
  ['wcs-idle.start', 'a threshold that is not a number is ignored'],
  // close(tag?): a tag that is not a string closes nothing — as `close()` with no tag does
  ['wcs-notify.close', 'a tag that is not a string closes nothing'],
]);

/** A built-in tag's command that declares parameters, subscribed to a token. */
interface Receiver {
  readonly tag: string;
  readonly method: string;
}

export function validateCommandArguments(html: string, bindAttribute: string = 'data-wcs', locale?: string): WcsDiagnostic[] {
  if (!html.includes(COMMAND_PREFIX)) return [];
  const receivers = new Map<string, Receiver[]>();
  const emitters: { token: string; property: string; start: number; end: number }[] = [];
  // the runtime reads nothing in a `data-wcs-ignore` element as bindings
  const ignored = findIgnoredRanges(html, bindAttribute);
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    if (!attr.value.includes(COMMAND_PREFIX)) continue;
    if (ignored.some(([start, end]) => attr.valueStart >= start && attr.valueStart < end)) continue;
    const tag = attr.tagName ?? '';
    const arity = Object.prototype.hasOwnProperty.call(BUILTIN_TAGS, tag) ? BUILTIN_TAGS[tag].commandArity : undefined;
    for (const binding of parseBindTextWithPositions(attr.value)) {
      const parsed = binding.parsed;
      if (parsed === null || !parsed.statePathName.startsWith(COMMAND_PREFIX)) continue;
      const token = parsed.statePathName;
      const segments = parsed.propSegments;
      if (parsed.bindingType === 'event') {
        // (`eventToken.<member>:` names an event token, never a command token)
        if (segments[0] === 'eventToken' || binding.propRange === null) continue;
        emitters.push({
          token,
          property: parsed.propName,
          start: attr.valueStart + binding.propRange.start,
          end: attr.valueStart + binding.propRange.end,
        });
      } else if (segments[0] === 'command' && segments.length === 2 && arity !== undefined) {
        const method = segments[1];
        if ((arity[method] ?? 0) === 0 || EVENT_TOLERANT_COMMANDS.has(`${tag}.${method}`)) continue;
        const list = receivers.get(token);
        if (list === undefined) receivers.set(token, [{ tag, method }]);
        else if (!list.some((r) => r.tag === tag && r.method === method)) list.push({ tag, method });
      }
    }
  }
  if (emitters.length === 0 || receivers.size === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const emitter of emitters) {
    const list = receivers.get(emitter.token);
    if (list === undefined) continue;
    const first = list[0];
    out.push({
      code: WcsDiagnosticCode.CommandEventArgument,
      start: emitter.start,
      end: emitter.end,
      severity: 'warning',
      tag: first.tag,
      member: first.method,
      message: msgs.commandEventArgument(emitter.property, emitter.token, first.tag, first.method, list.length - 1),
    });
  }
  return out;
}
