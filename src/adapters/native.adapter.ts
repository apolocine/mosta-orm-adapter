// @mostajs/orm-adapter — NativeAdapter
// Passthrough adapter for the native @mostajs/orm EntitySchema format.
// Useful as baseline, detection fallback, and validation layer.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { EntitySchema } from '@mostajs/orm';
import { AbstractAdapter } from '../core/abstract.adapter.js';
import type { AdapterOptions } from '../core/types.js';
import { WarningCode } from '../core/types.js';
import { InvalidSchemaError } from '../core/errors.js';

/**
 * NativeAdapter — accepts EntitySchema objects directly (passthrough).
 *
 * Use cases:
 *  - baseline to validate the IAdapter contract
 *  - allows mixing native and third-party schemas in one Registry
 *  - adds structural validation before handing off to the ORM
 */
export class NativeAdapter extends AbstractAdapter {
  readonly name = 'native';
  readonly vendor = '@mostajs/orm';
  readonly version = '0.1.0';

  /**
   * Detects an EntitySchema by structural shape (duck typing).
   * Accepts both single schema and array of schemas.
   */
  canParse(input: string | object): boolean {
    if (typeof input === 'string') return false;
    if (Array.isArray(input)) {
      return input.length === 0 || this.isEntitySchemaShape(input[0]);
    }
    return this.isEntitySchemaShape(input);
  }

  /**
   * Passthrough : validates each schema, emits warnings if invalid,
   * throws InvalidSchemaError in strict mode.
   */
  async toEntitySchema(
    input: EntitySchema | EntitySchema[] | object,
    opts?: AdapterOptions
  ): Promise<EntitySchema[]> {
    const array = Array.isArray(input) ? input : [input as EntitySchema];

    for (const schema of array) {
      const errors = this.validateEntitySchema(schema);
      if (errors.length > 0) {
        if (opts?.strict) {
          throw new InvalidSchemaError(
            `Invalid EntitySchema: ${errors.join('; ')}`,
            { schema, errors }
          );
        }
        for (const err of errors) {
          this.warn(opts, {
            code: WarningCode.MISSING_METADATA,
            message: err,
            entity: schema.name,
          });
        }
      }
    }

    return array as EntitySchema[];
  }

  /**
   * Reverse : native format IS the EntitySchema — identity function.
   */
  async fromEntitySchema(entities: EntitySchema[]): Promise<EntitySchema[]> {
    return entities;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Duck-type check : does the object look like an EntitySchema?
   * Checks for required structural fields without deep validation.
   */
  private isEntitySchemaShape(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return (
      typeof o.name === 'string' &&
      typeof o.collection === 'string' &&
      typeof o.fields === 'object' &&
      o.fields !== null &&
      typeof o.relations === 'object' &&
      o.relations !== null &&
      Array.isArray(o.indexes) &&
      typeof o.timestamps === 'boolean'
    );
  }
}
