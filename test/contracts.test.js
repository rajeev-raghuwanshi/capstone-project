const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const mapping = require('../docs-sync/source-map.json');
const routeContract = require('../docs-sync/contracts/routes.json');
const productContract = require('../docs-sync/contracts/product.json');
const persistenceContract = require('../docs-sync/contracts/persistence.json');
const setupContract = require('../docs-sync/contracts/setup.json');
const { PRODUCT_ROUTE_HANDLER_IDS } = require('../routes/products');
const { PRODUCT_CONTRACT: runtimeProductContract } = require('../product');
const { JsonProductRepository } = require('../product-repository');
const { compareDocumentation } = require('../docs-sync/compare-docs');
const {
  compareContractSection,
  renderContractSection,
} = require('../docs-sync/document-sections');

const repositoryRoot = path.resolve(__dirname, '..');

function existsFromRoot(relativePath) {
  return fs.existsSync(path.resolve(repositoryRoot, relativePath));
}

test('source map references existing source paths, documents, contracts, and verification tests', () => {
  assert.equal(mapping.pathBase, 'repository-root');
  assert.deepEqual(mapping.relevantSourceExtensions, ['.js', '.cjs', '.mjs', '.ejs']);
  assert.ok(mapping.ignoredSourcePrefixes.includes('test/'));
  assert.ok(Array.isArray(mapping.mappings) && mapping.mappings.length > 0);
  assert.deepEqual(
    mapping.mappings.map((entry) => entry.id).sort(),
    [
      'application-setup',
      'browser-routes',
      'json-persistence',
      'product-form-view',
      'product-model',
      'route-views',
    ],
  );

  for (const entry of mapping.mappings) {
    assert.ok(entry.id);
    assert.ok(entry.sourcePaths.length > 0);
    assert.ok(entry.documents.length > 0);
    assert.ok(entry.verification.length > 0);
    assert.ok(existsFromRoot(entry.contract), `Missing contract: ${entry.contract}`);

    for (const sourcePath of entry.sourcePaths) {
      assert.ok(existsFromRoot(sourcePath), `Missing mapped source: ${sourcePath}`);
    }
    for (const document of entry.documents) {
      assert.ok(existsFromRoot(document), `Missing mapped document: ${document}`);
    }
    for (const verification of entry.verification) {
      assert.ok(existsFromRoot(verification), `Missing verification test: ${verification}`);
    }
  }
});

test('route contract describes unique browser routes and response outcomes', () => {
  assert.equal(routeContract.version, 1);
  assert.ok(routeContract.routes.length > 0);
  const routeKeys = new Set();

  for (const route of routeContract.routes) {
    const key = `${route.method} ${route.path}`;
    assert.ok(!routeKeys.has(key), `Duplicate route contract: ${key}`);
    routeKeys.add(key);
    assert.ok(route.id && route.purpose);
    assert.ok(Array.isArray(route.inputs));
    assert.ok(route.successResponses.length > 0);
    assert.ok(Array.isArray(route.otherResponses));
    assert.ok(['GET', 'POST'].includes(route.method));
    assert.equal(route.protection, route.method === 'POST' ? 'local-origin' : null);
  }

  assert.deepEqual(
    PRODUCT_ROUTE_HANDLER_IDS.slice().sort(),
    routeContract.routes.map((route) => route.id).sort(),
  );
});

test('route contract paths and statuses are present in the route inventory', () => {
  const routeDocumentation = fs.readFileSync(path.join(repositoryRoot, 'docs/routes.md'), 'utf8');
  const statusLabels = {
    200: 'OK',
    303: 'See Other',
    403: 'Forbidden',
    404: 'Not Found',
    422: 'Unprocessable Content',
    500: 'Internal Server Error',
  };

  for (const route of routeContract.routes) {
    assert.ok(
      routeDocumentation.includes(`| \`${route.method}\` | \`${route.path}\``),
      `Route missing from documentation: ${route.method} ${route.path}`,
    );
    for (const status of [...route.successResponses, ...route.otherResponses]) {
      assert.ok(
        routeDocumentation.includes(`\`${status} ${statusLabels[status]}\``),
        `Status ${status} missing from route documentation`,
      );
    }
  }
});

test('product contract captures the current persisted field names and constraints', () => {
  assert.deepEqual(runtimeProductContract, productContract);
  assert.equal(productContract.id.format, 'uuid-v4');
  assert.equal(productContract.id.immutable, true);
  assert.deepEqual(
    productContract.fields.map((field) => field.inputName),
    ['name', 'price', 'description', 'category', 'imageUrl'],
  );
  assert.equal(productContract.fields.find((field) => field.inputName === 'price').storedName, 'pricePaise');
  assert.equal(productContract.fields.find((field) => field.inputName === 'price').required, true);
  assert.equal(productContract.fields.find((field) => field.inputName === 'price').maxFractionDigits, 2);
  assert.equal(productContract.fields.find((field) => field.inputName === 'imageUrl').formatValidation, false);
});

test('persistence and setup contracts match the package entry points', () => {
  const packageJson = require('../package.json');
  const defaultRepository = new JsonProductRepository();

  assert.equal(persistenceContract.filePath, 'data/products.json');
  assert.equal(defaultRepository.filePath, path.resolve(repositoryRoot, persistenceContract.filePath));
  assert.equal(persistenceContract.missingFileBehavior, 'initialize-empty-array');
  assert.equal(persistenceContract.storageErrorName, 'ProductStorageError');
  assert.equal(setupContract.host, '127.0.0.1');
  assert.equal(setupContract.defaultPort, 3000);
  assert.deepEqual(packageJson.scripts, setupContract.packageScripts);
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), setupContract.dependencies.slice().sort());
});

test('reports changed, missing, and duplicated generated contract sections', () => {
  const expected = renderContractSection('docs-sync/contracts/routes.json', routeContract);
  const matchingDocument = `# Routes\n\n${expected}\n\nAdditional authored text.\n`;

  assert.deepEqual(compareContractSection(matchingDocument, 'routes', expected), {
    matches: true,
    reason: null,
  });
  assert.deepEqual(compareContractSection(matchingDocument.replace('Responses', 'Outcomes'), 'routes', expected), {
    matches: false,
    reason: 'generated-section-mismatch',
  });
  assert.deepEqual(compareContractSection('# Routes\n', 'routes', expected), {
    matches: false,
    reason: 'missing-or-duplicate-generated-section',
  });
  assert.deepEqual(compareContractSection(`${expected}\n${expected}`, 'routes', expected), {
    matches: false,
    reason: 'missing-or-duplicate-generated-section',
  });
});
