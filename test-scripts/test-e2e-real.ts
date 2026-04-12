// test-e2e-real.ts — End-to-end tests on real-world specs
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: npx tsx test-scripts/test-e2e-real.ts
//
// These tests validate the adapter on production-like schemas to catch
// edge cases not covered by synthetic fixtures.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  OpenApiAdapter,
  PrismaAdapter,
  createDefaultRegistry,
  type AdapterWarning,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures/real');
const OPENAPI_FIXTURES = join(__dirname, 'fixtures/openapi');

let pass = 0;
let fail = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) { console.log(`  \u2713 ${msg}`); pass++; }
  else      { console.log(`  \u2717 ${msg}`); fail++; }
}
function section(title: string): void {
  console.log(`\n\x1b[1m\x1b[36m=== ${title} ===\x1b[0m`);
}

async function run() {
  // ---- Group 1 : YAML input (OpenAPI) ----
  section('YAML input — OpenAPI spec');
  const yamlInput = readFileSync(join(OPENAPI_FIXTURES, 'petstore-3.1.yaml'), 'utf8');
  const yamlAdapter = new OpenApiAdapter();

  assert(yamlAdapter.canParse(yamlInput) === true, 'canParse detects YAML via openapi: marker');

  const yamlEntities = await yamlAdapter.toEntitySchema(yamlInput);
  assert(yamlEntities.length === 2, 'YAML spec produces 2 entities (Pet + User)');

  const yamlPet = yamlEntities.find(e => e.name === 'Pet');
  const yamlUser = yamlEntities.find(e => e.name === 'User');
  assert(!!yamlPet, 'Pet from YAML');
  assert(!!yamlUser, 'User from YAML');
  assert(yamlPet?.collection === 'pets', 'Pet tableName preserved in YAML parse');
  assert(yamlPet?.timestamps === true, 'Pet timestamps from YAML');
  assert(yamlPet?.relations.owner?.target === 'User', 'Pet.owner relation from YAML $ref');

  // ---- Group 2 : Real SaaS Prisma schema ----
  section('Real SaaS Prisma schema (cal.com/dub-style)');
  const prismaSource = readFileSync(join(FIXTURES, 'saas-starter.prisma'), 'utf8');
  const prismaAdapter = new PrismaAdapter();
  const warnings: AdapterWarning[] = [];
  const prismaEntities = await prismaAdapter.toEntitySchema(prismaSource, {
    onWarning: w => warnings.push(w),
  });

  assert(prismaEntities.length === 8,
    'SaaS schema → 8 entities (User, Session, Organization, Member, Project, Post, Comment, Tag)');

  const modelNames = prismaEntities.map(e => e.name).sort();
  const expected = ['Comment', 'Member', 'Organization', 'Post', 'Project', 'Session', 'Tag', 'User'];
  assert(JSON.stringify(modelNames) === JSON.stringify(expected),
    'all 8 models detected correctly');

  const realUser = prismaEntities.find(e => e.name === 'User')!;
  assert(realUser.collection === 'users', 'User @@map("users")');
  assert(realUser.fields.id?.default?.toString().includes('CUID'),
    'id @default(cuid()) sentinel');
  assert(realUser.fields.emailVerified?.required === false,
    'emailVerified DateTime? optional');
  assert(realUser.fields.role?.enum?.length === 3, 'UserRole enum with 3 values');
  assert(realUser.timestamps === true, 'User has timestamps auto-detected');

  const post = prismaEntities.find(e => e.name === 'Post')!;
  assert(post.fields.views?.type === 'number', 'BigInt → number');
  assert(post.fields.metadata?.type === 'json', 'Json field');
  assert(post.fields.status?.enum?.length === 3, 'PostStatus enum');
  assert(post.relations.tags?.type === 'many-to-many', 'Post.tags implicit M-N');
  assert(post.relations.tags?.through === '_PostToTag',
    'junction table _PostToTag (alphabetical)');
  assert(post.relations.comments?.type === 'one-to-many', 'Post.comments 1-N');
  assert(post.indexes.some(i => i.fields.authorId === 'asc'), '@@index([authorId])');
  assert(post.indexes.some(i => i.fields.status === 'asc'), '@@index([status])');

  const comment = prismaEntities.find(e => e.name === 'Comment')!;
  assert(comment.relations.post?.onDelete === 'cascade', 'Comment.post Cascade');
  assert(comment.relations.author?.onDelete === 'set-null', 'Comment.author SetNull');

  const session = prismaEntities.find(e => e.name === 'Session')!;
  assert(session.fields.sessionToken?.unique === true, 'Session.sessionToken @unique');
  assert(session.relations.user?.onDelete === 'cascade', 'Session.user Cascade');

  const member = prismaEntities.find(e => e.name === 'Member')!;
  assert(member.indexes.some(i =>
    i.unique && i.fields.userId === 'asc' && i.fields.organizationId === 'asc'
  ), '@@unique([userId, organizationId]) composite');

  const org = prismaEntities.find(e => e.name === 'Organization')!;
  assert(org.relations.owner?.onDelete === 'restrict', 'Organization.owner Restrict');

  const tag = prismaEntities.find(e => e.name === 'Tag')!;
  assert(tag.relations.posts?.type === 'many-to-many', 'Tag.posts M-N (reverse side)');

  // Warnings check : schema uses BigInt → should emit LOSSY_CONVERSION
  assert(warnings.some(w => w.code === 'LOSSY_CONVERSION' && w.field === 'views'),
    'BigInt on Post.views emits LOSSY_CONVERSION');

  // ---- Group 3 : Swagger Petstore v3 (real) ----
  section('Swagger Petstore v3 (real spec, 6+ schemas)');
  try {
    const swaggerSpec = JSON.parse(readFileSync(join(FIXTURES, 'swagger-petstore.json'), 'utf8'));
    const openApiAdapter = new OpenApiAdapter();
    const openApiWarns: AdapterWarning[] = [];
    const swaggerEntities = await openApiAdapter.toEntitySchema(swaggerSpec, {
      onWarning: w => openApiWarns.push(w),
    });

    assert(swaggerEntities.length >= 5,
      `Petstore → ${swaggerEntities.length} entities (>= 5)`);

    const petNames = swaggerEntities.map(e => e.name).sort();
    console.log('    entities:', petNames.join(', '));

    assert(swaggerEntities.every(e => typeof e.name === 'string' && e.name.length > 0),
      'all entities have valid names');
    assert(swaggerEntities.every(e => typeof e.collection === 'string'),
      'all entities have collection');

    // Must have at least Pet
    assert(swaggerEntities.some(e => e.name === 'Pet'),
      'Pet entity exists in Petstore');

    // Report warnings count for visibility
    console.log(`    warnings emitted: ${openApiWarns.length}`);
    assert(openApiWarns.length < 50,
      `reasonable warning count (<50) — got ${openApiWarns.length}`);
  } catch (e) {
    console.log(`  \u2717 Swagger petstore test failed: ${e instanceof Error ? e.message : e}`);
    fail++;
  }

  // ---- Group 4 : Auto-detection via registry ----
  section('Auto-detection across formats');
  const registry = createDefaultRegistry();

  const detectedPrisma = registry.detect(prismaSource);
  assert(detectedPrisma?.name === 'prisma', 'registry detects .prisma from real source');

  const detectedYaml = registry.detect(yamlInput);
  assert(detectedYaml?.name === 'openapi', 'registry detects YAML OpenAPI');

  // Real spec dispatching
  const fromPrismaReg = await registry.fromAny(prismaSource);
  assert(fromPrismaReg.length === 8, 'registry dispatches to prisma → 8 entities');

  const fromYamlReg = await registry.fromAny(yamlInput);
  assert(fromYamlReg.length === 2, 'registry dispatches to openapi → 2 entities');

  // ---- Group 5 : Cross-format equivalence ----
  section('Cross-format round-trip sanity');
  // Verify that an EntitySchema produced by one adapter can be fed to NativeAdapter
  const nativeAdapter = registry.get('native')!;
  for (const entity of prismaEntities.slice(0, 3)) {
    const throughNative = await nativeAdapter.toEntitySchema(entity);
    assert(throughNative[0]?.name === entity.name,
      `${entity.name} passes through Native without alteration`);
  }

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
