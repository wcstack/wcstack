/**
 * core/sidecar/validate.ts
 *
 * sidecar 検証の入口。1 artifact の envelope + schema subset + namespace 検証、
 * および複数 artifact 横断の衝突・drift 検査を統合し WcsDiagnostic[] を返す。
 * VS Code / CI CLI / dev runtime が同じ関数を呼ぶ(§7.1)。
 *
 * pure(DOM / vscode 非依存)。
 */

import { WcsDiagnostic, sortDiagnostics } from "../diagnostics.js";
import { DiagnosticContext, validateSchemaSubset } from "./schemaSubset.js";
import { pointer } from "./jsonSource.js";
import { LoadedManifest, ManifestArtifact, loadManifest, resolvePackageContracts } from "./loader.js";
import { checkDrift } from "./drift.js";
import {
  JsonSchemaNode,
  LiveBindableDeclaration,
  TypesComponent,
} from "./types.js";

/** 1 artifact の内部整合性(envelope + wcstack.types の schema subset)を検証する。 */
export function validateManifestArtifact(artifact: ManifestArtifact): WcsDiagnostic[] {
  const loaded = loadManifest(artifact);
  validateLoadedSchemas(loaded);
  return sortDiagnostics(loaded.ctx.diagnostics);
}

function validateLoadedSchemas(loaded: LoadedManifest): void {
  if (loaded.manifest === null) return;
  const types = loaded.manifest.manifestExtensions?.["wcstack.types"];
  if (types === undefined) return;
  for (const [tag, component] of Object.entries(types.components ?? {})) {
    validateComponentSchemas(tag, component, loaded.ctx);
  }
}

function validateComponentSchemas(tag: string, component: TypesComponent, ctx: DiagnosticContext): void {
  const base = pointer("manifestExtensions", "wcstack.types", "components", tag);
  const walkSchema = (schema: JsonSchemaNode | undefined, ptr: string): void => {
    if (schema === undefined) return;
    // root の $defs を ref 解決に使う(schema 自身が $defs を持つ場合)。
    validateSchemaSubset(schema, ptr, ctx, schema.$defs ?? {});
  };
  for (const [name, observable] of Object.entries(component.observables ?? {})) {
    walkSchema(observable.schema, `${base}/observables/${escapePtr(name)}/schema`);
  }
  for (const [name, input] of Object.entries(component.inputs ?? {})) {
    walkSchema(input.schema, `${base}/inputs/${escapePtr(name)}/schema`);
  }
  for (const [name, command] of Object.entries(component.commands ?? {})) {
    walkSchema(command.args, `${base}/commands/${escapePtr(name)}/args`);
    walkSchema(command.result, `${base}/commands/${escapePtr(name)}/result`);
  }
}

export interface ManifestSetInput {
  readonly artifacts: readonly ManifestArtifact[];
  /** drift 照合用の live declaration(tag → 宣言)。省略時は drift 検査を行わない。 */
  readonly liveDeclarations?: ReadonlyMap<string, LiveBindableDeclaration>;
}

export interface ManifestSetResult {
  readonly diagnostics: readonly WcsDiagnostic[];
  /** artifact ごとの診断(source をキーに、CLI が per-file 出力に使う)。 */
  readonly byArtifact: ReadonlyMap<string, readonly WcsDiagnostic[]>;
  readonly resolvedTags: ReadonlyMap<string, ManifestArtifact["source"]>;
}

/**
 * 複数 artifact を横断検証する。各 artifact の内部検証 + 契約衝突 + drift を統合。
 * artifacts は探索順(diagnostics 順序のみに影響)。
 */
export function validateManifestSet(input: ManifestSetInput): ManifestSetResult {
  const loadedList = input.artifacts.map(loadManifest);
  const byArtifact = new Map<string, WcsDiagnostic[]>();

  for (const loaded of loadedList) {
    validateLoadedSchemas(loaded);
    // drift: package 契約と live 宣言を突き合わせる。
    if (input.liveDeclarations !== undefined && loaded.manifest?.kind === "package") {
      const types = loaded.manifest.manifestExtensions?.["wcstack.types"];
      for (const [tag, component] of Object.entries(types?.components ?? {})) {
        const live = input.liveDeclarations.get(tag);
        if (live !== undefined) {
          checkDrift(tag, component, live, loaded.ctx);
        }
      }
    }
    // 同一 source が複数回渡されても診断を失わないよう merge する(#4)。
    const existing = byArtifact.get(loaded.artifact.source) ?? [];
    byArtifact.set(loaded.artifact.source, [...existing, ...loaded.ctx.diagnostics]);
  }

  // 契約解決(衝突/override)。診断は生成元 artifact の source ごとに束ねられている。
  const resolved = resolvePackageContracts(loadedList);
  for (const [source, diags] of resolved.diagnosticsBySource) {
    const existing = byArtifact.get(source) ?? [];
    byArtifact.set(source, [...existing, ...diags]);
  }

  const all: WcsDiagnostic[] = [];
  for (const diags of byArtifact.values()) all.push(...diags);

  const resolvedTags = new Map<string, ManifestArtifact["source"]>();
  for (const [tag, contract] of resolved.tags) resolvedTags.set(tag, contract.source);

  const sortedByArtifact = new Map<string, readonly WcsDiagnostic[]>();
  for (const [source, diags] of byArtifact) sortedByArtifact.set(source, sortDiagnostics(diags));

  return {
    diagnostics: sortDiagnostics(all),
    byArtifact: sortedByArtifact,
    resolvedTags,
  };
}

function escapePtr(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
