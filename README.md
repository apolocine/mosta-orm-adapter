# @mostajs/orm-adapter

> **Bidirectional schema conversion** between [@mostajs/orm](https://www.npmjs.com/package/@mostajs/orm) `EntitySchema[]` and **Prisma** / **JSON Schema** / **OpenAPI** / **Native TS**.
>
> Every adapter works **both directions** since v0.6.0 — import your legacy schema, or export EntitySchemas as Prisma / OpenAPI / JSON Schema for downstream tooling (Swagger UI, Ajv, Prisma CLI, …).

[![npm version](https://img.shields.io/npm/v/@mostajs/orm-adapter.svg)](https://www.npmjs.com/package/@mostajs/orm-adapter)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

## Adapters

| Adapter | Input format | `toEntitySchema` | `fromEntitySchema` |
|---|---|:-:|:-:|
| **Native** | `EntitySchema[]` object / JSON | ✅ passthrough + validation | ✅ passthrough |
| **Prisma** | `.prisma` file (string) | ✅ full | ✅ emits `.prisma` |
| **JSON Schema** | Draft 2020-12 / 2019-09 / Draft-07 | ✅ full | ✅ emits 2020-12 |
| **OpenAPI** | 3.1 / 3.0 / Swagger 2.0 (JSON or YAML) | ✅ full | ✅ emits OpenAPI 3.1 |

Validated on the FitZoneGym fixture (40 real models with enums, composite uniques, M:1, 1:N, N:N, self-relations).

## Install

```bash
npm install @mostajs/orm-adapter @mostajs/orm
```

---

## Quick start

### Auto-detection via Registry (recommended)

```ts
import { createDefaultRegistry } from '@mostajs/orm-adapter'
import { readFileSync } from 'fs'

const registry = createDefaultRegistry()   // registers native, prisma, jsonschema, openapi
const entities = await registry.fromAny(readFileSync('./schema.prisma', 'utf8'))
// → EntitySchema[]  — hand to @mostajs/orm's registerSchemas / initSchema
```

### Subpath imports (pull only the parser you need)

```ts
import { PrismaAdapter }     from '@mostajs/orm-adapter/prisma'
import { JsonSchemaAdapter } from '@mostajs/orm-adapter/jsonschema'
import { OpenApiAdapter }    from '@mostajs/orm-adapter/openapi'
import { NativeAdapter }     from '@mostajs/orm-adapter/native'
```

Subpath imports avoid pulling parsers you're not using (`@mrleebo/prisma-ast`, `ajv`, `@readme/openapi-parser`, `js-yaml`).

---

## Forward conversions — `toEntitySchema()`

### Prisma → `EntitySchema[]`

```ts
import { PrismaAdapter } from '@mostajs/orm-adapter/prisma'

const entities = await new PrismaAdapter().toEntitySchema(
  readFileSync('./schema.prisma', 'utf8'),
  { onWarning: w => console.warn(`[${w.code}] ${w.message}`) },
)
```

Handles every Prisma feature that maps cleanly : all scalars (String, Int, BigInt, Float, Decimal, Boolean, DateTime, Json, Bytes), modifiers (`?`, `[]`), field attributes (`@id`, `@unique`, `@default`, `@map`, `@updatedAt`, `@db.*`), model attributes (`@@id`, `@@unique`, `@@index`, `@@map`, `@@schema`, `@@fulltext`), enums, relations (1:1, 1:N, M:N with implicit junction synthesis, self-relations via `@relation("Name")`), referential actions, default sentinels (`AUTOINCREMENT`, `NOW`, `UUID_V4/V7`, `CUID/CUID2`, `NANOID`, `ULID`, `OBJECT_ID`), and auto-detection of the `createdAt` + `updatedAt` convention.

### JSON Schema → `EntitySchema[]`

```ts
import { JsonSchemaAdapter } from '@mostajs/orm-adapter/jsonschema'

const entities = await new JsonSchemaAdapter().toEntitySchema(jsonSchemaObject)
```

Supports every draft (2020-12 / 2019-09 / Draft-07), all formats (`date-time`, `uuid`, `uri`, `email`, …), nullable (OpenAPI 3.0 `nullable: true` *and* 3.1 `type: [T, "null"]`), `allOf` flattening (inheritance), `oneOf` discriminator, `$ref` resolution (internal + external), cycle detection. Honors `x-mostajs-entity`, `x-mostajs-relation`, `x-primary`, `x-unique`, `x-index`, `x-indexes`, `x-autoIncrement`.

### OpenAPI → `EntitySchema[]`

```ts
import { OpenApiAdapter } from '@mostajs/orm-adapter/openapi'

// JSON object, JSON string, or YAML string — all accepted
const entities = await new OpenApiAdapter().toEntitySchema(openApiSpec)
```

- **OpenAPI 3.1** : full JSON Schema 2020-12 semantics
- **OpenAPI 3.0.x** : auto-normalized to 3.1 shape (`nullable: true` → `type: [T, "null"]`, `example: X` → `examples: [X]`, etc.)
- **Swagger 2.0** : detected, emits `PREVIEW_FEATURE` warning (no full support)
- **YAML input** parsed natively via `js-yaml` — no pre-parse needed

### Native (passthrough + validation)

```ts
import { NativeAdapter } from '@mostajs/orm-adapter/native'

const validated = await new NativeAdapter().toEntitySchema(mySchemas)
// Accepts { name, collection, fields, ... } — runs structural validation,
// warns on missing required properties, returns the same array.
```

---

## Reverse conversions — `fromEntitySchema()` (since v0.6.0)

The reverse direction lets you **export** your `EntitySchema[]` to any supported format — for migrations *out*, for downstream tooling (Swagger UI, Ajv, Prisma CLI), or for cross-team handoff.

### `EntitySchema[]` → Prisma

```ts
import { PrismaAdapter } from '@mostajs/orm-adapter/prisma'

const prismaSrc: string = await new PrismaAdapter().fromEntitySchema(entities)
// Complete .prisma string : generator + datasource + enums + models
await writeFile('./schema.prisma', prismaSrc)
// Then : npx prisma generate, npx prisma migrate dev, …
```

Emits a full Prisma schema (generator client + datasource db + enum blocks + model blocks). Mapping :

| EntitySchema feature | Prisma emit |
|---|---|
| `type: 'string'` / `'text'` | `String` |
| `type: 'number'` | `Float` |
| `type: 'boolean'` / `'date'` / `'json'` | `Boolean` / `DateTime` / `Json` |
| `type: 'array', arrayOf: 'string'` | `String[]` (optional modifier omitted — arrays already allow empty) |
| `enum: [...]` on a field | dedicated `enum EntityField { ... }` block |
| `required: false` | `?` modifier |
| `unique: true` | `@unique` |
| `default: '__MOSTA_NOW__' / 'now'` | `@default(now())` |
| `default: '__MOSTA_OBJECT_ID__' / '__MOSTA_UUID__'` | `@default(uuid())` |
| `default: <scalar>` | `@default(X)` — enum values unquoted, strings quoted |
| `relation.type: 'many-to-one' / 'one-to-one'` (owning) | `fkId String?` + `rel X? @relation(fields: [fkId], references: [id])` |
| `relation.type: 'many-to-one' / 'one-to-one'` (mappedBy / inverse) | `rel X?` (no `@relation`) |
| `relation.type: 'one-to-many'` / `'many-to-many'` | `rel X[]` |
| `relation.onDelete` | `, onDelete: Cascade / SetNull / Restrict / NoAction` |
| `indexes: [{ unique: true, fields: { a: 'asc', b: 'asc' } }]` | `@@unique([a, b])` |
| `indexes: [{ fields: { ... } }]` (non-unique) | `@@index([...])` |
| `collection: "members"` (when ≠ default) | `@@map("members")` |

Override the emitted `datasource` block via `opts.extensions.datasource`:

```ts
const out = await new PrismaAdapter().fromEntitySchema(entities, {
  extensions: {
    datasource: { provider: 'postgresql', url: 'env("DATABASE_URL")' },
  },
})
```

**Round-trip** : `toEntitySchema(fromEntitySchema(entities))` parses back without error on the 40-entity FitZoneGym fixture. Field-level properties (type, required, unique, default sentinels) survive the round-trip. Caveats : `@@index` columns without sort order are emitted without direction ; exotic `@map` overrides can lose alias data.

### `EntitySchema[]` → JSON Schema 2020-12

```ts
import { JsonSchemaAdapter } from '@mostajs/orm-adapter/jsonschema'

const doc: object = await new JsonSchemaAdapter().fromEntitySchema(entities)
// {
//   "$schema": "https://json-schema.org/draft/2020-12/schema",
//   "title":   "mostajs entities",
//   "definitions": {
//     "User":    { "$id": "User",    "type": "object", "properties": { ... }, "required": [...] },
//     "Profile": { "$id": "Profile", ... }
//   }
// }
```

Relations become `$ref` (for M:1 / 1:1) or `{ type: 'array', items: { $ref } }` (for 1:N / N:N), annotated with an `x-mostajs-relation` extension that preserves the full `RelationDef` (type, joinColumn, mappedBy, onDelete, cascade, fetch, …) for lossless reverse conversion.

Extension fields emitted for round-trip fidelity :

- `x-mostajs-collection` — table/collection name
- `x-mostajs-timestamps` — boolean
- `x-mostajs-unique` (on a property) — field-level unique
- `x-mostajs-indexes` — full `indexes` array
- `x-mostajs-relation` (on a property) — full `RelationDef`

### `EntitySchema[]` → OpenAPI 3.1

```ts
import { OpenApiAdapter } from '@mostajs/orm-adapter/openapi'

const spec: object = await new OpenApiAdapter().fromEntitySchema(entities)
// {
//   "openapi": "3.1.0",
//   "info":    { "title": "mostajs entities", "version": "1.0.0" },
//   "paths":   {},
//   "components": { "schemas": { "User": {...}, "Profile": {...} } }
// }
await writeFile('./openapi.json', JSON.stringify(spec, null, 2))
```

Produces a minimal but valid OpenAPI 3.1 document. `paths` is empty — the developer wires routes on top. The schema shapes in `components.schemas` are identical to the JSON Schema variant (same mapping, same `x-mostajs-*` extensions), so tools like Swagger UI, Redoc, Scalar, or Stoplight render the generated schemas out of the box.

### `EntitySchema[]` → Native (passthrough)

```ts
import { NativeAdapter } from '@mostajs/orm-adapter/native'

const out = await new NativeAdapter().fromEntitySchema(entities)
// → Array<EntitySchema> — returns the same array, validated for structural shape
```

Useful when you want structural validation before handing the schemas off to `@mostajs/orm`.

---

## Via `@mostajs/orm-cli` (no code)

If you prefer the interactive CLI, `@mostajs/orm-cli@0.4.6+` exposes the reverse adapters behind **menu `e`) Export entities** :

```bash
npx @mostajs/orm-cli@latest
# → menu e
#
#   1) Prisma        → prisma/schema.prisma
#   2) JSON Schema   → schema.json (2020-12)
#   3) OpenAPI 3.1   → openapi.json
#   4) Native (TS)   → src/schemas.ts
```

The CLI reads `.mostajs/generated/entities.json` (produced by menu 1 — Convert) and writes the chosen format to disk.

---

## API reference

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
| `extensions` | `Record<string, unknown>` | Custom values (e.g. `datasource` override for Prisma reverse) |
| `relationStrategy` | `'explicit' \| 'auto' \| 'none'` | Relation detection mode (forward only) |
| `unknownTypesFallback` | `'json' \| 'error' \| 'string'` | Fallback for unmappable types (forward only) |

### Warning codes

- `UNSUPPORTED_FEATURE` — source has a feature the target cannot express
- `LOSSY_CONVERSION` — precision or constraint lost during mapping
- `MISSING_METADATA` — expected metadata absent
- `AMBIGUOUS_MAPPING` — multiple valid interpretations
- `PREVIEW_FEATURE` — experimental / preview feature used
- `FALLBACK_APPLIED` — default strategy applied
- `CYCLIC_REFERENCE` — self-referencing schema detected
- `UNKNOWN_EXTENSION` — unrecognized `x-*` extension

### Registry

```ts
import { createDefaultRegistry, AdapterRegistry } from '@mostajs/orm-adapter'

const registry = createDefaultRegistry()
// or build your own :
const reg = new AdapterRegistry()
reg.register(new PrismaAdapter())
reg.register(new JsonSchemaAdapter())

// Auto-detect the right adapter
const entities = await reg.fromAny(input)

// Explicit selection
const entities2 = await reg.fromAny(input, { adapterName: 'prisma' })
```

## Writing a custom adapter

```ts
import { AbstractAdapter, WarningCode, type AdapterOptions } from '@mostajs/orm-adapter'
import type { EntitySchema } from '@mostajs/orm'

export class MyCustomAdapter extends AbstractAdapter {
  readonly name    = 'my-format'
  readonly vendor  = 'my-org'
  readonly version = '0.1.0'

  canParse(input: string | object): boolean {
    return typeof input === 'string' && input.includes('@my-format')
  }

  async toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]> {
    // Emit a warning that doesn't fail by default, but does fail with opts.strict:
    this.warn(opts, {
      code: WarningCode.LOSSY_CONVERSION,
      message: 'Some feature cannot be mapped exactly',
      entity: 'Foo',
    })
    return [/* ... EntitySchema[] */]
  }

  // Optional : reverse direction
  async fromEntitySchema(entities: EntitySchema[]): Promise<string> {
    return entities.map(e => `my-format ${e.name} { ... }`).join('\n')
  }
}
```

---

## Roadmap

- **v0.1.0 – v0.5.1** ✅ Forward adapters for all 4 formats + 238 tests + YAML + real-world fixes (40-entity FitZoneGym schema)
- **v0.6.0** ✅ **Bidirectional** — `fromEntitySchema` on all 4 adapters, integrated into `@mostajs/orm-cli` via menu `e`
- **v0.7.0** — Round-trip strictness : `toPrismaSchema(fromPrismaSchema(x)) ≡ x` on the field-for-field level (stable `@@map`, `@db.*` preservation)
- **v1.0.0** — Production-ready : plugin API, CLI `mostajs export --to <format>` subcommand, published type definitions for downstream `tsup` / `rollup` use

## Ecosystem

- [@mostajs/orm](https://www.npmjs.com/package/@mostajs/orm) — the ORM backing all these schemas (13 databases)
- [@mostajs/orm-bridge](https://www.npmjs.com/package/@mostajs/orm-bridge) — keep your Prisma code, run on 13 databases (drop-in `createPrismaLikeDb`)
- [@mostajs/orm-cli](https://www.npmjs.com/package/@mostajs/orm-cli) — interactive CLI (Convert / Apply / Seed / Export / Bootstrap)

## License

**AGPL-3.0-or-later** + commercial license available.

For closed-source commercial use : drmdh@msn.com

## Author

Dr Hamid MADANI <drmdh@msn.com>

---

Part of the [@mostajs ecosystem](https://github.com/apolocine) — 13 databases, 11 transports, one unified backend.
