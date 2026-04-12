// @mostajs/orm-adapter — Core types
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { EntitySchema } from '@mostajs/orm';

// ============================================================
// Adapter Warnings
// ============================================================

/**
 * Warning codes emitted during schema conversion.
 * Inspired by compiler diagnostic codes (TS1234, ESLint rules).
 */
export const WarningCode = {
  UNSUPPORTED_FEATURE:    'UNSUPPORTED_FEATURE',     // feature exists in source but not in target
  LOSSY_CONVERSION:       'LOSSY_CONVERSION',        // type precision / constraint lost
  MISSING_METADATA:       'MISSING_METADATA',        // expected metadata absent
  AMBIGUOUS_MAPPING:      'AMBIGUOUS_MAPPING',       // multiple valid interpretations
  PREVIEW_FEATURE:        'PREVIEW_FEATURE',         // experimental/preview feature used
  FALLBACK_APPLIED:       'FALLBACK_APPLIED',        // default strategy used
  CYCLIC_REFERENCE:       'CYCLIC_REFERENCE',        // self-referencing schema detected
  UNKNOWN_EXTENSION:      'UNKNOWN_EXTENSION',       // unrecognized x-* extension
} as const;

export type WarningCodeType = typeof WarningCode[keyof typeof WarningCode];

export interface AdapterWarning {
  /** Machine-readable code (see WarningCode) */
  code: WarningCodeType | string;
  /** Human-readable message */
  message: string;
  /** Entity name where the warning applies (if applicable) */
  entity?: string;
  /** Field name within the entity (if applicable) */
  field?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

// ============================================================
// Adapter Options
// ============================================================

export interface AdapterOptions {
  /**
   * When true, warnings become exceptions (fail-fast mode).
   * When false (default), warnings are delivered via `onWarning`.
   */
  strict?: boolean;

  /** Called for each warning emitted during conversion */
  onWarning?: (warning: AdapterWarning) => void;

  /** Custom extension values for x-mostajs-* metadata */
  extensions?: Record<string, unknown>;

  /**
   * Preferred strategy for relation detection when ambiguous.
   * - 'explicit' : require x-mostajs-relation extension
   * - 'auto'     : infer from conventions ($ref, naming)
   * - 'none'     : skip relation detection entirely
   */
  relationStrategy?: 'explicit' | 'auto' | 'none';

  /** Fallback type for unmappable structures */
  unknownTypesFallback?: 'json' | 'error' | 'string';
}

// ============================================================
// IAdapter — The contract
// ============================================================

export interface IAdapter {
  /** Unique identifier (e.g. 'prisma', 'jsonschema', 'openapi', 'native') */
  readonly name: string;

  /** Source vendor (e.g. 'prisma.io', 'json-schema.org') */
  readonly vendor: string;

  /** Adapter version (semver) */
  readonly version: string;

  /**
   * Quick detection : can this adapter parse the given input?
   * Should be fast and non-destructive (no full parsing).
   */
  canParse(input: string | object): boolean;

  /**
   * Primary conversion : source schema → EntitySchema[].
   * Always returns an array, even for single-entity sources.
   */
  toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]>;

  /**
   * Optional reverse conversion : EntitySchema[] → source format.
   * Not all adapters implement this.
   */
  fromEntitySchema?(entities: EntitySchema[], opts?: AdapterOptions): Promise<string | object>;
}

// ============================================================
// Registry types
// ============================================================

export interface RegistryOptions {
  /** Throw when no adapter matches (default: false, returns null) */
  strictDetection?: boolean;
}
