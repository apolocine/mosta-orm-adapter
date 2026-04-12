// @mostajs/orm-adapter — AdapterRegistry
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

import type { EntitySchema } from '@mostajs/orm';
import type { IAdapter, AdapterOptions, RegistryOptions } from './types.js';
import { NoAdapterFoundError } from './errors.js';

/**
 * AdapterRegistry — central registry for all adapters.
 * Provides auto-detection : given an unknown input, finds the right adapter
 * and converts it to EntitySchema[].
 */
export class AdapterRegistry {
  private readonly adapters: IAdapter[] = [];

  constructor(private readonly options: RegistryOptions = {}) {}

  /** Register an adapter. Later registrations take priority in detection. */
  register(adapter: IAdapter): this {
    // Remove any existing adapter with the same name (replace)
    const idx = this.adapters.findIndex(a => a.name === adapter.name);
    if (idx >= 0) this.adapters.splice(idx, 1);
    // Latest registrations first (priority)
    this.adapters.unshift(adapter);
    return this;
  }

  /** Unregister an adapter by name */
  unregister(name: string): boolean {
    const idx = this.adapters.findIndex(a => a.name === name);
    if (idx >= 0) {
      this.adapters.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** List all registered adapter names */
  list(): string[] {
    return this.adapters.map(a => a.name);
  }

  /** Get a specific adapter by name */
  get(name: string): IAdapter | undefined {
    return this.adapters.find(a => a.name === name);
  }

  /** Detect which adapter can handle the given input */
  detect(input: string | object): IAdapter | null {
    for (const adapter of this.adapters) {
      try {
        if (adapter.canParse(input)) return adapter;
      } catch {
        // canParse should not throw, but just in case: skip this adapter
      }
    }
    if (this.options.strictDetection) {
      throw new NoAdapterFoundError();
    }
    return null;
  }

  /** Convert any known input to EntitySchema[] via auto-detected adapter */
  async fromAny(
    input: string | object,
    opts?: AdapterOptions
  ): Promise<EntitySchema[]> {
    const adapter = this.detect(input);
    if (!adapter) {
      throw new NoAdapterFoundError(
        `No registered adapter can parse input. Registered: [${this.list().join(', ')}]`
      );
    }
    return adapter.toEntitySchema(input, opts);
  }
}
