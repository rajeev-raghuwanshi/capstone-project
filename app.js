const path = require('node:path');
const express = require('express');
const { ProductService } = require('./product-service');
const { createProductRouter } = require('./routes/products');

function errorHandler(error, request, response, next) {
  console.error(error);

  if (response.headersSent) {
    return next(error);
  }

  response.status(500).render('500');
}

function createApp({ productService = new ProductService() } = {}) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(createProductRouter(productService));
  app.use((request, response) => {
    response.status(404).render('404');
  });
  app.use(errorHandler);

  return app;
}

const app = createApp();

module.exports = { app, createApp, errorHandler };