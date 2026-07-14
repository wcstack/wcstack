import { getBindingSession } from "../bindings/BindingSession.js";
import { getDefinitionCoordinator } from "../bindings/DefinitionCoordinator.js";
import { getCustomElementRegistry } from "../platform/customElementRegistry.js";
import { IBindingInfo } from "../types.js";
import { applyChangeFromBindings } from "./applyChangeFromBindings.js";

const scheduledBindings = new WeakSet<IBindingInfo>();

function reportFailure(tagName: string, error: unknown): void {
  console.error(`[@wcstack/state] deferred apply failed for <${tagName}>.`, error);
}

export function scheduleDeferredApply(binding: IBindingInfo, tagName: string): void {
  if (scheduledBindings.has(binding)) return;
  scheduledBindings.add(binding);

  const applyLatest = (): void => {
    scheduledBindings.delete(binding);
    applyChangeFromBindings([binding]);
  };
  const reject = (error: unknown): void => {
    scheduledBindings.delete(binding);
    reportFailure(tagName, error);
  };

  const session = getBindingSession(binding);
  if (session !== null) {
    const cancel = session.deferUntilDefined(binding.replaceNode, tagName, applyLatest, reject);
    if (!session.addTeardown(binding, () => {
      scheduledBindings.delete(binding);
      cancel();
    })) {
      scheduledBindings.delete(binding);
      cancel();
    }
    return;
  }

  // Compatibility fallback for direct applyChange() callers outside a session.
  const registry = getCustomElementRegistry();
  if (registry === null) {
    scheduledBindings.delete(binding);
    reportFailure(tagName, new Error("CustomElementRegistry is unavailable."));
    return;
  }
  getDefinitionCoordinator(registry).wait(tagName, () => {
    if (!binding.replaceNode.isConnected) {
      scheduledBindings.delete(binding);
      return;
    }
    applyLatest();
  }, reject);
}
