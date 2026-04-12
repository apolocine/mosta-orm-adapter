# @mostajs/orm-adapter

> Third-party schema adapters for [@mostajs/orm](https://github.com/apolocine/mosta-orm).
> Convert Prisma, JSON Schema, OpenAPI, and more to `EntitySchema[]`.

[![npm version](https://img.shields.io/npm/v/@mostajs/orm-adapter.svg)](https://www.npmjs.com/package/@mostajs/orm-adapter)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

## Why

@mostajs/orm supports **13 databases** with a unified `EntitySchema` format. This package bridges that format with the rest of the ecosystem, letting you reuse schemas you already have:

- **Prisma** `.prisma` files → EntitySchema[] (planned)
- **JSON Schema** Draft 2020-12 → EntitySchema[] (planned)
- **OpenAPI 3.1** `components/schemas` → EntitySchema[] (planned)
- **Native** EntitySchema → EntitySchema[] (passthrough, **v0.1.0**)

## Install

```bash
npm install @mostajs/orm-adapter @mostajs/orm
```

## Quick start

### Native passthrough (validation layer)

```ts
import { NativeAdapter } from '@mostajs/orm-adapter';
import type { EntitySchema } from '@mostajs/orm';

const UserSchema: EntitySchema = {
  name: 'User',
  collection: 'users',
  fields: {
    email: { type: 'string', required: true, unique: true },
  },
  relations: {},
  indexes: [{ fields: { email: 'asc' }, unique: true }],
  timestamps: true,
};

const adapter = new NativeAdapter();
const entities = await adapter.toEntitySchema(UserSchema);
// -> EntitySchema[]
```

### Auto-detection via Registry

```ts
import { createDefaultRegistry } from '@mostajs/orm-adapter';

const registry = createDefaultRegistry();
const entities = await registry.fromAny(unknownInput);
// Auto-detects format (native / prisma / jsonschema / openapi)
```

### Strict mode — fail fast on invalid schema

```ts
try {
  await adapter.toEntitySchema(maybeInvalid, { strict: true });
} catch (e) {
  if (e instanceof InvalidSchemaError) console.error(e.details);
}
```

### Collect warnings for logging

```ts
await adapter.toEntitySchema(userSchema, {
  onWarning: (w) => logger.warn(`[${w.code}] ${w.message}`, {
    entity: w.entity,
    field: w.field,
  }),
});
```

## API

### `IAdapter` interface

```ts
interface IAdapter {
  readonly name: string;
  readonly vendor: string;
  readonly version: string;
  canParse(input: string | object): boolean;
  toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]>;
  fromEntitySchema?(entities: EntitySchema[], opts?: AdapterOptions): Promise<string | object>;
}
```

### `AdapterOptions`

| Option | Type | Description |
|--------|------|-------------|
| `strict` | `boolean` | Warnings become exceptions (fail-fast) |
| `onWarning` | `(w: AdapterWarning) => void` | Callback for each warning |
| `extensions` | `Record<string, unknown>` | Custom values for x-mostajs-* |
| `relationStrategy` | `'explicit' \| 'auto' \| 'none'` | Relation detection mode |
| `unknownTypesFallback` | `'json' \| 'error' \| 'string'` | Fallback for unmappable types |

### Warning codes

- `UNSUPPORTED_FEATURE` — source has a feature the target cannot express
- `LOSSY_CONVERSION` — precision or constraint lost during mapping
- `MISSING_METADATA` — expected metadata absent
- `AMBIGUOUS_MAPPING` — multiple valid interpretations
- `PREVIEW_FEATURE` — experimental/preview feature used
- `FALLBACK_APPLIED` — default strategy used
- `CYCLIC_REFERENCE` — self-referencing schema detected
- `UNKNOWN_EXTENSION` — unrecognized x-* extension

## Building your own adapter

```ts
import { AbstractAdapter, type AdapterOptions, WarningCode } from '@mostajs/orm-adapter';
import type { EntitySchema } from '@mostajs/orm';

export class MyCustomAdapter extends AbstractAdapter {
  readonly name = 'my-format';
  readonly vendor = 'my-org';
  readonly version = '0.1.0';

  canParse(input: string | object): boolean {
    // Fast, non-destructive detection
    return typeof input === 'string' && input.includes('@my-format');
  }

  async toEntitySchema(input: string | object, opts?: AdapterOptions): Promise<EntitySchema[]> {
    // 1. Parse your source format
    // 2. Map to EntitySchema[]
    // 3. Emit warnings for lossy conversions
    this.warn(opts, {
      code: WarningCode.LOSSY_CONVERSION,
      message: 'Some feature lost during mapping',
      entity: 'Foo',
    });
    return [/* ... */];
  }
}
```

## Roadmap

- **v0.1.0** — NativeAdapter + core (AbstractAdapter, Registry) ✅
- **v0.2.0** — PrismaAdapter (scalars, relations, enums, implicit M-N) ✅
- **v0.3.0** — JsonSchemaAdapter (Draft 2020-12 + Draft-07 + allOf + x-mostajs-*) ✅
- **v0.4.0** — OpenApiAdapter (3.1 with 3.0 normalization)
- **v1.0.0** — Production-ready, all 4 adapters with reverse conversion

## PrismaAdapter example

```ts
import { PrismaAdapter, DefaultSentinel } from '@mostajs/orm-adapter';
import { readFileSync } from 'fs';

const source = readFileSync('./schema.prisma', 'utf8');
const adapter = new PrismaAdapter();
const entities = await adapter.toEntitySchema(source, {
  onWarning: (w) => console.warn(`[${w.code}] ${w.message}`),
});

// entities: EntitySchema[] — feed directly to @mostajs/orm
// Supports 13 databases (Postgres, Oracle, DB2, MongoDB, etc.)
// where Prisma only supports 7.
```

## License

**AGPL-3.0-or-later** + commercial license available.

For commercial use in closed-source projects, contact: drmdh@msn.com

## Author

Dr Hamid MADANI <drmdh@msn.com>

---

Part of the [@mostajs ecosystem](https://github.com/apolocine) — 13 databases, 11 transports, one unified backend.
