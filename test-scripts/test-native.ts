// test-native.ts — Unit tests for NativeAdapter
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: npx tsx test-scripts/test-native.ts

import type { EntitySchema, AdapterWarning } from '@mostajs/orm';
import {
  NativeAdapter,
  AdapterRegistry,
  InvalidSchemaError,
  WarningCode,
} from '../src/index.js';

// ============================================================
// Test framework (minimal, same style as @mostajs/orm tests)
// ============================================================

let pass = 0;
let fail = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  \u2713 ${message}`);
    pass++;
  } else {
    console.log(`  \u2717 ${message}`);
    fail++;
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m\x1b[36m=== ${title} ===\x1b[0m`);
}

// ============================================================
// Fixtures
// ============================================================

const validUser: EntitySchema = {
  name: 'User',
  collection: 'users',
  fields: {
    id:    { type: 'string', required: true, unique: true },
    email: { type: 'string', required: true, unique: true },
    age:   { type: 'number' },
  },
  relations: {},
  indexes: [{ fields: { email: 'asc' }, unique: true }],
  timestamps: true,
};

const validPost: EntitySchema = {
  name: 'Post',
  collection: 'posts',
  fields: {
    title:    { type: 'string', required: true },
    content:  { type: 'text' },
    authorId: { type: 'string', required: true },
  },
  relations: {
    author: { target: 'User', type: 'many-to-one', required: true },
  },
  indexes: [],
  timestamps: true,
};

const discriminatedArticle: EntitySchema = {
  name: 'Article',
  collection: 'entities',
  fields: { title: { type: 'string', required: true } },
  relations: {},
  indexes: [],
  timestamps: true,
  discriminator: '_type',
  discriminatorValue: 'article',
};

const invalidBadName: unknown = {
  name: 'user',                       // lowercase, invalid PascalCase
  collection: 'users',
  fields: {},
  relations: {},
  indexes: [],
  timestamps: true,
};

const invalidBadType: unknown = {
  name: 'Foo',
  collection: 'foos',
  fields: {
    weird: { type: 'bigint' },        // not a valid FieldType
  },
  relations: {},
  indexes: [],
  timestamps: true,
};

const invalidDiscriminator: unknown = {
  name: 'Foo',
  collection: 'foos',
  fields: {},
  relations: {},
  indexes: [],
  timestamps: true,
  discriminator: '_type',             // no discriminatorValue
};

// ============================================================
// Tests
// ============================================================

async function run() {

  // --- Group 1 : detection via canParse ---
  section('canParse detection');
  const adapter = new NativeAdapter();

  assert(adapter.name === 'native', 'adapter.name is "native"');
  assert(adapter.vendor === '@mostajs/orm', 'adapter.vendor is @mostajs/orm');
  assert(typeof adapter.version === 'string', 'adapter.version is a string');

  assert(adapter.canParse(validUser) === true, 'canParse accepts valid EntitySchema');
  assert(adapter.canParse([validUser, validPost]) === true, 'canParse accepts array of EntitySchemas');
  assert(adapter.canParse([]) === true, 'canParse accepts empty array');
  assert(adapter.canParse('not an object') === false, 'canParse rejects strings');
  assert(adapter.canParse({ foo: 'bar' }) === false, 'canParse rejects random objects');
  assert(adapter.canParse(null as unknown as object) === false, 'canParse rejects null');

  // --- Group 2 : passthrough ---
  section('passthrough conversion');

  const single = await adapter.toEntitySchema(validUser);
  assert(Array.isArray(single), 'toEntitySchema always returns array');
  assert(single.length === 1, 'single input → array of 1');
  assert(single[0]!.name === 'User', 'single entity preserved');
  assert(single[0]! === validUser, 'identity (no copy)');

  const multi = await adapter.toEntitySchema([validUser, validPost]);
  assert(multi.length === 2, 'array input → array of 2');
  assert(multi[0]!.name === 'User' && multi[1]!.name === 'Post', 'order preserved');

  const disc = await adapter.toEntitySchema(discriminatedArticle);
  assert(disc[0]!.discriminator === '_type', 'discriminator preserved');
  assert(disc[0]!.discriminatorValue === 'article', 'discriminatorValue preserved');

  // --- Group 3 : validation warnings ---
  section('validation (non-strict mode)');

  const warnings: AdapterWarning[] = [];
  await adapter.toEntitySchema(invalidBadName as EntitySchema, {
    onWarning: (w) => warnings.push(w),
  });
  assert(warnings.length > 0, 'invalid PascalCase name produces warning');
  assert(
    warnings.some(w => w.message.includes('PascalCase')),
    'warning mentions PascalCase'
  );

  warnings.length = 0;
  await adapter.toEntitySchema(invalidBadType as EntitySchema, {
    onWarning: (w) => warnings.push(w),
  });
  assert(
    warnings.some(w => w.message.includes('invalid type')),
    'invalid FieldType produces warning'
  );

  warnings.length = 0;
  await adapter.toEntitySchema(invalidDiscriminator as EntitySchema, {
    onWarning: (w) => warnings.push(w),
  });
  assert(
    warnings.some(w => w.message.includes('discriminatorValue')),
    'discriminator without value produces warning'
  );

  // --- Group 4 : validation strict mode ---
  section('validation (strict mode)');

  let thrown = false;
  try {
    await adapter.toEntitySchema(invalidBadName as EntitySchema, { strict: true });
  } catch (e) {
    thrown = e instanceof InvalidSchemaError;
  }
  assert(thrown, 'strict mode throws InvalidSchemaError for bad name');

  thrown = false;
  try {
    await adapter.toEntitySchema(invalidBadType as EntitySchema, { strict: true });
  } catch (e) {
    thrown = e instanceof InvalidSchemaError;
  }
  assert(thrown, 'strict mode throws InvalidSchemaError for bad type');

  // --- Group 5 : fromEntitySchema (reverse = identity) ---
  section('fromEntitySchema (reverse)');

  const reversed = await adapter.fromEntitySchema([validUser, validPost]);
  assert(Array.isArray(reversed), 'fromEntitySchema returns array');
  assert((reversed as EntitySchema[])[0] === validUser, 'reverse is identity');

  // --- Group 6 : Registry integration ---
  section('AdapterRegistry integration');

  const registry = new AdapterRegistry();
  registry.register(adapter);

  assert(registry.list().includes('native'), 'registry lists native adapter');
  assert(registry.get('native') === adapter, 'registry.get returns instance');

  const detected = registry.detect(validUser);
  assert(detected === adapter, 'registry detects native for EntitySchema input');

  const detectedNone = registry.detect('some prisma file');
  assert(detectedNone === null, 'registry returns null for unknown input');

  const viaFromAny = await registry.fromAny(validUser);
  assert(viaFromAny.length === 1 && viaFromAny[0]!.name === 'User',
    'registry.fromAny dispatches correctly');

  // --- Group 7 : registry strictDetection ---
  section('registry strictDetection');

  const strictReg = new AdapterRegistry({ strictDetection: true });
  strictReg.register(adapter);
  let strictThrown = false;
  try {
    strictReg.detect('foo bar');
  } catch (e) {
    strictThrown = e instanceof Error && e.name === 'NoAdapterFoundError';
  }
  assert(strictThrown, 'strictDetection throws NoAdapterFoundError');

  // --- Summary ---
  console.log(`\n\x1b[1m=== Summary ===\x1b[0m`);
  console.log(`  \x1b[32mPass: ${pass}\x1b[0m`);
  console.log(`  \x1b[31mFail: ${fail}\x1b[0m`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('\x1b[31mFATAL:\x1b[0m', e);
  process.exit(1);
});
