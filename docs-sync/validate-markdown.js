const fs = require('node:fs');
const path = require('node:path');
const sourceMap = require('./source-map.json');
const { REPOSITORY_ROOT } = require('./document-sections');
const { isAllowedDocumentationPath } = require('./generate-proposals');

function stripCodeFences(text, filePath, issues) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence && match) {
      fence = { character: match[1][0], length: match[1].length, line: index + 1 };
      output.push('');
      continue;
    }
    if (fence) {
      const close = new RegExp(`^\\s*${fence.character}{${fence.length},}\\s*$`).test(line);
      output.push('');
      if (close) {
        fence = null;
      }
      continue;
    }
    output.push(line);
  }

  if (fence) {
    issues.push({ file: filePath, line: fence.line, code: 'unclosed-code-fence', message: 'Fenced code block is not closed.' });
  }
  return output;
}

function headingSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function collectAnchors(text) {
  const anchors = new Set();
  const duplicateCounts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const explicit = /\bid\s*=\s*["']([^"']+)["']/.exec(line);
    if (explicit) {
      anchors.add(explicit[1]);
    }
    if (heading) {
      const base = headingSlug(heading[1]);
      const count = duplicateCounts.get(base) || 0;
      duplicateCounts.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
  }
  return anchors;
}

function parseInlineLinks(line) {
  const links = [];
  const expression = /!?(?:\[[^\]]*\])\((<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g;
  let match;
  while ((match = expression.exec(line)) !== null) {
    let target = match[1];
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1);
    }
    links.push({ target, index: match.index });
  }
  return links;
}

function checkLinks(lines, filePath, candidates, repositoryRoot, issues, firstLine = 1) {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const link of parseInlineLinks(line)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link.target)) {
        continue;
      }

      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(link.target);
      } catch {
        issues.push({
          file: filePath,
          line: firstLine + lineIndex,
          code: 'invalid-link-encoding',
          message: `Link target has invalid percent encoding: ${link.target}`,
        });
        continue;
      }

      const hashIndex = decodedTarget.indexOf('#');
      const pathAndQuery = hashIndex >= 0 ? decodedTarget.slice(0, hashIndex) : decodedTarget;
      const fragment = hashIndex >= 0 ? decodedTarget.slice(hashIndex + 1) : '';
      const queryIndex = pathAndQuery.indexOf('?');
      const relativeTarget = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
      const destination = relativeTarget
        ? path.posix.normalize(path.posix.join(path.posix.dirname(filePath), relativeTarget))
        : filePath;
      const fullDestination = path.resolve(repositoryRoot, destination);
      const root = path.resolve(repositoryRoot);

      if (fullDestination !== root && !fullDestination.startsWith(`${root}${path.sep}`)) {
        issues.push({
          file: filePath,
          line: firstLine + lineIndex,
          code: 'link-outside-repository',
          message: `Local link escapes repository root: ${link.target}`,
        });
        continue;
      }

      let targetText;
      if (candidates.has(destination)) {
        targetText = candidates.get(destination);
      } else if (fs.existsSync(fullDestination) && fs.statSync(fullDestination).isFile()) {
        targetText = fs.readFileSync(fullDestination, 'utf8');
      } else {
        issues.push({
          file: filePath,
          line: firstLine + lineIndex,
          code: 'broken-local-link',
          message: `Local link target does not exist: ${link.target}`,
        });
        continue;
      }

      if (fragment && !collectAnchors(targetText).has(fragment)) {
        issues.push({
          file: filePath,
          line: firstLine + lineIndex,
          code: 'broken-local-fragment',
          message: `Local link fragment does not exist: ${link.target}`,
        });
      }
    }
  }
}

function validateMarkdownDocument(text, filePath, { candidates = new Map(), repositoryRoot = REPOSITORY_ROOT } = {}) {
  const issues = [];
  const contentLines = stripCodeFences(text, filePath, issues);
  for (let index = 0; index < contentLines.length; index += 1) {
    const line = contentLines[index];
    const links = parseInlineLinks(line);
    const withoutLinks = line.replace(/!?(?:\[[^\]]*\])\((?:<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g, '');
    const openBrackets = (withoutLinks.match(/(?<!\\)\[/g) || []).length;
    const closeBrackets = (withoutLinks.match(/(?<!\\)\]/g) || []).length;
    const openParentheses = (withoutLinks.match(/(?<!\\)\(/g) || []).length;
    const closeParentheses = (withoutLinks.match(/(?<!\\)\)/g) || []).length;
    if (openBrackets !== closeBrackets || openParentheses !== closeParentheses) {
      issues.push({
        file: filePath,
        line: index + 1,
        code: 'malformed-link-syntax',
        message: 'Unbalanced link label or destination delimiters.',
      });
    }

    if (links.length > 0) {
      checkLinks([line], filePath, candidates, repositoryRoot, issues, index + 1);
    }
  }

  return issues;
}

function validateDocuments(documents, { candidates = new Map(), repositoryRoot = REPOSITORY_ROOT } = {}) {
  const issues = [];
  const uniqueDocuments = [...new Set(documents)].sort();
  const candidateMap = candidates instanceof Map ? candidates : new Map(Object.entries(candidates));

  for (const document of uniqueDocuments) {
    if (!isAllowedDocumentationPath(document, new Set(uniqueDocuments))) {
      issues.push({ file: document, line: 1, code: 'document-not-allowed', message: 'Document is outside the allowed documentation paths.' });
      continue;
    }

    const content = candidateMap.has(document)
      ? candidateMap.get(document)
      : fs.existsSync(path.resolve(repositoryRoot, document))
        ? fs.readFileSync(path.resolve(repositoryRoot, document), 'utf8')
        : null;

    if (content === null) {
      issues.push({ file: document, line: 1, code: 'missing-document', message: 'Documentation file does not exist.' });
      continue;
    }

    issues.push(...validateMarkdownDocument(content, document, {
      candidates: candidateMap,
      repositoryRoot,
    }));
  }

  return { documents: uniqueDocuments, issues, passed: issues.length === 0 };
}

function validateMappedDocuments(mappingIds, options = {}) {
  const selected = !mappingIds || mappingIds.length === 0
    ? sourceMap.mappings
    : mappingIds.map((id) => {
      const mapping = sourceMap.mappings.find((entry) => entry.id === id);
      if (!mapping) {
        throw new Error(`Unknown source-map mapping ID: ${id}`);
      }
      return mapping;
    });
  return validateDocuments(selected.flatMap((entry) => entry.documents), options);
}

function main(args) {
  const mappingIds = [];
  try {
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--mapping' && args[index + 1]) {
        mappingIds.push(args[++index]);
      } else if (args[index] === '--help') {
        process.stdout.write('Usage: node docs-sync/validate-markdown.js [--mapping <id>]\n');
        return 0;
      } else {
        throw new Error(`Unknown or incomplete argument: ${args[index]}`);
      }
    }

    const result = validateMappedDocuments(mappingIds);
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

module.exports = {
  collectAnchors,
  main,
  parseInlineLinks,
  stripCodeFences,
  validateDocuments,
  validateMappedDocuments,
  validateMarkdownDocument,
};
