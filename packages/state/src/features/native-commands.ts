/**
 * The native-commands add-on (@wcstack/state/features/native-commands): `command.<method>:` on a
 * native element (README "Native element commands") — `showModal` / `close` on a `<dialog>`,
 * `focus` on an `<input>`, `play` / `pause` on a `<video>`, from the table in native/commands.ts.
 * Without it a native element's `command.` fails as before (`[wcs/token-misconfigured]`).
 */
import { hooks, type Feature } from "../hooks";
import { nativeCommand } from "../native/commands";

export const nativeCommands: Feature = {
  name: "native-commands",
  install(): void {
    hooks.nativeCommand = nativeCommand;
  },
};
export default nativeCommands;
