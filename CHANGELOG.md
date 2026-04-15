# Changelog

All notable changes to `@mostajs/orm-adapter` will be documented in this file.

## [0.6.0] — 2026-04-15

### Added — bidirectional adapters (`fromEntitySchema` on all 4 adapters)

- **`PrismaAdapter.fromEntitySchema(entities)`** → emits a complete `.prisma`
  schema string (generator + datasource + enums + models). Maps :
  - field types (`string → String`, `number → Float`, `date → DateTime`, …)
  - `__MOSTA_NOW__` / `__MOSTA_OBJECT_ID__` sentinels → `@default(now())` / `@default(uuid())`
  - enums → dedicated `enum X { ... }` blocks (one per field-with-`enum`)
  - unique fields → `@unique`, composite unique → `@@unique([a, b])`
  - M:1 / 1:1 owning side → `fkId String?` + `rel X? @relation(fields: [fkId], references: [id])`
  - 1:N / N:N → `rel X[]` list
  - `@@map("collection")` when collection ≠ default snake_case + 's'
  - Round-trip `toEntitySchema(fromEntitySchema(entities))` validated on the
    40-entity FitZoneGym fixture : parses back without error.
- **`JsonSchemaAdapter.fromEntitySchema(entities)`** → emits a JSON Schema
  2020-12 document with `definitions: { EntityName: { type: 'object', ... } }`.
  Relations become `$ref` (or `array of $ref` for 1:N / N:N) plus a
  `x-mostajs-relation` extension that preserves the full `RelationDef` for
  lossless inverse conversion.
- **`OpenApiAdapter.fromEntitySchema(entities)`** → emits a minimal but valid
  OpenAPI 3.1 document with `components.schemas` holding every entity
  (same JSON-Schema shape). `paths: {}` — user wires routes on top.
- **`NativeAdapter.fromEntitySchema`** — already existed (passthrough),
  documented as such.

### Strategy

Round-trip is **best-effort** by design. Lossy cases emit
`WarningCode.LOSSY_CONVERSION` (e.g. exotic default values that don't map
cleanly). Use `strict: true` in `AdapterOptions` to fail fast on any warning.

## [0.5.1] — 2026-04-13

### Fixed

- **PrismaAdapter : duplicate column DDL error.** When a Prisma model declared
  both an explicit scalar field (e.g. `createdById`) AND a relation using it
  as `@relation(fields: [createdById], ...)`, the generated EntitySchema
  contained both the explicit field AND the relation's joinColumn. The ORM's
  DDL generator then emitted the same column twice, causing :
  `SQLITE_ERROR: duplicate column name: createdById`
  Fix : after processing a model, drop any explicit field whose name matches
  a relation's joinColumn (the relation owns the FK column in the DDL).

- **PrismaAdapter : duplicate createdAt / updatedAt** when timestamps convention
  is detected. Setting `timestamps: true` tells the ORM to auto-manage those
  columns, so they must NOT remain in `fields{}` (which would cause the DDL
  to emit them twice).
  Fix : when `timestamps: true` is enabled, `createdAt` and `updatedAt` are
  removed from `fields{}`.

### Impact

Validated on FitZoneGym (real production schema, 40 Prisma models) :
- Before : `initSchema` crashed with SQLITE_ERROR on User (duplicate createdById, updatedById, createdAt, updatedAt).
- After : all 40 tables created successfully on SQLite, PG and MongoDB.

## [0.5.0] — 2026-04-12

### Added

- **YAML input for OpenApiAdapter** : native support for YAML-formatted OpenAPI specs via `js-yaml`
  - Auto-detected in `canParse` when string matches `^\s*openapi:` or `^\s*swagger:`
  - No need to pre-parse with external library anymore
  - Fixture `petstore-3.1.yaml` added for regression
- **E2E tests on real-world specs** (`test-e2e-real.ts`) :
  - YAML OpenAPI round-trip
  - Realistic SaaS Prisma schema (cal.com/dub style) with 8 entities, implicit M-N, nested relations, enums, BigInt, Json, composite unique constraints
  - Swagger Petstore v3 (real spec from swagger.io) — 6 entities extracted with < 10 warnings
  - Cross-format registry dispatch (auto-detection Prisma + YAML + JSON)
  - Cross-format equivalence (entities pass through Native without alteration)

### Test coverage

238 tests across 5 suites (all passing) :
- 31 native
- 55 prisma
- 60 jsonschema
- 50 openapi
- **42 e2e-real** (new)

### Dependencies

- Added `js-yaml ^4.1.1` (for YAML parsing in OpenApiAdapter)
- Added `@types/js-yaml ^4.0.9` (dev)

## [0.4.0] — 2026-04-12

### Added

- **OpenApiAdapter** : converts OpenAPI 2.0/3.0/3.1 specs to `EntitySchema[]`
  - OpenAPI 3.1 : full JSON Schema 2020-12 semantics
  - OpenAPI 3.0.x : auto-normalized to 3.1 shape before conversion
    - `nullable: true` → `type: [T, "null"]`
    - `example: X` → `examples: [X]`
    - `exclusiveMinimum: true` + `minimum: X` → `exclusiveMinimum: X`
  - Swagger 2.0 detected with PREVIEW_FEATURE warning
  - Extracts all `components/schemas` as entities
  - Delegates to JsonSchemaAdapter for the schema conversion pipeline
  - **x-mostajs-relation preservation** : re-attaches extensions on $ref-bearing properties (dereference strips siblings)
  - **Title injection** : auto-adds `title: <key>` to each schema for relation detection
  - **Input forms** : object, JSON string (YAML requires pre-parsing)
  - Uses `@readme/openapi-parser` for validation + dereferencing
- **Utils** : `openapi-normalize` (3.0 → 3.1 transformations)
- **JsonSchemaAdapter.schemasToEntities()** : public method to convert a named schema map without root-detection heuristic
- 50 new unit tests on 3 fixtures :
  - `petstore-3.1.json` (3 entities, relations, discriminator, x-mostajs-*)
  - `petstore-3.0.json` (legacy with all normalizations)
  - `discriminator.json` (oneOf polymorphism)

### Changed

- `createDefaultRegistry()` now includes OpenApiAdapter (4 adapters total)
- `JsonSchemaAdapter.toEntitySchema()` : uses `structuredClone` instead of JSON.parse/stringify to handle circular refs from OpenAPI's dereferenced tree

### Total test coverage

196 tests across 4 adapters :
- 31 native
- 55 prisma
- 60 jsonschema
- 50 openapi

## [0.3.0] — 2026-04-12

### Added

- **JsonSchemaAdapter** : converts JSON Schema to `EntitySchema[]`
  - Drafts : Draft-07, Draft 2019-09, Draft 2020-12 (auto-detected via `$schema` URL)
  - Types : `string`, `integer`, `number`, `boolean`, `array`, `object`, `null`
  - Formats : `date-time`, `date`, `time`, `email`, `uuid`, `uri`, `uri-reference`, `ipv4`, `ipv6`, `regex`, `binary`, `byte`
  - Nullable : both OpenAPI `nullable: true` and array form `type: [T, "null"]`
  - Constraints : `enum`, `const`, `default`, `minLength`/`maxLength`, `pattern`, `minimum`/`maximum`
  - Annotations : `readOnly`, `writeOnly`, `deprecated`, `title`, `description` (preserved)
  - **allOf flattening** : merges parent properties into child (inheritance pattern)
  - **oneOf discriminator** : maps to `EntitySchema.discriminator` + `discriminatorValue`
  - **Entity detection** : top-level title/x-mostajs-entity + all `$defs` / `definitions`
  - **$ref resolution** : internal + external via `@apidevtools/json-schema-ref-parser`
  - **Cycle detection** : self-references flagged via CYCLIC_REFERENCE warning
- **Extensions** (all `x-*`) :
  - `x-mostajs-entity` : `{ tableName, timestamps, softDelete, discriminator, discriminatorValue }`
  - `x-mostajs-relation` : `{ type, target, foreignKey, otherKey, through, onDelete }`
  - `x-primary`, `x-unique`, `x-index`, `x-indexes` (composite)
  - `x-autoIncrement`
- **Auto-relation detection** :
  - Property is object with title matching an entity → `many-to-one`
  - Array items `$ref` to an entity → `one-to-many`
  - Explicit `x-mostajs-relation` always wins
- **Input forms** : plain object, JSON string, or `$ref`-laden schema (auto-dereferenced)
- **Utils** : `jsonschema-types` (shared types + draft detection), `jsonschema-type-mapper`, `jsonschema-flatten`
- **Public types re-exports** : `JsonSchema`, `JsonSchemaType`, `XMostajsEntity`, `XMostajsRelation`, `DraftVersion`
- 60 new unit tests on 4 fixtures :
  - `user-2020-12.json` (Draft 2020-12 + relations + indexes + x-mostajs-*)
  - `post-draft-07.json` (Draft-07 compat + auto-relation via $ref title)
  - `allof-composition.json` (allOf merge + required merge)
  - `validators.json` (all validators + composite x-indexes)

### Changed

- `createDefaultRegistry()` now includes JsonSchemaAdapter in the detection chain

### Warnings emitted (new)

- `PREVIEW_FEATURE` on Draft-04/06 (legacy drafts)
- `LOSSY_CONVERSION` on `int64` format, tuple `items`, binary/byte format
- `AMBIGUOUS_MAPPING` on allOf property redefinition (last-wins)
- `CYCLIC_REFERENCE` on self-referencing entities
- `FALLBACK_APPLIED` on non-object $defs entries

## [0.2.0] — 2026-04-12

### Added

- **PrismaAdapter** : converts `.prisma` files to `EntitySchema[]`
  - All scalar types : String, Int, BigInt, Float, Decimal, Boolean, DateTime, Json, Bytes
  - Modifiers : `?` (optional), `[]` (array)
  - Field attributes : `@id`, `@unique`, `@default`, `@map`, `@updatedAt`, `@db.VarChar(n)`
  - Model attributes : `@@id`, `@@unique`, `@@index`, `@@map`, `@@schema`, `@@fulltext`
  - Enums (as `FieldDef.enum`)
  - Relations : 1-1, 1-N, many-to-one, implicit M-N (synthesized `_ATo B` junction)
  - Self-relations (named via `@relation("Name")`)
  - Referential actions : Cascade, SetNull, Restrict, NoAction, SetDefault (warn → set-null)
  - `@default` sentinels : AUTOINCREMENT, NOW, UUID_V4/V7, CUID/CUID2, NANOID, ULID, OBJECT_ID
  - Auto-detection of `createdAt` + `updatedAt` convention → `timestamps: true`
- **Utils** : `prisma-ast-helpers`, `prisma-type-mapper`, `prisma-default-mapper`
- **DefaultSentinel** constants exported for downstream ORM interpretation
- 55 new unit tests (all passing) on 4 fixtures (blog, scalars, m2m-implicit, self-relation)

### Changed

- `createDefaultRegistry()` now pre-registers PrismaAdapter alongside NativeAdapter

### Warnings emitted (new)

- `LOSSY_CONVERSION` on BigInt, Decimal, Bytes
- `UNSUPPORTED_FEATURE` on `Unsupported("...")`, `@@ignore`, `onDelete: SetDefault`
- `PREVIEW_FEATURE` on `view`, composite `type`, `@@fulltext`, `@@schema`
- `UNKNOWN_EXTENSION` on unrecognized `@default(fn())`

## [0.1.0] — 2026-04-12

### Added

- Initial release
- **Core abstractions** : `IAdapter`, `AbstractAdapter`, `AdapterRegistry`
- **NativeAdapter** : passthrough for @mostajs/orm EntitySchema with structural validation
- Error types : `AdapterError`, `NoAdapterFoundError`, `InvalidSchemaError`, `StrictWarningError`
- Warning system with 8 standard codes (`UNSUPPORTED_FEATURE`, `LOSSY_CONVERSION`, etc.)
- Strict mode (warnings as exceptions)
- Helpers : case conversion (snake/pascal/camel), schema validation
- `createDefaultRegistry()` factory
- 31 unit tests (all passing)
- AGPL-3.0-or-later license + commercial option

### Planned for v0.2.0

- PrismaAdapter (MVP covering scalars, 1-1, 1-N, M-N, enums, native types)

### Planned for v0.3.0

- JsonSchemaAdapter (Draft 2020-12 + Draft-07 compat)

### Planned for v0.4.0

- OpenApiAdapter (3.1 with 3.0 normalization)
