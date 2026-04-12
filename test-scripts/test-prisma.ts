// test-prisma.ts — Unit tests for PrismaAdapter
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: npx tsx test-scripts/test-prisma.ts

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  PrismaAdapter,
  AdapterRegistry,
  NativeAdapter,
  DefaultSentinel,
  type AdapterWarning,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures/prisma');

// ============================================================
// Mini test harness
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

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// ============================================================
// Tests
// ============================================================

async function run() {
  const adapter = new PrismaAdapter();

  // ---- Group 1 : detection ----
  section('canParse detection');
  assert(adapter.name === 'prisma', 'adapter.name === "prisma"');
  assert(adapter.vendor === 'prisma.io', 'adapter.vendor');
  assert(adapter.canParse('model User { id Int @id }') === true, 'canParse accepts model');
  assert(adapter.canParse('enum Role { USER }') === true, 'canParse accepts enum');
  assert(adapter.canParse('datasource db { provider = "x" }') === true, 'canParse accepts datasource');
  assert(adapter.canParse('not a prisma schema at all') === false, 'canParse rejects plain text');
  assert(adapter.canParse({ some: 'object' }) === false, 'canParse rejects objects');

  // ---- Group 2 : blog.prisma (3 models + 1 enum) ----
  section('blog.prisma conversion');
  const blog = readFixture('blog.prisma');
  const blogEntities = await adapter.toEntitySchema(blog);

  assert(blogEntities.length === 3, 'blog produces 3 entities');
  const names = blogEntities.map(e => e.name).sort();
  assert(JSON.stringify(names) === '["Comment","Post","User"]', 'entities: User, Post, Comment');

  const user = blogEntities.find(e => e.name === 'User')!;
  assert(user.collection === 'users', 'User @@map("users")');
  assert(user.timestamps === true, 'User has createdAt + updatedAt → timestamps=true');
  assert(user.fields.email?.unique === true, 'User.email @unique');
  assert(user.fields.email?.required === true, 'User.email required');
  assert(user.fields.id?.default === DefaultSentinel.AUTOINCREMENT, 'User.id @default(autoincrement())');
  assert(user.fields.role?.type === 'string', 'User.role type = string (enum)');
  assert(JSON.stringify(user.fields.role?.enum) === '["USER","ADMIN","MODERATOR"]', 'User.role enum values');
  assert(user.fields.role?.default === 'USER', 'User.role default = "USER"');
  assert(user.fields.name?.required === false, 'User.name optional');
  assert(user.indexes.some(i => i.fields.email === 'asc' && !i.unique), 'User has @@index([email])');

  const post = blogEntities.find(e => e.name === 'Post')!;
  assert(post.relations.author?.target === 'User', 'Post.author → User');
  assert(post.relations.author?.type === 'many-to-one', 'Post.author = many-to-one');
  assert(post.relations.author?.onDelete === 'cascade', 'Post.author onDelete: Cascade');
  assert(post.relations.author?.joinColumn === 'authorId', 'Post.author joinColumn = authorId');
  assert(post.fields.published?.default === false, 'Post.published @default(false)');

  const comment = blogEntities.find(e => e.name === 'Comment')!;
  assert(comment.relations.author?.onDelete === 'set-null', 'Comment.author onDelete: SetNull → set-null');

  // ---- Group 3 : implicit M-N ----
  section('implicit many-to-many (_CategoryToPost)');
  const m2m = await adapter.toEntitySchema(readFixture('m2m-implicit.prisma'));
  const mPost = m2m.find(e => e.name === 'Post')!;
  const mCat = m2m.find(e => e.name === 'Category')!;

  assert(mPost.relations.categories?.type === 'many-to-many', 'Post.categories = many-to-many');
  assert(mCat.relations.posts?.type === 'many-to-many', 'Category.posts = many-to-many');
  assert(mPost.relations.categories?.through === '_CategoryToPost',
    'implicit M-N uses _CategoryToPost (alphabetical)');
  assert(mCat.relations.posts?.through === '_CategoryToPost', 'both sides share through name');

  // ---- Group 4 : scalars coverage ----
  section('scalar types coverage');
  const warnings: AdapterWarning[] = [];
  const scalars = await adapter.toEntitySchema(readFixture('scalars.prisma'), {
    onWarning: w => warnings.push(w),
  });
  const s = scalars[0]!;

  assert(s.fields.str?.type === 'string', 'String → string');
  assert(s.fields.strArr?.type === 'array' && s.fields.strArr?.arrayOf === 'string',
    'String[] → array of string');
  assert(s.fields.strOpt?.required === false, 'String? → not required');
  assert(s.fields.bool?.type === 'boolean', 'Boolean → boolean');
  assert(s.fields.int?.type === 'number', 'Int → number');
  assert(s.fields.bigNum?.type === 'number', 'BigInt → number');
  assert(s.fields.float?.type === 'number', 'Float → number');
  assert(s.fields.decimal?.type === 'number', 'Decimal → number');
  assert(s.fields.date?.type === 'date', 'DateTime → date');
  assert(s.fields.json?.type === 'json', 'Json → json');
  assert(s.fields.bytes?.type === 'string', 'Bytes → string (with warning)');
  assert(s.fields.uuid?.default === DefaultSentinel.UUID_V4, 'uuid() sentinel');
  assert(s.fields.cuid?.default === DefaultSentinel.CUID, 'cuid() sentinel');
  assert(s.fields.nanoid?.default === DefaultSentinel.NANOID, 'nanoid() sentinel');
  assert(s.fields.int?.default === 0, '@default(0) → 0 (number)');
  assert(s.fields.bool?.default === false, '@default(false) → false');

  assert(warnings.some(w => w.code === 'LOSSY_CONVERSION' && w.field === 'bigNum'),
    'BigInt emits LOSSY_CONVERSION warning');
  assert(warnings.some(w => w.code === 'LOSSY_CONVERSION' && w.field === 'decimal'),
    'Decimal emits LOSSY_CONVERSION warning');
  assert(warnings.some(w => w.code === 'LOSSY_CONVERSION' && w.field === 'bytes'),
    'Bytes emits LOSSY_CONVERSION warning');

  // ---- Group 5 : self-relation ----
  section('self-relation (named)');
  const selfRel = await adapter.toEntitySchema(readFixture('self-relation.prisma'));
  const emp = selfRel[0]!;
  assert(emp.relations.manager?.target === 'Employee', 'manager → Employee (self)');
  assert(emp.relations.manager?.type === 'many-to-one', 'manager = many-to-one');
  assert(emp.relations.manager?.nullable === true, 'manager nullable');
  assert(emp.relations.reports?.type === 'one-to-many', 'reports = one-to-many');
  assert(emp.relations.manager?.mappedBy === 'Hierarchy',
    'relation name captured in mappedBy');

  // ---- Group 6 : Registry integration ----
  section('Registry integration with NativeAdapter');
  const reg = new AdapterRegistry();
  reg.register(new NativeAdapter());
  reg.register(new PrismaAdapter());

  const detected = reg.detect('model Foo { id Int @id }');
  assert(detected?.name === 'prisma', 'registry detects prisma for model text');

  const entities = await reg.fromAny(blog);
  assert(entities.length === 3, 'registry.fromAny dispatches to prisma');

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
