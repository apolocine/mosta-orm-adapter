// @mostajs/orm-adapter — Custom errors
// Author: Dr Hamid MADANI drmdh@msn.com

import type { AdapterWarning } from './types.js';

/** Base error class for all adapter-related errors */
export class AdapterError extends Error {
  constructor(message: string, public readonly code: string = 'ADAPTER_ERROR') {
    super(message);
    this.name = 'AdapterError';
  }
}

/** Thrown when an input cannot be parsed by any registered adapter */
export class NoAdapterFoundError extends AdapterError {
  constructor(message = 'No adapter can parse the given input') {
    super(message, 'NO_ADAPTER_FOUND');
    this.name = 'NoAdapterFoundError';
  }
}

/** Thrown when input is malformed or violates its own schema */
export class InvalidSchemaError extends AdapterError {
  constructor(message: string, public readonly details?: unknown) {
    super(message, 'INVALID_SCHEMA');
    this.name = 'InvalidSchemaError';
  }
}

/** Thrown in strict mode when an unsupported feature is encountered */
export class StrictWarningError extends AdapterError {
  constructor(public readonly warning: AdapterWarning) {
    super(`[${warning.code}] ${warning.message}`, warning.code);
    this.name = 'StrictWarningError';
  }
}
