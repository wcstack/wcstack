/**
 * generate.ts — one call from a state file to its `stateSchema`.
 */

import { loadStateFile, type LoadStateOptions } from "./program.js";
import { stateTypeToSchema, type JsonSchemaNode, type SchemaOptions } from "./typeToSchema.js";

export interface GenerateOptions extends LoadStateOptions, SchemaOptions {}

export interface GeneratedSchema {
  readonly schema: JsonSchemaNode;
  /** Non-fatal notes (e.g. the state type resolved to `any`, a list whose rows have no type). */
  readonly warnings: readonly string[];
}

export function generateStateSchema(file: string, options: GenerateOptions = {}): GeneratedSchema {
  const loaded = loadStateFile(file, options);
  const schema = loaded.open ? {} : stateTypeToSchema(loaded.checker, loaded.program, loaded.type, loaded.location, options);
  const warnings = [
    ...loaded.warnings,
    ...untypedRows(schema).map((path) =>
      `\`${path}\` is a list whose rows have no type (it starts empty and nothing types it): the generated stateSchema ` +
      `says nothing under \`${path}.*\` — not the rows' fields, not the row getters declared there — and a misspelt ` +
      `path under it is not an error. Give it a type that lists the fields (a JSDoc @type, e.g. ` +
      `/** @type {{ id: number, name: string }[]} */)`),
  ];
  return { schema, warnings };
}

/**
 * The lists whose `items` is a bare `{}` — unknown to the validator, which then checks nothing under them against
 * the schema. A state that starts a list empty (`dependents: []`) gets one, and a page that had a near-miss
 * reported without the schema had it reported no more once the schema was there, with nothing said (the Advent
 * Calendar's record, docs/v4-direction-2026-10.md §5.27).
 */
function untypedRows(node: JsonSchemaNode, path = "", out: string[] = []): string[] {
  if (node.items !== undefined) {
    if (Object.keys(node.items).length === 0) out.push(path);
    else untypedRows(node.items, `${path}.*`, out);
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) untypedRows(child, path === "" ? key : `${path}.${key}`, out);
  for (const member of node.anyOf ?? []) untypedRows(member, path, out);
  return out;
}
