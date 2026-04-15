// prisma.adapter.ts
// Converts Prisma schema (.prisma) to EntitySchema[] for @mostajs/orm.
// Parser: @mrleebo/prisma-ast (pure TypeScript, no Rust binary).
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import { getSchema, type Schema, type Model, type Field, type Attribute } from '@mrleebo/prisma-ast';
import type { EntitySchema, FieldDef, FieldType, RelationDef, RelationType, IndexDef, OnDeleteAction } from '@mostajs/orm';
import { AbstractAdapter } from '../core/abstract.adapter.js';
import { WarningCode, type AdapterOptions, type AdapterWarning } from '../core/types.js';
import { InvalidSchemaError } from '../core/errors.js';
import {
  getModels,
  buildEnumMap,
  buildModelNameSet,
  getFields,
  getBlockAttributes,
  hasFieldAttribute,
  getFieldAttribute,
  getDbAttribute,
  getArgValue,
  getKeyValueArg,
  getPositionalArgs,
  getFieldTypeName,
  isUnsupportedType,
} from '../utils/prisma-ast-helpers.js';
import { mapPrismaScalar, extractDbMetadata } from '../utils/prisma-type-mapper.js';
import { mapPrismaDefault } from '../utils/prisma-default-mapper.js';

/**
 * PrismaAdapter — converts .prisma files to EntitySchema[].
 *
 * Supports (MVP v0.2.0):
 *  - All scalar types (String, Int, BigInt, Float, Decimal, Boolean, DateTime, Json, Bytes)
 *  - Modifiers (?, [])
 *  - @id, @unique, @default, @map, @updatedAt
 *  - @@id, @@unique, @@index, @@map
 *  - @db.VarChar(N), @db.Decimal(p,s) (metadata extraction)
 *  - Enums (as FieldDef.enum)
 *  - Relations 1-1, 1-N, M-N (implicit & explicit)
 *  - Self-relations (named)
 *  - onDelete actions (Cascade, SetNull, Restrict, NoAction, SetDefault)
 *
 * Not yet supported (v0.3+):
 *  - Composite types (MongoDB embedded docs)
 *  - Views (preview)
 *  - Multi-schema
 *  - @@fulltext, specialized @@index(type: Gin)
 */
export class PrismaAdapter extends AbstractAdapter {
  readonly name = 'prisma';
  readonly vendor = 'prisma.io';
  readonly version = '0.2.0';

  canParse(input: string | object): boolean {
    if (typeof input !== 'string') return false;
    // Detect presence of Prisma schema block keywords
    return /^\s*(datasource|generator|model|enum)\s+\w+\s*\{/m.test(input);
  }

  async toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]> {
    if (typeof input !== 'string') {
      throw new InvalidSchemaError('PrismaAdapter expects a string (.prisma file contents)');
    }

    let ast: Schema;
    try {
      ast = getSchema(input);
    } catch (e) {
      throw new InvalidSchemaError(
        `Failed to parse .prisma: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }

    const models = getModels(ast);
    const enumMap = buildEnumMap(ast);
    const modelNames = buildModelNameSet(ast);

    // Emit a warning per preview feature detected in source (best-effort)
    this.detectPreviewFeatures(input, opts);

    // First pass : convert each model to EntitySchema (without M-N synthesis yet)
    const entities = models.map(m => this.modelToEntity(m, enumMap, modelNames, opts));

    // Second pass : detect implicit M-N relations and synthesize junction entries
    this.synthesizeImplicitM2M(entities, models, modelNames, opts);

    return entities;
  }

  // ============================================================
  // Model -> Entity conversion
  // ============================================================

  private modelToEntity(
    model: Model,
    enumMap: Map<string, string[]>,
    modelNames: Set<string>,
    opts: AdapterOptions | undefined
  ): EntitySchema {
    const entity: EntitySchema = {
      name: model.name,
      collection: this.resolveTableName(model),
      fields: {},
      relations: {},
      indexes: [],
      timestamps: false,
    };

    const fields = getFields(model);

    // ---- Field-level : classify field vs relation ----
    for (const field of fields) {
      if (this.isRelationField(field, modelNames, enumMap)) {
        const rel = this.fieldToRelation(field, model.name, opts);
        if (rel) entity.relations[field.name] = rel;
      } else {
        const fd = this.fieldToFieldDef(field, model.name, enumMap, opts);
        if (fd) entity.fields[field.name] = fd;
      }
    }

    // ---- Block-level : @@id, @@unique, @@index, @@map, @@schema ----
    for (const attr of getBlockAttributes(model)) {
      this.applyBlockAttribute(attr, entity, opts);
    }

    // ---- Detect timestamps convention (createdAt + updatedAt) ----
    // If both exist, enable timestamps:true AND remove the explicit fields
    // (the ORM DDL generator adds them automatically — leaving them in
    //  fields{} would cause duplicate columns at CREATE TABLE time).
    if (this.hasTimestampsConvention(fields)) {
      entity.timestamps = true;
      delete entity.fields.createdAt;
      delete entity.fields.updatedAt;
    }

    // ---- Deduplicate : if a relation's joinColumn matches an explicit field,
    //      drop the explicit field (the relation owns that column in the DDL).
    //      Without this, Prisma schemas like `createdById String?; createdBy User @relation(fields: [createdById], references: [id])`
    //      would produce two "createdById" columns. ----
    this.dedupeRelationJoinColumns(entity);

    return entity;
  }

  /**
   * When a relation's `joinColumn` equals the name of an explicit field,
   * remove the explicit field — the relation is the owning side and the
   * DDL generator will emit the FK column from it.
   *
   * Keeps the ORM's relation semantics correct and avoids "duplicate column"
   * errors at CREATE TABLE time.
   */
  private dedupeRelationJoinColumns(entity: EntitySchema): void {
    for (const rel of Object.values(entity.relations)) {
      if (rel.joinColumn && entity.fields[rel.joinColumn]) {
        delete entity.fields[rel.joinColumn];
      }
    }
  }

  private resolveTableName(model: Model): string {
    const mapAttr = getBlockAttributes(model).find(a => a.name === 'map');
    if (mapAttr) {
      const v = getArgValue(mapAttr);
      if (typeof v === 'string') return this.unquote(v);
    }
    return this.snakeCase(model.name);
  }

  // ============================================================
  // Field classification
  // ============================================================

  private isRelationField(
    field: Field,
    modelNames: Set<string>,
    enumMap: Map<string, string[]>
  ): boolean {
    // Relation = field whose type is another model (or array of a model)
    // NOT an enum, NOT a scalar
    if (isUnsupportedType(field)) return false;
    const t = getFieldTypeName(field);
    if (modelNames.has(t)) return true;
    if (enumMap.has(t)) return false;
    return false;  // scalar or unknown
  }

  // ============================================================
  // Field -> FieldDef
  // ============================================================

  private fieldToFieldDef(
    field: Field,
    entityName: string,
    enumMap: Map<string, string[]>,
    opts: AdapterOptions | undefined
  ): FieldDef | null {
    const fieldName = field.name;

    // Handle Unsupported("xxx") : not mappable
    if (isUnsupportedType(field)) {
      this.warn(opts, {
        code: WarningCode.UNSUPPORTED_FEATURE,
        message: `Unsupported type for "${fieldName}" — field ignored`,
        entity: entityName,
        field: fieldName,
      });
      return null;
    }

    const prismaType = getFieldTypeName(field);

    // Check if type is an enum
    if (enumMap.has(prismaType)) {
      const values = enumMap.get(prismaType)!;
      const fd: FieldDef = {
        type: 'string',
        required: !field.optional && !field.array,
        enum: values,
      };
      this.applyFieldAttributes(field, fd, entityName, enumMap, opts);
      return fd;
    }

    // Scalar type
    const mapping = mapPrismaScalar(prismaType, fieldName, entityName, opts, w => this.warn(opts, w));
    if (!mapping) {
      this.warn(opts, {
        code: WarningCode.UNSUPPORTED_FEATURE,
        message: `Unknown type "${prismaType}" for field "${fieldName}"`,
        entity: entityName,
        field: fieldName,
      });
      return null;
    }

    const fd: FieldDef = {
      type: mapping.type,
      required: !field.optional && !field.array,
    };

    // Array modifier → arrayOf
    if (field.array) {
      fd.type = 'array';
      fd.arrayOf = mapping.type;
    }

    this.applyFieldAttributes(field, fd, entityName, enumMap, opts);
    return fd;
  }

  private applyFieldAttributes(
    field: Field,
    fd: FieldDef,
    entityName: string,
    enumMap: Map<string, string[]>,
    opts: AdapterOptions | undefined
  ): void {
    // @unique
    if (hasFieldAttribute(field, 'unique')) {
      fd.unique = true;
    }

    // @default(...)
    const defaultAttr = getFieldAttribute(field, 'default');
    if (defaultAttr) {
      const raw = getArgValue(defaultAttr);
      const enumValues = enumMap.get(getFieldTypeName(field));
      const mapped = mapPrismaDefault(
        raw, field.name, entityName, enumValues, opts,
        w => this.warn(opts, w)
      );
      if (mapped !== undefined) fd.default = mapped;
    }

    // @db.VarChar(N), @db.Decimal(p,s) — extract metadata (not persisted in FieldDef,
    // but can be attached via future meta field; for now, no-op)
    const dbAttr = getDbAttribute(field);
    if (dbAttr) {
      const args = getPositionalArgs(dbAttr);
      const meta = extractDbMetadata(dbAttr.name, args);
      // TODO: persist meta if EntitySchema ever supports it
      void meta;
    }
  }

  // ============================================================
  // Field -> RelationDef
  // ============================================================

  private fieldToRelation(
    field: Field,
    entityName: string,
    opts: AdapterOptions | undefined
  ): RelationDef | null {
    const target = getFieldTypeName(field);
    const isArray = !!field.array;
    const isOptional = !!field.optional;

    // Determine relation type :
    // - field: Target[]          -> one-to-many (or many-to-many, resolved in second pass)
    // - field: Target            -> many-to-one (child side of 1-N, or owning side of 1-1)
    // - field: Target?           -> one-to-one (nullable back-reference)
    let type: RelationType;
    if (isArray) {
      type = 'one-to-many';  // may be upgraded to 'many-to-many' in second pass
    } else {
      // Check if there's a @relation with fields: — indicates owning side of 1-N or 1-1
      type = 'many-to-one';
    }

    const rel: RelationDef = {
      target,
      type,
    };

    if (!isOptional && !isArray) rel.required = true;
    if (isOptional && !isArray) rel.nullable = true;

    // Parse @relation(...)
    const relAttr = getFieldAttribute(field, 'relation');
    if (relAttr) {
      const fieldsList = getKeyValueArg(relAttr, 'fields');
      const referencesList = getKeyValueArg(relAttr, 'references');
      const onDelete = getKeyValueArg(relAttr, 'onDelete');
      const nameArg = getPositionalArgs(relAttr)[0];

      if (Array.isArray(fieldsList) && fieldsList.length > 0) {
        rel.joinColumn = String(fieldsList[0]);
      }
      if (Array.isArray(referencesList) && referencesList.length > 0) {
        // references[0] = PK of target; usually 'id'. We keep for reverse-engineering.
      }
      if (typeof onDelete === 'string') {
        rel.onDelete = this.mapReferentialAction(onDelete, field.name, entityName, opts);
      }
      if (typeof nameArg === 'string') {
        rel.mappedBy = this.unquote(nameArg);  // self-relation disambiguation name
      }
    }

    return rel;
  }

  private mapReferentialAction(
    action: string,
    fieldName: string,
    entityName: string,
    opts: AdapterOptions | undefined
  ): OnDeleteAction {
    switch (action) {
      case 'Cascade':    return 'cascade';
      case 'SetNull':    return 'set-null';
      case 'Restrict':   return 'restrict';
      case 'NoAction':   return 'no-action';
      case 'SetDefault':
        this.warn(opts, {
          code: WarningCode.UNSUPPORTED_FEATURE,
          message: `onDelete: SetDefault on "${fieldName}" not portable; using set-null`,
          entity: entityName,
          field: fieldName,
        });
        return 'set-null';
      default:
        return 'no-action';
    }
  }

  // ============================================================
  // Block-level attributes (@@id, @@unique, @@index, @@map, @@schema)
  // ============================================================

  private applyBlockAttribute(
    attr: Attribute,
    entity: EntitySchema,
    opts: AdapterOptions | undefined
  ): void {
    switch (attr.name) {
      case 'id': {
        // @@id([a, b]) — composite primary key. EntitySchema has no composite PK,
        // so we emit as composite unique index.
        const fields = getPositionalArgs(attr)[0];
        if (Array.isArray(fields)) {
          const index: IndexDef = {
            fields: Object.fromEntries(fields.map(f => [String(f), 'asc'])),
            unique: true,
          };
          entity.indexes.push(index);
          this.warn(opts, {
            code: WarningCode.LOSSY_CONVERSION,
            message: `@@id composite PK on ${entity.name} mapped to unique index; implicit _id still expected`,
            entity: entity.name,
          });
        }
        break;
      }
      case 'unique': {
        const fields = getPositionalArgs(attr)[0];
        if (Array.isArray(fields)) {
          entity.indexes.push({
            fields: Object.fromEntries(fields.map(f => [String(f), 'asc'])),
            unique: true,
          });
        }
        break;
      }
      case 'index': {
        const fields = getPositionalArgs(attr)[0];
        if (Array.isArray(fields)) {
          entity.indexes.push({
            fields: Object.fromEntries(fields.map(f => [String(f), 'asc'])),
          });
        }
        break;
      }
      case 'map':
        // Already handled in resolveTableName
        break;
      case 'schema':
        this.warn(opts, {
          code: WarningCode.PREVIEW_FEATURE,
          message: `@@schema on ${entity.name} (multi-schema preview) not reflected in EntitySchema`,
          entity: entity.name,
        });
        break;
      case 'fulltext':
        this.warn(opts, {
          code: WarningCode.PREVIEW_FEATURE,
          message: `@@fulltext on ${entity.name} mapped to regular index`,
          entity: entity.name,
        });
        break;
      case 'ignore':
        this.warn(opts, {
          code: WarningCode.UNSUPPORTED_FEATURE,
          message: `@@ignore on ${entity.name} not represented in EntitySchema`,
          entity: entity.name,
        });
        break;
    }
  }

  // ============================================================
  // Implicit M-N synthesis
  // ============================================================

  /**
   * Prisma allows implicit M-N: `categories Category[]` on both sides with NO join
   * table declared. The adapter detects these and upgrades one-to-many pairs to
   * many-to-many, synthesizing `through` as `_${A}To${B}` (Prisma's convention).
   */
  private synthesizeImplicitM2M(
    entities: EntitySchema[],
    models: Model[],
    modelNames: Set<string>,
    opts: AdapterOptions | undefined
  ): void {
    // For each pair of DISTINCT models where both sides reference each other with []
    // and neither side has a joinColumn (fields:), upgrade to many-to-many.
    for (const entity of entities) {
      for (const [relName, rel] of Object.entries(entity.relations)) {
        if (rel.type !== 'one-to-many') continue;

        // Skip self-relations — they are 1-N hierarchies (parent/children), not M-N
        if (rel.target === entity.name) continue;

        const otherEntity = entities.find(e => e.name === rel.target);
        if (!otherEntity) continue;

        // Find the reverse relation on the other side
        const reverseRel = Object.values(otherEntity.relations).find(
          r => r.target === entity.name && r.type === 'one-to-many'
        );
        if (!reverseRel) continue;

        // If neither side has a joinColumn (fields:), it's implicit M-N
        if (!rel.joinColumn && !reverseRel.joinColumn) {
          rel.type = 'many-to-many';
          reverseRel.type = 'many-to-many';

          // Prisma convention : table name is `_${A}To${B}` sorted alphabetically
          const [a, b] = [entity.name, otherEntity.name].sort();
          const throughName = `_${a}To${b}`;
          rel.through = throughName;
          reverseRel.through = throughName;
        }
      }
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  private hasTimestampsConvention(fields: Field[]): boolean {
    const names = new Set(fields.map(f => f.name));
    return names.has('createdAt') && names.has('updatedAt');
  }

  private unquote(s: string): string {
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    return s;
  }

  private detectPreviewFeatures(source: string, opts: AdapterOptions | undefined): void {
    const previews = [
      { pattern: /\bview\s+\w+\s*\{/i, name: 'views' },
      { pattern: /\btype\s+\w+\s*\{/i, name: 'composite types (Mongo)' },
      { pattern: /previewFeatures\s*=/i, name: 'generator previewFeatures' },
    ];

    for (const { pattern, name } of previews) {
      if (pattern.test(source)) {
        this.warn(opts, {
          code: WarningCode.PREVIEW_FEATURE,
          message: `Detected use of ${name}; MVP may not fully support this`,
        });
      }
    }
  }

  // ============================================================
  // Reverse : EntitySchema[] → .prisma string (best-effort)
  // ============================================================
  //
  // Emits a complete Prisma schema text including a default `datasource db`
  // and `generator client` block. Round-trip is best-effort : we preserve
  // field types, required flag, unique, default, enums, relations
  // (M:1, 1:N, M:N via `through`), composite uniques, and indexes. Lossy
  // by design : we don't currently round-trip @map(name) overrides, raw
  // SQL types, or generator previewFeatures — these emit warnings.

  async fromEntitySchema(
    entities: EntitySchema[],
    opts?: AdapterOptions,
  ): Promise<string> {
    const lines: string[] = [];

    // Header — datasource + generator (sqlite default ; user overrides via opts)
    const dataSource = (opts?.extensions as any)?.datasource ?? {
      provider: 'sqlite',
      url: 'env("DATABASE_URL")',
    };
    lines.push(
      `// Generated by @mostajs/orm-adapter — fromEntitySchema (Prisma)`,
      `// Round-trip is best-effort. Edit freely after generation.`,
      ``,
      `generator client {`,
      `  provider = "prisma-client-js"`,
      `}`,
      ``,
      `datasource db {`,
      `  provider = "${dataSource.provider}"`,
      `  url      = ${dataSource.url.startsWith('env(') ? dataSource.url : `"${dataSource.url}"`}`,
      `}`,
      ``,
    );

    // Collect all enums declared inline on fields (de-duplicated by name)
    const enums = new Map<string, string[]>();
    for (const e of entities) {
      for (const [fname, f] of Object.entries(e.fields ?? {})) {
        if (f.enum && f.enum.length) {
          const enumName = `${e.name}${this.pascalCase(fname)}`;
          if (!enums.has(enumName)) enums.set(enumName, f.enum as string[]);
        }
      }
    }
    for (const [name, values] of enums) {
      lines.push(`enum ${name} {`);
      for (const v of values) lines.push(`  ${v}`);
      lines.push(`}`, ``);
    }

    // Models
    for (const e of entities) {
      lines.push(...this.entityToModel(e, enums, opts));
      lines.push(``);
    }

    return lines.join('\n');
  }

  private entityToModel(
    e: EntitySchema,
    enums: Map<string, string[]>,
    opts: AdapterOptions | undefined,
  ): string[] {
    const lines: string[] = [`model ${e.name} {`];

    // id field — always emit first
    const idField = e.fields?.id;
    const idType = idField?.type === 'number' ? 'Int' : 'String';
    const idDefault = idField?.default && (idField.default === '__MOSTA_OBJECT_ID__' || idField.default === '__MOSTA_UUID__')
      ? '@default(uuid())'
      : idType === 'Int' ? '@default(autoincrement())' : '@default(uuid())';
    lines.push(`  id ${idType} @id ${idDefault}`);

    // Other fields
    for (const [fname, f] of Object.entries(e.fields ?? {})) {
      if (fname === 'id') continue;
      lines.push(`  ${this.fieldToPrismaLine(e.name, fname, f, enums, opts)}`);
    }

    // Relations
    for (const [rname, rel] of Object.entries(e.relations ?? {})) {
      lines.push(...this.relationToPrismaLines(e, rname, rel, opts));
    }

    // Composite unique indexes
    for (const idx of e.indexes ?? []) {
      const fields = Object.keys(idx.fields ?? {});
      if (idx.unique && fields.length > 1) {
        lines.push(`  @@unique([${fields.join(', ')}])`);
      } else if (!idx.unique && fields.length) {
        lines.push(`  @@index([${fields.join(', ')}])`);
      }
    }

    if (e.collection && e.collection !== this.snakeCase(e.name) + 's') {
      lines.push(`  @@map("${e.collection}")`);
    }

    lines.push(`}`);
    return lines;
  }

  private fieldToPrismaLine(
    entityName: string,
    fname: string,
    f: FieldDef,
    enums: Map<string, string[]>,
    opts: AdapterOptions | undefined,
  ): string {
    let type = this.fieldTypeToPrisma(f.type);
    // Enum override
    if (f.enum && f.enum.length) {
      type = `${entityName}${this.pascalCase(fname)}`;
    }
    // Array
    if (f.type === 'array') {
      const inner = f.arrayOf === 'string' ? 'String'
                  : f.arrayOf === 'number' ? 'Float'
                  : f.arrayOf === 'boolean' ? 'Boolean'
                  : 'String';
      type = `${inner}[]`;
    }
    let line = `${fname} ${type}`;
    // Arrays in Prisma are inherently optional (T[] already implies 0+). Adding
    // '?' after '[]' is a parse error — skip the '?' for array types.
    const isArray = f.type === 'array';
    if (!f.required && !isArray) line += '?';
    if (f.unique) line += ' @unique';
    if (f.default !== undefined) {
      const def = this.defaultToPrisma(f, !!f.enum);
      if (def) line += ` ${def}`;
      else this.warn(opts, {
        code: WarningCode.LOSSY_CONVERSION,
        entity: entityName,
        field: fname,
        message: `Default value not directly mappable to Prisma : ${JSON.stringify(f.default)}`,
      });
    }
    return line;
  }

  private fieldTypeToPrisma(t: FieldType): string {
    switch (t) {
      case 'string':  return 'String';
      case 'text':    return 'String';
      case 'number':  return 'Float';
      case 'boolean': return 'Boolean';
      case 'date':    return 'DateTime';
      case 'json':    return 'Json';
      case 'array':   return 'String';   // overridden to T[] above
      default:        return 'String';
    }
  }

  private defaultToPrisma(f: FieldDef, isEnum = false): string {
    const v = f.default;
    if (v === '__MOSTA_NOW__' || v === 'now') return '@default(now())';
    if (v === '__MOSTA_OBJECT_ID__' || v === '__MOSTA_UUID__') return '@default(uuid())';
    if (v === null) return '';
    if (typeof v === 'boolean') return `@default(${v})`;
    if (typeof v === 'number')  return `@default(${v})`;
    if (typeof v === 'string') {
      // Enum defaults in Prisma are unquoted identifiers : @default(MEMBER).
      if (isEnum) return `@default(${v})`;
      return `@default("${v.replace(/"/g, '\\"')}")`;
    }
    return '';
  }

  private relationToPrismaLines(
    e: EntitySchema,
    rname: string,
    rel: any,
    _opts: AdapterOptions | undefined,
  ): string[] {
    const target = rel.target as string;
    const isOptional = !rel.required;
    const optMark = isOptional ? '?' : '';
    switch (rel.type) {
      case 'many-to-one':
      case 'one-to-one': {
        if (rel.mappedBy) {
          // Inverse 1:1 — no FK on this side, just declare the relation
          return [`  ${rname} ${target}${optMark}`];
        }
        const fk = rel.joinColumn || (rname + 'Id');
        const out = [
          `  ${fk} String${optMark}`,
          `  ${rname} ${target}${optMark} @relation(fields: [${fk}], references: [id]${rel.onDelete ? `, onDelete: ${this.cascadeToPrisma(rel.onDelete)}` : ''})`,
        ];
        return out;
      }
      case 'one-to-many':
        return [`  ${rname} ${target}[]`];
      case 'many-to-many':
        return [`  ${rname} ${target}[]`];
      default:
        return [];
    }
  }

  private cascadeToPrisma(action: string): string {
    const map: Record<string, string> = {
      'cascade': 'Cascade', 'set-null': 'SetNull',
      'restrict': 'Restrict', 'no-action': 'NoAction',
    };
    return map[action] ?? 'NoAction';
  }
}
