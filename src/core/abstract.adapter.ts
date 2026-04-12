// @mostajs/orm-adapter — AbstractAdapter
// Base class providing common helpers for all adapter implementations.
// Inspired by AbstractSqlDialect in @mostajs/orm.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { EntitySchema, FieldDef, FieldType } from '@mostajs/orm';
import type { IAdapter, AdapterOptions, AdapterWarning } from './types.js';
import { StrictWarningError } from './errors.js';

/**
 * AbstractAdapter provides shared logic for all adapters:
 *  - warning emission (strict vs callback mode)
 *  - case conversion (pascal / camel / snake)
 *  - EntitySchema validation
 *  - empty-entity factory
 */
export abstract class AbstractAdapter implements IAdapter {
  abstract readonly name: string;
  abstract readonly vendor: string;
  readonly version: string = '0.1.0';

  abstract canParse(input: string | object): boolean;
  abstract toEntitySchema(
    input: string | object,
    opts?: AdapterOptions
  ): Promise<EntitySchema[]>;

  // ============================================================
  // Warning helpers
  // ============================================================

  /**
   * Emit a warning. In strict mode, throws; otherwise calls onWarning callback.
   */
  protected warn(opts: AdapterOptions | undefined, warning: AdapterWarning): void {
    if (opts?.strict) {
      throw new StrictWarningError(warning);
    }
    opts?.onWarning?.(warning);
  }

  // ============================================================
  // Case conversion helpers
  // ============================================================

  /** Convert to snake_case (for table/collection names) */
  protected snakeCase(str: string): string {
    return str
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
  }

  /** Convert to PascalCase (for entity names) */
  protected pascalCase(str: string): string {
    return str
      .replace(/[_\s-]+/g, ' ')
      .replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .replace(/\s+/g, '');
  }

  /** Convert to camelCase (for field names) */
  protected camelCase(str: string): string {
    const p = this.pascalCase(str);
    return p.charAt(0).toLowerCase() + p.slice(1);
  }

  // ============================================================
  // Schema helpers
  // ============================================================

  /**
   * Create an empty EntitySchema with sensible defaults.
   * Use as starting point when building a schema from source.
   */
  protected createEmptyEntity(name: string, collection?: string): EntitySchema {
    return {
      name: this.pascalCase(name),
      collection: collection ?? this.snakeCase(name) + 's',
      fields: {},
      relations: {},
      indexes: [],
      timestamps: false,
    };
  }

  /**
   * Validate an EntitySchema structure.
   * Returns array of error messages (empty array = valid).
   */
  protected validateEntitySchema(schema: EntitySchema): string[] {
    const errors: string[] = [];

    if (!schema.name || typeof schema.name !== 'string') {
      errors.push('name is required and must be a string');
    } else if (!/^[A-Z][a-zA-Z0-9]*$/.test(schema.name)) {
      errors.push(`name "${schema.name}" must be PascalCase`);
    }

    if (!schema.collection || typeof schema.collection !== 'string') {
      errors.push('collection is required and must be a string');
    }

    if (!schema.fields || typeof schema.fields !== 'object') {
      errors.push('fields must be an object');
    } else {
      for (const [key, field] of Object.entries(schema.fields)) {
        const fieldErrors = this.validateFieldDef(key, field);
        errors.push(...fieldErrors);
      }
    }

    if (!schema.relations || typeof schema.relations !== 'object') {
      errors.push('relations must be an object');
    } else {
      for (const [key, rel] of Object.entries(schema.relations)) {
        if (!rel.target) errors.push(`relation "${key}" missing target`);
        if (!['one-to-one', 'many-to-one', 'one-to-many', 'many-to-many'].includes(rel.type)) {
          errors.push(`relation "${key}" has invalid type: ${rel.type}`);
        }
      }
    }

    if (!Array.isArray(schema.indexes)) {
      errors.push('indexes must be an array');
    }

    if (typeof schema.timestamps !== 'boolean') {
      errors.push('timestamps must be a boolean');
    }

    if (schema.discriminator && !schema.discriminatorValue) {
      errors.push('discriminator requires discriminatorValue');
    }

    return errors;
  }

  /** Validate a single FieldDef */
  protected validateFieldDef(key: string, field: FieldDef): string[] {
    const errors: string[] = [];
    const validTypes: FieldType[] = [
      'string', 'text', 'number', 'boolean', 'date', 'json', 'array',
    ];
    if (!validTypes.includes(field.type)) {
      errors.push(`field "${key}" has invalid type: ${field.type}`);
    }
    if (field.type === 'array' && !field.arrayOf) {
      errors.push(`field "${key}" is array but arrayOf is missing`);
    }
    return errors;
  }
}
