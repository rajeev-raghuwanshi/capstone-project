const { execFileSync } = require('node:child_process');
const path = require('node:path');
const sourceMap = require('./source-map.json');

function normalizeRepositoryPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function parseNameStatusZ(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  if (typeof text !== 'string') {
    throw new TypeError('Git name-status output must be a string or Buffer.');
  }

  if (text === '') {
    return [];
  }

  const fields = text.split('\0');
  if (fields[fields.length - 1] === '') {
    fields.pop();
  }

  const changes = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index++];
    if (!/^[A-Z][0-9]*$/.test(status)) {
      throw new Error(`Invalid Git name-status entry: ${status}`);
    }

    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.slice(index, index + pathCount);
    if (paths.length !== pathCount || paths.some((filePath) => !filePath)) {
      throw new Error(`Incomplete Git name-status entry: ${status}`);
    }
    index += pathCount;
    changes.push({ status, paths });
  }

  return changes;
}

function resolveCommit(reference, label, cwd) {
  if (typeof reference !== 'string' || !reference || reference.startsWith('-')) {
    throw new Error(`${label} Git reference is missing or invalid.`);
  }

  try {
    return execFileSync('git', ['rev-parse', '--verify', `${reference}^{commit}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (cause) {
    throw new Error(`Unable to resolve ${label} Git reference: ${reference}`, { cause });
  }
}

function getChangedFiles(baseReference, headReference, { cwd = process.cwd() } = {}) {
  const baseCommit = resolveCommit(baseReference, 'base', cwd);
  const headCommit = resolveCommit(headReference, 'head', cwd);

  try {
    const output = execFileSync('git', [
      'diff',
      '--name-status',
      '-z',
      `${baseCommit}...${headCommit}`,
    ], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseNameStatusZ(output);
  } catch (cause) {
    throw new Error('Unable to compare the requested Git references.', { cause });
  }
}

function matchesSourcePath(filePath, sourcePath) {
  const normalizedSource = normalizeRepositoryPath(sourcePath);
  if (normalizedSource.endsWith('/')) {
    return filePath.startsWith(normalizedSource);
  }
  return filePath === normalizedSource;
}

function isIgnoredSourcePath(filePath, mapping) {
  return mapping.ignoredSourcePrefixes.some((prefix) =>
    filePath.startsWith(normalizeRepositoryPath(prefix)));
}

function analyzeChangedFiles(changes, mapping = sourceMap) {
  const changedPaths = [];
  const mappedChanges = [];
  const unmappedSourceChanges = [];
  const affectedMappings = new Map();
  const seenChangedPaths = new Set();
  const seenMappedChanges = new Set();
  const seenUnmappedChanges = new Set();

  for (const change of changes) {
    for (const originalPath of change.paths) {
      const filePath = normalizeRepositoryPath(originalPath);
      const pathKey = `${change.status}\0${filePath}`;
      if (!seenChangedPaths.has(pathKey)) {
        changedPaths.push({ status: change.status, path: filePath });
        seenChangedPaths.add(pathKey);
      }

      const matches = mapping.mappings.filter((entry) =>
        entry.sourcePaths.some((sourcePath) => matchesSourcePath(filePath, sourcePath)));

      if (matches.length > 0) {
        for (const entry of matches) {
          affectedMappings.set(entry.id, entry);
        }
        const key = `${change.status}\0${filePath}`;
        if (!seenMappedChanges.has(key)) {
          mappedChanges.push({
            status: change.status,
            path: filePath,
            mappings: matches.map((entry) => entry.id).sort(),
          });
          seenMappedChanges.add(key);
        }
        continue;
      }

      const extension = path.posix.extname(filePath).toLowerCase();
      if (
        !isIgnoredSourcePath(filePath, mapping)
        && mapping.relevantSourceExtensions.includes(extension)
        && !seenUnmappedChanges.has(pathKey)
      ) {
        unmappedSourceChanges.push({ status: change.status, path: filePath });
        seenUnmappedChanges.add(pathKey);
      }
    }
  }

  const orderedMappings = [...affectedMappings.values()].sort((left, right) =>
    left.id.localeCompare(right.id));
  const uniqueSorted = (values) => [...new Set(values)].sort();

  return {
    changedPaths,
    mappedChanges,
    unmappedSourceChanges,
    affectedMappings: orderedMappings.map((entry) => entry.id),
    affectedDocuments: uniqueSorted(orderedMappings.flatMap((entry) => entry.documents)),
    contracts: uniqueSorted(orderedMappings.map((entry) => entry.contract)),
    verification: uniqueSorted(orderedMappings.flatMap((entry) => entry.verification)),
    hasRelevantChanges: mappedChanges.length > 0 || unmappedSourceChanges.length > 0,
    hasUnmappedSourceChanges: unmappedSourceChanges.length > 0,
  };
}

function main(args) {
  if (args.length !== 2) {
    process.stderr.write('Usage: node docs-sync/detect-changes.js <base-ref> <head-ref>\n');
    return 2;
  }

  try {
    const changes = getChangedFiles(args[0], args[1]);
    const result = analyzeChangedFiles(changes);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.hasUnmappedSourceChanges ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { analyzeChangedFiles, getChangedFiles, parseNameStatusZ };
