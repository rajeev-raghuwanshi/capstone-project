const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../app');
const { JsonProductRepository } = require('../product-repository');
const { ProductService } = require('../product-service');

async function startServer(repository) {
  const app = createApp({ productService: new ProductService(repository) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

async function withDataFile(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'product-app-integration-'));
  const filePath = path.join(directory, 'data', 'products.json');

  try {
    await run(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function withoutErrorLogging(run) {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    return await run();
  } finally {
    console.error = originalConsoleError;
  }
}

function createProductRequest(baseUrl, fields) {
  return fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: {
      origin: baseUrl,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

test('initializes a missing product file through the catalogue request', async () => {
  await withDataFile(async (filePath) => {
    const repository = new JsonProductRepository({ filePath });
    const server = await startServer(repository);

    try {
      const response = await fetch(server.baseUrl);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /No products available\./);
      assert.equal(await fs.readFile(filePath, 'utf8'), '[]\n');
    } finally {
      await server.close();
    }
  });
});

test('keeps product changes available after an application server restart', async () => {
  await withDataFile(async (filePath) => {
    const firstServer = await startServer(new JsonProductRepository({ filePath }));
    let detailPath;

    try {
      const response = await createProductRequest(firstServer.baseUrl, {
        name: 'Restart-persistent product',
        price: '42.75',
      });
      assert.equal(response.status, 303);
      detailPath = response.headers.get('location');
    } finally {
      await firstServer.close();
    }

    const restartedServer = await startServer(new JsonProductRepository({ filePath }));
    try {
      const detail = await fetch(new URL(detailPath, restartedServer.baseUrl));
      const body = await detail.text();
      assert.equal(detail.status, 200);
      assert.match(body, /Restart-persistent product/);
      assert.match(body, /INR 42\.75/);
    } finally {
      await restartedServer.close();
    }
  });
});

test('serves generic errors for malformed JSON, preserves it, and stays available', async () => {
  await withDataFile(async (filePath) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const malformedContents = '{"damaged":';
    await fs.writeFile(filePath, malformedContents, 'utf8');

    const server = await startServer(new JsonProductRepository({ filePath }));
    try {
      await withoutErrorLogging(async () => {
        const failedCatalogue = await fetch(server.baseUrl);
        const errorBody = await failedCatalogue.text();
        assert.equal(failedCatalogue.status, 500);
        assert.match(errorBody, /Something went wrong/);
        assert.doesNotMatch(errorBody, /damaged|products\.json|SyntaxError/);
      });

      assert.equal(await fs.readFile(filePath, 'utf8'), malformedContents);
      assert.equal((await fetch(`${server.baseUrl}/products/new`)).status, 200);

      await fs.writeFile(filePath, '[]\n', 'utf8');
      const recoveredCatalogue = await fetch(server.baseUrl);
      assert.equal(recoveredCatalogue.status, 200);
      assert.match(await recoveredCatalogue.text(), /No products available\./);
    } finally {
      await server.close();
    }
  });
});

test('reports write failures without claiming success or replacing existing data', async () => {
  await withDataFile(async (filePath) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const originalContents = '[]\n';
    await fs.writeFile(filePath, originalContents, 'utf8');
    const fileSystem = {
      ...fs,
      rename: async () => {
        throw new Error('simulated disk failure');
      },
    };
    const repository = new JsonProductRepository({ filePath, fileSystem });
    const server = await startServer(repository);

    try {
      await withoutErrorLogging(async () => {
        const response = await createProductRequest(server.baseUrl, {
          name: 'Not persisted',
          price: '3.00',
        });
        const body = await response.text();

        assert.equal(response.status, 500);
        assert.equal(response.headers.get('location'), null);
        assert.match(body, /Something went wrong/);
        assert.doesNotMatch(body, /simulated disk failure|products\.json/);
      });

      assert.equal(await fs.readFile(filePath, 'utf8'), originalContents);
      assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['products.json']);
      assert.equal((await fetch(`${server.baseUrl}/products/new`)).status, 200);
    } finally {
      await server.close();
    }
  });
});
