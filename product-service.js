const {
  createProduct: buildProduct,
  updateProduct: buildUpdatedProduct,
} = require('./product');
const { JsonProductRepository } = require('./product-repository');

class ProductService {
  constructor(repository = new JsonProductRepository()) {
    this.repository = repository;
  }

  listProducts() {
    return this.repository.list();
  }

  getProductById(id) {
    return this.repository.getById(id);
  }

  async createProduct(input) {
    const result = buildProduct(input);
    if (result.product === null) {
      return result;
    }

    const product = await this.repository.create(result.product);
    if (product === null) {
      throw new Error('Generated product ID already exists.');
    }

    return { product, errors: {} };
  }

  async updateProduct(id, input) {
    const existingProduct = await this.repository.getById(id);
    if (existingProduct === null) {
      return { product: null, errors: {} };
    }

    const result = buildUpdatedProduct(existingProduct, input);
    if (result.product === null) {
      return result;
    }

    const product = await this.repository.update(id, result.product);
    return { product, errors: {} };
  }

  deleteProduct(id) {
    return this.repository.delete(id);
  }
}

module.exports = { ProductService };