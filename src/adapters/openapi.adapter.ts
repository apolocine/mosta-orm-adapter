// openapi.adapter.ts
// Converts OpenAPI 3.0 / 3.1 specifications to EntitySchema[].
// Extracts components/schemas and feeds them through the JsonSchema pipeline.
// Parser : @readme/openapi-parser (supports 2.0, 3.0, 3.1 complet).
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import { dereference, validate } from '@readme/openapi-parser';
import yaml from 'js-yaml';
import type { EntitySchema } from '@mostajs/orm';
import { AbstractAdapter } from '../core/abstract.adapter.js';
import { WarningCode, type AdapterOptions, type AdapterWarning } from '../core/types.js';
import { InvalidSchemaError } from '../core/errors.js';
import { JsonSchemaAdapter } from './jsonschema.adapter.js';
import type { JsonSchema } from '../utils/jsonschema-types.js';
import { normalizeComponentsSchemas, isOpenApi30 } from '../utils/openapi-normalize.js';

interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * OpenApiAdapter — converts OpenAPI specs to EntitySchema[].
 *
 * Supported (MVP v0.4.0) :
 *  - OpenAPI 3.0.x (auto-normalized to 3.1 shape before conversion)
 *  - OpenAPI 3.1.x (JSON Schema 2020-12 compliant)
 *  - Extracts all `components/schemas` as entities
 *  - All features of JsonSchemaAdapter (allOf, discriminator, $ref, x-mostajs-*, etc.)
 *  - 3.0→3.1 normalizations :
 *      - `nullable: true` → `type: [T, "null"]`
 *      - `example: X` → `examples: [X]`
 *      - `exclusiveMinimum: true` → `exclusiveMinimum: <number>`
 *  - Input : object, JSON string, YAML string, or file path (via @readme/openapi-parser)
 *
 * Not supported yet (v0.5+) :
 *  - paths → CRUD endpoint deduction (opt-in flag planned)
 *  - Inline schemas inside `paths` (only `components/schemas` become entities)
 *  - Webhooks (detected, parsed, but not mapped to entities)
 *  - `pathItems` components (parsed, not used for entities)
 *  - File upload body (kept as string with warning)
 */
export class OpenApiAdapter extends AbstractAdapter {
  readonly name = 'openapi';
  readonly vendor = 'openapis.org';
  readonly version = '0.4.0';

  /** Internal JsonSchemaAdapter used to convert normalized schemas */
  private readonly jsonSchemaAdapter = new JsonSchemaAdapter();

  canParse(input: string | object): boolean {
    const obj = this.tryParseAny(input);
    if (!obj || typeof obj !== 'object') return false;

    const doc = obj as OpenApiDoc;
    // Strongest indicator : `openapi: "3.x.y"` field
    if (typeof doc.openapi === 'string' && /^3\./.test(doc.openapi)) return true;

    // Swagger 2.0 shape (not yet supported but let us detect and warn)
    if ((obj as { swagger?: string }).swagger === '2.0') return true;

    // YAML heuristic on raw string input
    if (typeof input === 'string' && /^\s*openapi\s*:\s*['"]?3\./m.test(input)) return true;
    if (typeof input === 'string' && /^\s*swagger\s*:\s*['"]?2\.0/m.test(input)) return true;

    return false;
  }

  async toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]> {
    // 1. Normalize input to object (parse JSON string if needed).
    //    @readme/openapi-parser treats strings as file paths — we want inline parsing.
    const specInput = this.resolveInput(input);

    // 2. Pre-annotate components.schemas with title = key, so dereference propagates names.
    this.injectSchemaTitles(specInput);

    // 3. Pre-extract x-mostajs-relation from $ref-bearing properties before dereference.
    //    json-schema-ref-parser strips siblings when resolving $ref.
    const relationOverrides = this.extractRelationOverrides(specInput);

    // 4. Parse + dereference via @readme/openapi-parser
    let spec: OpenApiDoc;
    try {
      // We validate first for diagnostics, but don't fail on warnings
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const report = await (validate as any)(this.cloneForParser(specInput));
      if (!(report as { valid?: boolean }).valid) {
        this.warn(opts, {
          code: WarningCode.FALLBACK_APPLIED,
          message: `OpenAPI spec has validation issues; proceeding anyway`,
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spec = (await (dereference as any)(this.cloneForParser(specInput))) as OpenApiDoc;
    } catch (e) {
      throw new InvalidSchemaError(
        `Failed to parse OpenAPI spec: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }

    // 4b. Re-attach x-mostajs-relation overrides on each property
    this.reattachRelationOverrides(spec, relationOverrides);

    // 2. Warn if Swagger 2.0 (not fully supported)
    if ((spec as { swagger?: string }).swagger === '2.0') {
      this.warn(opts, {
        code: WarningCode.PREVIEW_FEATURE,
        message: `Swagger 2.0 input — conversion may be incomplete. Consider migrating to OpenAPI 3.1.`,
      });
    }

    const version = spec.openapi;
    if (isOpenApi30(version)) {
      // Handled by normalize below — just informational
    }

    // 3. Extract components.schemas
    const rawSchemas = spec.components?.schemas;
    if (!rawSchemas || Object.keys(rawSchemas).length === 0) {
      this.warn(opts, {
        code: WarningCode.MISSING_METADATA,
        message: `OpenAPI spec has no components.schemas — no entities extracted`,
      });
      return [];
    }

    // 4. Normalize 3.0 → 3.1 if needed
    const normalized = normalizeComponentsSchemas(
      spec.components,
      version,
      w => this.warn(opts, w)
    );

    if (!normalized) return [];

    // 5. Ensure each schema has a title so inline detection works post-dereference
    const titled: Record<string, JsonSchema> = {};
    for (const [name, schema] of Object.entries(normalized)) {
      titled[name] = schema.title ? schema : { ...schema, title: name };
    }

    // 6. Delegate to JsonSchemaAdapter
    return this.jsonSchemaAdapter.schemasToEntities(titled, opts);
  }

  /**
   * Walk the ORIGINAL (pre-dereference) spec and record all x-mostajs-relation
   * extensions on properties that also have a $ref. These siblings are stripped
   * during dereference, so we capture them here and re-attach after.
   */
  private extractRelationOverrides(
    doc: OpenApiDoc
  ): Map<string, Map<string, unknown>> {
    const map = new Map<string, Map<string, unknown>>();  // schemaName -> propName -> xRel
    const schemas = doc.components?.schemas;
    if (!schemas) return map;

    for (const [schemaName, schema] of Object.entries(schemas)) {
      if (!schema?.properties) continue;
      const propMap = new Map<string, unknown>();
      for (const [propName, prop] of Object.entries(schema.properties)) {
        const p = prop as Record<string, unknown>;
        if (p['x-mostajs-relation']) {
          propMap.set(propName, p['x-mostajs-relation']);
        }
      }
      if (propMap.size > 0) map.set(schemaName, propMap);
    }
    return map;
  }

  /**
   * After dereference, re-attach the x-mostajs-relation extensions we extracted.
   * The property schema becomes `{ ...inlinedRef, 'x-mostajs-relation': saved }`.
   */
  private reattachRelationOverrides(
    doc: OpenApiDoc,
    overrides: Map<string, Map<string, unknown>>
  ): void {
    const schemas = doc.components?.schemas;
    if (!schemas) return;

    for (const [schemaName, propMap] of overrides) {
      const schema = schemas[schemaName];
      if (!schema?.properties) continue;
      for (const [propName, xRel] of propMap) {
        const prop = schema.properties[propName];
        if (prop && typeof prop === 'object') {
          (prop as Record<string, unknown>)['x-mostajs-relation'] = xRel;
        }
      }
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  /** Clone input for the parser (must not mutate caller's input) */
  private cloneForParser(input: object): unknown {
    return typeof structuredClone === 'function'
      ? structuredClone(input)
      : JSON.parse(JSON.stringify(input));
  }

  /**
   * Normalize input to object form.
   * Supports:
   *  - plain JS object (no parsing)
   *  - JSON string (starts with `{`)
   *  - YAML string (common OpenAPI format)
   *
   * @readme/openapi-parser treats strings as file paths (not content),
   * so we parse strings ourselves here.
   */
  private resolveInput(input: string | object): OpenApiDoc {
    if (typeof input !== 'string') return input as OpenApiDoc;
    const trimmed = input.trim();

    // JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as OpenApiDoc;
      } catch (e) {
        throw new InvalidSchemaError(
          `Invalid JSON input: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // YAML
    try {
      const parsed = yaml.load(trimmed, { schema: yaml.JSON_SCHEMA });
      if (parsed && typeof parsed === 'object') {
        return parsed as OpenApiDoc;
      }
      throw new InvalidSchemaError('YAML parsed to non-object value');
    } catch (e) {
      throw new InvalidSchemaError(
        `Invalid YAML/JSON input: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * Ensure each schema in components.schemas has `title: <key>`.
   * After dereference, inlined schemas need a title for JsonSchemaAdapter's
   * relation detection (which matches property schema titles against entity names).
   */
  private injectSchemaTitles(doc: OpenApiDoc): void {
    const schemas = doc.components?.schemas;
    if (!schemas) return;
    for (const [name, schema] of Object.entries(schemas)) {
      if (schema && typeof schema === 'object' && !schema.title) {
        schema.title = name;
      }
    }
  }

  /** Parse JSON string if necessary — used for canParse detection only */
  private tryParseAny(input: unknown): unknown {
    if (typeof input !== 'string') return input;
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try { return JSON.parse(trimmed); } catch { /* fall through */ }
    }
    if (/^\s*openapi\s*:\s*['"]?3\./m.test(trimmed)) {
      return { openapi: '3.0.0' };  // placeholder to pass canParse
    }
    return null;
  }
}
