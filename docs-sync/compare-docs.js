const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sourceMap = require('./source-map.json');
const {
  REPOSITORY_ROOT,
  compareContractSection,
  loadContract,
  renderContractSection,
} = require('./document-sections');

function selectMappings(mappingIds, mapping = sourceMap) {
  if (!mappingIds || mappingIds.length === 0) {
    return mapping.mappings;
  }

  const selected = mappingIds.map((id) => mapping.mappings.find((entry) => entry.id === id));
  const missing = mappingIds.filter((id, index) => !selected[index]);
  if (missing.length > 0) {
    throw new Error(`Unknown source-map mapping ID(s): ${missing.join(', ')}`);
  }
  return selected;
}

function safeRepositoryPath(relativePath) {
  const fullPath = path.resolve(REPOSITORY_ROOT, relativePath);
  if (!fullPath.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw new Error(`Repository path escapes root: ${relativePath}`);
  }
  return fullPath;
}

function buildExpectedSections(mappings) {
  const sectionsByDocument = new Map();

  for (const mapping of mappings) {
    for (const document of mapping.documents) {
      const contract = loadContract(mapping.contract);
      const id = mapping.contractId;
      if (!id) {
        throw new Error(`Mapping ${mapping.id} is missing a contractId.`);
      }
      const sections = sectionsByDocument.get(document) || new Map();
      const expected = renderContractSection(mapping.contract, contract);
      const previous = sections.get(id);
      if (previous && previous !== expected) {
        throw new Error(`Conflicting contract definitions for ${document}: ${id}`);
      }
      sections.set(id, expected);
      sectionsByDocument.set(document, sections);
    }
  }

  return sectionsByDocument;
}

function validateVerificationFiles(mappings) {
  const missing = [...new Set(mappings.flatMap((mapping) => mapping.verification))]
    .filter((testFile) => !fs.existsSync(safeRepositoryPath(testFile)));
  if (missing.length > 0) {
    throw new Error(`Missing runtime verification file(s): ${missing.join(', ')}`);
  }
}

function runVerificationTests(mappings) {
  const testFiles = [...new Set(mappings.flatMap((mapping) => mapping.verification))];
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Unable to run mapped runtime verification tests: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`Mapped runtime verification tests failed.\n${output}`);
  }

  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function compareDocumentation(mappingIds, { mapping = sourceMap, verify = true } = {}) {
  const mappings = selectMappings(mappingIds, mapping);
  validateVerificationFiles(mappings);
  const expectedSections = buildExpectedSections(mappings);
  const drift = [];

  for (const [document, sections] of expectedSections) {
    const documentPath = safeRepositoryPath(document);
    if (!fs.existsSync(documentPath)) {
      drift.push({ document, contract: null, reason: 'missing-document' });
      continue;
    }

    const documentText = fs.readFileSync(documentPath, 'utf8');
    for (const [id, expected] of sections) {
      const comparison = compareContractSection(documentText, id, expected);
      if (!comparison.matches) {
        drift.push({ document, contract: id, reason: comparison.reason });
      }
    }
  }

  const result = {
    checkedMappings: mappings.map((entry) => entry.id).sort(),
    checkedDocuments: [...expectedSections.keys()].sort(),
    drift,
    passed: drift.length === 0,
  };

  if (!result.passed) {
    return result;
  }

  if (verify) {
    runVerificationTests(mappings);
    result.runtimeVerification = 'passed';
  } else {
    result.runtimeVerification = 'not-run';
  }

  return result;
}

function parseArguments(args) {
  const mappingIds = [];
  let verify = true;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--mapping') {
      if (!args[index + 1]) {
        throw new Error('--mapping requires a mapping ID.');
      }
      mappingIds.push(args[++index]);
    } else if (args[index] === '--no-verify') {
      verify = false;
    } else if (args[index] === '--help') {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }

  return { mappingIds, verify };
}

function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write('Usage: node docs-sync/compare-docs.js [--mapping <id>] [--no-verify]\n');
      return 0;
    }

    const result = compareDocumentation(options.mappingIds, { verify: options.verify });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { compareDocumentation, main, parseArguments, runVerificationTests };