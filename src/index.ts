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

// --- Convenience factory ---
import { AdapterRegistry } from './core/registry.js';
import { NativeAdapter } from './adapters/native.adapter.js';

/**
 * Create a registry with all standard adapters pre-registered.
 * Order of priority: native → (prisma) → (jsonschema) → (openapi).
 * Future adapters auto-registered here as they become available.
 */
export function createDefaultRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new NativeAdapter());
  // TODO: register PrismaAdapter / JsonSchemaAdapter / OpenApiAdapter when ready
  return registry;
}
