// jsonschema-flatten.ts
// Flattens allOf composition, merging parent properties into the target schema.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { JsonSchema } from './jsonschema-types.js';
import { WarningCode, type AdapterWarning } from '../core/types.js';

/**
 * Flatten allOf composition recursively.
 * Merges all properties, requireds, indexes from allOf members into a single schema.
 * Later entries overwrite earlier (last-wins on conflicts).
 */
export function flattenAllOf(
  schema: JsonSchema,
  emitWarning: (w: AdapterWarning) => void,
  entityName?: string
): JsonSchema {
  if (!schema.allOf || schema.allOf.length === 0) return schema;

  const merged: JsonSchema = {
    ...schema,
    properties: { ...(schema.properties ?? {}) },
    required: [...(schema.required ?? [])],
  };

  for (const sub of schema.allOf) {
    const subFlat = flattenAllOf(sub, emitWarning, entityName);

    // Merge properties
    if (subFlat.properties) {
      for (const [key, val] of Object.entries(subFlat.properties)) {
        if (merged.properties && key in merged.properties && entityName) {
          emitWarning({
            code: WarningCode.AMBIGUOUS_MAPPING,
            message: `Property "${key}" redefined in allOf; last-wins`,
            entity: entityName,
            field: key,
          });
        }
        if (!merged.properties) merged.properties = {};
        merged.properties[key] = val;
      }
    }

    // Merge required
    if (subFlat.required) {
      merged.required = Array.from(new Set([...(merged.required ?? []), ...subFlat.required]));
    }

    // Inherit type from first allOf entry if parent doesn't have one
    if (!merged.type && subFlat.type) merged.type = subFlat.type;

    // Merge x-mostajs-entity metadata (parent wins)
    if (subFlat['x-mostajs-entity'] && !merged['x-mostajs-entity']) {
      merged['x-mostajs-entity'] = subFlat['x-mostajs-entity'];
    }
  }

  // Remove the allOf after merging
  delete merged.allOf;
  return merged;
}

/**
 * Detect oneOf with discriminator and return the discriminator mapping.
 * Used to build polymorphism (EntitySchema.discriminator + discriminatorValue).
 */
export function detectDiscriminator(
  schema: JsonSchema
): { propertyName: string; mapping?: Record<string, string> } | null {
  if (schema.discriminator && schema.discriminator.propertyName) {
    return schema.discriminator;
  }
  return null;
}
