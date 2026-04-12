import { dereference } from '@readme/openapi-parser';
import { readFileSync } from 'fs';

const spec = JSON.parse(readFileSync('test-scripts/fixtures/openapi/petstore-3.1.json', 'utf8'));

// Add title pre-injection (like the adapter does)
for (const [name, schema] of Object.entries(spec.components.schemas)) {
  if (!schema.title) schema.title = name;
}

const derefed = await dereference(structuredClone(spec));
const orderPet = derefed.components.schemas.Order.properties.pet;

console.log('Order.pet after dereference:');
console.log(JSON.stringify(orderPet, (k, v) => k === 'properties' ? '[truncated]' : v, 2).slice(0, 500));
console.log('\nhas x-mostajs-relation?', 'x-mostajs-relation' in orderPet);
if (orderPet['x-mostajs-relation']) {
  console.log('x-mostajs-relation:', JSON.stringify(orderPet['x-mostajs-relation'], null, 2));
}
