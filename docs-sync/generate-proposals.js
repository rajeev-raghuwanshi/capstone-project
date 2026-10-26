const fs = require('node:fs');
const path = require('node:path');
const sourceMap = require('./source-map.json');
const {
  REPOSITORY_ROOT,
  compareContractSection,
  loadContract,
  renderContractSection,
} = require('./document-sections');

function selectMappings(mappingIds, mapping) {
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

function isAllowedDocumentationPath(documentPath, mappedDocuments) {
  if (!mappedDocuments.has(documentPath)) {
    return false;
  }
  if (documentPath === 'README.md') {
    return true;
  }
  return documentPath.startsWith('docs/')
    && documentPath.endsWith('.md')
    && !documentPath.split('/').some((segment) => segment === '.' || segment === '..');
}

function resolveRegularFile(repositoryRoot, relativePath) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const fullPath = path.resolve(resolvedRoot, relativePath);
  if (!fullPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Documentation path escapes repository root: ${relativePath}`);
  }
  const stat = fs.lstatSync(fullPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Documentation target is not a regular file: ${relativePath}`);
  }
  return fullPath;
}

function sectionExpression(id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `<!--[ \\t]*docs-sync:begin ${escapedId} \\t*-->[\\s\\S]*?<!--[ \\t]*docs-sync:end ${escapedId} \\t*-->`,
    'g',
  );
}

function updateDocumentSection(documentText, id, expectedSection) {
  const expression = sectionExpression(id);
  const matches = documentText.match(expression) || [];
  if (matches.length > 1) {
    throw new Error(`Cannot propose an update: duplicate generated section markers for ${id}.`);
  }

  if (matches.length === 1) {
    const current = matches[0].replace(/\r\n/g, '\n');
    if (current === expectedSection) {
      return { content: documentText, changed: false };
    }
    const newline = documentText.includes('\r\n') ? '\r\n' : '\n';
    return {
      content: documentText.replace(expression, expectedSection.replace(/\n/g, newline)),
      changed: true,
    };
  }

  const heading = /^# .+$/m.exec(documentText);
  if (!heading) {
    throw new Error(`Cannot propose an update: ${id} section is absent and no document title exists.`);
  }
  const newline = documentText.includes('\r\n') ? '\r\n' : '\n';
  const insertion = `${newline}${newline}${expectedSection.replace(/\n/g, newline)}`;
  const insertionIndex = heading.index + heading[0].length;
  return {
    content: `${documentText.slice(0, insertionIndex)}${insertion}${documentText.slice(insertionIndex)}`,
    changed: true,
  };
}

function createDocumentProposals(mappingIds, {
  mapping = sourceMap,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const mappings = selectMappings(mappingIds, mapping);
  const mappedDocuments = new Set(mapping.mappings.flatMap((entry) => entry.documents));
  const expectedByDocument = new Map();

  for (const entry of mappings) {
    if (!entry.contractId) {
      throw new Error(`Mapping ${entry.id} is missing a contractId.`);
    }
    const contract = loadContract(entry.contract, repositoryRoot);
    const expected = renderContractSection(entry.contract, contract);

    for (const documentPath of entry.documents) {
      if (!isAllowedDocumentationPath(documentPath, mappedDocuments)) {
        throw new Error(`Refusing to propose changes outside the documentation allowlist: ${documentPath}`);
      }

      const sections = expectedByDocument.get(documentPath) || new Map();
      const previous = sections.get(entry.contractId);
      if (previous && previous !== expected) {
        throw new Error(`Conflicting generated sections for ${documentPath}: ${entry.contractId}`);
      }
      sections.set(entry.contractId, expected);
      expectedByDocument.set(documentPath, sections);
    }
  }

  const proposals = [];
  for (const [documentPath, sections] of expectedByDocument) {
    const fullPath = resolveRegularFile(repositoryRoot, documentPath);
    const original = fs.readFileSync(fullPath, 'utf8');
    let candidate = original;

    for (const [id, expectedSection] of sections) {
      candidate = updateDocumentSection(candidate, id, expectedSection).content;
    }

    if (candidate !== original) {
      proposals.push({ path: documentPath, original, candidate });
    }
  }

  return proposals.sort((left, right) => left.path.localeCompare(right.path));
}

function compareCandidateSections(proposals, mappingIds, {
  mapping = sourceMap,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const mappings = selectMappings(mappingIds, mapping);
  const contractsByDocument = new Map();

  for (const entry of mappings) {
    const contract = loadContract(entry.contract, repositoryRoot);
    const expected = renderContractSection(entry.contract, contract);
    for (const documentPath of entry.documents) {
      const sections = contractsByDocument.get(documentPath) || new Map();
      sections.set(entry.contractId, expected);
      contractsByDocument.set(documentPath, sections);
    }
  }

  const proposalByPath = new Map(proposals.map((proposal) => [proposal.path, proposal]));
  const drift = [];

  for (const [documentPath, sections] of contractsByDocument) {
    const proposal = proposalByPath.get(documentPath);
    const fullPath = path.resolve(repositoryRoot, documentPath);
    if (!fullPath.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) {
      throw new Error(`Documentation path escapes repository root: ${documentPath}`);
    }

    let candidate;
    if (proposal) {
      candidate = proposal.candidate;
    } else if (fs.existsSync(fullPath)) {
      candidate = fs.readFileSync(fullPath, 'utf8');
    } else {
      drift.push({ document: documentPath, contract: null, reason: 'missing-document' });
      continue;
    }

    for (const [id, expected] of sections) {
      const comparison = compareContractSection(candidate, id, expected);
      if (!comparison.matches) {
        drift.push({ document: documentPath, contract: id, reason: comparison.reason });
      }
    }
  }

  return drift;
}

function diffLines(original, candidate) {
  const oldLines = original.replace(/\r\n/g, '\n').split('\n');
  const newLines = candidate.replace(/\r\n/g, '\n').split('\n');
  const cellCount = (oldLines.length + 1) * (newLines.length + 1);
  if (cellCount > 2_000_000) {
    throw new Error('Refusing to generate a diff for an unexpectedly large documentation file.');
  }

  const columns = newLines.length + 1;
  const lcs = new Uint32Array(cellCount);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const position = oldIndex * columns + newIndex;
      lcs[position] = oldLines[oldIndex] === newLines[newIndex]
        ? 1 + lcs[(oldIndex + 1) * columns + newIndex + 1]
        : Math.max(lcs[(oldIndex + 1) * columns + newIndex], lcs[oldIndex * columns + newIndex + 1]);
    }
  }

  const operations = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length
      && newIndex < newLines.length
      && oldLines[oldIndex] === newLines[newIndex]
    ) {
      operations.push({ type: 'context', line: oldLines[oldIndex], oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length
      && (oldIndex === oldLines.length
        || lcs[oldIndex * columns + newIndex + 1] >= lcs[(oldIndex + 1) * columns + newIndex])
    ) {
      operations.push({ type: 'add', line: newLines[newIndex], oldIndex, newIndex });
      newIndex += 1;
    } else {
      operations.push({ type: 'remove', line: oldLines[oldIndex], oldIndex, newIndex });
      oldIndex += 1;
    }
  }

  return operations;
}

function renderUnifiedDiff(documentPath, original, candidate, contextLines = 3) {
  const operations = diffLines(original, candidate);
  const changedIndexes = operations
    .map((operation, index) => operation.type === 'context' ? -1 : index)
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) {
    return '';
  }

  const groups = [];
  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - contextLines);
    const end = Math.min(operations.length - 1, changedIndex + contextLines);
    const previous = groups[groups.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = end;
    } else {
      groups.push({ start, end });
    }
  }

  const hunks = groups.map(({ start, end }) => {
    const operationsInHunk = operations.slice(start, end + 1);
    const firstOldLine = operationsInHunk.find((operation) => operation.type !== 'add')?.oldIndex ?? 0;
    const firstNewLine = operationsInHunk.find((operation) => operation.type !== 'remove')?.newIndex ?? 0;
    const oldCount = operationsInHunk.filter((operation) => operation.type !== 'add').length;
    const newCount = operationsInHunk.filter((operation) => operation.type !== 'remove').length;
    const oldStart = oldCount === 0 ? firstOldLine : firstOldLine + 1;
    const newStart = newCount === 0 ? firstNewLine : firstNewLine + 1;
    const lines = operationsInHunk.map((operation) => {
      const prefix = operation.type === 'context' ? ' ' : operation.type === 'add' ? '+' : '-';
      return `${prefix}${operation.line}`;
    });
    return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...lines].join('\n');
  });

  return [
    `--- a/${documentPath}`,
    `+++ b/${documentPath}`,
    ...hunks,
  ].join('\n');
}

function renderProposals(proposals) {
  return proposals
    .map((proposal) => renderUnifiedDiff(proposal.path, proposal.original, proposal.candidate))
    .filter(Boolean)
    .join('\n');
}

function parseArguments(args) {
  const mappingIds = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--mapping') {
      if (!args[index + 1]) {
        throw new Error('--mapping requires a mapping ID.');
      }
      mappingIds.push(args[++index]);
    } else if (args[index] === '--help') {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  return { mappingIds };
}

function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write('Usage: node docs-sync/generate-proposals.js [--mapping <id>]\n');
      return 0;
    }

    const proposals = createDocumentProposals(options.mappingIds);
      const drift = compareCandidateSections(proposals, options.mappingIds);
      if (drift.length > 0) {
        process.stderr.write(`Candidate proposal still has documentation drift: ${JSON.stringify(drift)}\n`);
        return 2;
      }
    const diff = renderProposals(proposals);
    if (!diff) {
      process.stdout.write('No documentation proposal is needed.\n');
      return 0;
    }

    process.stdout.write(`${diff}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  createDocumentProposals,
  compareCandidateSections,
  diffLines,
  isAllowedDocumentationPath,
  main,
  parseArguments,
  renderUnifiedDiff,
  renderProposals,
  updateDocumentSection,
};