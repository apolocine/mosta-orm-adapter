// explore-prisma-ast.mjs
// Exploration script to understand the AST structure of @mrleebo/prisma-ast
// KEEP THIS FILE — serves as living documentation for PrismaAdapter implementation.
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: node test-scripts/explore-prisma-ast.mjs

import { getSchema } from '@mrleebo/prisma-ast';

const source = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique @db.VarChar(320)
  name      String?
  age       Int?     @default(0)
  role      Role     @default(USER)
  posts     Post[]
  createdAt DateTime @default(now()) @map("created_at")

  @@map("users")
  @@index([email, name])
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([authorId])
}

model Category {
  id    Int    @id
  posts Post[]
}

enum Role {
  USER
  ADMIN
  MODERATOR
}
`;

const ast = getSchema(source);

console.log('=== BLOCK TYPES ===');
for (const block of ast.list) {
  console.log(`  ${block.type}${'name' in block ? ' : ' + block.name : ''}`);
}

console.log('\n=== MODEL User (first 2 properties) ===');
const userModel = ast.list.find(b => b.type === 'model' && b.name === 'User');
console.log(JSON.stringify(userModel?.properties?.slice(0, 3), null, 2));

console.log('\n=== MODEL Post relation field (author) ===');
const postModel = ast.list.find(b => b.type === 'model' && b.name === 'Post');
const authorField = postModel?.properties?.find(p => p.type === 'field' && p.name === 'author');
console.log(JSON.stringify(authorField, null, 2));

console.log('\n=== MODEL User @@-level attributes ===');
const userAttrs = userModel?.properties?.filter(p => p.type === 'attribute');
console.log(JSON.stringify(userAttrs, null, 2));

console.log('\n=== ENUM Role ===');
const roleEnum = ast.list.find(b => b.type === 'enum' && b.name === 'Role');
console.log(JSON.stringify(roleEnum, null, 2));
