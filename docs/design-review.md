# Design Review: Automated Documentation Sync Capstone

**Status:** Review recommendations implemented for the initial application and sync workflow. Requirements remain labeled proposed in `docs/requirements.md` and were not changed by this review.

## 1. Review Scope

Reviewed `docs/requirements.md` and `docs/architecture.md` for requirements coverage, Express/EJS product CRUD, JSON persistence and validation, component boundaries, documentation synchronization, changed-file and affected-document detection, generation and validation accuracy, error handling, security, testability, maintainability, and unnecessary complexity.

No application code was reviewed or implemented. The architecture was assessed against the current requirements document, which is explicitly marked proposed. This review does not convert those requirements into approved requirements.

## 2. Findings

### DR-01: Source-change detection and documentation mapping were underspecified

- **Review area:** Synchronization; changed-file detection
- **Severity:** High
- **Description:** The original architecture compared PR changes with the base and referred to a source-to-document mapping, but did not define mapping maintenance or handling of additions, modifications, deletions, renames, and unmapped relevant changes.
- **Why it matters:** The same change could be handled inconsistently or an affected document could be missed.
- **Recommended solution:** Maintain a version-controlled source-to-document mapping, define change classification, and fail with an actionable finding for relevant unmapped changes.
- **Requirement affected:** Detect relevant source changes and identify affected documentation.
- **Decision:** Accepted.

### DR-02: Drift source of truth and comparison method were not selected

- **Review area:** Documentation accuracy and drift detection
- **Severity:** High
- **Description:** The original architecture proposed a normalized representation but did not define it, how it is compared to Markdown, or how the representation is proven to match actual behavior.
- **Why it matters:** Documentation and metadata could agree while both contradict runtime behavior; fuzzy prose comparison would also be unstable.
- **Recommended solution:** Use deterministic structured contracts or generated documentation sections, compare deterministically, and test those contracts against runtime behavior.
- **Requirement affected:** Detect implementation/documentation inconsistencies and keep route/product documentation accurate.
- **Decision:** Accepted.

### DR-03: Applying proposals to PR branches was unresolved

- **Review area:** Generation, human review, workflow security
- **Severity:** High
- **Description:** The original architecture required a reviewable PR-branch diff but left the write mechanism undecided, especially for fork-originated PRs.
- **Why it matters:** The proposal mechanism is central to the workflow and grants write access that must not be exposed to untrusted PR code.
- **Recommended solution:** Keep fork checks read-only and provide a patch artifact or suggested diff for a human to apply. Any same-repository automated branch update must be separately gated, least-privilege, and isolated from untrusted code execution.
- **Requirement affected:** Propose documentation changes for human review on the pull-request branch without automatic merging or direct main-branch writes.
- **Decision:** Accepted. Implemented as a read-only workflow artifact for same-repository and fork PRs. The artifact is not automatically applied to the PR branch; a human applies and reviews it.

### DR-04: Synchronization infrastructure failure behavior was undefined

- **Review area:** Error handling; workflow reliability
- **Severity:** Medium
- **Description:** The original architecture did not specify outcomes for mapping, extraction, comparison, validator, or incomplete-generation failures.
- **Why it matters:** A failed checker must not report success or leave a partial proposal appearing valid.
- **Recommended solution:** Define explicit pass/fail outcomes, fail closed with actionable diagnostics, and discard or clearly mark incomplete proposals.
- **Requirement affected:** Drift must block the PR; sync tests must demonstrate detection and validation behavior.
- **Decision:** Accepted.

### DR-05: Generated-diff guardrails were not specified

- **Review area:** Security; generated changes
- **Severity:** Medium
- **Description:** The original architecture did not constrain generated edits to documentation targets.
- **Why it matters:** A generation or patching defect could modify source, workflows, or unrelated files.
- **Recommended solution:** Allowlist documentation paths, validate repository-relative paths, reject out-of-scope diffs, and display the exact patch for human review.
- **Requirement affected:** Proposed changes must be documentation updates, reviewable by a human, and not merged automatically.
- **Decision:** Accepted.

### DR-06: Malformed JSON lifecycle needed an operational decision

- **Review area:** Persistence; error handling
- **Severity:** Medium
- **Description:** The original architecture did not say whether malformed or unreadable JSON prevents startup or returns errors on requests.
- **Why it matters:** Startup failure and request-time `500` behavior differ and have distinct test expectations.
- **Recommended solution:** Keep the server running, return generic `500` responses for requests requiring the unavailable store, log diagnostics, preserve the source file, and test that behavior.
- **Requirement affected:** Malformed/unreadable product data must not cause an unexpected crash or silent overwrite; storage failures return generic `500` responses.
- **Decision:** Accepted and selected by the project owner.

### DR-07: Requirements approval status was unresolved

- **Review area:** Requirements coverage; governance
- **Severity:** Medium
- **Description:** The architecture was reviewed against requirements labeled proposed, while the request referred to approved requirements.
- **Why it matters:** Architecture could be based on decisions that have not been formally approved.
- **Recommended solution:** Formally review and approve or revise `docs/requirements.md` before architecture approval and implementation planning. Do not silently alter requirements as part of architecture work.
- **Requirement affected:** Requirements document review-and-approval process.
- **Decision:** Accepted as a process prerequisite. Requirements were not changed or marked approved as part of this review.

### DR-08: Localhost-only use does not eliminate browser-originated state changes

- **Review area:** Security
- **Severity:** Low; optional hardening
- **Description:** Loopback binding limits network exposure but does not by itself prevent browser-originated requests to local state-changing endpoints.
- **Why it matters:** A browser visiting another site may be induced to submit requests to a localhost service, depending on browser protections and application behavior.
- **Recommended solution:** Include proportionate CSRF protection, such as origin checks or an equivalent mechanism, for state-changing forms. Select the concrete mechanism during implementation.
- **Requirement affected:** No explicit requirement; recommendation addresses the unauthenticated localhost constraint.
- **Decision:** Accepted as an architectural security control. The implementation mechanism remains open.

## 3. Accepted and Rejected Recommendations

All review recommendations DR-01 through DR-08 were accepted as recorded above. No recommendation was rejected. Acceptance of architecture recommendations does not approve or modify the requirements document.

## 4. Architecture Changes

`docs/architecture.md` was updated to:

- Define a proposed source-to-document mapping and rules for additions, modifications, deletions, renames, and unmapped relevant changes.
- Require deterministic structured/generated documentation comparison and tests that validate metadata/contracts against application runtime behavior.
- Define explicit workflow outcomes and fail-closed behavior for drift, uncertainty, missing evidence, and tooling failures.
- Restrict generated changes to an allowlist of documentation paths and reject unrelated file modifications.
- Specify read-only checks and human-applied patch artifacts for both same-repository and fork PRs; no automated branch-writing mechanism is implemented.
- Select request-time generic `500` behavior for malformed or unreadable product JSON while keeping the server running and preserving the file.
- Specify the implemented localhost Origin/Referer check for state-changing forms.
- Record unresolved decisions and risks rather than silently changing requirements.

Implementation evidence is present in `docs-sync/source-map.json`, `docs-sync/contracts/`, `docs-sync/detect-changes.js`, `docs-sync/document-sections.js`, `docs-sync/compare-docs.js`, `docs-sync/generate-proposals.js`, `docs-sync/validate-markdown.js`, `docs-sync/review-proposals.js`, and `.github/workflows/documentation-sync.yml`. Automated tests cover mapping, drift comparison, proposal safety, local Markdown/link validation, and workflow configuration.

## 5. Unresolved Decisions and Risks

- `docs/requirements.md` remains proposed and requires formal project-owner approval before implementation planning.
- The requirements document remains marked proposed; formal requirements approval is a governance action not recorded in this implementation review.
- The human must download/apply the generated artifact; automatic PR-branch application is intentionally absent.
- The contract system only covers explicitly mapped source paths and contract domains; new or unmapped relevant source must continue to fail closed.
- GitHub Actions hosted behavior remains to be confirmed after push; local verification cannot execute the hosted workflow.
- Multi-process JSON write coordination remains out of scope.

## 6. Review Conclusion

The reviewed architecture is implemented for the initial prototype and aligns with the current requirements draft without modifying it. The remaining risks are operational and scope-related as listed above. No commit was made.
