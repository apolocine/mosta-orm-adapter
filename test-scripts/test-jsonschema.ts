// test-jsonschema.ts — Unit tests for JsonSchemaAdapter
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: npx tsx test-scripts/test-jsonschema.ts

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  JsonSchemaAdapter,
  AdapterRegistry,
  NativeAdapter,
  type AdapterWarning,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures/jsonschema');

let pass = 0;
let fail = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) { console.log(`  \u2713 ${msg}`); pass++; }
  else      { console.log(`  \u2717 ${msg}`); fail++; }
}
function section(title: string): void {
  console.log(`\n\x1b[1m\x1b[36m=== ${title} ===\x1b[0m`);
}
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

async function run() {
  const adapter = new JsonSchemaAdapter();

  // ---- Group 1 : detection ----
  section('canParse detection');
  assert(adapter.name === 'jsonschema', 'adapter.name');
  assert(adapter.vendor === 'json-schema.org', 'adapter.vendor');

  assert(adapter.canParse({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }) === true,
    'canParse accepts object with $schema');
  assert(adapter.canParse('{"$schema":"https://json-schema.org/draft-07/schema#","type":"object"}') === true,
    'canParse accepts JSON string');
  assert(adapter.canParse({ type: 'object', properties: {} }) === true,
    'canParse accepts object+properties (no $schema)');
  assert(adapter.canParse({ foo: 'bar' }) === false, 'canParse rejects random objects');
  assert(adapter.canParse('not json') === false, 'canParse rejects non-JSON');

  // ---- Group 2 : Draft 2020-12 user.json ----
  section('Draft 2020-12 (user-2020-12.json)');
  const raw2020 = JSON.parse(readFixture('user-2020-12.json'));
  const entities2020 = await adapter.toEntitySchema(raw2020);

  assert(entities2020.length === 2, 'user + role → 2 entities');
  const user = entities2020.find(e => e.name === 'User')!;
  const role = entities2020.find(e => e.name === 'Role')!;

  assert(user, 'User entity extracted');
  assert(role, 'Role entity extracted from $defs');
  assert(user.collection === 'users', 'User table = "users" via x-mostajs-entity');
  assert(user.timestamps === true, 'User timestamps: true');

  assert(user.fields.id?.type === 'string', 'id = string (uuid)');
  assert(user.fields.email?.required === true, 'email required');
  assert(user.fields.status?.enum?.length === 3, 'status has 3 enum values');
  assert(user.fields.status?.default === 'active', 'status default = active');
  assert(user.fields.age?.type === 'number', 'age = number (integer)');
  assert(user.fields.archived?.required === false,
    'archived nullable → not required');
  assert(user.fields.passwordHash?.type === 'string', 'passwordHash = string');
  assert(user.fields.createdAt?.type === 'date', 'createdAt date-time → date');

  assert(user.indexes.some(i => i.fields.email === 'asc' && i.unique === true),
    'email has unique index (x-index.unique=true)');

  // Relation via x-mostajs-relation
  assert(user.relations.roles?.target === 'Role', 'roles → Role relation');
  assert(user.relations.roles?.type === 'many-to-many', 'belongsToMany → many-to-many');
  assert(user.relations.roles?.through === 'user_roles', 'through preserved');
  assert(user.relations.roles?.joinColumn === 'userId', 'foreignKey → joinColumn');
  assert(user.relations.roles?.inverseJoinColumn === 'roleId',
    'otherKey → inverseJoinColumn');

  // Role from $defs
  assert(role.fields.name?.unique === true, 'Role.name x-unique=true');
  assert(role.indexes.some(i => i.fields.name === 'asc' && i.unique === true),
    'Role.name has unique index');

  // ---- Group 3 : Draft-07 (post-draft-07.json) ----
  section('Draft-07 (post-draft-07.json)');
  const raw07 = JSON.parse(readFixture('post-draft-07.json'));
  const entities07 = await adapter.toEntitySchema(raw07);

  assert(entities07.length === 2, 'Post + Author → 2 entities');
  const post = entities07.find(e => e.name === 'Post')!;
  const author = entities07.find(e => e.name === 'Author')!;
  assert(!!post, 'Post entity');
  assert(!!author, 'Author from "definitions" (Draft-07)');

  assert(post.fields.title?.required === true, 'Post.title required');
  assert(post.fields.slug?.type === 'string', 'Post.slug = string');
  assert(post.indexes.some(i => i.fields.slug === 'asc' && i.unique === true),
    'Post.slug has unique index');
  assert(post.fields.tags?.type === 'array' && post.fields.tags?.arrayOf === 'string',
    'Post.tags = array of string');

  assert(post.relations.author?.target === 'Author', 'author → Author (detected by $ref title)');
  assert(post.relations.author?.type === 'many-to-one', 'author = many-to-one');
  assert(post.relations.author?.required === true, 'author required');

  // ---- Group 4 : allOf composition ----
  section('allOf composition (inheritance)');
  const rawAllOf = JSON.parse(readFixture('allof-composition.json'));
  const entitiesAllOf = await adapter.toEntitySchema(rawAllOf);

  assert(entitiesAllOf.length === 1, 'allOf → 1 entity (Admin)');
  const admin = entitiesAllOf[0]!;

  assert(admin.name === 'Admin', 'Admin detected');
  assert(admin.collection === 'admins', 'table from x-mostajs-entity');
  assert('id' in admin.fields, 'id merged from first allOf');
  assert('name' in admin.fields, 'name merged from first allOf');
  assert('email' in admin.fields, 'email merged');
  assert('role' in admin.fields, 'role merged from second allOf');
  assert('permissions' in admin.fields, 'permissions merged');
  assert(admin.fields.role?.enum?.length === 2, 'role enum preserved');
  assert(admin.fields.name?.required === true, 'name required merged');
  assert(admin.fields.role?.required === true, 'role required merged');

  // ---- Group 5 : validators + x-indexes ----
  section('validators + x-indexes (validators.json)');
  const rawVal = JSON.parse(readFixture('validators.json'));
  const entitiesVal = await adapter.toEntitySchema(rawVal);
  const product = entitiesVal[0]!;

  assert(product.name === 'Product', 'Product entity');
  assert(product.fields.price?.type === 'number', 'price number');
  assert(product.fields.stock?.type === 'number', 'stock number (integer)');
  assert(product.fields.description?.type === 'string', 'uri-reference → string');
  assert(product.fields.weight?.required === false,
    'nullable weight → not required');

  assert(product.indexes.some(i => i.fields.sku === 'asc' && i.unique === true),
    'sku has unique index');
  assert(product.indexes.some(i =>
    i.fields.name === 'asc' && i.fields.status === 'asc'
  ), 'composite index from x-indexes');

  // ---- Group 6 : warnings ----
  section('warnings');
  const warns: AdapterWarning[] = [];
  await adapter.toEntitySchema({
    $schema: 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    title: 'Legacy',
    properties: {}
  }, { onWarning: w => warns.push(w) });
  assert(warns.some(w => w.code === 'PREVIEW_FEATURE'),
    'draft-04 emits PREVIEW_FEATURE warning');

  // ---- Group 7 : Registry integration ----
  section('Registry integration');
  const reg = new AdapterRegistry();
  reg.register(new NativeAdapter());
  reg.register(new JsonSchemaAdapter());

  const detected = reg.detect(raw2020);
  assert(detected?.name === 'jsonschema',
    'registry detects jsonschema for $schema-tagged object');

  const viaReg = await reg.fromAny(raw07);
  assert(viaReg.length === 2, 'fromAny dispatches to JsonSchemaAdapter');

  // ---- Group 8 : JSON string input ----
  section('JSON string input');
  const asString = JSON.stringify(raw2020);
  const fromStr = await adapter.toEntitySchema(asString);
  assert(fromStr.length === 2, 'accepts stringified JSON');

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
