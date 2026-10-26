const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const PRODUCT_CONTRACT = require('./docs-sync/contracts/product.json');
const PERSISTENCE_CONTRACT = require('./docs-sync/contracts/persistence.json');

const DEFAULT_FILE_PATH = path.resolve(__dirname, ...PERSISTENCE_CONTRACT.filePath.split('/'));
const ID_FIELD = PRODUCT_CONTRACT.id;
const NAME_FIELD = PRODUCT_CONTRACT.fields.find((field) => field.inputName === 'name');
const PRICE_FIELD = PRODUCT_CONTRACT.fields.find((field) => field.currency);
const OPTIONAL_FIELDS = PRODUCT_CONTRACT.fields.filter((field) => field.optional);
const PRODUCT_FIELDS = new Set([
  ID_FIELD.storedName,
  ...PRODUCT_CONTRACT.fields.map((field) => field.storedName),
]);
const UUID_PATTERN = new RegExp(ID_FIELD.pattern, 'i');
const PRICE_PATTERN = new RegExp(PRICE_FIELD.storedPattern);

class ProductStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'ProductStorageError';
  }
}

function isValidProduct(product) {
  if (product === null || typeof product !== 'object' || Array.isArray(product)) {
    return false;
  }

  if (Object.keys(product).some((field) => !PRODUCT_FIELDS.has(field))) {
    return false;
  }

  if (!UUID_PATTERN.test(product[ID_FIELD.storedName] || '') || typeof product[NAME_FIELD.storedName] !== 'string') {
    return false;
  }

  if (!product[NAME_FIELD.storedName].trim() || product[NAME_FIELD.storedName] !== product[NAME_FIELD.storedName].trim()) {
    return false;
  }

  if (typeof product[PRICE_FIELD.storedName] !== 'string' || !PRICE_PATTERN.test(product[PRICE_FIELD.storedName])) {
    return false;
  }

  for (const field of OPTIONAL_FIELDS) {
    if (Object.hasOwn(product, field.storedName)) {
      if (typeof product[field.storedName] !== 'string' || !product[field.storedName].trim() || product[field.storedName] !== product[field.storedName].trim()) {
        return false;
      }
    }
  }

  return true;
}

function assertProduct(product) {
  if (!isValidProduct(product)) {
    throw new TypeError('A product must match the normalized product model.');
  }
}

class JsonProductRepository {
  constructor({ filePath = DEFAULT_FILE_PATH, fileSystem = fs } = {}) {
    if (typeof filePath !== 'string' || !filePath) {
      throw new TypeError('A product data file path is required.');
    }

    this.filePath = path.resolve(filePath);
    this.fileSystem = fileSystem;
    this.operationQueue = Promise.resolve();
  }

  list() {
    return this.#runExclusive(() => this.#readProducts());
  }

  getById(id) {
    return this.#runExclusive(async () => {
      const products = await this.#readProducts();
      return products.find((product) => product.id === id) || null;
    });
  }

  create(product) {
    const productSnapshot = { ...product };
    assertProduct(productSnapshot);

    return this.#runExclusive(async () => {
      const products = await this.#readProducts();
      if (products.some((existing) => existing[ID_FIELD.storedName] === productSnapshot[ID_FIELD.storedName])) {
        return null;
      }

      products.push(productSnapshot);
      await this.#writeProducts(products);
      return productSnapshot;
    });
  }

  update(id, product) {
    const productSnapshot = { ...product };
    assertProduct(productSnapshot);
    if (productSnapshot[ID_FIELD.storedName] !== id) {
      throw new TypeError('A product update cannot change its ID.');
    }

    return this.#runExclusive(async () => {
      const products = await this.#readProducts();
      const index = products.findIndex((existing) => existing[ID_FIELD.storedName] === id);
      if (index === -1) {
        return null;
      }

      products[index] = productSnapshot;
      await this.#writeProducts(products);
      return productSnapshot;
    });
  }

  delete(id) {
    return this.#runExclusive(async () => {
      const products = await this.#readProducts();
      const index = products.findIndex((product) => product[ID_FIELD.storedName] === id);
      if (index === -1) {
        return null;
      }

      const [deletedProduct] = products.splice(index, 1);
      await this.#writeProducts(products);
      return deletedProduct;
    });
  }

  #runExclusive(operation) {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  async #readProducts() {
    let contents;

    try {
      contents = await this.fileSystem.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.#writeProducts([]);
        return [];
      }

      throw new ProductStorageError('Unable to read product data.', error);
    }

    let products;
    try {
      products = JSON.parse(contents);
    } catch (error) {
      throw new ProductStorageError('Product data is not valid JSON.', error);
    }

    if (!Array.isArray(products) || products.some((product) => !isValidProduct(product))) {
      throw new ProductStorageError('Product data has an invalid structure.');
    }

    const ids = new Set(products.map((product) => product[ID_FIELD.storedName]));
    if (ids.size !== products.length) {
      throw new ProductStorageError('Product data contains duplicate IDs.');
    }

    return products;
  }

  async #writeProducts(products) {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await this.fileSystem.mkdir(path.dirname(this.filePath), { recursive: true });
      await this.fileSystem.writeFile(
        temporaryPath,
        `${JSON.stringify(products, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      await this.fileSystem.rename(temporaryPath, this.filePath);
    } catch (error) {
      try {
        await this.fileSystem.rm(temporaryPath, { force: true });
      } catch {
        // Preserve the original write error.
      }

      throw new ProductStorageError('Unable to write product data.', error);
    }
  }
}

module.exports = { JsonProductRepository, ProductStorageError };