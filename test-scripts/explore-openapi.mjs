// explore-openapi.mjs
// Exploration of @readme/openapi-parser APIs.
// KEEP THIS FILE — living documentation for OpenApiAdapter.
// Author: Dr Hamid MADANI drmdh@msn.com
// Run: node test-scripts/explore-openapi.mjs

import { validate, dereference } from '@readme/openapi-parser';

// ============================================================
// 1. Minimal OpenAPI 3.1 spec
// ============================================================

const spec31 = {
  openapi: '3.1.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { responses: { '200': { description: 'ok' } } }
    }
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id:   { type: 'integer', format: 'int64' },
          name: { type: 'string' },
          tag:  { type: ['string', 'null'] },
        },
      },
      User: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          pet:   { $ref: '#/components/schemas/Pet' },
        },
      },
    },
  },
};

console.log('=== 3.1 parse - return shape ===');
const api31 = await validate(JSON.parse(JSON.stringify(spec31)));
console.log('typeof:', typeof api31, 'keys:', Object.keys(api31 ?? {}).slice(0, 10));
console.log('raw:', JSON.stringify(api31, null, 2).slice(0, 500));

// ============================================================
// 2. OpenAPI 3.0 with differences
// ============================================================

const spec30 = {
  openapi: '3.0.3',
  info: { title: 'Legacy', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', nullable: true },
          age:   { type: 'integer', minimum: 0, exclusiveMaximum: true, maximum: 150 },
          name:  { type: 'string', example: 'Alice' },
        },
      },
    },
  },
};

console.log('\n=== 3.0 parse (raw, shows differences) ===');
const api30 = await validate(JSON.parse(JSON.stringify(spec30)));
console.log('User.email:', JSON.stringify(api30.components?.schemas?.User?.properties?.email, null, 2));
console.log('User.age:', JSON.stringify(api30.components?.schemas?.User?.properties?.age, null, 2));

// ============================================================
// 3. Dereference (resolves $ref into inline schemas)
// ============================================================

console.log('\n=== dereference ===');
const deref = await dereference(JSON.parse(JSON.stringify(spec31)));
console.log('User.pet resolved:',
  JSON.stringify(deref.components?.schemas?.User?.properties?.pet, null, 2));

// ============================================================
// 4. Discriminator
// ============================================================

const specDiscrim = {
  openapi: '3.1.0',
  info: { title: 'Animals', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      Animal: {
        oneOf: [
          { $ref: '#/components/schemas/Dog' },
          { $ref: '#/components/schemas/Cat' },
        ],
        discriminator: {
          propertyName: 'petType',
          mapping: { dog: '#/components/schemas/Dog', cat: '#/components/schemas/Cat' },
        },
      },
      Dog: { type: 'object', properties: { petType: { type: 'string' }, breed: { type: 'string' } } },
      Cat: { type: 'object', properties: { petType: { type: 'string' }, meow: { type: 'boolean' } } },
    },
  },
};

console.log('\n=== discriminator ===');
const apiD = await validate(JSON.parse(JSON.stringify(specDiscrim)));
console.log('Animal.discriminator:',
  JSON.stringify(apiD.components?.schemas?.Animal?.discriminator, null, 2));
