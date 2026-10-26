const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/documentation-sync.yml'),
  'utf8',
);

test('workflow runs for pull request open, update, reopen, and ready events', () => {
  assert.match(workflow, /pull_request:\s*\r?\n\s+types:\s*\[opened, synchronize, reopened, ready_for_review\]/);
  assert.equal((workflow.match(/^name:/gm) || []).length, 1);
});

test('workflow grants read-only repository permission and does not persist checkout credentials', () => {
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /ref:\s*refs\/pull\/\$\{\{ github\.event\.pull_request\.number \}\}\/head/);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write|GITHUB_TOKEN:\s*\$\{\{/);
});

test('workflow installs, tests, validates docs, and runs review generation', () => {
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm test/);
  assert.match(workflow, /node docs-sync\/validate-markdown\.js/);
  assert.match(workflow, /node docs-sync\/review-proposals\.js/);
  assert.match(workflow, /node docs-sync\/compare-docs\.js/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.ok(
    workflow.indexOf('Generate documentation review report')
      < workflow.indexOf('Verify synchronized documentation contracts'),
    'proposal artifact should be generated before the clean-documentation gate',
  );
});

test('workflow uploads the human-review artifact even after a failed review check', () => {
  assert.match(workflow, /if:\s*always\(\) && hashFiles\('documentation-review\.json'\) != ''/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(workflow, /path:\s*documentation-review\.json/);
  assert.ok(
    workflow.indexOf('Generate documentation review report')
      < workflow.indexOf('Upload review report and proposed patch'),
    'review artifact should be uploaded after its report is generated',
  );
  assert.doesNotMatch(workflow, /git push|gh pr merge|pull_request_target/);
});