# Implementation Plan: Automated Documentation Sync Capstone

**Status:** Approved plan; implementation has not started.

This plan is based on `docs/requirements.md`, `docs/architecture.md`, and `docs/design-review.md`. The requirements document remains marked proposed, so implementation is gated on formal approval. Open decisions are blockers and must not be silently resolved during implementation.

## Planning Blockers

Resolve these before implementation begins:

- Approve or revise `docs/requirements.md` and `docs/architecture.md`.
- Decide the exact browser routes and HTTP methods.
- Decide the JSON representation of INR prices and blank optional fields.
- Confirm locations for product-data and setup documentation.
- Agree the source-to-document mapping and structured contract format.
- Confirm GitHub Actions as the workflow provider.
- Confirm the PR proposal flow, especially that fork PRs receive a patch artifact for a human to apply, while same-repository writes remain separately gated.
- Select a proportionate CSRF protection mechanism.
- Inspect the existing project configuration and choose test/Markdown validation tooling only if not already available. Do not add tooling without approval.

## Prioritized Tasks

### IP-01: Approve decisions and implementation baseline

- **Priority:** High
- **Dependencies:** None
- **Description and outcome:** Resolve the planning blockers above and approve the requirements and architecture baselines. Record decisions before implementation so tasks have stable acceptance criteria.
- **Likely files/components:** `docs/requirements.md`, `docs/architecture.md`; planning notes as approved by the project owner.
- **Acceptance criteria:** Requirements and architecture have clear approval status; route, data representation, documentation locations, mapping/contract format, CI provider, PR proposal flow, and CSRF approach are decided or explicitly deferred with a named owner and point of resolution.
- **Verification:** Review both documents for consistency; confirm the plan does not introduce requirements or technologies beyond approved decisions.
- **Blockers/risks:** This task blocks implementation. Requirements currently state that they are not formally approved.

### IP-02: Establish project foundation

- **Priority:** High
- **Dependencies:** IP-01
- **Description and outcome:** Inspect the existing project configuration, then establish or adjust the Node.js project scripts and configuration needed to run the app and its checks. Preserve existing project setup where usable.
- **Likely files/components:** `package.json`, lockfile, `.gitignore`, application entry-point/configuration files as determined by the approved architecture.
- **Acceptance criteria:** The project has documented commands for starting the app and running its checks; configuration matches the approved Node.js setup; generated/runtime files are excluded appropriately.
- **Verification:** Install dependencies using the selected package manager; run the start/check commands; confirm the app binds only to loopback as required.
- **Blockers/risks:** Existing package files are present; inspect them before changing dependencies or scripts. Node.js/package versions and test tooling are not specified in the documents.

### IP-03: Create the Express and EJS application shell

- **Priority:** High
- **Dependencies:** IP-02
- **Description and outcome:** Add the Express app structure, EJS rendering setup, static asset handling if needed, and a minimal shared page layout. Add visitor-safe not-found and server-error handling.
- **Likely files/components:** Express entry point, route registration module, EJS layout/partials, error views, static asset directory.
- **Acceptance criteria:** The server starts locally; a basic page renders through EJS; unknown routes return `404`; unexpected errors return a generic `500` without stack traces or internal paths.
- **Verification:** Start the app and exercise a rendered page, unknown route, and forced error path using focused automated or manual checks.
- **Blockers/risks:** Exact route paths and page design are deferred until IP-01.

### IP-04: Implement product representation and validation

- **Priority:** High
- **Dependencies:** IP-01, IP-02
- **Description and outcome:** Define the product record and input normalization/validation. Generate immutable UUIDs in application logic. Implement required name and INR price validation, trimming, and blank optional-field handling.
- **Likely files/components:** Product model/schema or validation module; focused unit tests.
- **Acceptance criteria:** Name is required and non-empty after trimming; price is positive with at most two decimal places; optional description/category/image URL are treated as empty when blank; category remains free-form; image URL has no format validation; user input cannot set or change the ID.
- **Verification:** Unit tests cover valid and invalid names/prices, whitespace, decimals, optional fields, and immutable generated IDs.
- **Blockers/risks:** Price storage and optional-field JSON representation must be decided in IP-01. No maximum text lengths are specified; do not invent them.

### IP-05: Implement JSON product repository

- **Priority:** High
- **Dependencies:** IP-02, IP-04
- **Description and outcome:** Add the repository boundary that owns all access to `data/products.json`, including initial empty-file creation, reads, writes, and product lookup/mutations.
- **Likely files/components:** JSON repository module, `data/products.json` initialization behavior, repository tests.
- **Acceptance criteria:** Missing file initializes as an empty product list; valid data is read and updated; writes persist; malformed/unreadable data is not overwritten; write failure is not reported as success; server remains running and affected requests can return generic `500`.
- **Verification:** Repository tests cover missing, valid, malformed, unreadable, and unwritable file cases; test preservation of malformed content and restart persistence.
- **Blockers/risks:** Must follow the data representation fixed by IP-01. Atomic replacement and serialized in-process writes are architecture recommendations to implement and test without claiming multi-process guarantees.

### IP-06: Implement product CRUD routes and EJS views

- **Priority:** High
- **Dependencies:** IP-03, IP-04, IP-05
- **Description and outcome:** Implement catalogue, details, create, update, and delete-confirmation flows through server-rendered pages.
- **Likely files/components:** Route handlers, product service, EJS catalogue/detail/forms/confirmation views, CSS/static assets if approved.
- **Acceptance criteria:** Visitors can browse products and open details; empty catalogue has a clear state; valid create/update/delete persist correctly; update preserves ID; delete requires confirmation; invalid submissions render useful errors; malformed/unknown IDs return `404`; successful mutations redirect with `303`; successful pages use `200`.
- **Verification:** Route-level integration tests assert views, status codes, redirects, invalid-input behavior, deletion confirmation, and persistence calls.
- **Blockers/risks:** Exact routes and methods depend on IP-01. Ensure EJS escapes user-provided values.

### IP-07: Complete e-commerce integration and failure tests

- **Priority:** High
- **Dependencies:** IP-04, IP-05, IP-06
- **Description and outcome:** Verify the end-to-end application behavior across routes, validation, JSON persistence, and failures.
- **Likely files/components:** Integration tests and test fixtures; test scripts/configuration.
- **Acceptance criteria:** Tests cover CRUD, required response behavior, storage error pages, malformed JSON preservation, and product persistence after server restart.
- **Verification:** Run the full application test suite from a clean install or documented setup; verify no test depends on pre-existing product data.
- **Blockers/risks:** Test framework choice is not specified and must follow the approved tooling decision in IP-01/IP-02.

### IP-08: Create baseline user documentation

- **Priority:** High
- **Dependencies:** IP-01, IP-03, IP-06
- **Description and outcome:** Write the human-maintained baseline documentation that the sync system will compare against.
- **Likely files/components:** `README.md`, `docs/routes.md`, approved product-data documentation location, setup documentation location.
- **Acceptance criteria:** README explains local setup and run commands; route inventory lists every implemented browser route's method, path, purpose, inputs, and expected status/redirect; product data documentation reflects the actual model and validation.
- **Verification:** Compare docs against route definitions and tests; run agreed Markdown and local-link validation.
- **Blockers/risks:** Product-data and setup document locations are unresolved until IP-01. There is no separate JSON REST API; do not create REST API documentation.

### IP-09: Define sync contracts and source-to-document mapping

- **Priority:** High
- **Dependencies:** IP-04, IP-06, IP-08
- **Description and outcome:** Add the maintained mapping and normalized contract format connecting relevant source areas to docs and runtime verification.
- **Likely files/components:** Mapping/contract files and documentation markers or generated sections; contract tests.
- **Acceptance criteria:** Mappings cover route handlers, product model/validation, JSON persistence/error handling, and setup/configuration; affected documentation and verification evidence are explicit; unmapped relevant changes are detectable.
- **Verification:** Tests validate mapping completeness and assert that route/product contracts agree with runtime behavior.
- **Blockers/risks:** Exact format and locations must be selected in IP-01. Avoid maintaining duplicate facts without a defined source of truth.

### IP-10: Build changed-file detection

- **Priority:** High
- **Dependencies:** IP-02, IP-09
- **Description and outcome:** Compare a pull request's changed paths against its base and classify changes according to the maintained mapping.
- **Likely files/components:** Sync checker modules/scripts, mapping tests, fixtures.
- **Acceptance criteria:** Additions, modifications, deletions, and renames are handled; mapped changes identify all affected docs/checks; unrelated changes do not require docs updates; unmapped relevant changes produce actionable failure findings.
- **Verification:** Fixture tests cover each change type, multiple affected docs, irrelevant files, and unmapped relevant files.
- **Blockers/risks:** The base/head comparison interface and exact mapping format depend on IP-01 and IP-09.

### IP-11: Implement deterministic drift comparison

- **Priority:** High
- **Dependencies:** IP-08, IP-09, IP-10
- **Description and outcome:** Extract or render normalized documentation-relevant facts and compare them deterministically with the baseline documentation.
- **Likely files/components:** Contract extraction/comparison modules, generated-section markers or structured doc data, fixtures.
- **Acceptance criteria:** Missing, changed, or deleted mapped documentation is detected; equivalent representations pass consistently; checker errors and absent runtime evidence fail closed; no fuzzy prose similarity is used as the pass/fail mechanism.
- **Verification:** Tests cover matching docs, stale docs, missing docs, deleted docs, uncertain extraction, and extraction/comparison failures.
- **Blockers/risks:** Contract source-of-truth and representation are set in IP-01/IP-09. Runtime verification coverage is required to prevent metadata/docs from agreeing while both are wrong.

### IP-12: Generate constrained documentation proposals

- **Priority:** High
- **Dependencies:** IP-11
- **Description and outcome:** Render deterministic documentation changes from reliable contracts when drift is resolvable.
- **Likely files/components:** Documentation renderer/templates, patch-generation module, allowlist configuration, generator tests.
- **Acceptance criteria:** Proposals are limited to allowed documentation paths; repository-relative path validation is enforced; source/workflow/unrelated file changes are rejected; exact source cause and proposed diff are available for review; uncertain cases do not generate guessed edits.
- **Verification:** Tests assert expected patch content, path traversal rejection, out-of-allowlist rejection, partial generation failure, and uncertain-change behavior.
- **Blockers/risks:** Target paths and proposal destination depend on IP-01/IP-08. Generated content must not execute as code.

### IP-13: Validate documentation and human-review output

- **Priority:** High
- **Dependencies:** IP-08, IP-12
- **Description and outcome:** Validate proposed Markdown and local links, rerun drift comparison on the candidate, and prepare clear review output.
- **Likely files/components:** Markdown/link validation scripts or configuration, sync checker, review output/patch artifact.
- **Acceptance criteria:** Invalid Markdown, broken local links, remaining drift, and incomplete proposals fail with actionable findings; a clean candidate is shown as an exact diff with source changes and validation results; human approval is required before merge.
- **Verification:** Fixtures cover valid/invalid Markdown, valid/broken links, residual drift, and partial proposals.
- **Blockers/risks:** Select validation tooling based on existing project setup and approved dependencies. Do not add unnecessary tools.

### IP-14: Integrate sync checks with the pull-request workflow

- **Priority:** High
- **Dependencies:** IP-10, IP-11, IP-12, IP-13
- **Description and outcome:** Connect the checker to pull-request creation/update events and implement the approved PR proposal path.
- **Likely files/components:** GitHub Actions workflow if approved; permission configuration; patch-artifact or gated update logic; workflow tests/docs.
- **Acceptance criteria:** Relevant PR changes run all sync checks; irrelevant changes follow the documented no-update path; drift, uncertainty, and tooling failures block the PR; fork checks are read-only and provide the approved human-applied patch flow; no workflow automatically merges or writes to the main branch.
- **Verification:** Validate workflow configuration and exercise representative PR scenarios, including same-repository and fork-originated paths where available.
- **Blockers/risks:** GitHub Actions and the accepted fork/same-repository interaction must be decided at IP-01. Never expose write credentials to untrusted PR code.

### IP-15: Final verification and pull-request preparation

- **Priority:** High
- **Dependencies:** IP-07, IP-13, IP-14
- **Description and outcome:** Run the complete verification suite, review scope and documentation accuracy, and prepare the implementation PR for human review.
- **Likely files/components:** No new application components expected; final updates to README/docs/tests may be needed.
- **Acceptance criteria:** All approved acceptance criteria have test evidence; documentation matches the implementation; sync check passes for a clean change and fails for a deliberate drift fixture; no out-of-scope feature or unauthorized generated change is present.
- **Verification:** Run all unit, integration, sync, Markdown/link, and workflow checks; inspect the final diff and PR checklist.
- **Blockers/risks:** Requires all unresolved decisions to be closed and the requirements baseline formally approved.

## Dependency Order and Parallel Work

Primary application sequence:

`IP-01 → IP-02 → IP-03 → IP-04 → IP-05 → IP-06 → IP-07`

Documentation and sync sequence:

`IP-08 → IP-09 → IP-10 → IP-11 → IP-12 → IP-13 → IP-14`

Cross-dependencies: IP-08 depends on the implemented routes and product behavior from IP-06; IP-09 depends on both the implementation contracts and baseline docs; IP-15 depends on both application and sync verification.

After IP-01 and IP-02, product validation/repository work (IP-04/IP-05) can proceed in parallel with the Express shell (IP-03), provided their shared product contract is agreed. After IP-06, application test completion (IP-07) and baseline documentation (IP-08) can proceed in parallel. Sync checker work should not begin until its mapping and contract decisions are settled.

## Verification Strategy

Run tests alongside each implementation task rather than deferring verification:

- Product validation unit tests with IP-04.
- Repository and storage-failure tests with IP-05.
- Route/status/redirect integration tests with IP-06.
- Restart and cross-route persistence tests with IP-07.
- Mapping and changed-file fixtures with IP-09/IP-10.
- Drift, uncertainty, proposal-path, and diff-safety fixtures with IP-11/IP-12.
- Markdown, local-link, and candidate re-comparison tests with IP-13.
- PR permission and trigger verification with IP-14.
- Full acceptance and clean/drift scenario run with IP-15.

## First Implementation Task

The first implementation task is **IP-02: Establish project foundation**, but only after IP-01 is complete. It comes first because every application and sync component depends on a known project configuration, runnable commands, and agreed tooling. The workspace already has package files, so this task begins by inspecting and adapting them rather than reinitializing the project.
