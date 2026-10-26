const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDocumentProposals, renderProposals, updateDocumentSection } = require('../docs-sync/generate-proposals');
const { renderContractSection } = require('../docs-sync/document-sections');
const { reviewDocumentationChanges } = require('../docs-sync/review-proposals');
const sourceMap = require('../docs-sync/source-map.json');

function makeMapping(documentPath = 'docs/routes.md') {
  return {
    mappings: [{
      id: 'route-test',
      sourcePaths: ['routes/'],
      documents: [documentPath],
      contract: 'contracts/routes.json',
      contractId: 'routes',
      verification: ['test/routes.test.js'],
    }],
  };
}

async function withRepository(run) {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'proposal-generation-'));
  await fs.mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
  await fs.mkdir(path.join(repositoryRoot, 'contracts'), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, 'contracts', 'routes.json'), JSON.stringify({
    version: 1,
    routes: [{
      id: 'catalogue',
      method: 'GET',
      path: '/',
      purpose: 'Display catalogue.',
      inputs: [],
      successResponses: [200],
      otherResponses: [],
      protection: null,
    }],
  }), 'utf8');

  try {
    await run(repositoryRoot);
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
}

test('generates a reviewable diff without modifying the source document', async () => {
  await withRepository(async (repositoryRoot) => {
    const documentPath = path.join(repositoryRoot, 'docs', 'routes.md');
    const original = '# Routes\n\nAuthored explanation remains here.\n';
    await fs.writeFile(documentPath, original, 'utf8');
    const proposals = createDocumentProposals([], {
      mapping: makeMapping(),
      repositoryRoot,
    });

    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].path, 'docs/routes.md');
    assert.equal(await fs.readFile(documentPath, 'utf8'), original);
    assert.match(proposals[0].candidate, /<!-- docs-sync:begin routes -->/);
    assert.match(proposals[0].candidate, /Authored explanation remains here\./);

    const diff = renderProposals(proposals);
    assert.match(diff, /^--- a\/docs\/routes\.md/m);
    assert.match(diff, /^\+\+\+ b\/docs\/routes\.md/m);
    assert.match(diff, /^\+<!-- docs-sync:begin routes -->/m);
  });
});

test('updates only the generated section and preserves surrounding prose', () => {
  const oldSection = '<!-- docs-sync:begin routes -->\nold\n<!-- docs-sync:end routes -->';
  const expected = renderContractSection('contracts/routes.json', {
    version: 1,
    routes: [],
  });
  const before = `# Routes\n\nIntro text.\n\n${oldSection}\n\nClosing text.\n`;
  const updated = updateDocumentSection(before, 'routes', expected);

  assert.equal(updated.changed, true);
  assert.match(updated.content, /Intro text\./);
  assert.match(updated.content, /Closing text\./);
  assert.ok(updated.content.includes(expected));
});

test('leaves already matching generated sections unchanged', () => {
  const section = '<!-- docs-sync:begin routes -->\ncurrent\n<!-- docs-sync:end routes -->';
  const content = `# Routes\n\n${section}\n`;

  assert.deepEqual(updateDocumentSection(content, 'routes', section), {
    content,
    changed: false,
  });
});

test('rejects duplicate generated sections instead of guessing which to replace', () => {
  const section = '<!-- docs-sync:begin routes -->\ncurrent\n<!-- docs-sync:end routes -->';

  assert.throws(
    () => updateDocumentSection(`${section}\n${section}`, 'routes', 'updated'),
    /duplicate generated section markers/,
  );
});

test('rejects missing docs, unmapped targets, non-Markdown paths, traversal, and symlinks', async () => {
  await withRepository(async (repositoryRoot) => {
    const mapping = makeMapping();

    assert.throws(
      () => createDocumentProposals([], { mapping: makeMapping('../README.md'), repositoryRoot }),
      /outside the documentation allowlist|escapes repository root/,
    );

    assert.throws(
      () => createDocumentProposals([], { mapping: makeMapping('docs/routes.js'), repositoryRoot }),
      /outside the documentation allowlist/,
    );

    assert.throws(
      () => createDocumentProposals([], { mapping: makeMapping('docs/../README.md'), repositoryRoot }),
      /outside the documentation allowlist|escapes repository root/,
    );

    assert.throws(
      () => createDocumentProposals([], { mapping, repositoryRoot }),
      /ENOENT/,
    );

    const outsideFile = path.join(repositoryRoot, 'outside.md');
    await fs.writeFile(outsideFile, '# Outside\n', 'utf8');
    const linkedPath = path.join(repositoryRoot, 'docs', 'routes.md');
    try {
      await fs.symlink(outsideFile, linkedPath);
      assert.throws(
        () => createDocumentProposals([], { mapping, repositoryRoot }),
        /not a regular file/,
      );
    } catch (error) {
      if (error.code !== 'EPERM') {
        throw error;
      }
    }
  });
});

test('diff output includes changed lines and handles new files deterministically', () => {
  const proposals = [{ path: 'docs/new.md', original: '# New\n', candidate: '# New\n\nGenerated\n' }];
  const diff = renderProposals(proposals);

  assert.match(diff, /^--- a\/docs\/new\.md/m);
  assert.match(diff, /^\+Generated$/m);
});

test('review report validates candidates and marks generated diffs for human review', async () => {
  await withRepository(async (repositoryRoot) => {
    const documentPath = path.join(repositoryRoot, 'docs', 'routes.md');
    await fs.writeFile(documentPath, '# Routes\n\n[Details](details.md)\n', 'utf8');
    await fs.writeFile(path.join(repositoryRoot, 'docs', 'details.md'), '# Details\n', 'utf8');
    const mapping = makeMapping();
    let verificationRan = false;
    const result = reviewDocumentationChanges([
      { status: 'M', paths: ['routes/products.js'] },
    ], {
      mapping,
      repositoryRoot,
      runVerification: () => {
        verificationRan = true;
        return 'passed';
      },
    });

    assert.equal(result.passed, true);
    assert.equal(result.humanReviewRequired, true);
    assert.match(result.diff, /docs\/routes\.md/);
    assert.equal(result.markdownValidation.passed, true);
    assert.deepEqual(result.candidateDrift, []);
    assert.equal(result.runtimeVerification, 'passed');
    assert.equal(verificationRan, true);
    assert.equal(await fs.readFile(documentPath, 'utf8'), '# Routes\n\n[Details](details.md)\n');
  });
});

test('review report blocks candidate docs with invalid local links', async () => {
  await withRepository(async (repositoryRoot) => {
    const documentPath = path.join(repositoryRoot, 'docs', 'routes.md');
    const original = '# Routes\n\n[broken](absent.md)\n';
    await fs.writeFile(documentPath, original, 'utf8');
    const result = reviewDocumentationChanges([
      { status: 'M', paths: ['routes/products.js'] },
    ], {
      mapping: makeMapping(),
      repositoryRoot,
      runVerification: () => 'passed',
    });

    assert.equal(result.passed, false);
    assert.ok(result.unresolvedFindings.some((finding) => finding.code === 'markdown-validation-failed'));
    assert.equal(await fs.readFile(documentPath, 'utf8'), original);
  });
});

test('review report blocks unmapped changes and surfaces incomplete proposal errors', () => {
  const unmapped = reviewDocumentationChanges([
    { status: 'M', paths: ['new-controller.js'] },
  ], {
    mapping: {
      ...sourceMap,
      mappings: makeMapping().mappings,
    },
    runVerification: () => 'passed',
  });

  assert.equal(unmapped.passed, false);
  assert.ok(unmapped.unresolvedFindings.some((finding) => finding.code === 'unmapped-source-change'));

  const incomplete = reviewDocumentationChanges([
    { status: 'M', paths: ['routes/products.js'] },
  ], {
    mapping: makeMapping('../escape.md'),
    repositoryRoot: process.cwd(),
    runVerification: () => 'passed',
  });

  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.unresolvedFindings.some((finding) => finding.code === 'proposal-validation-failed'));
});
