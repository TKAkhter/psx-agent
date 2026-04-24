import './config'; // validates env vars at startup — throws if invalid
import { logger } from './utils/logger';
import { runAnalysisEngine } from './engine';
import { startScheduler } from './scheduler/cron-scheduler';

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function handleShutdown(signal: string): void {
  logger.info({ signal }, 'Received shutdown signal — exiting gracefully');
  process.exit(0);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT',  () => handleShutdown('SIGINT'));

process.on('uncaughtException', (err: Error) => {
  logger.error({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'Unhandled promise rejection — shutting down');
  process.exit(1);
});

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args    = process.argv.slice(2);
  const runNow  = args.includes('--run-now') || args.includes('-r');

  logger.info(
    { mode: runNow ? 'immediate' : 'scheduled', pid: process.pid },
    'PSX Analyzer starting'
  );

  if (runNow) {
    try {
      const output = await runAnalysisEngine();
      logger.info({
        runId:          output.runId,
        portfolioValue: Math.round(output.totalPortfolioValue),
        unrealisedPl:   Math.round(output.totalUnrealisedPl),
        alertCount:     output.alerts.length,
        stance:         output.aiReview.overallMarketView?.stance ?? 'unknown',
      }, 'Immediate run complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Immediate run failed');
      process.exit(1);
    }
  } else {
    startScheduler();
    // Keep the process alive — the cron job handles execution
    logger.info('Process running — waiting for scheduled trigger. Ctrl+C to stop.');
  }
}

main();
