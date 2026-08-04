# Run Issue Email Specification

## 1. Summary

Add an end-of-run notification email using the `mailersend` npm package. After all configured synchronization mappings have been attempted, the application must send one plain-text summary email whenever the run contains at least one warning or error. The email must summarize what went wrong while preserving the existing sequential synchronization behavior and process exit semantics.

The implementation must use MailerSend credentials and addresses from environment variables, must not expose secrets, and must not send an email for a completely healthy run. Email delivery is a notification side effect: if delivery fails, the application logs the failure safely but preserves the original synchronization exit status.

This document is the implementation contract. It records the repository context, technical decisions, interview outcomes, data model, failure behavior, configuration, MailerSend integration, tests, and acceptance criteria. It does not itself implement the feature.

## 2. Repository Context

The repository is a Node.js 16+ ESM application written in TypeScript. The canonical command is `npm start`, which builds the source to `dist/` and runs `node dist/index.js`. The application synchronizes Google Group membership from Odoo data.

Relevant current files:

- `index.ts`: composition root; loads configuration, constructs Google/Odoo adapters, runs sequential synchronization, logs completion, and sets `process.exitCode` on failed groups.
- `src/domain/sync.ts`: orchestration and membership planning; returns `RunSummary` containing per-group outcomes.
- `src/domain/group.ts`: defines `GroupOutcome` and `RunSummary`.
- `src/adapters/google-directory.ts`: lists members and performs add/delete operations; logs warnings when an individual member operation fails, including normalized email and group.
- `src/config.ts`: loads dotenv and validates typed environment configuration.
- `src/runtime/logging.ts`: structured console logger with redaction of secret-like keys and values.
- `src/ports/logger.ts`: typed logging interface.
- `test/`: Node test suite covering configuration, synchronization behavior, Google response helpers, and Odoo filtering.
- `package.json`: ESM package with `npm start`, `npm run build`, `npm run typecheck`, and `npm test`.
- `.env`: ignored local configuration currently includes legacy names `SENDMAIL_TO` and `SENDMAILER_API_KEY`; implementation must not read or print their values. The requested design renames these to explicit MailerSend names.

Current synchronization outcomes include:

- `synchronized`: group completed, with added/deleted counts.
- `skipped`: Google group was not found (404), currently represented as `group-not-found`.
- `failed`: group synchronization failed, with an unknown error value.

Current console warnings/errors include:

- Missing Google group warnings.
- Google member add/delete warnings, including the normalized failed email.
- Group synchronization failure errors.
- Startup/configuration errors.

The feature must collect structured issues as part of the run result rather than attempting to reconstruct them by parsing console output.

## 3. Goals

### Required goals

- Add the `mailersend` npm dependency and use its TypeScript API.
- Send exactly one summary email after all mappings have been attempted when the run contains one or more warnings or errors.
- Send no email for a completely healthy run with no warnings or errors.
- Include counts plus grouped details in the email.
- Include skipped groups, failed groups, and member-operation warnings according to the selected severity policy.
- Include group identifier, operation, and normalized failed email addresses for member-operation failures.
- Send plain text only.
- Use explicit MailerSend configuration variables:
  - `MAILERSEND_API_KEY`.
  - `MAILERSEND_FROM_EMAIL`.
  - Optional `MAILERSEND_FROM_NAME`.
  - `MAILERSEND_TO_EMAILS`, containing comma-separated recipient addresses.
- Validate MailerSend API key, sender, and recipients at startup on every run.
- Use a verified MailerSend sender address.
- Preserve existing synchronization exit status when email delivery fails.
- Log email delivery failures safely without API keys, authorization data, or raw sensitive payloads.
- Keep member emails in the report normalized (lowercased and trimmed), because they are operationally needed to identify failed operations.
- Add tests that do not use live MailerSend credentials or network requests.
- Update README and configuration documentation.

### Non-goals

- Do not send one email per group or per member operation.
- Do not send healthy-run emails under the baseline design.
- Do not replace the existing console logging.
- Do not treat email delivery failure as a synchronization failure or alter the original synchronization exit code.
- Do not include credentials, API keys, authorization headers, complete raw API payloads, or private keys in the email.
- Do not add HTML in the baseline feature.
- Do not introduce a second email provider or a custom SMTP implementation.

## 4. Interview Decisions

The following choices were confirmed during the interview:

- Trigger: send when there are warnings or errors.
- Detail level: counts plus grouped details.
- Sender/recipient model: explicit sender and recipients.
- Email delivery failure: log it and preserve the original run status.
- Missing Google groups: every skipped group counts as a warning and triggers the email.
- Member failures: include group, operation, and failed email addresses.
- Recipient format: comma-separated email addresses.
- Sender: required sender email plus optional sender display name.
- Privacy: never include credentials; normalized member emails are allowed.
- Timing: send one email after all mappings have completed/been attempted.
- Warning-only run: use a warning status and explicitly indicate that there are no failed groups.
- Subject: include status plus counts.
- Body format: plain text only.
- Email configuration: fail startup always if required MailerSend configuration is missing or invalid.
- Existing environment variables: rename the current `SENDMAIL_TO` and `SENDMAILER_API_KEY` conventions to explicit `MAILERSEND_*` variables rather than preserving aliases.
- Sender source: add a required sender environment variable; do not derive or hardcode it.
- Recipient parsing: support multiple recipients as comma-separated addresses.
- Email display: show normalized lowercased/trims addresses.

## 5. MailerSend Integration

### Package

Add the `mailersend` package using its supported TypeScript API. The expected usage pattern is conceptually:

```ts
import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';

const mailerSend = new MailerSend({ apiKey });
const emailParams = new EmailParams()
  .setFrom(new Sender(fromEmail, fromName))
  .setTo(recipients.map((email) => new Recipient(email)))
  .setSubject(subject)
  .setText(body);

await mailerSend.email.send(emailParams);
```

The exact import names and method signatures must be verified against the installed package version during implementation. The application is compiled before runtime and does not use `tsx` or `ts-node`.

### Adapter boundary

Create a typed email port, for example:

```ts
export interface IssueEmailClient {
  sendSummary(summary: RunIssueSummary): Promise<void>;
}
```

Create a MailerSend adapter behind that port. The synchronization core and summary formatter must not import MailerSend directly. This allows unit tests to use a fake email client and prevents live API calls in tests.

The adapter must:

- Construct MailerSend once from validated configuration.
- Use the configured sender email and optional display name.
- Use all configured recipients.
- Send exactly one text email per completed run requiring notification.
- Await the send promise.
- Allow MailerSend/network/API errors to reject to the composition root, where they are logged as notification failures.
- Never log the API key or raw request payload.
- Avoid including private keys, Odoo passwords, Google tokens, or authorization headers in error logs.

## 6. Configuration

Extend the typed application configuration with an email section:

```ts
interface EmailConfig {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName?: string;
  readonly toEmails: readonly string[];
}
```

### Required environment variables

- `MAILERSEND_API_KEY`: non-empty MailerSend API token.
- `MAILERSEND_FROM_EMAIL`: non-empty, valid sender email; must be verified with MailerSend in the deployed environment.
- `MAILERSEND_TO_EMAILS`: one or more comma-separated recipient email addresses.

### Optional environment variable

- `MAILERSEND_FROM_NAME`: optional non-empty display name. If omitted, use the package/API default or omit the sender name. Do not invent a sender identity in source.

### Validation

- Validate all three required email settings at startup on every run, regardless of whether a warning/error eventually occurs.
- Reject missing or blank values before constructing external synchronization clients or making API requests.
- Trim all comma-separated recipient values.
- Reject an empty recipient list.
- Reject blank entries such as `a@example.com,,b@example.com`.
- Validate sender and recipient syntax with a conservative email-address validator appropriate for configuration. Avoid overcomplicated RFC parsing; reject clearly malformed values.
- Deduplicate recipients after normalization while preserving deterministic order.
- Reject duplicate-free empty results.
- Treat the API key as opaque; validate only presence/non-blank, never log its value.
- Do not expose API key or other credentials in validation errors.
- Fail startup if the old names `SENDMAIL_TO` or `SENDMAILER_API_KEY` are the only values present; document the new names clearly rather than silently relying on aliases.

### Example documentation shape

```dotenv
MAILERSEND_API_KEY=...
MAILERSEND_FROM_EMAIL=verified-sender@example.com
MAILERSEND_FROM_NAME=DDS synchronizer
MAILERSEND_TO_EMAILS=ops@example.com,admin@example.com
```

The actual README must not include real credentials or claim that an unverified sender will work.

## 7. Issue Collection Model

The summary must be generated from structured run data. Introduce typed issue types rather than parsing logger output.

A suitable model is:

```ts
type RunIssue =
  | {
      readonly kind: 'group-skipped';
      readonly groupId: string;
      readonly groupEmail: string;
      readonly reason: 'group-not-found';
    }
  | {
      readonly kind: 'group-failed';
      readonly groupId: string;
      readonly groupEmail: string;
      readonly message: string;
    }
  | {
      readonly kind: 'member-operation-failed';
      readonly groupId: string;
      readonly groupEmail: string;
      readonly operation: 'add' | 'delete';
      readonly emails: readonly NormalizedEmail[];
      readonly message?: string;
    };
```

The exact shape may vary, but it must support all required report fields without retaining raw secrets or arbitrary API payloads.

Extend `RunSummary` with:

- Per-group outcomes.
- Structured `issues`.
- Aggregate counts, either stored or deterministically derived:
  - mappings attempted;
  - synchronized groups;
  - skipped groups;
  - failed groups;
  - add-operation failed members;
  - delete-operation failed members;
  - total issue count.

### Issue capture requirements

- A missing Google group adds one `group-skipped` warning.
- A group-level failure adds one `group-failed` error with a sanitized safe message.
- A member operation that has one or more failures adds a `member-operation-failed` issue containing the operation and all failed normalized emails.
- Continue processing remaining members after an individual add/delete failure, as the current adapter does.
- Avoid duplicate issue records for the same underlying failure. If the adapter logs a warning and throws an aggregate error, the orchestration layer must have one authoritative structured issue path.
- Preserve the existing console warnings/errors while making the structured issue available to the final summary.
- Do not retain `unknown` error objects in a summary that will be passed to the email formatter. Convert them to sanitized messages at the boundary.

## 8. Run and Notification Flow

The composition root should follow this sequence:

1. Load dotenv and validate all normal and MailerSend configuration.
2. Construct the typed synchronization adapters and email adapter.
3. Run every mapping sequentially.
4. Collect synchronized, skipped, and failed outcomes plus structured warnings/errors.
5. Derive the run status:
   - `success` if there are no issues;
   - `warning` if there are issues but no failed groups/member-operation errors according to the chosen classification;
   - `error` if at least one group or member operation failed.
6. If the issue list is non-empty, format one plain-text summary.
7. Attempt to send one MailerSend email after all mappings have been attempted.
8. If email delivery fails, log a safe notification error and do not overwrite the synchronization-derived exit status.
9. Set `process.exitCode` based on synchronization/group failure policy, not email delivery outcome.

The implementation must define whether member-operation failures count toward the `error` status; the recommended behavior is yes, because they mean the desired membership was not fully applied. Missing groups are warnings but still trigger notification.

### Startup configuration failure

Because the interview selected “fail startup always” for missing email configuration:

- Missing/invalid MailerSend settings must stop startup before Google/Odoo calls.
- The process exits non-zero.
- No issue-summary email is attempted because the email channel itself is not configured safely.
- The startup error must identify the configuration field without revealing secret values.

## 9. Summary Email Content

### Subject

The subject must include status and counts. Recommended format:

```text
DDS synchronization warning: 2 skipped, 1 member failure
DDS synchronization error: 1 failed group, 2 member failures
```

The exact grammar can be finalized during implementation, but it must:

- identify DDS;
- identify `warning` or `error`;
- include meaningful issue counts;
- remain reasonably short and deterministic;
- not include secrets or raw stack traces.

### Plain-text body

The body should contain:

1. Header identifying DDS synchronization issue summary.
2. Run timestamp in ISO 8601 format.
3. Overall status (`WARNING` or `ERROR`).
4. Aggregate counts:
   - mappings attempted;
   - synchronized groups;
   - skipped groups;
   - failed groups;
   - failed additions;
   - failed deletions;
   - total issues.
5. Grouped issue sections:
   - skipped groups, with group address and reason;
   - failed groups, with group address and sanitized error message;
   - failed member operations, grouped by group and operation, with normalized failed emails.
6. A final note that the synchronization process completed and that the email is a notification summary.

The body must not include:

- MailerSend API key;
- Google private key, password, OAuth token, or authorization header;
- Odoo password or raw connection credentials;
- complete raw SDK/API payloads;
- arbitrary unsanitized stack traces.

Member email addresses are intentionally allowed because the user selected them as necessary troubleshooting details. Only failed operation addresses should be included; do not list all successful members.

### Determinism and size

- Keep issue ordering deterministic: configured group order first, then operation order, then email order.
- Deduplicate failed email addresses within each issue.
- Define a maximum body size or truncation strategy for pathological runs with many failures. Truncation must preserve counts and clearly indicate omitted details. The implementation may start with a documented conservative limit.

## 10. Logging and Error Handling

### Synchronization errors

Preserve existing console logging and add structured issue collection. Member-operation warnings must continue to include the normalized failed email.

### Email delivery errors

If MailerSend rejects the send:

- Log one safe warning/error such as `Could not send run issue summary email`.
- Include a sanitized category/status/message if available.
- Never include the API key, authorization headers, or raw request body.
- Do not send a second email about the failed email.
- Preserve the original synchronization `process.exitCode`.

### Classification

- `group-skipped`: warning; triggers email but does not by itself make the process non-zero.
- `group-failed`: error; triggers email and makes the process non-zero.
- `member-operation-failed`: error; triggers email and makes the process non-zero because the desired synchronization was incomplete.
- Email delivery failure: notification failure only; preserve whatever exit status synchronization already determined.
- Startup/configuration failure: non-zero and no notification attempt.

## 11. Suggested Architecture

Add the following conceptual modules:

```text
src/
  email/
    issue-summary.ts       # issue types, aggregation, subject/body formatting
  ports/
    issue-email-client.ts  # typed email sending port
  adapters/
    mailersend.ts          # MailerSend SDK adapter
```

Possible responsibilities:

- `src/email/issue-summary.ts`: pure functions for determining status, counts, subject, and plain-text body. No MailerSend import and no console side effects.
- `src/ports/issue-email-client.ts`: `sendSummary(subject, body)` or `sendSummary(summary)` contract.
- `src/adapters/mailersend.ts`: MailerSend package construction and send call.
- `src/config.ts`: typed email configuration and validation.
- `src/domain/group.ts` / `src/domain/sync.ts`: structured issue capture and run summary.
- `index.ts`: compose the email client, execute the run, conditionally send one summary, and preserve exit status.

The email adapter should be injectable so tests can assert “one send when issues exist” and “zero sends for healthy runs” without network calls.

## 12. Dependency and Package Changes

- Add `mailersend` to `dependencies`, not devDependencies, because production runs use it.
- Verify and pin a compatible version according to the project’s existing dependency policy.
- Regenerate `package-lock.json`.
- Keep `npm start`, `npm run build`, `npm run typecheck`, and `npm test` behavior intact.
- Do not add a second runtime email library.

## 13. Tests

Add deterministic tests without live MailerSend credentials:

### Configuration tests

- Valid API key/sender/recipient configuration parses.
- Comma-separated recipients trim whitespace.
- Duplicate recipients are deduplicated.
- Blank recipient entries are rejected.
- Missing API key is rejected.
- Missing sender is rejected.
- Missing recipient list is rejected.
- Malformed sender/recipient addresses are rejected.
- Old `SENDMAIL_TO`/`SENDMAILER_API_KEY` names alone are rejected, documenting the rename.
- API key and password values never appear in validation errors.

### Issue-summary unit tests

- Healthy summary produces `success`, no notification requirement, and no email content requirement.
- Warning-only summary produces `warning`, triggers notification, and explicitly reports zero failed groups.
- Error summary produces `error`, triggers notification, and includes counts.
- Skipped groups are included as warnings.
- Failed groups include sanitized messages.
- Member operation failures include operation and normalized emails.
- Duplicate emails are removed.
- Issue ordering is deterministic.
- Large summaries obey truncation/size rules if implemented.
- Subject includes status and counts.
- Body is plain text and excludes secret-like values.

### Orchestration tests

Using a fake `IssueEmailClient`:

- A healthy run sends no email.
- A warning-only run sends exactly one email after all mappings finish.
- An error run sends exactly one email after all mappings finish.
- Mappings after an early failure still run before the email is sent.
- Email send failure is logged and does not replace the synchronization exit status.
- Startup configuration failure does not instantiate synchronization or email adapters and does not attempt sending.

### MailerSend adapter tests

Use a typed fake/mock SDK boundary or injectable factory:

- API key is passed to the MailerSend client.
- Sender email/name are mapped correctly.
- All parsed recipients are mapped correctly.
- Subject and plain-text body are passed correctly.
- SDK rejection becomes a safe adapter error.
- Tests never call MailerSend’s live API.

## 14. Documentation

Update `README.md` with:

- Installation including the `mailersend` dependency.
- MailerSend account/API-token setup.
- Requirement that `MAILERSEND_FROM_EMAIL` is verified with MailerSend.
- New environment variables and exact recipient format.
- The rename from legacy `SENDMAIL_TO` and `SENDMAILER_API_KEY` to the new `MAILERSEND_*` names.
- Optional sender display name.
- Notification trigger behavior: warnings/errors only, after the full run.
- Warning/error subject and body behavior.
- Email delivery failure behavior: logged, but original synchronization status preserved.
- Privacy guidance: API keys and credentials are never emailed; failed normalized member addresses may appear.
- No-email behavior for healthy runs.

Do not place real API keys or real recipient addresses in documentation.

## 15. Acceptance Criteria

- [ ] `mailersend` is installed as a production dependency and lockfile is regenerated.
- [ ] Typed email configuration is added and validated at startup.
- [ ] `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL`, and `MAILERSEND_TO_EMAILS` are required.
- [ ] `MAILERSEND_FROM_NAME` is optional.
- [ ] Recipients are parsed as trimmed, validated, deduplicated comma-separated addresses.
- [ ] Legacy `SENDMAIL_TO` and `SENDMAILER_API_KEY` are not silently used as aliases.
- [ ] Missing/invalid email configuration fails startup before external synchronization calls.
- [ ] Structured run warnings/errors are collected without parsing console output.
- [ ] Missing Google groups count as warnings and trigger notification.
- [ ] Member add/delete failures include normalized failed email addresses in structured issues.
- [ ] Group failures include sanitized messages.
- [ ] A healthy run sends no email.
- [ ] A warning/error run sends exactly one email after all mappings are attempted.
- [ ] Email status distinguishes warning-only runs from error runs.
- [ ] Subject includes status and counts.
- [ ] Body is plain text with counts and grouped issue details.
- [ ] Failed member operation sections include group, operation, and normalized emails.
- [ ] Credentials and raw sensitive API payloads are excluded from the email.
- [ ] MailerSend delivery failure is safely logged and does not alter synchronization exit status.
- [ ] MailerSend adapter is behind a typed injectable port.
- [ ] Configuration, formatter, orchestration, and adapter tests pass without live credentials.
- [ ] README documents setup, variables, trigger behavior, and failure semantics.
- [ ] Existing synchronization behavior remains intact.

## 16. Implementation Verification Notes

These are items to verify during implementation, not unresolved user decisions:

1. Confirm the exact installed `mailersend` version’s ESM import names and `EmailParams.setText` behavior.
2. Confirm whether MailerSend requires a recipient `name` or accepts email-only `Recipient` objects.
3. Confirm the SDK’s error object shape and implement safe status/message extraction.
4. Confirm the maximum practical MailerSend body size and choose a deterministic truncation limit if needed.
5. Decide whether the existing `RunSummary` should store raw per-group errors only temporarily or be changed to fully sanitized structured issues; the email formatter must receive only safe data.
6. Ensure startup validation order means invalid MailerSend configuration fails before Google JWT/Odoo client construction or network activity.
7. Preserve the current process exit behavior for group/member failures while keeping email delivery failure non-authoritative.
