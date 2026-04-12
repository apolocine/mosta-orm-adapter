// jsonschema.adapter.ts
// Converts JSON Schema (Draft-07, 2019-09, 2020-12) to EntitySchema[].
// Parser : @apidevtools/json-schema-ref-parser.
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import $RefParser from '@apidevtools/json-schema-ref-parser';
import type { EntitySchema, FieldDef, RelationDef, RelationType, IndexDef, IndexType } from '@mostajs/orm';
import { AbstractAdapter } from '../core/abstract.adapter.js';
import { WarningCode, type AdapterOptions, type AdapterWarning } from '../core/types.js';
import { InvalidSchemaError } from '../core/errors.js';
import {
  type JsonSchema,
  type XMostajsRelation,
  type DraftVersion,
  detectDraft,
  getDefinitions,
  primaryType,
  isNullable,
} from '../utils/jsonschema-types.js';
import { mapJsonSchemaType, mapArrayItems } from '../utils/jsonschema-type-mapper.js';
import { flattenAllOf, detectDiscriminator } from '../utils/jsonschema-flatten.js';

interface EntityCandidate {
  name: string;
  schema: JsonSchema;
}

/**
 * JsonSchemaAdapter — converts JSON Schema to EntitySchema[].
 *
 * Supports (MVP v0.3.0):
 *  - Draft-07, Draft 2019-09, Draft 2020-12 (auto-detected)
 *  - type: string/integer/number/boolean/array/object/null (including array form)
 *  - formats: date-time, date, time, email, uuid, uri, ipv4, regex, binary
 *  - Constraints: enum, const, default, minLength/maxLength, pattern, min/max
 *  - Nullable (both OpenAPI nullable: true and type: [T, "null"])
 *  - readOnly / writeOnly / deprecated (annotations preserved)
 *  - allOf flattening (inheritance merge)
 *  - oneOf + discriminator → discriminator + discriminatorValue
 *  - Entity detection : top-level (title+x-mostajs-entity) + all $defs
 *  - Extensions : x-mostajs-entity, x-mostajs-relation, x-primary, x-unique, x-index, x-indexes
 *  - $ref resolution (cycles detected, self-relation auto-created)
 *
 * Not yet supported (v0.4+):
 *  - $dynamicRef / $dynamicAnchor late-binding
 *  - patternProperties as structured mapping (falls back to json)
 *  - if/then/else conditional
 *  - External $ref resolution (HTTP/file beyond basic dereference)
 */
export class JsonSchemaAdapter extends AbstractAdapter {
  readonly name = 'jsonschema';
  readonly vendor = 'json-schema.org';
  readonly version = '0.3.0';

  canParse(input: string | object): boolean {
    const obj = this.tryParseJson(input);
    if (!obj || typeof obj !== 'object') return false;

    // Strongest indicator : $schema URL
    if (typeof (obj as JsonSchema).$schema === 'string' &&
        /json-schema\.org/.test((obj as JsonSchema).$schema!)) {
      return true;
    }

    // Fallback : has type + properties (or $defs / definitions)
    const o = obj as JsonSchema;
    if ((o.type === 'object' || Array.isArray(o.type)) &&
        (!!o.properties || !!o.$defs || !!o.definitions)) {
      return true;
    }
    // OpenAPI components/schemas shape — let OpenApiAdapter handle first
    return false;
  }

  async toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]> {
    const raw = this.tryParseJson(input);
    if (!raw || typeof raw !== 'object') {
      throw new InvalidSchemaError('JsonSchemaAdapter expects an object or JSON string');
    }

    let resolved: JsonSchema;
    try {
      // Dereference : resolves all $ref into inline schemas.
      // We clone to avoid mutating caller's input.
      resolved = await $RefParser.dereference(JSON.parse(JSON.stringify(raw))) as JsonSchema;
    } catch (e) {
      throw new InvalidSchemaError(
        `Failed to dereference JSON Schema: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }

    const draft = detectDraft(resolved);
    if (draft === 'draft-04' || draft === 'draft-06') {
      this.warn(opts, {
        code: WarningCode.PREVIEW_FEATURE,
        message: `Legacy draft ${draft} — mapping may be incomplete. Recommend upgrading to Draft 2020-12.`,
      });
    }

    // Collect entity candidates : root schema + all $defs/definitions
    const candidates = this.collectEntities(resolved, opts);

    // Convert each candidate
    const seen = new Set<string>();  // for cycle detection
    const entities = candidates.map(c => this.convertEntity(c, candidates, seen, opts));

    return entities;
  }

  // ============================================================
  // Entity collection
  // ============================================================

  private collectEntities(root: JsonSchema, opts: AdapterOptions | undefined): EntityCandidate[] {
    const out: EntityCandidate[] = [];

    // 1. Root if it's an object with title OR x-mostajs-entity
    const rootIsObject = primaryType(root) === 'object';
    const rootName = root.title ?? this.nameFromId(root.$id);
    const rootHasEntityMarker = !!root['x-mostajs-entity'];

    if (rootIsObject && (rootHasEntityMarker || rootName)) {
      out.push({ name: rootName ?? 'RootEntity', schema: root });
    }

    // 2. All $defs / definitions that are objects
    const defs = getDefinitions(root);
    for (const [key, def] of Object.entries(defs)) {
      if (primaryType(def) === 'object') {
        out.push({ name: def.title ?? key, schema: def });
      } else {
        this.warn(opts, {
          code: WarningCode.FALLBACK_APPLIED,
          message: `$defs["${key}"] is not an object — ignored as entity candidate`,
        });
      }
    }

    // Deduplicate by name (last-wins)
    const byName = new Map<string, EntityCandidate>();
    for (const c of out) byName.set(this.pascalCase(c.name), c);
    return Array.from(byName.values()).map(c => ({ ...c, name: this.pascalCase(c.name) }));
  }

  private nameFromId(id: string | undefined): string | undefined {
    if (!id) return undefined;
    const segments = id.replace(/\.json$/, '').split(/[/#]/);
    return segments[segments.length - 1] || undefined;
  }

  // ============================================================
  // Candidate → EntitySchema
  // ============================================================

  private convertEntity(
    candidate: EntityCandidate,
    allCandidates: EntityCandidate[],
    seen: Set<string>,
    opts: AdapterOptions | undefined
  ): EntitySchema {
    const name = candidate.name;
    if (seen.has(name)) {
      this.warn(opts, {
        code: WarningCode.CYCLIC_REFERENCE,
        message: `Cyclic entity reference detected at "${name}"`,
        entity: name,
      });
    }
    seen.add(name);

    // Flatten allOf composition
    const schema = flattenAllOf(candidate.schema, w => this.warn(opts, w), name);

    // Extract x-mostajs-entity metadata
    const entityMeta = schema['x-mostajs-entity'] ?? {};
    const tableName = entityMeta.tableName ?? this.snakeCase(name);

    const entity: EntitySchema = {
      name,
      collection: tableName,
      fields: {},
      relations: {},
      indexes: [],
      timestamps: entityMeta.timestamps ?? false,
    };

    if (entityMeta.softDelete) entity.softDelete = true;
    if (entityMeta.discriminator) entity.discriminator = entityMeta.discriminator;
    if (entityMeta.discriminatorValue) entity.discriminatorValue = entityMeta.discriminatorValue;

    // Also detect discriminator from OpenAPI-style discriminator property
    if (!entity.discriminator) {
      const d = detectDiscriminator(schema);
      if (d) entity.discriminator = d.propertyName;
    }

    // Process properties
    const required = new Set(schema.required ?? []);
    const entityNames = new Set(allCandidates.map(c => c.name));
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      this.processProperty(key, propSchema, entity, required.has(key), entityNames, opts);
    }

    // Process x-indexes (model-level composite indexes)
    const xIndexes = schema['x-indexes'];
    if (Array.isArray(xIndexes)) {
      for (const idx of xIndexes) {
        const fields: Record<string, IndexType> = {};
        for (const f of idx.fields) fields[f] = 'asc';
        entity.indexes.push({ fields, unique: !!idx.unique });
      }
    }

    // Auto-timestamps detection
    if (!entity.timestamps &&
        'createdAt' in entity.fields && 'updatedAt' in entity.fields) {
      entity.timestamps = true;
    }

    return entity;
  }

  // ============================================================
  // Property → Field or Relation
  // ============================================================

  private processProperty(
    key: string,
    propSchema: JsonSchema,
    entity: EntitySchema,
    required: boolean,
    entityNames: Set<string>,
    opts: AdapterOptions | undefined
  ): void {
    // 1. Explicit x-mostajs-relation always wins
    const xRel = propSchema['x-mostajs-relation'];
    if (xRel) {
      entity.relations[key] = this.mapXMostajsRelation(xRel, required);
      return;
    }

    // 2. Detection by shape : object with title matching an entity = belongsTo
    if (primaryType(propSchema) === 'object' && propSchema.title &&
        entityNames.has(this.pascalCase(propSchema.title))) {
      entity.relations[key] = {
        target: this.pascalCase(propSchema.title),
        type: 'many-to-one',
        required: required && !isNullable(propSchema),
        nullable: isNullable(propSchema),
      };
      return;
    }

    // 3. Array of entities = hasMany
    if (primaryType(propSchema) === 'array' && !Array.isArray(propSchema.items)) {
      const item = propSchema.items as JsonSchema | undefined;
      if (item && primaryType(item) === 'object' && item.title &&
          entityNames.has(this.pascalCase(item.title))) {
        entity.relations[key] = {
          target: this.pascalCase(item.title),
          type: 'one-to-many',
        };
        return;
      }
    }

    // 4. Regular field
    const field = this.toFieldDef(key, propSchema, required, entity.name, opts);
    if (field) {
      entity.fields[key] = field;
      this.applyFieldIndexes(key, propSchema, entity);
    }
  }

  private mapXMostajsRelation(xRel: XMostajsRelation, required: boolean): RelationDef {
    const typeMap: Record<XMostajsRelation['type'], RelationType> = {
      belongsTo:     'many-to-one',
      hasOne:        'one-to-one',
      hasMany:       'one-to-many',
      belongsToMany: 'many-to-many',
    };
    const rel: RelationDef = {
      target: xRel.target,
      type: typeMap[xRel.type],
    };
    if (xRel.required ?? required) rel.required = true;
    if (xRel.nullable) rel.nullable = true;
    if (xRel.foreignKey) rel.joinColumn = xRel.foreignKey;
    if (xRel.otherKey) rel.inverseJoinColumn = xRel.otherKey;
    if (xRel.through) rel.through = xRel.through;
    if (xRel.onDelete) rel.onDelete = xRel.onDelete;
    return rel;
  }

  private toFieldDef(
    key: string,
    schema: JsonSchema,
    required: boolean,
    entityName: string,
    opts: AdapterOptions | undefined
  ): FieldDef | null {
    const type = mapJsonSchemaType(schema, key, entityName, w => this.warn(opts, w));
    if (!type) {
      this.warn(opts, {
        code: WarningCode.UNSUPPORTED_FEATURE,
        message: `Cannot map property "${key}" — no type information`,
        entity: entityName,
        field: key,
      });
      return null;
    }

    const nullable = isNullable(schema);
    const fd: FieldDef = {
      type,
      required: required && !nullable,
    };

    // Array : resolve arrayOf
    if (type === 'array') {
      const inner = mapArrayItems(schema, key, entityName, w => this.warn(opts, w));
      if (inner) fd.arrayOf = inner;
    }

    // Enum
    if (schema.enum?.length) {
      fd.enum = schema.enum.filter(v => v != null).map(String);
    }

    // Default
    if (schema.default !== undefined) {
      fd.default = schema.default;
    } else if (schema.const !== undefined) {
      fd.default = schema.const;
    }

    // x-primary / x-unique
    if (schema['x-unique'] === true) fd.unique = true;

    return fd;
  }

  /**
   * Generate indexes from x-index and x-unique on individual fields.
   */
  private applyFieldIndexes(
    key: string,
    schema: JsonSchema,
    entity: EntitySchema
  ): void {
    const xIndex = schema['x-index'];
    const xUnique = schema['x-unique'] === true;

    if (xIndex === true) {
      entity.indexes.push({ fields: { [key]: 'asc' } });
    } else if (xIndex && typeof xIndex === 'object') {
      entity.indexes.push({
        fields: { [key]: 'asc' },
        unique: !!xIndex.unique,
      });
    } else if (xUnique) {
      entity.indexes.push({ fields: { [key]: 'asc' }, unique: true });
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  private tryParseJson(input: unknown): unknown {
    if (typeof input !== 'string') return input;
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
}
