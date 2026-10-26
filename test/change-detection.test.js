const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sourceMap = require('../docs-sync/source-map.json');
const {
  analyzeChangedFiles,
  getChangedFiles,
  parseNameStatusZ,
} = require('../docs-sync/detect-changes');

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('parses NUL-delimited additions, modifications, deletions, and renames', () => {
  const changes = parseNameStatusZ(
    'A\0routes/new route.js\0M\0product.js\0D\0views/old.ejs\0R100\0routes/old.js\0routes/new.js\0',
  );

  assert.deepEqual(changes, [
    { status: 'A', paths: ['routes/new route.js'] },
    { status: 'M', paths: ['product.js'] },
    { status: 'D', paths: ['views/old.ejs'] },
    { status: 'R100', paths: ['routes/old.js', 'routes/new.js'] },
  ]);
  assert.deepEqual(parseNameStatusZ(''), []);
  assert.throws(() => parseNameStatusZ('R100\0routes/old.js\0'), /Incomplete/);
});

test('maps changed sources to docs and flags unmapped relevant source files', () => {
  const result = analyzeChangedFiles([
    { status: 'M', paths: ['routes/products.js'] },
    { status: 'A', paths: ['routes/new-route.js'] },
    { status: 'M', paths: ['views/product-form.ejs'] },
    { status: 'M', paths: ['product.js'] },
    { status: 'M', paths: ['index.js'] },
    { status: 'A', paths: ['new-validation.js'] },
    { status: 'M', paths: ['test/helper.js'] },
    { status: 'M', paths: ['docs-sync/detect-changes.js'] },
    { status: 'M', paths: ['README.md'] },
  ], sourceMap);

  assert.deepEqual(result.affectedDocuments, [
    'README.md',
    'docs/product-data.md',
    'docs/routes.md',
  ]);
  assert.deepEqual(result.unmappedSourceChanges, [
    { status: 'A', path: 'new-validation.js' },
  ]);
  assert.equal(result.hasRelevantChanges, true);
  assert.equal(result.hasUnmappedSourceChanges, true);
  assert.ok(result.affectedMappings.includes('route-views'));
  assert.ok(result.affectedMappings.includes('product-form-view'));
  assert.ok(result.verification.includes('test/contracts.test.js'));
});

test('ignores unrelated and explicitly excluded changes', () => {
  const result = analyzeChangedFiles([
    { status: 'M', paths: ['README.md'] },
    { status: 'M', paths: ['test/fixture.js'] },
    { status: 'M', paths: ['docs-sync/implementation.js'] },
  ], sourceMap);

  assert.equal(result.hasRelevantChanges, false);
  assert.deepEqual(result.affectedDocuments, []);
  assert.deepEqual(result.unmappedSourceChanges, []);
});

test('reads actual Git changes including renames and additions', async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-sync-diff-'));

  try {
    runGit(['init', '--quiet'], repository);
    runGit(['config', 'user.name', 'Contract Test'], repository);
    runGit(['config', 'user.email', 'contract-test@example.invalid'], repository);
    await fs.mkdir(path.join(repository, 'routes'), { recursive: true });
    await fs.writeFile(path.join(repository, 'routes', 'old-route.js'), 'module.exports = 1;\n');
    await fs.writeFile(path.join(repository, 'product.js'), 'module.exports = 1;\n');
    runGit(['add', '--all'], repository);
    runGit(['commit', '--quiet', '-m', 'base'], repository);
    const base = runGit(['rev-parse', 'HEAD'], repository);

    await fs.rename(
      path.join(repository, 'routes', 'old-route.js'),
      path.join(repository, 'routes', 'products.js'),
    );
    await fs.writeFile(path.join(repository, 'product.js'), 'module.exports = 2;\n');
    await fs.writeFile(path.join(repository, 'routes', 'new-route.js'), 'module.exports = 3;\n');
    runGit(['add', '--all'], repository);
    runGit(['commit', '--quiet', '-m', 'head'], repository);
    const head = runGit(['rev-parse', 'HEAD'], repository);

    const changes = getChangedFiles(base, head, { cwd: repository });
    assert.ok(changes.some((change) => change.status.startsWith('R')));
    assert.ok(changes.some((change) => change.status === 'M' && change.paths[0] === 'product.js'));
    assert.ok(changes.some((change) => change.status === 'A' && change.paths[0] === 'routes/new-route.js'));

    const result = analyzeChangedFiles(changes, sourceMap);
    assert.ok(result.affectedDocuments.includes('docs/routes.md'));
    assert.ok(result.affectedDocuments.includes('docs/product-data.md'));
    assert.deepEqual(result.unmappedSourceChanges, []);

    await fs.writeFile(path.join(repository, 'unmapped-controller.js'), 'module.exports = 4;\n');
    runGit(['add', '--all'], repository);
    runGit(['commit', '--quiet', '-m', 'unmapped source'], repository);
    const updatedHead = runGit(['rev-parse', 'HEAD'], repository);
    const detectorPath = path.resolve(__dirname, '../docs-sync/detect-changes.js');
    const cliResult = spawnSync(process.execPath, [detectorPath, base, updatedHead], {
      cwd: repository,
      encoding: 'utf8',
    });

    assert.equal(cliResult.status, 1);
    assert.deepEqual(
      JSON.parse(cliResult.stdout).unmappedSourceChanges,
      [{ status: 'A', path: 'unmapped-controller.js' }],
    );
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
});

test('rejects option-like Git references before invoking Git', () => {
  assert.throws(() => getChangedFiles('--help', 'HEAD'), /base Git reference is missing or invalid/);
});
