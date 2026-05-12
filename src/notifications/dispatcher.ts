import pRetry from 'p-retry';
import { format } from 'date-fns';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { sendEmailWithPdf } from './email-sender';
import { sendWhatsAppWithPdf } from './whatsapp-sender';
import { generatePdfReport } from '../reporting/pdf-builder';
import { formatPkr, formatPkrCompact, formatPct, round, signalEmoji, buildNotificationSubject } from '../utils/helpers';
import type { RunOutput, DeliveryLog, Alert } from '../types';

// ─── WhatsApp condensed summary ───────────────────────────────────────────────
function buildWaSummary(output: RunOutput): string {
  const { runAt, macro: m, portfolioRecs, discoveryPicks, alerts, aiReview,
          totalPortfolioValue, totalUnrealisedPl, totalUnrealisedPlPct, circuitBreakerActive } = output;

  const EMOJI: Record<string, string> = {
    STRONG_BUY:'🟢🟢', BUY:'🟢', HOLD:'🟡', SELL:'🔴', STRONG_SELL:'🔴🔴',
  };
  const date = format(runAt, 'dd MMM yyyy HH:mm');
  const plSign = totalUnrealisedPl >= 0 ? '+' : '';
  const critAlerts = alerts.filter(a => a.severity === 'CRITICAL');

  const subject   = output.notifSubject || output.aiReview.emailSubject;
  let msg = `*📊 ${subject}*\n\n`;
  msg += `Market: *${aiReview.marketStance.toUpperCase()}* — ${aiReview.marketSummary.split('.')[0]}.\n`;
  if (circuitBreakerActive) msg += `⚠️ _Circuit breaker active — BUY signals paused_\n`;
  msg += `\n`;

  msg += `*Portfolio*\n`;
  msg += `Value: ${formatPkrCompact(totalPortfolioValue)}\n`;
  msg += `P&L: ${plSign}${formatPkrCompact(totalUnrealisedPl)} (${plSign}${round(totalUnrealisedPlPct,1)}%)\n\n`;

  if (critAlerts.length > 0) {
    msg += `*🚨 Critical Alerts*\n`;
    critAlerts.slice(0, 4).forEach(a => { msg += `• *${a.ticker}*: ${a.detail}\n  → ${a.action}\n`; });
    msg += '\n';
  }

  const actionable = portfolioRecs.filter(r => r.signal !== 'HOLD').slice(0, 6);
  if (actionable.length > 0) {
    msg += `*Portfolio Signals*\n`;
    actionable.forEach(r => {
      const pl = r.position ? ` (${formatPct(r.position.unrealisedPlPct)})` : '';
      msg += `${signalEmoji(r.signal) ?? '⚪'} *${r.ticker}* — ${r.signal.replace('_',' ')}${pl}\n`;
      msg += `  Buy≤${r.priceTargets.aggressiveBuyAt} | T1: ${r.priceTargets.target1} | SL: ${r.priceTargets.stopLoss}\n`;
      if (r.suggestedReplacement) msg += `  💡 Replace with: *${r.suggestedReplacement}*\n`;
    });
    msg += '\n';
  }

  if (discoveryPicks.length > 0) {
    msg += `*New Picks*\n`;
    discoveryPicks.slice(0, 3).forEach(r => {
      msg += `🔍 *${r.ticker}* (${r.sector}) — Score ${r.compositeScore.composite}/100\n`;
      msg += `  Buy≤${r.priceTargets.aggressiveBuyAt} | T1: ${r.priceTargets.target1} | SL: ${r.priceTargets.stopLoss}\n`;
    });
    msg += '\n';
  }

  msg += `*Macro*: PKR ${m.pkrUsdOfficial} | SBP ${m.sbpPolicyRate}% | Crude $${m.brentCrude}\n\n`;
  msg += `_📎 Full PDF report sent to email_\n`;
  msg += `_Run ID: ${output.runId.slice(0,8)}_`;

  return msg.slice(0, 1500);
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────
export async function dispatchNotifications(output: RunOutput): Promise<DeliveryLog[]> {
  const hasAlerts = (a: Alert[]) => a.some(x => x.severity !== 'INFO');

  if (CONFIG.NOTIFY_ON_ALERT_ONLY && !hasAlerts(output.alerts)) {
    logger.info('NOTIFY_ON_ALERT_ONLY=true, no critical/warning alerts — skipping');
    return [];
  }

  if (!CONFIG.NOTIFY_EMAIL && !CONFIG.NOTIFY_WHATSAPP) {
    logger.info('All notification channels disabled — skipping');
    return [];
  }

  // Generate PDF once, reuse for both channels
  logger.info('Generating PDF report');
  const pdfBuffer = await generatePdfReport(output);
  const filename  = `PSX-Analysis-${format(output.runAt, 'yyyy-MM-dd-HHmm')}.pdf`;
  // Use the pre-built subject from engine (format: "PSX 07 May 2026, 09:01 PKT · 2B/1S · P&L +11.1%")
  const subject   = output.notifSubject || output.aiReview.emailSubject;
  const waSummary = buildWaSummary(output);
  const emailBody = waSummary.replace(/[*_]/g, '');

  const logs: DeliveryLog[] = [];

  // ── Email ──────────────────────────────────────────────────────────────────
  if (CONFIG.NOTIFY_EMAIL) {
    const log = await pRetry(
      () => sendEmailWithPdf(subject, emailBody, pdfBuffer, filename),
      {
        retries: 3, minTimeout: 2_000, factor: 2,
        onFailedAttempt: e => logger.warn({ attempt: e.attemptNumber }, 'Email retry'),
      },
    ).catch(err => ({
      channel: 'email' as const, status: 'failed' as const,
      timestamp: new Date(), error: String(err), attempts: 3,
    }));
    logs.push(log);
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (CONFIG.NOTIFY_WHATSAPP) {
    const log = await pRetry(
      () => sendWhatsAppWithPdf(waSummary, pdfBuffer, filename),
      {
        retries: 3, minTimeout: 2_000, factor: 2,
        onFailedAttempt: e => logger.warn({ attempt: e.attemptNumber }, 'WhatsApp retry'),
      },
    ).catch(err => ({
      channel: 'whatsapp' as const, status: 'failed' as const,
      timestamp: new Date(), error: String(err), attempts: 3,
    }));
    logs.push(log);
  }

  const sent   = logs.filter(l => l.status === 'sent').length;
  const failed = logs.filter(l => l.status === 'failed').length;
  logger.info({ sent, failed }, 'Notifications dispatched');
  return logs;
}
