const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProduct, updateProduct } = require('../product');
const { JsonProductRepository, ProductStorageError } = require('../product-repository');

async function withRepository(run, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'product-repository-'));
  const filePath = path.join(directory, 'data', 'products.json');

  try {
    await run(new JsonProductRepository({ filePath, ...options }), filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function makeProduct(name, price) {
  const result = createProduct({ name, price });
  assert.equal(Object.keys(result.errors).length, 0);
  return result.product;
}

test('initializes a missing file as an empty product list', async () => {
  await withRepository(async (repository, filePath) => {
    assert.deepEqual(await repository.list(), []);
    assert.equal(await fs.readFile(filePath, 'utf8'), '[]\n');
  });
});

test('creates, retrieves, updates, and deletes products', async () => {
  await withRepository(async (repository) => {
    const original = makeProduct('Desk lamp', '12.90');

    assert.deepEqual(await repository.create(original), original);
    assert.deepEqual(await repository.getById(original.id), original);

    const updated = updateProduct(original, {
      id: 'ignored-user-id',
      name: 'Reading lamp',
      price: '15.00',
    }).product;

    assert.deepEqual(await repository.update(original.id, updated), updated);
    assert.equal((await repository.getById(original.id)).name, 'Reading lamp');
    assert.deepEqual(await repository.delete(original.id), updated);
    assert.equal(await repository.getById(original.id), null);
    assert.deepEqual(await repository.list(), []);
  });
});

test('persists products so a new repository instance can read them', async () => {
  await withRepository(async (repository, filePath) => {
    const product = makeProduct('Notebook', '1.25');
    await repository.create(product);

    const restartedRepository = new JsonProductRepository({ filePath });
    assert.deepEqual(await restartedRepository.list(), [product]);
  });
});

test('returns null for missing IDs and duplicate creates without changing storage', async () => {
  await withRepository(async (repository) => {
    const product = makeProduct('Pen', '0.50');
    const missingId = '00000000-0000-4000-8000-000000000001';
    await repository.create(product);

    assert.equal(await repository.getById(missingId), null);
    assert.equal(await repository.update(missingId, { ...product, id: missingId }), null);
    assert.equal(await repository.delete(missingId), null);
    assert.equal(await repository.create(product), null);
    assert.deepEqual(await repository.list(), [product]);
  });
});

test('serializes concurrent creates to avoid losing updates', async () => {
  await withRepository(async (repository) => {
    const first = makeProduct('Pencil', '0.25');
    const second = makeProduct('Eraser', '0.30');

    await Promise.all([repository.create(first), repository.create(second)]);

    const products = await repository.list();
    assert.equal(products.length, 2);
    assert.deepEqual(new Set(products.map((product) => product.id)), new Set([first.id, second.id]));
  });
});

test('snapshots records before queued writes', async () => {
  await withRepository(async (repository) => {
    const product = makeProduct('Original name', '3.50');
    const createPromise = repository.create(product);
    product.name = 'Mutated after submission';

    await createPromise;

    assert.equal((await repository.getById(product.id)).name, 'Original name');
  });
});

test('rejects malformed JSON without replacing the original file', async () => {
  await withRepository(async (repository, filePath) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const malformedContents = '{"unfinished":';
    await fs.writeFile(filePath, malformedContents, 'utf8');

    await assert.rejects(repository.list(), ProductStorageError);
    assert.equal(await fs.readFile(filePath, 'utf8'), malformedContents);
  });
});

test('rejects invalid product data without replacing the original file', async () => {
  await withRepository(async (repository, filePath) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const invalidContents = JSON.stringify([{ id: 'not-a-uuid', name: '', pricePaise: '0' }]);
    await fs.writeFile(filePath, invalidContents, 'utf8');

    await assert.rejects(repository.list(), ProductStorageError);
    assert.equal(await fs.readFile(filePath, 'utf8'), invalidContents);
  });
});

test('rejects duplicate IDs in persisted data without replacing the file', async () => {
  await withRepository(async (repository, filePath) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const product = makeProduct('Duplicate', '1.00');
    const duplicateContents = JSON.stringify([product, product]);
    await fs.writeFile(filePath, duplicateContents, 'utf8');

    await assert.rejects(repository.list(), ProductStorageError);
    assert.equal(await fs.readFile(filePath, 'utf8'), duplicateContents);
  });
});

test('wraps unreadable-file errors as storage errors', async () => {
  await withRepository(async (repository) => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const fileSystem = {
      ...fs,
      readFile: async () => {
        throw error;
      },
    };
    const unreadableRepository = new JsonProductRepository({
      filePath: repository.filePath,
      fileSystem,
    });

    await assert.rejects(unreadableRepository.list(), ProductStorageError);
  });
});

test('preserves existing data and removes the temporary file after a write failure', async () => {
  await withRepository(async (repository, filePath) => {
    await repository.list();
    const originalContents = await fs.readFile(filePath, 'utf8');
    const fileSystem = {
      ...fs,
      rename: async () => {
        throw new Error('simulated replacement failure');
      },
    };
    const failingRepository = new JsonProductRepository({ filePath, fileSystem });

    await assert.rejects(
      failingRepository.create(makeProduct('Marker', '2.00')),
      ProductStorageError,
    );

    assert.equal(await fs.readFile(filePath, 'utf8'), originalContents);
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['products.json']);
  });
});