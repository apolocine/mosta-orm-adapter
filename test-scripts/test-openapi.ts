// test-openapi.ts — Unit tests for OpenApiAdapter
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: npx tsx test-scripts/test-openapi.ts

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  OpenApiAdapter,
  AdapterRegistry,
  NativeAdapter,
  JsonSchemaAdapter,
  PrismaAdapter,
  type AdapterWarning,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures/openapi');

let pass = 0;
let fail = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) { console.log(`  \u2713 ${msg}`); pass++; }
  else      { console.log(`  \u2717 ${msg}`); fail++; }
}
function section(title: string): void {
  console.log(`\n\x1b[1m\x1b[36m=== ${title} ===\x1b[0m`);
}
function readFixtureJSON(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

async function run() {
  const adapter = new OpenApiAdapter();

  // ---- Group 1 : detection ----
  section('canParse detection');
  assert(adapter.name === 'openapi', 'adapter.name');
  assert(adapter.vendor === 'openapis.org', 'adapter.vendor');

  assert(adapter.canParse({ openapi: '3.1.0', info: {}, paths: {} }) === true,
    'canParse accepts openapi: 3.1.0');
  assert(adapter.canParse({ openapi: '3.0.3', info: {}, paths: {} }) === true,
    'canParse accepts openapi: 3.0.x');
  assert(adapter.canParse('{"openapi":"3.1.0","info":{},"paths":{}}') === true,
    'canParse accepts JSON string');
  assert(adapter.canParse({ type: 'object' }) === false,
    'canParse rejects plain JSON Schema');
  assert(adapter.canParse({ foo: 'bar' }) === false,
    'canParse rejects random objects');
  assert(adapter.canParse({ swagger: '2.0', info: {}, paths: {} }) === true,
    'canParse detects Swagger 2.0');

  // ---- Group 2 : OpenAPI 3.1 (petstore) ----
  section('OpenAPI 3.1 (petstore-3.1.json)');
  const spec31 = readFixtureJSON('petstore-3.1.json');
  const entities31 = await adapter.toEntitySchema(spec31);

  assert(entities31.length === 3, 'petstore → 3 entities (Pet, User, Order)');
  const pet = entities31.find(e => e.name === 'Pet')!;
  const user = entities31.find(e => e.name === 'User')!;
  const order = entities31.find(e => e.name === 'Order')!;

  assert(!!pet, 'Pet entity');
  assert(!!user, 'User entity');
  assert(!!order, 'Order entity');

  assert(pet.collection === 'pets', 'Pet table via x-mostajs-entity');
  assert(pet.timestamps === true, 'Pet timestamps: true');
  assert(pet.fields.id?.required === true, 'Pet.id required');
  assert(pet.fields.name?.type === 'string', 'Pet.name = string');
  assert(pet.indexes.some(i => i.fields.name === 'asc' && !i.unique),
    'Pet.name has index (x-index: true)');
  assert(pet.fields.tag?.required === false, 'Pet.tag nullable → not required');
  assert(pet.fields.status?.enum?.length === 3, 'Pet.status enum (3 values)');
  assert(pet.fields.status?.default === 'available', 'Pet.status default');
  assert(pet.relations.owner?.target === 'User', 'Pet.owner → User');
  assert(pet.relations.owner?.type === 'many-to-one', 'Pet.owner many-to-one');

  assert(user.indexes.some(i => i.fields.email === 'asc' && i.unique === true),
    'User.email has unique index');
  assert(user.relations.pets?.target === 'Pet', 'User.pets → Pet');
  assert(user.relations.pets?.type === 'one-to-many', 'User.pets one-to-many');

  assert(order.relations.pet?.target === 'Pet', 'Order.pet → Pet');
  assert(order.relations.pet?.type === 'many-to-one',
    'Order.pet many-to-one (via x-mostajs-relation belongsTo)');
  assert(order.relations.pet?.joinColumn === 'petId', 'Order.pet joinColumn');
  assert(order.relations.pet?.onDelete === 'cascade', 'Order.pet onDelete: cascade');

  // ---- Group 3 : OpenAPI 3.0 → 3.1 normalization ----
  section('OpenAPI 3.0 normalization');
  const warns30: AdapterWarning[] = [];
  const spec30 = readFixtureJSON('petstore-3.0.json');
  const entities30 = await adapter.toEntitySchema(spec30, {
    onWarning: w => warns30.push(w),
  });

  assert(entities30.length === 1, '3.0 produces 1 entity');
  const pet30 = entities30[0]!;
  assert(pet30.name === 'Pet', 'Pet entity from 3.0');
  assert(pet30.fields.nickname?.required === false,
    'nullable:true → normalized to type array → not required');
  assert(pet30.fields.age?.type === 'number', 'age = number (integer)');
  assert(pet30.fields.name?.type === 'string', 'name = string');
  assert(pet30.fields.avatar?.type === 'string',
    'format: binary → string (with warning)');

  assert(warns30.some(w => w.code === 'FALLBACK_APPLIED'),
    '3.0 emits FALLBACK_APPLIED (normalization) warning');
  assert(warns30.some(w => w.code === 'LOSSY_CONVERSION' && w.field === 'avatar'),
    'avatar binary emits LOSSY_CONVERSION');

  // ---- Group 4 : discriminator ----
  section('oneOf + discriminator');
  const specD = readFixtureJSON('discriminator.json');
  const entitiesD = await adapter.toEntitySchema(specD);

  // Pet is oneOf, not itself an entity (no type:object, no properties)
  // Only Dog and Cat should be entities
  const dog = entitiesD.find(e => e.name === 'Dog');
  const cat = entitiesD.find(e => e.name === 'Cat');
  assert(!!dog, 'Dog entity from $defs');
  assert(!!cat, 'Cat entity from $defs');
  assert(dog?.collection === 'animals', 'Dog collection = animals (shared)');
  assert(dog?.discriminator === 'petType', 'Dog discriminator field');
  assert(dog?.discriminatorValue === 'dog', 'Dog discriminatorValue');
  assert(cat?.discriminator === 'petType', 'Cat discriminator field');
  assert(cat?.discriminatorValue === 'cat', 'Cat discriminatorValue');

  // ---- Group 5 : JSON string input ----
  section('JSON string input');
  const asString = JSON.stringify(spec31);
  const fromStr = await adapter.toEntitySchema(asString);
  assert(fromStr.length === 3, 'accepts stringified OpenAPI');

  // ---- Group 6 : Registry integration ----
  section('Registry integration (full chain)');
  const reg = new AdapterRegistry();
  reg.register(new NativeAdapter());
  reg.register(new PrismaAdapter());
  reg.register(new JsonSchemaAdapter());
  reg.register(new OpenApiAdapter());

  const detected = reg.detect(spec31);
  assert(detected?.name === 'openapi', 'registry detects OpenAPI');

  const viaReg = await reg.fromAny(spec31);
  assert(viaReg.length === 3, 'registry.fromAny dispatches correctly');

  // Ensure OpenAPI wins over JsonSchema for specs with `openapi: 3.1.0`
  const jsonSchemaOnly = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: 'Foo',
    properties: {},
  };
  assert(reg.detect(jsonSchemaOnly)?.name === 'jsonschema',
    'JsonSchema still wins for plain JSON Schema input');

  // ---- Group 7 : edge cases ----
  section('edge cases');

  const emptyWarns: AdapterWarning[] = [];
  const emptySpec = { openapi: '3.1.0', info: { title: 'E', version: '1' }, paths: {} };
  const empty = await adapter.toEntitySchema(emptySpec, { onWarning: w => emptyWarns.push(w) });
  assert(empty.length === 0, 'empty components.schemas → 0 entities');
  assert(emptyWarns.some(w => w.code === 'MISSING_METADATA'),
    'empty spec emits MISSING_METADATA warning');

  // ---- Summary ----
  console.log(`\n\x1b[1m=== Summary ===\x1b[0m`);
  console.log(`  \x1b[32mPass: ${pass}\x1b[0m`);
  console.log(`  \x1b[31mFail: ${fail}\x1b[0m`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('\x1b[31mFATAL:\x1b[0m', e);
  process.exit(1);
});
