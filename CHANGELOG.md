# Changelog

All notable changes to `@mostajs/orm-adapter` will be documented in this file.

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
