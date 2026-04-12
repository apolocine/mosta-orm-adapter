// prisma-ast-helpers.ts
// Helpers for navigating the AST produced by @mrleebo/prisma-ast.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { Schema, Block, Model, Enum, Field, Attribute, AttributeArgument, Func } from '@mrleebo/prisma-ast';

// ============================================================
// AST type-narrowing predicates
// ============================================================

export function isModel(block: Block): block is Model {
  return block.type === 'model';
}

export function isEnum(block: Block): block is Enum {
  return block.type === 'enum';
}

export function isField(property: unknown): property is Field {
  return (property as { type?: string })?.type === 'field';
}

export function isAttribute(property: unknown): property is Attribute {
  return (property as { type?: string })?.type === 'attribute';
}

// ============================================================
// Block extraction
// ============================================================

export function getModels(ast: Schema): Model[] {
  return ast.list.filter(isModel);
}

export function getEnums(ast: Schema): Enum[] {
  return ast.list.filter(isEnum);
}

/** Build a map of enum name -> values, used for default-value resolution */
export function buildEnumMap(ast: Schema): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of getEnums(ast)) {
    const values = (e.enumerators ?? [])
      .filter((en): en is { type: 'enumerator'; name: string } =>
        (en as { type?: string })?.type === 'enumerator'
      )
      .map(en => en.name);
    map.set(e.name, values);
  }
  return map;
}

/** Build a set of model names, used for relation detection */
export function buildModelNameSet(ast: Schema): Set<string> {
  return new Set(getModels(ast).map(m => m.name));
}

// ============================================================
// Field-level helpers
// ============================================================

export function getFields(model: Model): Field[] {
  return (model.properties ?? []).filter(isField);
}

/** Get @@-level attributes (block attributes) */
export function getBlockAttributes(model: Model): Attribute[] {
  return ((model.properties ?? []) as unknown[])
    .filter((p): p is Attribute => (p as { type?: string })?.type === 'attribute');
}

/**
 * Get the name of a field's type. Field.fieldType is either a string scalar
 * (String, Int, ModelName, EnumName) or a Func node (for Unsupported("...")).
 */
export function getFieldTypeName(field: Field): string {
  const t = field.fieldType;
  if (typeof t === 'string') return t;
  // Func node — typically Unsupported("...")
  return (t as Func).name ?? 'Unknown';
}

/** Detect Unsupported("xxx") type */
export function isUnsupportedType(field: Field): boolean {
  const t = field.fieldType;
  return typeof t !== 'string' && (t as Func)?.name === 'Unsupported';
}

// ============================================================
// Field attribute helpers
// ============================================================

export function hasFieldAttribute(field: Field, attrName: string): boolean {
  return !!(field.attributes ?? []).find(a => a.name === attrName && !a.group);
}

export function getFieldAttribute(field: Field, attrName: string): Attribute | undefined {
  return (field.attributes ?? []).find(a => a.name === attrName && !a.group);
}

export function getDbAttribute(field: Field): Attribute | undefined {
  return (field.attributes ?? []).find(a => a.group === 'db');
}

// ============================================================
// Argument extraction
// ============================================================

/**
 * Extract a plain-value arg (first positional or by key).
 * Returns the raw value as produced by @mrleebo/prisma-ast.
 */
export function getArgValue(attr: Attribute | undefined, index = 0): unknown {
  const arg = attr?.args?.[index];
  return extractArgValue(arg);
}

/** Extract value of keyValue-form arg, e.g. `fields: [id]` */
export function getKeyValueArg(attr: Attribute | undefined, key: string): unknown {
  if (!attr?.args) return undefined;
  for (const arg of attr.args) {
    const val = (arg as AttributeArgument).value as unknown;
    if (isKeyValueNode(val) && val.key === key) {
      return extractArgValue({ value: val.value } as AttributeArgument);
    }
  }
  return undefined;
}

/** Extract all positional values as array */
export function getPositionalArgs(attr: Attribute | undefined): unknown[] {
  if (!attr?.args) return [];
  return attr.args
    .filter(arg => {
      const v = (arg as AttributeArgument).value as unknown;
      return !isKeyValueNode(v);
    })
    .map(extractArgValue);
}

// ============================================================
// Private : AST value flattening
// ============================================================

interface FunctionNode { type: 'function'; name: string; params?: unknown[] }
interface ArrayNode    { type: 'array'; args: unknown[] }
interface KeyValueNode { type: 'keyValue'; key: string; value: unknown }

function isFunctionNode(v: unknown): v is FunctionNode {
  return !!v && typeof v === 'object' && (v as { type?: string }).type === 'function';
}

function isArrayNode(v: unknown): v is ArrayNode {
  return !!v && typeof v === 'object' && (v as { type?: string }).type === 'array';
}

function isKeyValueNode(v: unknown): v is KeyValueNode {
  return !!v && typeof v === 'object' && (v as { type?: string }).type === 'keyValue';
}

/** Canonical form of any attribute argument value */
function extractArgValue(arg: AttributeArgument | undefined): unknown {
  if (!arg) return undefined;
  const v = arg.value as unknown;

  if (v === undefined || v === null) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;

  if (isFunctionNode(v)) {
    return { __fn: v.name, params: v.params ?? [] };
  }
  if (isArrayNode(v)) {
    return v.args;
  }
  if (isKeyValueNode(v)) {
    return { [v.key]: extractArgValue({ value: v.value } as AttributeArgument) };
  }
  return v;
}

// ============================================================
// Known Prisma default-function helpers
// ============================================================

export interface PrismaDefaultFunction {
  name: string;
  params: unknown[];
}

export function isFunctionDefault(value: unknown): value is { __fn: string; params: unknown[] } {
  return !!value && typeof value === 'object' && '__fn' in (value as object);
}

export function getFunctionName(value: unknown): string | null {
  if (isFunctionDefault(value)) {
    return value.__fn;
  }
  return null;
}
