# dds

Valhalla-gruppe mailing-list maintainer. The application synchronizes Google Group membership from Odoo member data.

## Requirements

- Node.js 22.18 or newer.
- Access to the configured Odoo XML-RPC endpoint.
- A Google service account with domain-wide delegation and the required Admin Directory scopes.

The application is intentionally run with Node's native TypeScript type stripping. It uses erasable TypeScript syntax and does not require `tsx` or `ts-node` at runtime. Native execution strips types but does not typecheck, so run the typecheck command before deployment.

## Install and run

```sh
npm install
npm run typecheck
npm test
npm start
```

`npm start` executes `node index.ts`. The repository also preserves the executable wrapper:

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

`odooIds` is a non-negative integer or a non-empty array of non-negative integers. `groupId` is a non-empty string. `excludeParents` is optional and defaults to `false`. The complete mapping is rejected before any network request if any entry is invalid.

Optional variables:

- `GROUPDOMAIN` (default: `valhallagruppe.dk`).
- `ODOOPORT` (default: `443`).
- `ODOOORGANIZATIONID` (default: `859`).
- `ODOOPARENTRELATIONTYPEID` (default: `9`, the parent relation type).
- `ODOOLEADERFUNCTIONTYPEID` (default: `1`, the leader function type).

## Synchronization behavior

- Mappings are processed sequentially because the external APIs do not support concurrent use safely.
- Email comparisons are trimmed, lowercased, and deduplicated.
- Odoo members missing from a Google Group are added before stale Google members are deleted.
- Missing Google Groups (404 responses) are skipped without destructive changes.
- Parent members are omitted when `excludeParents` is true. Otherwise the existing relation type and leader exclusion rules are applied.
- An individual group failure does not prevent later mappings from running. The process reports the failure and exits non-zero after all mappings have been attempted.
- Startup configuration errors fail fast before API calls.

## Development

The synchronization core is separated from Google and Odoo adapters behind typed ports, allowing tests to run without external credentials:

```sh
npm run typecheck
npm test
```

The test suite covers configuration validation, email normalization, synchronization planning, ordering, missing-group handling, and continuation after group failures.

## Operations

The existing operational scripts remain available:

- `npm run logs` tails Heroku logs.
- `npm run deploy` pushes to the existing Heroku target.
- `run.sh` changes to `/home/pi/dds` and runs `npm start`.

Do not log or paste private keys, passwords, access tokens, or complete sensitive API payloads.
