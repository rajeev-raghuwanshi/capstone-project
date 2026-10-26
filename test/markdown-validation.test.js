const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  collectAnchors,
  validateDocuments,
  validateMarkdownDocument,
} = require('../docs-sync/validate-markdown');

async function withRepository(run) {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-validation-'));
  await fs.mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
  try {
    await run(repositoryRoot);
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
}

test('accepts closed code fences, valid relative links, and valid heading fragments', async () => {
  await withRepository(async (repositoryRoot) => {
    const source = '# Overview\n\n[Details](details.md#product-fields)\n\n```md\n[not a real link](missing.md)\n```\n';
    const target = '# Product Fields\n\nDetails.\n';
    await fs.writeFile(path.join(repositoryRoot, 'docs', 'details.md'), target, 'utf8');

    const result = validateMarkdownDocument(source, 'docs/readme.md', { repositoryRoot });
    assert.deepEqual(result, []);
  });
});

test('reports unclosed fences, malformed links, broken local targets, and fragments', async () => {
  await withRepository(async (repositoryRoot) => {
    const markdown = [
      '# Overview',
      '[broken label](missing.md)',
      '[bad bracket](details.md',
      '[bad fragment](details.md#does-not-exist)',
      '```js',
      'const example = true;',
    ].join('\n');
    await fs.writeFile(path.join(repositoryRoot, 'docs', 'details.md'), '# Existing\n', 'utf8');

    const issues = validateMarkdownDocument(markdown, 'docs/readme.md', { repositoryRoot });
    assert.deepEqual(
      issues.map((issue) => issue.code).sort(),
      ['broken-local-fragment', 'broken-local-link', 'malformed-link-syntax', 'unclosed-code-fence'],
    );
    assert.ok(issues.every((issue) => issue.file === 'docs/readme.md'));
    assert.ok(issues.some((issue) => issue.line === 5 && issue.code === 'unclosed-code-fence'));
  });
});

test('validates links against candidate documents before they are written', () => {
  const candidates = new Map([
    ['docs/one.md', '# One\n\n[Two](two.md#target)\n'],
    ['docs/two.md', '# Target\n'],
  ]);
  const result = validateDocuments([...candidates.keys()], { candidates, repositoryRoot: process.cwd() });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('rejects local links that escape the repository root', () => {
  const issues = validateMarkdownDocument('[outside](../../outside.md)', 'docs/page.md', {
    repositoryRoot: process.cwd(),
  });

  assert.equal(issues[0].code, 'link-outside-repository');
});

test('creates unique Markdown heading anchors deterministically', () => {
  assert.deepEqual(
    [...collectAnchors('# Product Fields\n## Product Fields\n<a id="custom"></a>')].sort(),
    ['custom', 'product-fields', 'product-fields-1'],
  );
});

test('validates proposed text in preference to the current on-disk document', async () => {
  await withRepository(async (repositoryRoot) => {
    await fs.writeFile(path.join(repositoryRoot, 'docs', 'page.md'), '# Existing\n', 'utf8');
    const result = validateDocuments(['docs/page.md'], {
      candidates: new Map([['docs/page.md', '# Candidate\n\n[Missing](lost.md)\n']]),
      repositoryRoot,
    });

    assert.equal(result.passed, false);
    assert.equal(result.issues[0].code, 'broken-local-link');
  });
});
