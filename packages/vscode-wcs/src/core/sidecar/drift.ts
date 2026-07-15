/**
 * core/sidecar/drift.ts
 *
 * sidecar の wcstack.types と live な static wcBindable 宣言の drift 検査(§7)。
 * 「sidecar に member があるのに実行時宣言にない、または event 名が異なる場合は
 * CI で drift error」。live declaration が正本であり、sidecar は上書きしない。
 *
 * pure(DOM / vscode 非依存)。
 */

import { WcsDiagnosticCode } from "../diagnostics.js";
import { DiagnosticContext } from "./schemaSubset.js";
import { pointer } from "./jsonSource.js";
import { LiveBindableDeclaration, TypesComponent } from "./types.js";

/**
 * 1 コンポーネントの drift を検査する。ctx は sidecar 側の span を持つ(range は
 * sidecar member を指す — drift の修正対象は sidecar だから)。
 */
export function checkDrift(
  tag: string,
  component: TypesComponent,
  live: LiveBindableDeclaration,
  ctx: DiagnosticContext,
): void {
  const liveProps = new Map(live.properties.map((p) => [p.name, p.event]));
  const liveInputs = new Set((live.inputs ?? []).map((i) => i.name));
  const liveCommands = new Set((live.commands ?? []).map((c) => c.name));

  for (const [name, observable] of Object.entries(component.observables ?? {})) {
    const memberPtr = pointer("manifestExtensions", "wcstack.types", "components", tag, "observables", name);
    if (!liveProps.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        memberPtr,
        `Sidecar declares observable "${name}" on <${tag}>, but the live wcBindable declaration has no such property.`,
        "error",
        { tag, member: name },
        true,
      );
      continue;
    }
    const liveEvent = liveProps.get(name)!;
    if (observable.event !== liveEvent) {
      ctx.add(
        WcsDiagnosticCode.DriftEventMismatch,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "observables", name, "event"),
        `Sidecar observable "${name}" on <${tag}> declares event "${observable.event}", but the live declaration uses "${liveEvent}".`,
        "error",
        { tag, member: name },
      );
    }
  }

  for (const name of Object.keys(component.inputs ?? {})) {
    if (!liveInputs.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "inputs", name),
        `Sidecar declares input "${name}" on <${tag}>, but the live wcBindable declaration has no such input.`,
        "error",
        { tag, member: name },
        true,
      );
    }
  }

  for (const name of Object.keys(component.commands ?? {})) {
    if (!liveCommands.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "commands", name),
        `Sidecar declares command "${name}" on <${tag}>, but the live wcBindable declaration has no such command.`,
        "error",
        { tag, member: name },
        true,
      );
    }
  }
}
