const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../app');
const { JsonProductRepository, ProductStorageError } = require('../product-repository');
const { ProductService } = require('../product-service');

async function withServer(productService, run) {
  const server = createApp({ productService }).listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await run(baseUrl, address);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function withRepository(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'product-routes-'));
  const repository = new JsonProductRepository({
    filePath: path.join(directory, 'data', 'products.json'),
  });

  try {
    await withServer(new ProductService(repository), (baseUrl, address) =>
      run(baseUrl, address, repository));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function postForm(baseUrl, route, fields, { origin = baseUrl, referer } = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (origin !== null) {
    headers.origin = origin;
  }
  if (referer) {
    headers.referer = referer;
  }

  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

test('shows the empty catalogue and new-product form', async () => {
  await withRepository(async (baseUrl) => {
    const catalogue = await fetch(baseUrl);
    const catalogueBody = await catalogue.text();
    const form = await fetch(`${baseUrl}/products/new`);

    assert.equal(catalogue.status, 200);
    assert.match(catalogueBody, /No products available\./);
    assert.equal(form.status, 200);
    assert.match(await form.text(), /name="price"/);
  });
});

test('creates products and redirects to escaped product details', async () => {
  await withRepository(async (baseUrl) => {
    const response = await postForm(baseUrl, '/products', {
      name: '<script>alert(1)</script>',
      price: '12.34',
    });

    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /^\/products\/[0-9a-f-]+$/i);

    const detail = await fetch(new URL(response.headers.get('location'), baseUrl));
    const body = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
    assert.match(body, /INR 12\.34/);
  });
});

test('rejects invalid product input with 422 and does not persist it', async () => {
  await withRepository(async (baseUrl, address, repository) => {
    const response = await postForm(baseUrl, '/products', {
      name: '   ',
      price: '0',
    });

    assert.equal(response.status, 422);
    assert.match(await response.text(), /Name is required\./);
    assert.deepEqual(await repository.list(), []);
  });
});

test('returns validation feedback for a POST with no parsed form body', async () => {
  await withRepository(async (baseUrl, address, repository) => {
    const response = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { origin: baseUrl },
    });

    assert.equal(response.status, 422);
    assert.match(await response.text(), /Name is required\./);
    assert.deepEqual(await repository.list(), []);
  });
});

test('updates an existing product without changing its ID', async () => {
  await withRepository(async (baseUrl, address, repository) => {
    const created = await (await postForm(baseUrl, '/products', {
      name: 'Desk lamp',
      price: '10.00',
    })).headers.get('location');
    const productId = created.split('/').at(-1);
    const editPage = await fetch(`${baseUrl}/products/${productId}/edit`);

    assert.equal(editPage.status, 200);
    assert.match(await editPage.text(), /value="10\.00"/);

    const response = await postForm(baseUrl, `/products/${productId}/edit`, {
      id: 'replacement-id',
      name: 'Updated lamp',
      price: '15.25',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/products/${productId}`);
    const saved = await repository.getById(productId);
    assert.equal(saved.id, productId);
    assert.equal(saved.name, 'Updated lamp');
    assert.equal(saved.pricePaise, '1525');
  });
});

test('requires deletion confirmation before removing a product', async () => {
  await withRepository(async (baseUrl, address, repository) => {
    const product = {
      id: '6e7c8a73-2fe3-4a44-8e73-29fdc860e42b',
      name: 'Notebook',
      pricePaise: '250',
    };
    await repository.create(product);

    const confirmation = await fetch(`${baseUrl}/products/${product.id}/delete`);
    assert.equal(confirmation.status, 200);
    assert.match(await confirmation.text(), /Confirm deletion of <strong>Notebook<\/strong>/);
    assert.ok(await repository.getById(product.id));

    const response = await postForm(baseUrl, `/products/${product.id}/delete`, {});
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/');
    assert.equal(await repository.getById(product.id), null);
  });
});

test('returns 404 for malformed and unknown product IDs', async () => {
  await withRepository(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/products/not-a-uuid`);
    const unknown = await fetch(`${baseUrl}/products/6e7c8a73-2fe3-4a44-8e73-29fdc860e42b`);

    assert.equal(malformed.status, 404);
    assert.equal(unknown.status, 404);
  });
});

test('rejects foreign origins and accepts a same-origin referer fallback', async () => {
  await withRepository(async (baseUrl, address, repository) => {
    const rejected = await postForm(baseUrl, '/products', {
      name: 'Blocked product',
      price: '1.00',
    }, { origin: 'https://attacker.example' });

    assert.equal(rejected.status, 403);
    assert.deepEqual(await repository.list(), []);

    const accepted = await postForm(baseUrl, '/products', {
      name: 'Allowed product',
      price: '1.00',
    }, { origin: null, referer: `${baseUrl}/products/new` });

    assert.equal(accepted.status, 303);
    assert.equal((await repository.list()).length, 1);
  });
});

test('returns a generic 500 page when product storage fails', async () => {
  const productService = {
    listProducts: async () => {
      throw new ProductStorageError('private filesystem path');
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withServer(productService, async (baseUrl) => {
      const response = await fetch(baseUrl);
      const body = await response.text();

      assert.equal(response.status, 500);
      assert.match(body, /Something went wrong/);
      assert.doesNotMatch(body, /private filesystem path/);
    });
  } finally {
    console.error = originalConsoleError;
  }
});