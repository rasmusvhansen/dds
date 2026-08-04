import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig, type AppConfig } from './src/config.ts';
import { GoogleDirectoryClient } from './src/adapters/google-directory.ts';
import { MailerSendIssueEmailClient } from './src/adapters/mailersend.ts';
import { OdooXmlRpcClient } from './src/adapters/odoo-xmlrpc.ts';
import type { RunIssueSummary } from './src/email/issue-summary.ts';
import { createSynchronizer } from './src/domain/sync.ts';
import type { IssueEmailClient } from './src/ports/issue-email-client.ts';
import type { DirectoryClient } from './src/ports/directory-client.ts';
import type { OdooClient } from './src/ports/odoo-client.ts';
import { consoleLogger } from './src/runtime/logging.ts';
import { errorMessage } from './src/runtime/errors.ts';

export interface ApplicationDependencies {
  readonly directory: DirectoryClient;
  readonly odoo: OdooClient;
  readonly email: IssueEmailClient;
}

export async function runApplication(
  config: AppConfig,
  dependencies: ApplicationDependencies
): Promise<void> {
  const synchronizer = createSynchronizer(
    dependencies.directory,
    dependencies.odoo,
    consoleLogger,
    config.google.groupDomain
  );
  const summary = await synchronizer.run(config.groupMap);
  const failed = summary.outcomes.filter((outcome) => outcome.kind === 'failed');
  const skipped = summary.outcomes.filter((outcome) => outcome.kind === 'skipped');

  consoleLogger.info('Synchronization completed', {
    synchronized: summary.outcomes.length - failed.length - skipped.length,
    skipped: skipped.length,
    failed: failed.length,
    issues: summary.issues.length
  });

  if (summary.issues.length > 0) {
    try {
      await dependencies.email.sendSummary(toIssueSummary(summary));
    } catch (error) {
      consoleLogger.error('Could not send run issue summary email', {
        error: errorMessage(error)
      });
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function toIssueSummary(summary: Awaited<ReturnType<ReturnType<typeof createSynchronizer>['run']>>): RunIssueSummary {
  return {
    timestamp: new Date().toISOString(),
    mappingsAttempted: summary.mappingsAttempted,
    outcomes: summary.outcomes,
    issues: summary.issues
  };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const dependencies: ApplicationDependencies = {
    email: new MailerSendIssueEmailClient(config.email),
    directory: new GoogleDirectoryClient(config.google, consoleLogger),
    odoo: new OdooXmlRpcClient(config.odoo, consoleLogger)
  };
  await runApplication(config, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    consoleLogger.error('Synchronization could not start', {
      error: errorMessage(error)
    });
    process.exitCode = 1;
  }
}
