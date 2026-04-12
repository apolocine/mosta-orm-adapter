// jsonschema-types.ts
// Type definitions for JSON Schema structures we navigate.
// Covers Draft-07, Draft 2019-09, Draft 2020-12 (superset shape).
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

export type JsonSchemaType =
  | 'string' | 'number' | 'integer' | 'boolean'
  | 'object' | 'array' | 'null';

export interface JsonSchemaFormat {
  format?: string;        // date-time, email, uuid, uri, ipv4, etc.
}

/** A JSON Schema object (union of all common keywords across drafts) */
export interface JsonSchema extends JsonSchemaFormat {
  // Identity
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;        // Draft 2019-09+
  definitions?: Record<string, JsonSchema>;  // Draft-07 and earlier
  $anchor?: string;

  // Type
  type?: JsonSchemaType | JsonSchemaType[];
  const?: unknown;
  enum?: unknown[];
  default?: unknown;

  // String
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Numeric
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;   // numeric in 2020-12, boolean in earlier
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;

  // Object
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  required?: string[];
  minProperties?: number;
  maxProperties?: number;

  // Array
  items?: JsonSchema | JsonSchema[];            // tuple form deprecated in 2020-12
  prefixItems?: JsonSchema[];                   // 2020-12 replacement
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // Composition
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  not?: JsonSchema;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;

  // Annotations
  title?: string;
  description?: string;
  examples?: unknown[];
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;

  // OpenAPI-style (preserved when present)
  nullable?: boolean;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };

  // Custom mostajs extensions
  'x-mostajs-entity'?: XMostajsEntity;
  'x-mostajs-relation'?: XMostajsRelation;
  'x-primary'?: boolean;
  'x-unique'?: boolean;
  'x-index'?: boolean | { unique?: boolean };
  'x-indexes'?: Array<{ fields: string[]; unique?: boolean; name?: string }>;
  'x-autoIncrement'?: boolean;

  // Allow any x-* extension
  [extensionKey: `x-${string}`]: unknown;
}

export interface XMostajsEntity {
  tableName?: string;
  timestamps?: boolean;
  softDelete?: boolean;
  discriminator?: string;
  discriminatorValue?: string;
}

export interface XMostajsRelation {
  type: 'belongsTo' | 'hasOne' | 'hasMany' | 'belongsToMany';
  target: string;
  foreignKey?: string;
  otherKey?: string;
  through?: string;
  onDelete?: 'cascade' | 'set-null' | 'restrict' | 'no-action';
  required?: boolean;
  nullable?: boolean;
}

/** Inferred draft version from $schema URL */
export type DraftVersion = 'draft-04' | 'draft-06' | 'draft-07' | 'draft-2019-09' | 'draft-2020-12' | 'unknown';

export function detectDraft(schema: JsonSchema): DraftVersion {
  const url = schema.$schema ?? '';
  if (/2020-12/.test(url)) return 'draft-2020-12';
  if (/2019-09/.test(url)) return 'draft-2019-09';
  if (/draft-07/.test(url)) return 'draft-07';
  if (/draft-06/.test(url)) return 'draft-06';
  if (/draft-04/.test(url)) return 'draft-04';
  return 'unknown';
}

/** Get sub-schemas regardless of draft ($defs vs definitions) */
export function getDefinitions(schema: JsonSchema): Record<string, JsonSchema> {
  return schema.$defs ?? schema.definitions ?? {};
}

/** First type if type is an array, else the type itself */
export function primaryType(schema: JsonSchema): JsonSchemaType | undefined {
  const t = schema.type;
  if (!t) return undefined;
  if (Array.isArray(t)) return t.find(x => x !== 'null');
  return t;
}

/** Is nullable (either OpenAPI nullable: true, or type array includes null) */
export function isNullable(schema: JsonSchema): boolean {
  if (schema.nullable === true) return true;
  if (Array.isArray(schema.type)) return schema.type.includes('null');
  return false;
}
