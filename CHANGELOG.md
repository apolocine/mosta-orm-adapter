# Changelog

All notable changes to `@mostajs/orm-adapter` will be documented in this file.

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
