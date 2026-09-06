/**
 * generate.ts — one call from a state file to its `stateSchema`.
 */

import { loadStateFile, type LoadStateOptions } from "./program.js";
import { stateTypeToSchema, type JsonSchemaNode, type SchemaOptions } from "./typeToSchema.js";

export interface GenerateOptions extends LoadStateOptions, SchemaOptions {}

export interface GeneratedSchema {
  readonly schema: JsonSchemaNode;
  /** Non-fatal notes (e.g. the state type resolved to `any`). */
  readonly warnings: readonly string[];
}

export function generateStateSchema(file: string, options: GenerateOptions = {}): GeneratedSchema {
  const loaded = loadStateFile(file, options);
  const schema = stateTypeToSchema(loaded.checker, loaded.program, loaded.type, loaded.location, options);
  return { schema, warnings: loaded.warnings };
}
