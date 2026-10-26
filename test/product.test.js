const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createProduct,
  priceToPaise,
  updateProduct,
  validateProductInput,
} = require('../product');

test('normalizes required and optional product text and converts price to paise', () => {
  const result = validateProductInput({
    name: '  Desk lamp  ',
    price: ' 12.90 ',
    description: '  Adjustable arm  ',
    category: '  Lighting  ',
    imageUrl: '  https://example.test/lamp.jpg  ',
  });

  assert.deepEqual(result, {
    product: {
      name: 'Desk lamp',
      pricePaise: '1290',
      description: 'Adjustable arm',
      category: 'Lighting',
      imageUrl: 'https://example.test/lamp.jpg',
    },
    errors: {},
  });
});

test('omits blank optional fields and ignores user-supplied IDs', () => {
  const result = createProduct({
    id: 'user-controlled-id',
    name: 'Notebook',
    price: '1',
    description: '  ',
    category: '',
    imageUrl: '\t',
  });

  assert.equal(result.errors && Object.keys(result.errors).length, 0);
  assert.match(result.product.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(result.product.pricePaise, '100');
  assert.equal(Object.hasOwn(result.product, 'description'), false);
  assert.equal(Object.hasOwn(result.product, 'category'), false);
  assert.equal(Object.hasOwn(result.product, 'imageUrl'), false);
});

test('updates preserve the existing ID regardless of submitted ID', () => {
  const result = updateProduct(
    { id: 'original-id', name: 'Old name', pricePaise: '500' },
    { id: 'replacement-id', name: 'New name', price: '7.25' },
  );

  assert.deepEqual(result, {
    product: { id: 'original-id', name: 'New name', pricePaise: '725' },
    errors: {},
  });
});

test('rejects missing or whitespace-only names and invalid prices', () => {
  for (const input of [
    { price: '1.00' },
    { name: '   ', price: '1.00' },
    { name: 'Chair', price: '0' },
    { name: 'Chair', price: '0.00' },
    { name: 'Chair', price: '-1.00' },
    { name: 'Chair', price: '1.234' },
    { name: 'Chair', price: '1e2' },
    { name: 'Chair', price: 'not a price' },
  ]) {
    const result = validateProductInput(input);
    assert.equal(result.product, null);
    assert.ok(Object.keys(result.errors).length > 0);
  }
});

test('converts large INR values to exact paise without a safe-integer ceiling', () => {
  assert.equal(priceToPaise('9007199254740992.01'), '900719925474099201');
});

test('rejects non-text optional fields and non-object input', () => {
  const invalidField = validateProductInput({
    name: 'Pen',
    price: '1.00',
    category: ['Stationery'],
  });
  const invalidObject = validateProductInput([]);

  assert.equal(invalidField.product, null);
  assert.equal(invalidField.errors.category, 'category must be text.');
  assert.equal(invalidObject.product, null);
  assert.equal(invalidObject.errors.form, 'Product input must be an object.');
});