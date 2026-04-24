import { CronJob } from 'cron';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { runAnalysisEngine } from '../engine';

let isRunning = false;

export function startScheduler(): void {
  logger.info({ schedule: CONFIG.RUN_SCHEDULE }, 'Starting PSX analysis scheduler');

  const job = new CronJob(
    CONFIG.RUN_SCHEDULE,
    async () => {
      if (isRunning) {
        logger.warn('Previous run still in progress — skipping this trigger');
        return;
      }
      isRunning = true;
      logger.info('Scheduled run triggered');
      try {
        await runAnalysisEngine();
      } catch (err) {
        logger.error({ err }, 'Scheduled run failed');
      } finally {
        isRunning = false;
      }
    },
    null,  // onComplete
    true,  // start immediately
    'Asia/Karachi'
  );

  logger.info({ nextRun: job.nextDate().toISO() }, 'Scheduler active — next run');
}
