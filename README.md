# dds

Valhalla-gruppe mailing-list maintainer. The application synchronizes Google Group membership from Odoo member data.

## Requirements

- Node.js 16 or newer.
- Access to the configured Odoo XML-RPC endpoint.
- A Google service account with domain-wide delegation and the required Admin Directory scopes.

The application is written in TypeScript and compiled to Node 16-compatible ESM JavaScript before it starts. `npm start` runs the production build and then launches `dist/index.js`. Run the typecheck command before deployment.

## Install and run

```sh
npm install
npm run typecheck
npm test
npm start
```

`npm start` compiles the application and executes `node dist/index.js`. The repository also preserves the executable wrapper:

```sh
./bin/sync
```

`run.sh` remains available for the existing Raspberry Pi deployment path.

## Configuration

Copy the required values into a local `.env` or provide them through the process environment. Never commit `.env` or credential files.

Required variables:

- `CLIENTEMAIL`: Google service-account client email.
- `PRIVATEKEY`: Google private key; escaped `\\n` sequences are converted to newlines.
- `GOOGLEUSER`: delegated Google Workspace user.
- `ODOOURL`: Odoo URL.
- `ODOODB`: Odoo database name.
- `ODOOUSER`: Odoo username.
- `ODOOPASSWORD`: Odoo password.
- `GROUPMAP`: JSON array of legacy tuples: `[[odooIds, groupId, excludeParents], ...]`.
- `MAILERSEND_API_KEY`: MailerSend API token.
- `MAILERSEND_FROM_EMAIL`: verified MailerSend sender address.
- `MAILERSEND_TO_EMAILS`: comma-separated notification recipients.

Optional:

- `MAILERSEND_FROM_NAME`: sender display name.

The old `SENDMAIL_TO` and `SENDMAILER_API_KEY` names are no longer accepted. Configure the explicit `MAILERSEND_*` names instead.

`odooIds` is a non-negative integer or a non-empty array of non-negative integers. `groupId` is a non-empty string. `excludeParents` is optional and defaults to `false`. The complete mapping is rejected before any network request if any entry is invalid.

Optional variables:

- `GROUPDOMAIN` (default: `valhallagruppe.dk`).
- `ODOOPORT` (default: `443`).
- `ODOOORGANIZATIONID` (default: `859`).
- `ODOOPARENTRELATIONTYPEID` (default: `9`, the parent relation type).
- `ODOOLEADERFUNCTIONTYPEID` (default: `1`, the leader function type).

MailerSend requires a verified sender address. The application validates the API key, sender, and comma-separated recipients at startup before any synchronization calls.

## Synchronization behavior

- Mappings are processed sequentially because the external APIs do not support concurrent use safely.
- Email comparisons are trimmed, lowercased, and deduplicated.
- Odoo members missing from a Google Group are added before stale Google members are deleted.
- Missing Google Groups (404 responses) are skipped without destructive changes.
- Parent members are omitted when `excludeParents` is true. Otherwise the existing relation type and leader exclusion rules are applied.
- An individual group failure does not prevent later mappings from running. The process reports the failure and exits non-zero after all mappings have been attempted.
- Startup configuration errors fail fast before API calls.
- A run with skipped or failed groups sends one plain-text MailerSend summary after all mappings have been attempted. Healthy runs send no email.
- The summary includes warning/error counts, affected groups, failed operations, and normalized failed member emails, but never credentials or raw API payloads.
- If summary email delivery fails, the failure is logged and the original synchronization exit status is preserved.

## Development

The synchronization core is separated from Google and Odoo adapters behind typed ports, allowing tests to run without external credentials:

```sh
npm run typecheck
npm test
```

The test suite covers configuration validation, email normalization, synchronization planning, ordering, missing-group handling, continuation after group failures, issue-summary formatting, and notification orchestration. Tests compile to `dist/` and execute under the supported Node 16 runtime.

## Operations

The existing operational scripts remain available:

- `npm run logs` tails Heroku logs.
- `npm run deploy` pushes to the existing Heroku target.
- `run.sh` changes to `/home/pi/dds` and runs `npm start`.

Do not log or paste private keys, passwords, access tokens, or complete sensitive API payloads.
