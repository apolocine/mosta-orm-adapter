// @mostajs/orm-adapter — Public API
// Third-party schema adapters for @mostajs/orm
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

// --- Core types & base classes ---
export type {
  IAdapter,
  AdapterOptions,
  AdapterWarning,
  WarningCodeType,
  RegistryOptions,
} from './core/types.js';

export { WarningCode } from './core/types.js';
export { AbstractAdapter } from './core/abstract.adapter.js';
export { AdapterRegistry } from './core/registry.js';
export {
  AdapterError,
  NoAdapterFoundError,
  InvalidSchemaError,
  StrictWarningError,
} from './core/errors.js';

// --- Concrete adapters ---
export { NativeAdapter } from './adapters/native.adapter.js';
export { PrismaAdapter } from './adapters/prisma.adapter.js';

// --- Default-value sentinels (Prisma @default semantics) ---
export { DefaultSentinel } from './utils/prisma-default-mapper.js';

// --- Convenience factory ---
import { AdapterRegistry } from './core/registry.js';
import { NativeAdapter } from './adapters/native.adapter.js';
import { PrismaAdapter } from './adapters/prisma.adapter.js';

/**
 * Create a registry with all standard adapters pre-registered.
 * Detection order (first registered = last priority) :
 *   PrismaAdapter  > NativeAdapter
 * (Prisma registered last so it wins over Native when input is a string.
 *  Native has canParse === false for strings, so no ambiguity either way.)
 */
export function createDefaultRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new NativeAdapter());
  registry.register(new PrismaAdapter());
  // TODO: register JsonSchemaAdapter / OpenApiAdapter when ready
  return registry;
}
