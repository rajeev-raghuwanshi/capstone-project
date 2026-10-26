const express = require('express');
const { paiseToRupees } = require('../product');
const ROUTE_CONTRACT = require('../docs-sync/contracts/routes.json');

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

function isLocalRequestSource(source, localPort) {
  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    return false;
  }

  const sourcePort = sourceUrl.port
    ? Number(sourceUrl.port)
    : sourceUrl.protocol === 'https:' ? 443 : 80;

  return sourceUrl.protocol === 'http:'
    && LOCAL_HOSTNAMES.has(sourceUrl.hostname)
    && sourcePort === localPort;
}

function requireLocalOrigin(request, response, next) {
  const source = request.get('origin') || request.get('referer');
  if (!source || !isLocalRequestSource(source, request.socket.localPort)) {
    return response.status(403).render('403');
  }

  return next();
}

const ROUTE_HANDLERS = {
  catalogue: async (request, response, productService) => {
    const products = await productService.listProducts();
    response.status(200).render('home', { products, formatPrice: paiseToRupees });
  },

  'create-form': (request, response) => {
    response.status(200).render('product-form', {
      action: '/products',
      errors: {},
      heading: 'Create product',
      product: {},
    });
  },

  'create-product': async (request, response, productService) => {
    const input = request.body || {};
    const result = await productService.createProduct(input);
    if (result.product === null) {
      return response.status(422).render('product-form', {
        action: '/products',
        errors: result.errors,
        heading: 'Create product',
        product: input,
      });
    }

    return response.redirect(303, `/products/${encodeURIComponent(result.product.id)}`);
  },

  'edit-form': async (request, response, productService) => {
    const product = await productService.getProductById(request.params.id);
    if (!product) {
      return response.status(404).render('404');
    }

    return response.status(200).render('product-form', {
      action: `/products/${encodeURIComponent(product.id)}/edit`,
      errors: {},
      heading: 'Edit product',
      product: { ...product, price: paiseToRupees(product.pricePaise) },
    });
  },

  'update-product': async (request, response, productService) => {
    const input = request.body || {};
    const result = await productService.updateProduct(request.params.id, input);
    if (result.product === null && Object.keys(result.errors).length > 0) {
      return response.status(422).render('product-form', {
        action: `/products/${encodeURIComponent(request.params.id)}/edit`,
        errors: result.errors,
        heading: 'Edit product',
        product: input,
      });
    }

    if (result.product === null) {
      return response.status(404).render('404');
    }

    return response.redirect(303, `/products/${encodeURIComponent(result.product.id)}`);
  },

  'delete-confirmation': async (request, response, productService) => {
    const product = await productService.getProductById(request.params.id);
    if (!product) {
      return response.status(404).render('404');
    }

    return response.status(200).render('delete-confirmation', { product });
  },

  'delete-product': async (request, response, productService) => {
    const product = await productService.deleteProduct(request.params.id);
    if (!product) {
      return response.status(404).render('404');
    }

    return response.redirect(303, '/');
  },

  'product-detail': async (request, response, productService) => {
    const product = await productService.getProductById(request.params.id);
    if (!product) {
      return response.status(404).render('404');
    }

    return response.status(200).render('product-detail', {
      formatPrice: paiseToRupees,
      product,
    });
  },
};

const PRODUCT_ROUTE_HANDLER_IDS = Object.keys(ROUTE_HANDLERS);

function createProductRouter(productService) {
  const router = express.Router();

  for (const route of ROUTE_CONTRACT.routes) {
    const handler = ROUTE_HANDLERS[route.id];
    if (!handler) {
      throw new Error(`No route handler is registered for contract ID: ${route.id}`);
    }

    const middleware = route.protection === 'local-origin' ? [requireLocalOrigin] : [];
    router[route.method.toLowerCase()](route.path, ...middleware, (request, response) =>
      handler(request, response, productService));
  }

  const contractIds = new Set(ROUTE_CONTRACT.routes.map((route) => route.id));
  if (PRODUCT_ROUTE_HANDLER_IDS.some((id) => !contractIds.has(id))) {
    throw new Error('A product route handler has no route contract.');
  }

  return router;
}

module.exports = { createProductRouter, PRODUCT_ROUTE_HANDLER_IDS };