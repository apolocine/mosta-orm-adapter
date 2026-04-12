// explore-jsonschema-ajv.mjs
// Exploration of ajv + @apidevtools/json-schema-ref-parser APIs.
// KEEP THIS FILE — living documentation for JsonSchemaAdapter implementation.
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: node test-scripts/explore-jsonschema-ajv.mjs

import $RefParser from '@apidevtools/json-schema-ref-parser';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// ============================================================
// 1. $RefParser : bundle + dereference
// ============================================================

const userSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/user.json',
  title: 'User',
  type: 'object',
  $defs: {
    Address: {
      type: 'object',
      properties: {
        street: { type: 'string' },
        city:   { type: 'string' },
      },
    },
  },
  properties: {
    id:      { type: 'string', format: 'uuid' },
    email:   { type: 'string', format: 'email' },
    address: { $ref: '#/$defs/Address' },
    roles:   { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'email'],
};

console.log('=== $RefParser.bundle ===');
const bundled = await $RefParser.bundle(userSchema);
console.log('properties.address:', JSON.stringify(bundled.properties.address, null, 2));

console.log('\n=== $RefParser.dereference ===');
const deref = await $RefParser.dereference(JSON.parse(JSON.stringify(userSchema)));
console.log('properties.address (resolved):', JSON.stringify(deref.properties.address, null, 2));

// ============================================================
// 2. ajv validation
// ============================================================

console.log('\n=== Ajv Draft 2020-12 validation ===');
const ajv2020 = new Ajv2020.default({ strict: false, allErrors: true });
addFormats.default(ajv2020);

// Meta-schema validation : is the schema itself valid?
const validateSchema = ajv2020.compile(userSchema);
console.log('meta-schema compilable:', typeof validateSchema === 'function');

// Data validation
const valid = validateSchema({
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
});
console.log('valid instance:', valid);

const invalid = validateSchema({ id: 'not-a-uuid', email: 'not-email' });
console.log('invalid instance:', invalid, ajv2020.errors?.map(e => e.message));

// ============================================================
// 3. Format support
// ============================================================

console.log('\n=== ajv-formats supported ===');
const testFormats = ['date-time', 'date', 'time', 'email', 'uuid', 'uri', 'ipv4', 'ipv6', 'regex'];
for (const f of testFormats) {
  const schema = { type: 'string', format: f };
  try {
    const validate = ajv2020.compile(schema);
    console.log(`  ${f.padEnd(12)} compile OK`);
  } catch (e) {
    console.log(`  ${f.padEnd(12)} compile FAIL: ${e.message}`);
  }
}

// ============================================================
// 4. Draft-07 compat
// ============================================================

console.log('\n=== Draft-07 ===');
const draft07 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Post',
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 200 },
  },
  required: ['title'],
  definitions: {
    Comment: { type: 'object' },
  },
};
const ajv07 = new Ajv.default({ strict: false });
addFormats.default(ajv07);
const v07 = ajv07.compile(draft07);
console.log('Draft-07 compile OK:', typeof v07 === 'function');
console.log('definitions vs $defs: Draft-07 uses "definitions"');

// ============================================================
// 5. allOf composition
// ============================================================

console.log('\n=== allOf composition ===');
const allOfSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Admin',
  allOf: [
    { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    { type: 'object', properties: { role: { type: 'string' } } },
  ],
};
console.log('allOf raw:', JSON.stringify(allOfSchema.allOf, null, 2));
// Manual flatten :
const flattened = {
  title: allOfSchema.title,
  type: 'object',
  properties: allOfSchema.allOf.reduce((acc, s) => ({ ...acc, ...(s.properties || {}) }), {}),
  required: [...new Set(allOfSchema.allOf.flatMap(s => s.required || []))],
};
console.log('manually flattened:', JSON.stringify(flattened, null, 2));
