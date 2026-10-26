const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { createApp, errorHandler } = require('../app');

const app = createApp({
  productService: { listProducts: async () => [] },
});

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`, address);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('renders the catalogue on loopback', async () => {
  await withServer(async (baseUrl, address) => {
    const response = await fetch(baseUrl);
    const body = await response.text();

    assert.equal(address.address, '127.0.0.1');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(body, /<h1>Product Catalogue<\/h1>/);
  });
});

test('renders a not-found page for unknown paths', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(body, /Page not found/);
  });
});

test('logs server errors without passing details to the visitor view', () => {
  const originalConsoleError = console.error;
  const error = new Error('private filesystem path');
  let loggedError;
  let responseStatus;
  let renderedView;

  console.error = (logged) => {
    loggedError = logged;
  };

  try {
    errorHandler(error, {}, {
      headersSent: false,
      status(status) {
        responseStatus = status;
        return this;
      },
      render(view) {
        renderedView = view;
        return this;
      },
    }, () => {
      assert.fail('next should not be called before response headers are sent');
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedError, error);
  assert.equal(responseStatus, 500);
  assert.equal(renderedView, '500');
});