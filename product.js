const { randomUUID } = require('node:crypto');
const PRODUCT_CONTRACT = require('./docs-sync/contracts/product.json');

const NAME_FIELD = PRODUCT_CONTRACT.fields.find((field) => field.required);
const PRICE_FIELD = PRODUCT_CONTRACT.fields.find((field) => field.currency);
const OPTIONAL_TEXT_FIELDS = PRODUCT_CONTRACT.fields.filter((field) => field.optional);
const PRICE_PATTERN = createPricePattern(PRICE_FIELD);

function createPricePattern(field) {
  const sign = field.allowLeadingPlus ? '\\+?' : '';
  const fraction = `\\d{1,${field.maxFractionDigits}}`;
  const wholeNumber = `\\d+(?:\\.${fraction})?`;
  const leadingDecimal = field.allowLeadingDecimalPoint ? `|\\.${fraction}` : '';
  return new RegExp(`^${sign}(?:${wholeNumber}${leadingDecimal})$`);
}

function priceToPaise(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = PRICE_FIELD.trim ? value.trim() : value;
  if (!PRICE_PATTERN.test(trimmedValue)) {
    return null;
  }

  const unsignedValue = trimmedValue.startsWith('+')
    ? trimmedValue.slice(1)
    : trimmedValue;
  const [wholePart, fractionalPart = ''] = unsignedValue.split('.');
  const wholeRupees = wholePart || '0';
  const scale = 10n ** BigInt(PRICE_FIELD.maxFractionDigits);
  const paisePart = fractionalPart.padEnd(PRICE_FIELD.maxFractionDigits, '0') || '0';
  const paise = BigInt(wholeRupees) * scale + BigInt(paisePart);

  return !PRICE_FIELD.positive || paise > 0n ? paise.toString() : null;
}

function paiseToRupees(value) {
  if (typeof value !== 'string' || !new RegExp(PRICE_FIELD.storedPattern).test(value)) {
    throw new TypeError('Price must be a positive paise integer string.');
  }

  const paise = BigInt(value);
  const scale = 10n ** BigInt(PRICE_FIELD.maxFractionDigits);
  return `${paise / scale}.${(paise % scale).toString().padStart(PRICE_FIELD.maxFractionDigits, '0')}`;
}

function validateProductInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      product: null,
      errors: { form: 'Product input must be an object.' },
    };
  }

  const errors = {};
  const product = {};
  const rawName = input[NAME_FIELD.inputName];
  const name = typeof rawName === 'string' && NAME_FIELD.trim ? rawName.trim() : rawName;

  if (typeof name !== 'string' || (NAME_FIELD.nonEmpty && !name)) {
    errors[NAME_FIELD.inputName] = 'Name is required.';
  } else {
    product[NAME_FIELD.storedName] = name;
  }

  const pricePaise = priceToPaise(input[PRICE_FIELD.inputName]);
  if (pricePaise === null) {
    errors[PRICE_FIELD.inputName] = `Price must be a positive ${PRICE_FIELD.currency} amount with no more than ${PRICE_FIELD.maxFractionDigits} decimal places.`;
  } else {
    product[PRICE_FIELD.storedName] = pricePaise;
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = input[field.inputName];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'string') {
      errors[field.inputName] = `${field.inputName} must be text.`;
      continue;
    }

    const trimmedValue = field.trim ? value.trim() : value;
    if (trimmedValue) {
      product[field.storedName] = trimmedValue;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { product: null, errors };
  }

  return { product, errors };
}

function createProduct(input) {
  const result = validateProductInput(input);
  if (result.product === null) {
    return result;
  }

  return {
    product: { [PRODUCT_CONTRACT.id.storedName]: randomUUID(), ...result.product },
    errors: {},
  };
}

function updateProduct(existingProduct, input) {
  const id = existingProduct?.[PRODUCT_CONTRACT.id.storedName];
  if (typeof id !== 'string' || !id) {
    throw new TypeError('An existing product with an ID is required.');
  }

  const result = validateProductInput(input);
  if (result.product === null) {
    return result;
  }

  return {
    product: { [PRODUCT_CONTRACT.id.storedName]: id, ...result.product },
    errors: {},
  };
}

module.exports = {
  PRODUCT_CONTRACT,
  createProduct,
  paiseToRupees,
  priceToPaise,
  updateProduct,
  validateProductInput,
};