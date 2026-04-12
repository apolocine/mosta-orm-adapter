// jsonschema-type-mapper.ts
// Maps JSON Schema types + formats to @mostajs/orm FieldType.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { FieldType } from '@mostajs/orm';
import type { JsonSchema, JsonSchemaType } from './jsonschema-types.js';
import { primaryType } from './jsonschema-types.js';
import { WarningCode, type AdapterWarning } from '../core/types.js';

/**
 * Map a JSON Schema value to a FieldType.
 * Returns null if the schema is not a leaf scalar (e.g., object, array, $ref unresolved).
 */
export function mapJsonSchemaType(
  schema: JsonSchema,
  fieldName: string,
  entityName: string,
  emitWarning: (w: AdapterWarning) => void
): FieldType | null {
  const t = primaryType(schema);

  switch (t) {
    case 'string':
      return mapStringFormat(schema, fieldName, entityName, emitWarning);

    case 'integer':
    case 'number':
      if (schema.format === 'int64' || schema.format === 'int32') {
        // No precision distinction in EntitySchema — warn for int64
        if (schema.format === 'int64') {
          emitWarning({
            code: WarningCode.LOSSY_CONVERSION,
            message: `int64 format on "${fieldName}" mapped to number; precision loss > 2^53`,
            entity: entityName,
            field: fieldName,
          });
        }
      }
      return 'number';

    case 'boolean':
      return 'boolean';

    case 'array':
      // Caller must handle with arrayOf
      return 'array';

    case 'object':
      // Object → json column (unless it's an entity to be detected separately)
      return 'json';

    case 'null':
      return null;

    default:
      // No type info — default to string
      if (schema.enum?.length) return 'string';
      if (schema.const !== undefined) return mapConstType(schema.const);
      return null;
  }
}

/** Map string + format to FieldType */
function mapStringFormat(
  schema: JsonSchema,
  fieldName: string,
  entityName: string,
  emitWarning: (w: AdapterWarning) => void
): FieldType {
  switch (schema.format) {
    case 'date-time':
    case 'date':
    case 'time':
      return 'date';

    case 'binary':
    case 'byte':
      emitWarning({
        code: WarningCode.LOSSY_CONVERSION,
        message: `binary/byte format on "${fieldName}" mapped to string (base64); blob handling is application's responsibility`,
        entity: entityName,
        field: fieldName,
      });
      return 'string';

    // text-heavy formats → text
    case 'uri':
    case 'iri':
    case 'uri-reference':
    case 'iri-reference':
      return 'string';

    // All other formats (email, uuid, ipv4, regex, hostname, etc.) → string
    default:
      return 'string';
  }
}

/** Infer type from a const value */
function mapConstType(value: unknown): FieldType | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') return 'json';
  return null;
}

/** Resolve arrayOf from items (single schema only — tuple not supported in EntitySchema) */
export function mapArrayItems(
  schema: JsonSchema,
  fieldName: string,
  entityName: string,
  emitWarning: (w: AdapterWarning) => void
): FieldType | null {
  let items = schema.items;
  if (Array.isArray(items)) {
    emitWarning({
      code: WarningCode.LOSSY_CONVERSION,
      message: `Tuple "items" (array form) on "${fieldName}" not supported; using first item type`,
      entity: entityName,
      field: fieldName,
    });
    items = items[0];
  }
  if (!items) {
    emitWarning({
      code: WarningCode.MISSING_METADATA,
      message: `Array "${fieldName}" has no items definition`,
      entity: entityName,
      field: fieldName,
    });
    return 'string';  // fallback
  }
  return mapJsonSchemaType(items, fieldName, entityName, emitWarning);
}
