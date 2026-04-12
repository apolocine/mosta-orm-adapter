// prisma-default-mapper.ts
// Maps Prisma @default(...) values to EntitySchema FieldDef.default
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import { WarningCode, type AdapterOptions, type AdapterWarning } from '../core/types.js';

/**
 * Sentinel values we emit for Prisma's special default functions.
 * These are recognizable patterns that a downstream ORM can interpret.
 *
 * We DON'T execute these at adapter time — we just signal the intent
 * so the ORM can decide (autoincrement in SQLite vs. Postgres differs).
 */
export const DefaultSentinel = {
  AUTOINCREMENT: '__MOSTA_AUTOINCREMENT__',
  NOW:           '__MOSTA_NOW__',
  UUID:          '__MOSTA_UUID__',
  UUID_V4:       '__MOSTA_UUID_V4__',
  UUID_V7:       '__MOSTA_UUID_V7__',
  CUID:          '__MOSTA_CUID__',
  CUID2:         '__MOSTA_CUID2__',
  NANOID:        '__MOSTA_NANOID__',
  ULID:          '__MOSTA_ULID__',
  DB_GENERATED:  '__MOSTA_DB_GENERATED__',
  OBJECT_ID:     '__MOSTA_OBJECT_ID__',
} as const;

/**
 * Parse a Prisma @default value and return the EntitySchema equivalent.
 *
 * Returns `undefined` if no default is specified or it's unmappable.
 * Emits warnings for dbgenerated() (non-portable SQL).
 */
export function mapPrismaDefault(
  defaultValue: unknown,
  fieldName: string,
  entityName: string,
  enumValues: string[] | undefined,
  opts: AdapterOptions | undefined,
  emitWarning: (w: AdapterWarning) => void
): unknown {
  if (defaultValue === undefined || defaultValue === null) return undefined;

  // 1. Function default : { __fn: 'now', params: [] }
  if (isFunctionDefault(defaultValue)) {
    const fnName = defaultValue.__fn;
    const params = defaultValue.params ?? [];

    switch (fnName) {
      case 'autoincrement':
        return DefaultSentinel.AUTOINCREMENT;

      case 'now':
        return DefaultSentinel.NOW;

      case 'uuid': {
        const version = typeof params[0] === 'number' ? params[0] : 4;
        if (version === 4) return DefaultSentinel.UUID_V4;
        if (version === 7) return DefaultSentinel.UUID_V7;
        return DefaultSentinel.UUID;
      }

      case 'cuid': {
        const version = typeof params[0] === 'number' ? params[0] : 1;
        return version === 2 ? DefaultSentinel.CUID2 : DefaultSentinel.CUID;
      }

      case 'nanoid':
        return DefaultSentinel.NANOID;

      case 'ulid':
        return DefaultSentinel.ULID;

      case 'auto':
        // MongoDB @default(auto()) — generates ObjectId
        return DefaultSentinel.OBJECT_ID;

      case 'dbgenerated':
        emitWarning({
          code: WarningCode.UNSUPPORTED_FEATURE,
          message: `@default(dbgenerated(...)) on "${fieldName}" is not portable across dialects`,
          entity: entityName,
          field: fieldName,
        });
        return DefaultSentinel.DB_GENERATED;

      default:
        emitWarning({
          code: WarningCode.UNKNOWN_EXTENSION,
          message: `Unknown @default function "${fnName}" on "${fieldName}"`,
          entity: entityName,
          field: fieldName,
        });
        return undefined;
    }
  }

  // 2. Literal defaults (string, number, boolean, array)
  if (
    typeof defaultValue === 'string' ||
    typeof defaultValue === 'number' ||
    typeof defaultValue === 'boolean'
  ) {
    // Normalize string booleans : @mrleebo/prisma-ast returns `false`/`true` as bare strings
    if (defaultValue === 'true') return true;
    if (defaultValue === 'false') return false;
    // Normalize string numbers : AST returns numbers as strings ("0", "320")
    if (typeof defaultValue === 'string' && /^-?\d+$/.test(defaultValue)) {
      return parseInt(defaultValue, 10);
    }
    if (typeof defaultValue === 'string' && /^-?\d+\.\d+$/.test(defaultValue)) {
      return parseFloat(defaultValue);
    }
    // Strip quotes from string literals (AST sometimes keeps them)
    if (typeof defaultValue === 'string' &&
        defaultValue.startsWith('"') && defaultValue.endsWith('"')) {
      return defaultValue.slice(1, -1);
    }
    // Enum value reference (bare identifier matches an enum)
    if (typeof defaultValue === 'string' && enumValues?.includes(defaultValue)) {
      return defaultValue;
    }
    return defaultValue;
  }

  // 3. Array literal (e.g., @default([]))
  if (Array.isArray(defaultValue)) {
    return defaultValue;
  }

  // Unrecognized form
  emitWarning({
    code: WarningCode.UNKNOWN_EXTENSION,
    message: `Unrecognized @default form for "${fieldName}": ${JSON.stringify(defaultValue)}`,
    entity: entityName,
    field: fieldName,
  });
  return undefined;
}

function isFunctionDefault(v: unknown): v is { __fn: string; params?: unknown[] } {
  return !!v && typeof v === 'object' && '__fn' in (v as object);
}
