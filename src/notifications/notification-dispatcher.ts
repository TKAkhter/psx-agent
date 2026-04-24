import pRetry from 'p-retry';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { sendEmail } from './email-sender';
import { sendWhatsApp } from './whatsapp-sender';
import { buildHtmlReport, buildWhatsAppMessage } from '../reporting/report-builder';
import type { RunOutput, DeliveryLog } from '../types';

export async function dispatchNotifications(output: RunOutput): Promise<DeliveryLog[]> {
  const logs: DeliveryLog[] = [];
  const hasAlerts = output.alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'WARNING').length > 0;

  if (CONFIG.NOTIFY_ON_ALERT_ONLY && !hasAlerts) {
    logger.info('NOTIFY_ON_ALERT_ONLY=true and no alerts — skipping notifications');
    return logs;
  }

  const subject  = output.aiReview.emailSubjectLine;
  const htmlBody = buildHtmlReport(output);
  const waMsgBody = buildWhatsAppMessage(output);
  const textBody = waMsgBody.replace(/[*_]/g, '');

  // ── Email ──────────────────────────────────────────────────────────────────
  if (CONFIG.NOTIFY_EMAIL) {
    const log = await pRetry(
      () => sendEmail(subject, htmlBody, textBody),
      {
        retries: 3,
        minTimeout: 2_000,
        factor: 2,
        onFailedAttempt: (err) => {
          logger.warn({ attempt: err.attemptNumber, err: err.message }, 'Email attempt failed');
        },
      }
    ).catch((err) => ({
      channel: 'email' as const,
      status: 'failed' as const,
      timestamp: new Date(),
      error: `Failed after 3 retries: ${err.message}`,
      attempts: 3,
    }));
    logs.push({ ...log, attempts: log.attempts });
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (CONFIG.NOTIFY_WHATSAPP) {
    const log = await pRetry(
      () => sendWhatsApp(waMsgBody),
      {
        retries: 3,
        minTimeout: 2_000,
        factor: 2,
        onFailedAttempt: (err) => {
          logger.warn({ attempt: err.attemptNumber, err: err.message }, 'WhatsApp attempt failed');
        },
      }
    ).catch((err) => ({
      channel: 'whatsapp' as const,
      status: 'failed' as const,
      timestamp: new Date(),
      error: `Failed after 3 retries: ${err.message}`,
      attempts: 3,
    }));
    logs.push({ ...log, attempts: log.attempts });
  }

  const sent   = logs.filter((l) => l.status === 'sent').length;
  const failed = logs.filter((l) => l.status === 'failed').length;
  logger.info({ sent, failed }, 'Notification dispatch complete');

  return logs;
}
