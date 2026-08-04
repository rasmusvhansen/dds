# TypeScript Rewrite Specification

## 1. Summary

Rewrite the `dds` repository from JavaScript to strongly typed TypeScript while preserving its role as a mailing-list synchronizer between Odoo and Google Groups. The rewrite may modernize the architecture and dependencies, but it must preserve the synchronization outcome and operational intent. The canonical local/runtime command must remain:

```sh
npm start
```

`npm start` must compile the TypeScript source to Node 16-compatible ESM JavaScript and execute the emitted `dist/index.js` entrypoint. The implementation must use Node-compatible TypeScript syntax and explicit ESM import extensions in emitted output; no runtime TypeScript loader is required.

This document is a design and implementation contract. It does not itself make implementation changes.

## 2. Current Repository Context

The current repository is a small CommonJS Node application with these relevant files:

- `index.js`: loads dotenv, parses `GROUPMAP`, processes mappings sequentially, reads Google and Odoo memberships, computes additions/removals, and applies Google Group changes.
- `directory.js`: authenticates with a Google service-account JWT and wraps Google Admin Directory group-member list/insert/delete calls.
- `odoo.js`: connects to Odoo XML-RPC, reads member profiles and relations, optionally includes parents, and returns member names/emails.
- `bin/sync`: executable Node wrapper that requires `index.js`.
- `run.sh`: changes to `/home/pi/dds` and invokes `npm start`.
- `package.json`: currently has `start: node index.js`, legacy CommonJS-oriented dependencies, and operational `logs`/`deploy` scripts.
- `README.md`: currently contains only a short project description.
- `.gitignore`: already ignores common Node artifacts, `.env`, and secrets.

Current synchronization behavior includes:

1. Load environment variables using dotenv.
2. Parse `GROUPMAP` as an array of mapping tuples.
3. Process mappings sequentially because the APIs do not support concurrent usage.
4. For each mapping, obtain Google members and Odoo members.
5. Normalize member emails by lowercasing and trimming whitespace.
6. Skip a Google group when its lookup returns a 404/missing-group condition.
7. Add Odoo members missing from Google.
8. Delete Google members absent from Odoo.
9. Perform additions before deletions.
10. Include or exclude parent members according to the mapping's `excludeParents` flag and preserve the existing leader/parent relation rules.

## 3. Goals

### 3.1 Required goals

- Migrate all application JavaScript implementation files to TypeScript.
- Use modern ESM `import`/`export` semantics.
- Make `npm start` run the TypeScript entrypoint directly with Node.
- Enable maximum practical TypeScript strictness.
- Keep the application strongly typed at module boundaries, configuration boundaries, API boundaries, and domain-model boundaries.
- Separate synchronization/orchestration logic from Google and Odoo integrations behind typed interfaces (ports/adapters).
- Preserve synchronization semantics while improving error handling, configuration validation, testability, and operational diagnostics.
- Continue processing remaining group mappings after an individual group failure, then exit non-zero if any group failed.
- Preserve `bin/sync` as a supported executable wrapper.
- Cover repository entrypoints and operational documentation, including `run.sh`, package metadata, README, and ignore rules where relevant.
- Add automated tests at pure-logic and integration-seam boundaries.

### 3.2 Quality goals

- No implicit `any` in application code.
- No unvalidated `process.env` values used directly by business or adapter code.
- No untyped SDK response objects leaking into the synchronization core.
- No secrets in logs or error output.
- Deterministic tests for synchronization decisions and configuration parsing.
- Clear process exit status: success only when startup validation succeeds and all attempted group synchronizations complete according to policy.

## 4. Non-goals

- Do not change the product purpose or replace Odoo/Google Groups with different services as part of the baseline rewrite.
- Do not introduce parallel processing of group mappings; sequential processing is an explicit compatibility requirement.
- Do not silently change parent inclusion, leader exclusion, email normalization, or add-before-delete behavior.
- Keep the generated production artifact out of version control; `npm start` creates it in `dist/` before launching Node 16.
- Do not expose a public library API beyond what is needed by the executable and supported `bin/sync` wrapper.
- Do not add unrelated UI, web-server, database, or infrastructure work.

## 5. Runtime and Toolchain Decisions

### 5.1 Node runtime

- Official minimum runtime: Node.js 16.0.0.
- Document the minimum in `README.md` and package metadata where appropriate (`engines.node`).
- `npm start` must build with `tsc` and launch the generated JavaScript entrypoint with Node 16; it must not require `tsx` or `ts-node`.
- Verify the exact TypeScript build configuration, emitted ESM import extensions, and Node 16 runtime behavior before implementation. If the target runtime requires a flag, encode that explicitly in `npm start` and document it; do not rely on an undocumented local setup.

### 5.2 TypeScript syntax

Use erasable TypeScript syntax only, because the application is executed directly by Node. In particular:

- Avoid runtime `enum` declarations.
- Avoid namespaces with runtime output.
- Avoid parameter properties if unsupported by the selected Node runtime.
- Avoid other non-erasable TypeScript constructs unless the runtime contract is explicitly revised.
- Prefer string literal unions, interfaces, type aliases, and ordinary class constructors where needed.

### 5.3 Module system

- Adopt ESM imports and exports throughout the application.
- Update `package.json` with the appropriate module declaration (expected to be `"type": "module"`).
- Use explicit file extensions in local ESM imports if required by the Node runtime/module resolver.
- Ensure the `bin/sync` wrapper remains executable and uses a Node-compatible ESM-compatible delegation approach.
- Confirm compatibility of every dependency with the chosen ESM strategy. Where a dependency remains CommonJS, use a deliberate interop pattern and isolate it in the relevant adapter rather than spreading compatibility workarounds through the core.

### 5.4 Typechecking

Add a TypeScript configuration and a required typecheck script:

```sh
npm run typecheck
```

The typecheck script must run `tsc --noEmit` with strict settings. The production build is emitted to `dist/` and is the runtime input for `npm start`; `npm run typecheck` remains a separate no-emit validation command.

## 6. Proposed Source Organization

The exact directory layout may be adjusted during implementation, but the following boundaries are required conceptually:

```text
index.ts                         # executable composition root
src/
  config.ts                      # environment loading and validated config
  domain/
    member.ts                    # Member and email-domain types
    group.ts                     # mapping and synchronization types
    sync.ts                      # pure diff/orchestration policy
  ports/
    directory-client.ts          # Google Groups adapter contract
    odoo-client.ts               # Odoo adapter contract
    logger.ts                    # logging contract, if needed
  adapters/
    google-directory.ts          # Google SDK implementation
    odoo-xmlrpc.ts               # Odoo XML-RPC implementation
  runtime/
    errors.ts                    # typed error helpers/classification
    normalization.ts              # email normalization and collection helpers
    logging.ts                   # redacted operational logger, if needed
```

The composition root should wire validated configuration, adapters, logger, and synchronization service. Pure synchronization decisions must be usable without importing Google or Odoo SDKs.

## 7. Strong Typing Requirements

### 7.1 Configuration

Create a typed configuration contract covering at least:

- Google service-account client email.
- Google private key.
- Google delegated user.
- Odoo URL, database, username, password, and port.
- `GROUPMAP`.
- Any domain suffix currently hardcoded for Google group addresses.

Configuration requirements:

- Load dotenv before reading configuration.
- Validate all required variables at startup.
- Fail fast before making any external API request when a required variable is absent, empty, malformed, or invalid.
- Parse and validate `GROUPMAP` into a typed representation rather than passing `JSON.parse` output through the application.
- Reject the entire configuration when any mapping entry is invalid. Do not process partially valid mappings.
- Define and document the accepted mapping shape, expected types, required tuple positions or migrate it to a named-object representation if that improves clarity. If the external environment format must remain tuple-based for compatibility, validate and convert it immediately into a named internal type.
- Keep secrets out of thrown error messages and validation output.

### 7.2 Domain types

Define types for:

- Normalized email addresses.
- Odoo member records used by synchronization (`name`, `email`, and any required source identifiers).
- Google group members and list responses.
- Group synchronization mappings.
- Synchronization plans (`toCreate`, `toDelete`).
- Per-group outcomes, skipped groups, and failures.
- Typed API/error shapes at adapter boundaries.

Use explicit `null`/`undefined` handling for missing Google groups and optional API fields. Do not use broad `any` to model third-party responses. If dependency declarations are incomplete, add maintained type declarations or narrow local adapter types at the boundary.

### 7.3 Error boundaries

Treat caught values as `unknown` and classify them with type guards or typed helper functions. Model expected conditions separately from unexpected failures, including:

- Missing Google group/404: expected skip outcome.
- Authentication/configuration failure: startup or fatal infrastructure failure.
- Odoo query failure: group failure.
- Google member insert/delete failure: operation/group failure according to the selected adapter policy.
- Malformed external response: adapter failure, never silently accepted as an empty member list.

## 8. Synchronization Behavior

### 8.1 Core orchestration

- Process mappings sequentially in their configured order.
- Do not run independent Odoo/Google calls concurrently if doing so conflicts with existing API constraints; preserve the current safe sequencing policy or document any narrowly scoped concurrency proven safe by the adapters.
- Continue to the next mapping after a group-level failure.
- Collect structured per-group outcomes and failures.
- At the end of the run, emit a summary and exit with a non-zero status if any group failed.
- A missing Google group remains a skip, not a destructive operation and not a failed synchronization, unless later clarified by implementation evidence.

### 8.2 Membership calculation

- Normalize all comparable emails using lowercase plus trimming.
- Deduplicate membership lists before calculating differences.
- Compute additions as Odoo members absent from Google.
- Compute deletions as Google members absent from Odoo.
- Keep additions before deletions.
- Do not delete or modify members when the Google group lookup is unavailable or identifies a missing group.
- Keep the configured Google group address construction compatible with the current domain (`<groupId>@valhallagruppe.dk`) unless configuration centralization changes it without changing its default.

### 8.3 Odoo rules

Preserve and explicitly document the current rules:

- Fetch members for one or multiple Odoo organization/group IDs.
- Process multiple IDs sequentially.
- Include a member's own email when present.
- When `excludeParents` is true, do not fetch/include parent relations.
- When parents are eligible, include only the existing relation type representing parents (`type_selection_id` 9), subject to the existing leader exclusion rule.
- Preserve the existing special organization/function rule that prevents adding leader parents, but represent magic identifiers such as relation type 9 and function type 1 as named constants with explanatory documentation.
- Deduplicate resulting Odoo members by email using a defined case/normalization policy.
- Treat missing/invalid fields defensively rather than assuming every Odoo record is complete.

Any change to these business rules must be separately approved; the TypeScript rewrite alone must not alter them.

### 8.4 Google Directory rules

- Authenticate with the configured service account and delegated user.
- Keep the required directory scopes explicit and centralized.
- List group members through a typed adapter.
- Classify 404/missing-group responses robustly across the SDK's possible status locations.
- Insert members with the existing `MEMBER` role.
- Delete members by normalized member key/email.
- Preserve the existing pacing/rate-limit behavior or replace it with a typed, tested delay/rate-limit abstraction.
- Decide and document whether an individual insert/delete failure causes the remaining operations in that group to continue; the default recommendation is to continue collecting per-member failures, mark the group failed, and let the overall process continue to later groups.

## 9. Error Handling and Exit Behavior

### Startup

- Invalid environment configuration or malformed `GROUPMAP` must fail before external API calls.
- Print a concise actionable error naming the missing/invalid configuration field, never its secret value.
- Exit non-zero.

### Per-group execution

- Catch failures at the group boundary.
- Log group identifier and failure category without credentials or raw sensitive payloads.
- Continue processing subsequent mappings.
- Preserve successful outcomes and skipped missing groups in the final summary.

### Completion

- Exit zero only when startup was valid and all groups completed without unrecovered group failures.
- Exit non-zero when one or more groups failed.
- The top-level executable must await the run and set `process.exitCode` rather than allowing rejected promises to disappear.
- Avoid both duplicate error logging and swallowed failures.

## 10. Logging and Security

- Never log service-account private keys, passwords, raw authorization tokens, or complete sensitive API payloads.
- Preserve useful operational context such as timestamps, group identifiers, counts, skip reasons, operation names, and durations.
- Redact or avoid member-level data where not required; email addresses should not be dumped unnecessarily.
- Keep the missing-group warning behavior recognizable, but route it through the new logging policy.
- Prefer structured, level-aware logs if dependency modernization makes that reasonable; otherwise define consistent console logging helpers with explicit redaction.
- Document required secret environment variables without including example secret values.

## 11. Dependency and API Modernization

- Review current dependency versions and compatibility with Node 16 ESM and TypeScript.
- Modernize stale dependencies where safe, especially when required for supported ESM behavior, security, or maintained type declarations.
- Keep Odoo and Google behavior stable. Replacing a client library or API wrapper is permitted only when the adapter preserves behavior and has tests around the contract.
- Add TypeScript and type declaration dependencies only as needed by the selected direct-Node runtime and `typecheck` workflow.
- Do not add a runtime TypeScript loader; compile to JavaScript before `npm start` launches the application.
- Keep dependency changes scoped to the migration and record notable upgrades in the README/spec implementation notes.

## 12. Tests

Add automated tests, prioritizing tests that do not require live credentials or network access:

### Pure unit tests

- Environment/configuration validation.
- `GROUPMAP` parsing and complete rejection of malformed mappings.
- Email lowercasing, trimming, and deduplication.
- Difference calculation and add-before-delete planning.
- Missing Google group skip behavior.
- Parent inclusion/exclusion.
- Leader-parent exclusion.
- Sequential mapping orchestration and aggregate failure status.

### Adapter/seam tests

- Google response mapping, including empty/missing member arrays.
- Google 404 classification.
- Google insert/delete request mapping and role values.
- Odoo response mapping and relation filtering.
- Odoo callback/error conversion into typed promises.
- Per-member failure aggregation according to the final chosen policy.

Use fakes/mocks through the typed ports so tests do not require live Google or Odoo credentials. If a test framework is introduced, choose one compatible with the Node 16 emitted-JavaScript test workflow or define the necessary test execution strategy explicitly; test tooling must not alter the production `npm start` contract.

## 13. Package Scripts and Entrypoints

The final package metadata must provide at least:

```json
{
  "type": "module",
  "engines": {
    "node": ">=16.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "npm run build && node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "..."
  }
}
```

The exact `test` command and any optional `build`/`lint` command should match the selected tooling.

Additional requirements:

- Update `main` or remove it if it is misleading for an executable-only package; do not leave it pointing to a deleted `index.js`.
- Keep `npm start` as the documented build-and-run command.
- Keep `bin/sync` executable and delegating to the canonical TypeScript entrypoint without duplicating synchronization logic.
- Update `run.sh` only as needed to remain compatible with the new entrypoint and preserve its deployment context.
- Update `.gitignore` for any new caches, coverage output, or generated artifacts while retaining `.env`/secret protection.
- Preserve operational `logs` and `deploy` scripts unless their assumptions break; document any required changes rather than silently removing them.

## 14. Documentation

Expand `README.md` to cover:

- Project purpose.
- Supported Node.js version and the TypeScript-to-ESM build workflow.
- Installation (`npm install`).
- `npm start` usage.
- `npm run typecheck` and test commands.
- Required environment variables and the validated `GROUPMAP` format.
- Google service-account/domain delegation prerequisites.
- Odoo prerequisites.
- Behavior for missing groups, parent inclusion, leader exclusion, additions, deletions, and failures.
- Supported `bin/sync` invocation.
- Secret-handling guidance.
- Operational notes for `run.sh`, Heroku commands, or Raspberry Pi deployment where still applicable.

## 15. Migration Plan

1. Inventory current runtime behavior and verify dependency/API compatibility with Node 16 ESM and emitted TypeScript JavaScript.
2. Add package/module/runtime metadata and TypeScript configuration without changing synchronization decisions.
3. Introduce typed domain models, configuration validation, error types, and normalization helpers.
4. Define Google and Odoo ports.
5. Implement typed Google and Odoo adapters, isolating legacy/CommonJS interop and callback conversion.
6. Implement the typed synchronization core and composition root.
7. Migrate `bin/sync` and operational scripts/documentation.
8. Add unit and adapter-seam tests using fakes.
9. Run typecheck, tests, and a non-network startup/configuration validation path.
10. Verify `npm start` under Node 16 and confirm emitted JavaScript imports resolve correctly.
11. Review the final diff for behavior changes, secret leakage, untyped boundaries, and stale paths.

## 16. Acceptance Criteria

The rewrite is complete when all of the following are true:

- [ ] Application implementation has been migrated from `.js` to `.ts`.
- [ ] The package uses ESM consistently, with intentional handling of any CommonJS dependencies.
- [ ] `npm start` builds the TypeScript source and executes `node dist/index.js` under Node 16 without `tsx`/`ts-node`.
- [ ] `npm run typecheck` passes with strict and maximum practical compiler checks enabled.
- [ ] No application code relies on implicit `any` or unchecked raw environment/API data.
- [ ] Invalid configuration and malformed `GROUPMAP` fail fast before network calls.
- [ ] Valid mappings process sequentially.
- [ ] Email normalization and deduplication are preserved.
- [ ] Parent and leader exclusion semantics are preserved and tested.
- [ ] Additions occur before deletions.
- [ ] Missing Google groups are skipped safely without destructive changes.
- [ ] A failed group does not prevent later groups from being attempted, and the final process exits non-zero when failures occurred.
- [ ] Secrets are not emitted in logs or errors.
- [ ] Google and Odoo integrations are behind typed ports/adapters.
- [ ] Unit and adapter-seam tests pass without live credentials.
- [ ] `bin/sync` remains executable and supported.
- [ ] README, package metadata, scripts, and ignore rules describe the new workflow accurately.
- [ ] No implementation files outside this spec are changed until the migration is explicitly started.

## 17. Decisions Captured from Interview

- Start strategy: compile with `tsc` and execute the emitted `dist/index.js` through `npm start`.
- Module format: ESM.
- Type strictness: maximum strictness.
- Rewrite scope: modernized redesign, while retaining synchronization semantics.
- Runtime baseline: Node 16+, using a TypeScript build to Node-compatible ESM JavaScript.
- Entrypoint layout: source layout is flexible; the start command must remain direct and documented.
- Validation: a required typecheck command, with build/typecheck separation if useful.
- Configuration: centralized typed config with fail-fast validation.
- Invalid `GROUPMAP`: reject the entire configuration.
- Group failures: continue remaining groups and finish non-zero with a failure summary.
- Tests: unit tests plus integration-seam tests using fakes/mocks.
- Dependencies: modernize where safe.
- Operations: cover all repository entrypoints and operational artifacts.
- TypeScript syntax: erasable syntax only.
- Architecture: typed ports/adapters required.
- Logging: never log secrets.
- CLI compatibility: preserve `bin/sync`.

## 18. Items to Verify During Implementation

These are implementation verification points rather than unresolved product requirements:

1. Confirm Node 16 ESM behavior, emitted import extensions, and the production TypeScript build configuration.
2. Confirm each current Google/Odoo dependency's ESM and TypeScript declaration status before selecting interop or upgrade paths.
3. Confirm the exact stable external `GROUPMAP` format from deployment configuration before deciding whether to preserve tuple input or introduce a backwards-compatible named-object format.
4. Confirm the desired per-member insert/delete failure aggregation behavior when implementing the adapter contract; the default is to continue operations, mark the group failed, and continue later groups.
5. Confirm whether the hardcoded Odoo organization ID, relation type ID, function type ID, and Google domain should remain constants or become validated configuration, without changing their defaults.
