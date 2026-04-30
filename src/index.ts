/**
 * PSX Analyzer v2 — Entry Point
 *
 * Designed for Render.com cron deployment:
 * - No CLI arguments required
 * - Runs the full analysis once, exits cleanly
 * - Render triggers execution on its own schedule
 *
 * Local dev:  npm run dev
 * Production: npm start   (after npm run build)
 */
import './config';                         // validates env vars — throws on bad config
import { logger } from './utils/logger';
import { runAnalysisEngine } from './engine';
import { disconnectDb } from './db/prisma-client';

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — disconnecting DB');
  await disconnectDb();
  process.exit(0);
});

process.on('uncaughtException', async (err: Error) => {
  logger.error({ err }, 'Uncaught exception — exiting');
  await disconnectDb();
  process.exit(1);
});

process.on('unhandledRejection', async (reason: unknown) => {
  logger.error({ reason }, 'Unhandled rejection — exiting');
  await disconnectDb();
  process.exit(1);
});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info({ pid: process.pid, node: process.version }, 'PSX Analyzer v2 starting');

  try {
    const output = await runAnalysisEngine();

    logger.info({
      runId:          output.runId,
      portfolioValue: Math.round(output.totalPortfolioValue),
      unrealisedPl:   Math.round(output.totalUnrealisedPl),
      alerts:         output.alerts.length,
      stance:         output.aiReview.marketStance,
      aiScore:        output.aiReview.algorithmScore,
    }, 'Run successful');

    await disconnectDb();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Fatal error during analysis run');
    await disconnectDb();
    process.exit(1);
  }
}

main();
