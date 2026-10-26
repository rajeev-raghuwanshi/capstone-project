const { spawnSync } = require('node:child_process');
const sourceMap = require('./source-map.json');
const { analyzeChangedFiles, getChangedFiles } = require('./detect-changes');
const { runVerificationTests } = require('./compare-docs');
const {
  createDocumentProposals,
  compareCandidateSections,
  renderProposals,
} = require('./generate-proposals');
const { validateDocuments } = require('./validate-markdown');

function mappingsForIds(ids, mapping) {
  return ids.map((id) => mapping.mappings.find((entry) => entry.id === id)).filter(Boolean);
}

function reviewDocumentationChanges(changes, {
  mapping = sourceMap,
  repositoryRoot,
  runVerification = runVerificationTests,
} = {}) {
  const impact = analyzeChangedFiles(changes, mapping);
  const result = {
    changedPaths: impact.changedPaths,
    affectedMappings: impact.affectedMappings,
    affectedDocuments: impact.affectedDocuments,
    proposals: [],
    diff: '',
    markdownValidation: { documents: [], issues: [], passed: true },
    candidateDrift: [],
    runtimeVerification: 'not-required',
    unresolvedFindings: [],
  };

  if (impact.unmappedSourceChanges.length > 0) {
    result.unresolvedFindings.push({
      code: 'unmapped-source-change',
      changes: impact.unmappedSourceChanges,
      message: 'Relevant source changes are not covered by the source-to-document mapping.',
    });
  }

  if (!impact.hasRelevantChanges) {
    result.passed = result.unresolvedFindings.length === 0;
    return result;
  }

  const mappings = mappingsForIds(impact.affectedMappings, mapping);
  try {
    result.proposals = createDocumentProposals(impact.affectedMappings, {
      mapping,
      repositoryRoot,
    });
    result.diff = renderProposals(result.proposals);

    const candidateDocuments = new Map(result.proposals.map((proposal) => [proposal.path, proposal.candidate]));
    result.markdownValidation = validateDocuments(impact.affectedDocuments, {
      candidates: candidateDocuments,
      repositoryRoot,
    });

    result.candidateDrift = compareCandidateSections(result.proposals, impact.affectedMappings, {
      mapping,
      repositoryRoot,
    });

    runVerification(mappings);
    result.runtimeVerification = 'passed';
  } catch (error) {
    result.unresolvedFindings.push({
      code: 'proposal-validation-failed',
      message: error.message,
    });
  }

  if (result.markdownValidation.issues.length > 0) {
    result.unresolvedFindings.push({
      code: 'markdown-validation-failed',
      issues: result.markdownValidation.issues,
    });
  }
  if (result.candidateDrift.length > 0) {
    result.unresolvedFindings.push({
      code: 'candidate-documentation-drift',
      drift: result.candidateDrift,
    });
  }

  result.passed = result.unresolvedFindings.length === 0;
  result.humanReviewRequired = result.proposals.length > 0;
  return result;
}

function main(args) {
  if (args.length !== 2) {
    process.stderr.write('Usage: node docs-sync/review-proposals.js <base-ref> <head-ref>\n');
    return 2;
  }

  try {
    const changes = getChangedFiles(args[0], args[1]);
    const result = reviewDocumentationChanges(changes);
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

module.exports = { main, reviewDocumentationChanges };