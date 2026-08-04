import { loadConfig } from './src/config.ts';
import { GoogleDirectoryClient } from './src/adapters/google-directory.ts';
import { OdooXmlRpcClient } from './src/adapters/odoo-xmlrpc.ts';
import { createSynchronizer } from './src/domain/sync.ts';
import { consoleLogger } from './src/runtime/logging.ts';

export async function main(): Promise<void> {
  const config = loadConfig();
  const directory = new GoogleDirectoryClient(config.google, consoleLogger);
  const odoo = new OdooXmlRpcClient(config.odoo, consoleLogger);
  const synchronizer = createSynchronizer(directory, odoo, consoleLogger, config.google.groupDomain);
  const summary = await synchronizer.run(config.groupMap);
  const failed = summary.outcomes.filter((outcome) => outcome.kind === 'failed');
  const skipped = summary.outcomes.filter((outcome) => outcome.kind === 'skipped');

  consoleLogger.info('Synchronization completed', {
    synchronized: summary.outcomes.length - failed.length - skipped.length,
    skipped: skipped.length,
    failed: failed.length
  });
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  consoleLogger.error('Synchronization could not start', {
    error: error instanceof Error ? error.message : 'Unknown error'
  });
  process.exitCode = 1;
}
