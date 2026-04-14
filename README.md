# @mostajs/orm-adapter

> **Convert Prisma / JSON Schema / OpenAPI schemas to [@mostajs/orm](https://github.com/apolocine/mosta-orm) `EntitySchema[]`.**
>
> One canonical format, four adapters, 238 tests, production-validated on a 40-model real-world Prisma schema.

[![npm version](https://img.shields.io/npm/v/@mostajs/orm-adapter.svg)](https://www.npmjs.com/package/@mostajs/orm-adapter)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

## Adapters

| Adapter | Input | Status | Notes |
|---|---|---|---|
| **Native** | `EntitySchema[]` | ✅ v0.1 | Passthrough with structural validation |
| **Prisma** | `.prisma` file | ✅ v0.2 / fixes in v0.5.1 | All scalars, 1-1, 1-N, M-N (implicit), enums, native types, auto-timestamps detection |
| **JSONSchema** | Draft 2020-12 / 2019-09 / Draft-07 | ✅ v0.3 | `allOf` flattening, `oneOf` discriminator, `x-mostajs-*` extensions |
| **OpenAPI** | 3.1 / 3.0 / Swagger 2.0 | ✅ v0.4 / YAML in v0.5 | 3.0→3.1 auto-normalization, `$ref` dereferencing |

Tests : **238 passing** across 5 suites (native / prisma / jsonschema / openapi / e2e-real).

## Install

```bash
npm install @mostajs/orm-adapter @mostajs/orm
```

## Quick start

### Auto-detection via Registry (recommended)

```ts
import { createDefaultRegistry } from '@mostajs/orm-adapter'
import { readFileSync } from 'fs'

const registry = createDefaultRegistry()   // registers native, prisma, jsonschema, openapi
const source   = readFileSync('./schema.prisma', 'utf8')
const entities = await registry.fromAny(source)
// → EntitySchema[]  — hand to @mostajs/orm's `registerSchemas` / `initSchema`
```

### Subpath imports (avoid pulling all deps)

```ts
import { PrismaAdapter }     from '@mostajs/orm-adapter/prisma'
import { JsonSchemaAdapter } from '@mostajs/orm-adapter/jsonschema'
import { OpenApiAdapter }    from '@mostajs/orm-adapter/openapi'
import { NativeAdapter }     from '@mostajs/orm-adapter/native'
```

Subpath imports only pull the parser libs you actually need (`@mrleebo/prisma-ast`, `ajv`, `@readme/openapi-parser`, `js-yaml`).

### Prisma

```ts
import { PrismaAdapter } from '@mostajs/orm-adapter/prisma'

const adapter  = new PrismaAdapter()
const entities = await adapter.toEntitySchema(readFileSync('./schema.prisma', 'utf8'), {
  onWarning: w => console.warn(`[${w.code}] ${w.message}`),
})
```

Supports all scalars (String, Int, BigInt, Float, Decimal, Boolean, DateTime, Json, Bytes), modifiers (`?`, `[]`), field attributes (`@id`, `@unique`, `@default`, `@map`, `@updatedAt`, `@db.*`), model attributes (`@@id`, `@@unique`, `@@index`, `@@map`, `@@schema`, `@@fulltext`), enums, relations (1-1, 1-N, many-to-one, implicit M-N with junction synthesis, self-relations named via `@relation("Name")`), referential actions, default sentinels (`AUTOINCREMENT`, `NOW`, `UUID_V4/V7`, `CUID/CUID2`, `NANOID`, `ULID`, `OBJECT_ID`), and auto-detection of `createdAt` + `updatedAt` convention.

### JSON Schema

```ts
import { JsonSchemaAdapter } from '@mostajs/orm-adapter/jsonschema'

const adapter  = new JsonSchemaAdapter()
const entities = await adapter.toEntitySchema(jsonSchemaObject)
```

Supports all draft types + formats (`date-time`, `uuid`, `uri`, `email`, …), nullable (OpenAPI `nullable: true` and array-form `type: [T, "null"]`), `allOf` flattening (inheritance), `oneOf` discriminator, `$ref` resolution (internal + external), cycle detection. Recognizes `x-mostajs-entity`, `x-mostajs-relation`, `x-primary`, `x-unique`, `x-index`, `x-indexes`, `x-autoIncrement`.

### OpenAPI

```ts
import { OpenApiAdapter } from '@mostajs/orm-adapter/openapi'

const adapter  = new OpenApiAdapter()
const entities = await adapter.toEntitySchema(openApiSpec)   // JSON object, JSON string, or YAML string
```

- OpenAPI 3.1 : full JSON Schema 2020-12 semantics
- OpenAPI 3.0.x : auto-normalized to 3.1 shape (`nullable: true` → `type: [T, "null"]`, `example: X` → `examples: [X]`, etc.)
- Swagger 2.0 : detected, emits `PREVIEW_FEATURE` warning
- YAML input supported natively (no pre-parsing needed)

## Recent fixes (v0.5.1)

**PrismaAdapter : duplicate column DDL errors** on real-world schemas.
- When a model declared both an explicit scalar field (e.g. `createdById`) AND a relation using it as `@relation(fields: [createdById], ...)`, the generated EntitySchema contained the same column twice → `SQLITE_ERROR: duplicate column name`.
- Timestamps convention : when `timestamps: true` is detected, `createdAt` / `updatedAt` were still present in `fields{}`, causing DDL to emit them twice.

Both fixed. Validated on FitZoneGym (40 real Prisma models) : all tables now create cleanly on SQLite, PostgreSQL, and MongoDB.

## API

### `IAdapter` interface

```ts
interface IAdapter {
  readonly name: string
  readonly vendor: string
  readonly version: string
  canParse(input: string | object): boolean
  toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]>
  fromEntitySchema?(entities: EntitySchema[], opts?: AdapterOptions): Promise<string | object>
}
```

### `AdapterOptions`

| Option | Type | Description |
|--------|------|-------------|
| `strict` | `boolean` | Warnings become exceptions (fail-fast) |
| `onWarning` | `(w: AdapterWarning) => void` | Callback for each warning |
| `extensions` | `Record<string, unknown>` | Custom values for `x-mostajs-*` |
| `relationStrategy` | `'explicit' \| 'auto' \| 'none'` | Relation detection mode |
| `unknownTypesFallback` | `'json' \| 'error' \| 'string'` | Fallback for unmappable types |

### Warning codes

- `UNSUPPORTED_FEATURE` — source has a feature the target cannot express
- `LOSSY_CONVERSION` — precision or constraint lost during mapping
- `MISSING_METADATA` — expected metadata absent
- `AMBIGUOUS_MAPPING` — multiple valid interpretations
- `PREVIEW_FEATURE` — experimental/preview feature used
- `FALLBACK_APPLIED` — default strategy applied
- `CYCLIC_REFERENCE` — self-referencing schema detected
- `UNKNOWN_EXTENSION` — unrecognized `x-*` extension

## Writing a custom adapter

```ts
import { AbstractAdapter, type AdapterOptions, WarningCode } from '@mostajs/orm-adapter'
import type { EntitySchema } from '@mostajs/orm'

export class MyCustomAdapter extends AbstractAdapter {
  readonly name    = 'my-format'
  readonly vendor  = 'my-org'
  readonly version = '0.1.0'

  canParse(input: string | object): boolean {
    return typeof input === 'string' && input.includes('@my-format')
  }

  async toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]> {
    this.warn(opts, {
      code: WarningCode.LOSSY_CONVERSION,
      message: 'Some feature lost during mapping',
      entity: 'Foo',
    })
    return [/* ... */]
  }
}
```

## Roadmap

- **v0.1.0** ✅ — NativeAdapter + core (AbstractAdapter, Registry)
- **v0.2.0** ✅ — PrismaAdapter
- **v0.3.0** ✅ — JsonSchemaAdapter
- **v0.4.0** ✅ — OpenApiAdapter
- **v0.5.0** ✅ — YAML input + 238 tests including e2e-real
- **v0.5.1** ✅ — PrismaAdapter DDL fixes (joinColumn dedup, timestamps)
- **v0.6.0** 🚧 — `fromEntitySchema` for all 4 adapters (bidirectional conversion)
- **v1.0.0** — Production-ready : round-trip tests (Prisma → ORM → Prisma), plugin API

## Ecosystem

- [@mostajs/orm](https://www.npmjs.com/package/@mostajs/orm) — the ORM backing all these schemas
- [@mostajs/orm-bridge](https://www.npmjs.com/package/@mostajs/orm-bridge) — keep your Prisma code, run on 13 databases
- [@mostajs/orm-cli](https://www.npmjs.com/package/@mostajs/orm-cli) — one-shot migration

## License

**AGPL-3.0-or-later** + commercial license available.

For closed-source commercial use : drmdh@msn.com

## Author

Dr Hamid MADANI <drmdh@msn.com>

---

Part of the [@mostajs ecosystem](https://github.com/apolocine) — 13 databases, 11 transports, one unified backend.
