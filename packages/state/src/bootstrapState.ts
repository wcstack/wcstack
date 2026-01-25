import { registerComponents } from "./registerComponents";
import { registerHandler } from "./registerHandler";

export function bootstrapState() {
  registerComponents();
  registerHandler();
}