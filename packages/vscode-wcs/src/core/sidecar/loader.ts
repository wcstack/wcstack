/**
 * core/sidecar/loader.ts
 *
 * manifest artifact の parse + envelope 検証、および複数 package artifact の
 * 契約解決(同名 tag / filter 衝突・override 規則、last-file-wins 禁止)。
 * docs/wcstack-manifest-schema.md §1/§2/§5 を実装する。
 *
 * pure(DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from "../diagnostics.js";
import { DiagnosticContext } from "./schemaSubset.js";
import { JsonSpan, parseJsonWithSpans, pointer } from "./jsonSource.js";
import {
  JsonSchemaNode,
  SUPPORTED_NAMESPACE_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  TypesComponent,
  WcstackManifest,
} from "./types.js";

export interface ManifestArtifact {
  /** 診断 range を索く生テキスト。 */
  readonly text: string;
  /** artifact の識別子(ファイルパス等)。診断メッセージ・並び順に使う。 */
  readonly source: string;
}

export interface LoadedManifest {
  readonly artifact: ManifestArtifact;
  readonly manifest: WcstackManifest | null;
  readonly ctx: DiagnosticContext;
  /** collision 解決など後段の診断が range を索くための span 表。 */
  readonly spans: ReadonlyMap<string, JsonSpan>;
}

const NAMESPACE_KEYS = ["wcstack.types", "wcstack.async", "wcstack.platformCapabilities", "wcstack.application"] as const;

/** 1 artifact を parse し envelope を検証する。schema subset の深い検証は validate.ts が行う。 */
export function loadManifest(artifact: ManifestArtifact): LoadedManifest {
  const parsed = parseJsonWithSpans(artifact.text);
  const ctx = new DiagnosticContext(parsed.spans);

  if (parsed.error !== null) {
    ctx.diagnostics.push({
      code: WcsDiagnosticCode.ManifestBroken,
      start: parsed.error.offset,
      end: Math.min(parsed.error.offset + 1, artifact.text.length),
      message: `Broken manifest JSON: ${parsed.error.message}.`,
      severity: "error",
    });
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }

  const root = parsed.value;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    ctx.add(WcsDiagnosticCode.ManifestBroken, "", `Manifest root must be a JSON object.`, "error");
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const obj = root as Record<string, unknown>;

  // schemaVersion
  if (obj.schemaVersion === undefined) {
    ctx.add(WcsDiagnosticCode.ManifestSchemaVersion, "", `Manifest is missing an integer "schemaVersion".`, "error");
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (typeof obj.schemaVersion !== "number" || !Number.isInteger(obj.schemaVersion)) {
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Manifest "schemaVersion" must be an integer.`,
      "error",
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Unsupported schemaVersion ${obj.schemaVersion}; this reader supports ${SUPPORTED_SCHEMA_VERSION}.`,
      "error",
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }

  // kind
  if (obj.kind !== "package" && obj.kind !== "application") {
    ctx.add(
      WcsDiagnosticCode.ManifestKindInvalid,
      obj.kind === undefined ? "" : pointer("kind"),
      `Manifest "kind" must be "package" or "application".`,
      "error",
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }

  // namespace versions (best-effort; unknown namespaces are ignored)
  const extensions = obj.manifestExtensions;
  if (extensions !== null && typeof extensions === "object") {
    for (const ns of NAMESPACE_KEYS) {
      const nsObj = (extensions as Record<string, unknown>)[ns];
      if (nsObj !== null && typeof nsObj === "object") {
        const version = (nsObj as Record<string, unknown>).version;
        if (typeof version === "number" && version !== SUPPORTED_NAMESPACE_VERSION) {
          ctx.add(
            WcsDiagnosticCode.ManifestNamespaceVersion,
            pointer("manifestExtensions", ns, "version"),
            `Namespace "${ns}" version ${version} is unsupported (expected ${SUPPORTED_NAMESPACE_VERSION}).`,
            "warning",
          );
        }
      }
    }
  }

  return { artifact, manifest: obj as unknown as WcstackManifest, ctx, spans: parsed.spans };
}

export interface ResolvedTagContract {
  readonly tag: string;
  readonly component: TypesComponent;
  readonly source: string;
}

export interface ResolvedContracts {
  /** 衝突していない tag → 契約。衝突した tag は含めない(unknown 扱いにするため)。 */
  readonly tags: ReadonlyMap<string, ResolvedTagContract>;
  /**
   * 衝突していない application state → stateSchema(D8)。同名 state が複数の application
   * artifact に宣言されていれば含めない(未宣言扱い = schema 検証は沈黙)。
   */
  readonly applicationStates: ReadonlyMap<string, JsonSchemaNode>;
  /** application artifact が 1 つでも渡されたか(明示指定が発見結果を置き換える判定用)。 */
  readonly hasApplicationArtifact: boolean;
  /** 衝突/override 診断を、それを生んだ artifact の source ごとに束ねたもの。 */
  readonly diagnosticsBySource: ReadonlyMap<string, readonly WcsDiagnostic[]>;
}

/**
 * 複数 artifact から契約を解決する(§5)。同名 tag(package)/同名 filter(application)
 * の二重定義は衝突エラーで後勝ちにしない(§5-3)。override は明示 `override: true` のみ
 * 許可(§5-4)。`loaded` は探索順に渡す(diagnostics の順序のみに影響)。
 */
export function resolvePackageContracts(loaded: readonly LoadedManifest[]): ResolvedContracts {
  const perSource = new Map<string, WcsDiagnostic[]>();
  const ctxBySource = new Map<string, DiagnosticContext>();
  const ctxFor = (lm: LoadedManifest): DiagnosticContext => {
    let ctx = ctxBySource.get(lm.artifact.source);
    if (ctx === undefined) {
      ctx = new DiagnosticContext(lm.spans);
      ctxBySource.set(lm.artifact.source, ctx);
      perSource.set(lm.artifact.source, ctx.diagnostics);
    }
    return ctx;
  };

  const winners = new Map<string, ResolvedTagContract>();
  const collided = new Set<string>();
  const firstSource = new Map<string, string>();
  const filterOwner = new Map<string, string>();
  const stateOwner = new Map<string, string>();
  const stateWinners = new Map<string, JsonSchemaNode>();
  const collidedStates = new Set<string>();
  let hasApplicationArtifact = false;

  for (const lm of loaded) {
    if (lm.manifest === null) continue;
    if (lm.manifest.kind === "application") hasApplicationArtifact = true;

    // package: tag 契約の衝突/override。
    const types = lm.manifest.manifestExtensions?.["wcstack.types"];
    if (lm.manifest.kind === "package" && types !== undefined) {
      for (const [tag, component] of Object.entries(types.components ?? {})) {
        const ptr = pointer("manifestExtensions", "wcstack.types", "components", tag);
        if (!winners.has(tag) && !collided.has(tag)) {
          winners.set(tag, { tag, component, source: lm.artifact.source });
          firstSource.set(tag, lm.artifact.source);
          continue;
        }
        if (component.override === true) {
          ctxFor(lm).add(
            WcsDiagnosticCode.ManifestOverride,
            ptr,
            `Component "${tag}" explicitly overrides a prior package contract.`,
            "info",
            { tag },
            true,
          );
          continue;
        }
        const priorSource = firstSource.get(tag) ?? "an earlier artifact";
        collided.add(tag);
        winners.delete(tag);
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestTagCollision,
          ptr,
          `Component tag "${tag}" is defined by multiple package artifacts (also in "${priorSource}"). Set "override": true to intentionally shadow.`,
          "error",
          { tag },
          true,
        );
      }
    }

    // application: filter 名の衝突(§5-3)。同名 filter は後勝ちにしない。
    const application = lm.manifest.manifestExtensions?.["wcstack.application"];
    if (lm.manifest.kind === "application" && application?.filters !== undefined) {
      for (const name of Object.keys(application.filters)) {
        const priorSource = filterOwner.get(name);
        if (priorSource === undefined) {
          filterOwner.set(name, lm.artifact.source);
          continue;
        }
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestFilterCollision,
          pointer("manifestExtensions", "wcstack.application", "filters", name),
          `Filter "${name}" is defined by multiple application artifacts (also in "${priorSource}").`,
          "error",
          { member: name },
          true,
        );
      }
    }

    // application: state 名の衝突(D8)。同名 stateSchema は後勝ちにせず、勝者なし。
    if (lm.manifest.kind === "application" && application?.states !== undefined) {
      for (const [name, entry] of Object.entries(application.states)) {
        const schema = (entry as { stateSchema?: unknown } | null)?.stateSchema;
        if (schema === null || typeof schema !== "object" || Array.isArray(schema)) continue;
        const priorSource = stateOwner.get(name);
        if (priorSource === undefined) {
          stateOwner.set(name, lm.artifact.source);
          stateWinners.set(name, schema as JsonSchemaNode);
          continue;
        }
        collidedStates.add(name);
        stateWinners.delete(name);
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestStateCollision,
          pointer("manifestExtensions", "wcstack.application", "states", name),
          `State "${name}" declares a stateSchema in multiple application artifacts (also in "${priorSource}"); neither is used.`,
          "error",
          { statePath: name },
          true,
        );
      }
    }
  }

  // 撤回された tag の override info は陳腐化するため取り除く(#5)。
  const diagnosticsBySource = new Map<string, readonly WcsDiagnostic[]>();
  for (const [source, diags] of perSource) {
    const kept = diags.filter((d) =>
      !(d.code === WcsDiagnosticCode.ManifestOverride && d.tag !== undefined && collided.has(d.tag)));
    if (kept.length > 0) diagnosticsBySource.set(source, kept);
  }

  return { tags: winners, applicationStates: stateWinners, hasApplicationArtifact, diagnosticsBySource };
}
