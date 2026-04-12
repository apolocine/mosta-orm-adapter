// openapi-normalize.ts
// Normalizes OpenAPI 3.0.x schemas to OpenAPI 3.1 / JSON Schema 2020-12 shape.
// Makes it safe to feed OpenAPI schemas into the JsonSchema type mapper.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { JsonSchema } from './jsonschema-types.js';
import { WarningCode, type AdapterWarning } from '../core/types.js';

/** Detect if a spec is OpenAPI 3.0.x (not 3.1) */
export function isOpenApi30(version: string | undefined): boolean {
  if (!version) return false;
  return /^3\.0/.test(version);
}

/**
 * Normalize a Schema Object to 3.1 shape (in-place safe — operates on a cloned tree).
 * Recursively walks through properties, items, $defs, allOf/oneOf/anyOf.
 *
 * Transformations applied:
 *  - nullable: true  → type: [T, "null"]
 *  - example: X      → examples: [X] (deprecated in 3.1)
 *  - exclusiveMinimum: true (3.0 boolean) → exclusiveMinimum: minimum (3.1 number)
 *  - exclusiveMaximum: true (3.0 boolean) → exclusiveMaximum: maximum (3.1 number)
 *  - Drop format: binary + enforce blob (kept as-is but flagged)
 */
export function normalizeSchema30to31(
  schema: JsonSchema,
  emitWarning: (w: AdapterWarning) => void,
  path = '$'
): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema;

  const out: JsonSchema = { ...schema };

  // 1. nullable: true → type: [T, "null"]
  if (out.nullable === true) {
    if (typeof out.type === 'string') {
      out.type = [out.type, 'null'];
    } else if (Array.isArray(out.type)) {
      if (!out.type.includes('null')) out.type = [...out.type, 'null'];
    }
    delete out.nullable;
  }

  // 2. example (singular, deprecated 3.1) → examples
  const schemaAny = out as unknown as { example?: unknown };
  if (schemaAny.example !== undefined && !out.examples) {
    out.examples = [schemaAny.example];
    delete schemaAny.example;
  }

  // 3. exclusiveMinimum/Maximum boolean (3.0) → numeric (3.1)
  if (out.exclusiveMinimum === true && typeof out.minimum === 'number') {
    out.exclusiveMinimum = out.minimum;
    delete out.minimum;
  } else if (out.exclusiveMinimum === false) {
    delete out.exclusiveMinimum;
  }

  if (out.exclusiveMaximum === true && typeof out.maximum === 'number') {
    out.exclusiveMaximum = out.maximum;
    delete out.maximum;
  } else if (out.exclusiveMaximum === false) {
    delete out.exclusiveMaximum;
  }

  // 4. Recurse into nested schemas
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [
        k,
        normalizeSchema30to31(v, emitWarning, `${path}.properties.${k}`),
      ])
    );
  }

  if (out.items) {
    if (Array.isArray(out.items)) {
      out.items = out.items.map((it, i) =>
        normalizeSchema30to31(it, emitWarning, `${path}.items[${i}]`)
      );
    } else {
      out.items = normalizeSchema30to31(out.items, emitWarning, `${path}.items`);
    }
  }

  if (out.$defs) {
    out.$defs = Object.fromEntries(
      Object.entries(out.$defs).map(([k, v]) => [
        k,
        normalizeSchema30to31(v, emitWarning, `${path}.$defs.${k}`),
      ])
    );
  }

  if (out.definitions) {
    out.definitions = Object.fromEntries(
      Object.entries(out.definitions).map(([k, v]) => [
        k,
        normalizeSchema30to31(v, emitWarning, `${path}.definitions.${k}`),
      ])
    );
  }

  for (const k of ['allOf', 'oneOf', 'anyOf'] as const) {
    const arr = out[k];
    if (Array.isArray(arr)) {
      out[k] = arr.map((s, i) =>
        normalizeSchema30to31(s, emitWarning, `${path}.${k}[${i}]`)
      );
    }
  }

  if (out.not) {
    out.not = normalizeSchema30to31(out.not, emitWarning, `${path}.not`);
  }

  return out;
}

/**
 * Normalize ALL schemas in components.schemas.
 * Only runs if the spec is OpenAPI 3.0.x.
 */
export function normalizeComponentsSchemas(
  components: { schemas?: Record<string, JsonSchema> } | undefined,
  version: string | undefined,
  emitWarning: (w: AdapterWarning) => void
): Record<string, JsonSchema> | undefined {
  const schemas = components?.schemas;
  if (!schemas) return undefined;

  if (!isOpenApi30(version)) return schemas;  // already 3.1+

  // Emit a single info-level warning per spec
  emitWarning({
    code: WarningCode.FALLBACK_APPLIED,
    message: `OpenAPI 3.0 detected — normalizing schemas to 3.1 shape (nullable/exclusiveMin/examples)`,
  });

  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      normalizeSchema30to31(schema, emitWarning, `components.schemas.${name}`),
    ])
  );
}
