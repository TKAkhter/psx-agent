import { format } from 'date-fns';
import { formatPkr, formatPct } from '../utils/helpers';
import type { RunOutput } from '../types';

// ─── Signal Styling ───────────────────────────────────────────────────────────

const SIGNAL_EMOJI: Record<string, string> = {
  STRONG_BUY: '🟢🟢', BUY: '🟢', HOLD: '🟡', SELL: '🔴', STRONG_SELL: '🔴🔴',
};

const SIGNAL_COLOR: Record<string, string> = {
  STRONG_BUY: '#0a7c3e', BUY: '#2d8a4e', HOLD: '#b08000', SELL: '#c0392b', STRONG_SELL: '#7b0a0a',
};

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#c0392b', WARNING: '#e67e22', INFO: '#2980b9',
};

// ─── HTML Email Report ────────────────────────────────────────────────────────

export function buildHtmlReport(output: RunOutput): string {
  const { runAt, macroSnapshot: m, portfolioRecommendations, discoveryPicks,
          alerts, sectorConcentration, aiReview, totalPortfolioValue, totalUnrealisedPl,
          circuitBreakerActive } = output;

  const dateStr = format(runAt, 'EEEE, d MMMM yyyy');
  const plColor = totalUnrealisedPl >= 0 ? '#0a7c3e' : '#c0392b';

  const portfolioRows = portfolioRecommendations.map((rec) => {
    const holding = rec.holding;
    if (!holding) return '';
    const aiR = aiReview.portfolioReview.find((r) => r.ticker === rec.ticker);
    const color = SIGNAL_COLOR[rec.signal] ?? '#333';
    const plPct = rec.unrealisedPlPct ?? 0;
    const plColor = plPct >= 0 ? '#0a7c3e' : '#c0392b';
    return `
      <tr style="border-bottom:1px solid #e8e8e8">
        <td style="padding:10px 8px;font-weight:600">${rec.ticker}</td>
        <td style="padding:10px 8px;font-size:12px;color:#666">${rec.name}</td>
        <td style="padding:10px 8px;text-align:right">${holding.shares.toLocaleString()}</td>
        <td style="padding:10px 8px;text-align:right">${formatPkr(holding.avgCost)}</td>
        <td style="padding:10px 8px;text-align:right;font-weight:600">${formatPkr(rec.currentPrice)}</td>
        <td style="padding:10px 8px;text-align:right;color:${plColor}">${formatPct(plPct)}</td>
        <td style="padding:10px 8px;text-align:right;color:${plColor}">${formatPkr(rec.unrealisedPlPkr ?? 0)}</td>
        <td style="padding:10px 8px;text-align:center">
          <span style="background:${color};color:#fff;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600">${rec.signal}</span>
        </td>
        <td style="padding:10px 8px;text-align:right;font-size:12px">${formatPkr(rec.priceTargets.buyAt)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px">${formatPkr(rec.priceTargets.sellAt)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;color:#c0392b">${formatPkr(rec.priceTargets.stopLoss)}</td>
        <td style="padding:10px 8px;text-align:center;font-size:12px">${aiR?.confidence ?? '—'}</td>
      </tr>`;
  }).join('');

  const discoveryRows = discoveryPicks.slice(0, 10).map((rec) => {
    const aiD = aiReview.discoveryPicksReview.find((r) => r.ticker === rec.ticker);
    const endColor = aiD?.aiEndorsement === 'ENDORSE' ? '#0a7c3e' : aiD?.aiEndorsement === 'AVOID' ? '#c0392b' : '#888';
    return `
      <tr style="border-bottom:1px solid #e8e8e8">
        <td style="padding:10px 8px;font-weight:600">${rec.ticker}</td>
        <td style="padding:10px 8px;font-size:12px;color:#666">${rec.name}</td>
        <td style="padding:10px 8px;font-size:12px">${rec.sector}</td>
        <td style="padding:10px 8px;text-align:right;font-weight:600">${formatPkr(rec.currentPrice)}</td>
        <td style="padding:10px 8px;text-align:center;font-size:12px">${rec.compositeScore.composite}/100</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px">${formatPkr(rec.priceTargets.buyAt)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px">${formatPkr(rec.priceTargets.sellAt)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;color:#c0392b">${formatPkr(rec.priceTargets.stopLoss)}</td>
        <td style="padding:10px 8px;text-align:center">
          <span style="color:${endColor};font-weight:600">${aiD?.aiEndorsement ?? '—'}</span>
        </td>
        <td style="padding:10px 8px;font-size:11px;color:#555;max-width:200px">${aiD?.reasoning?.slice(0, 100) ?? ''}…</td>
      </tr>`;
  }).join('');

  const alertsHtml = alerts.length === 0
    ? '<p style="color:#2d8a4e">No active alerts today.</p>'
    : alerts.map((a) => `
        <div style="padding:10px 14px;margin:6px 0;border-left:4px solid ${SEVERITY_COLOR[a.severity]};background:#f9f9f9;border-radius:0 6px 6px 0">
          <strong style="color:${SEVERITY_COLOR[a.severity]}">[${a.severity}] ${a.ticker} — ${a.type}</strong><br>
          <span style="font-size:13px;color:#555">${a.detail}</span>
        </div>`).join('');

  const sectorHtml = Object.entries(sectorConcentration)
    .sort(([, a], [, b]) => b - a)
    .map(([sector, pct]) => {
      const barColor = pct > 35 ? '#c0392b' : pct > 25 ? '#e67e22' : '#2d8a4e';
      return `
        <div style="margin:5px 0">
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span>${sector}</span><span style="font-weight:600;color:${barColor}">${pct}%</span>
          </div>
          <div style="height:6px;background:#e8e8e8;border-radius:3px;margin-top:3px">
            <div style="height:6px;width:${Math.min(100, pct)}%;background:${barColor};border-radius:3px"></div>
          </div>
        </div>`;
    }).join('');

  const stanceColor: Record<string, string> = {
    bullish: '#0a7c3e', bearish: '#c0392b', neutral: '#888', cautious: '#e67e22',
  };

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;max-width:900px;margin:0 auto;padding:20px;background:#fff}
  h2{font-size:16px;font-weight:600;margin:24px 0 10px;color:#111;border-bottom:2px solid #f0f0f0;padding-bottom:6px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f5f5f5;padding:10px 8px;text-align:left;font-weight:600;font-size:12px;color:#555;border-bottom:2px solid #e0e0e0}
  .metric{display:inline-block;padding:6px 14px;background:#f5f5f5;border-radius:8px;margin:4px;text-align:center}
  .metric-val{font-size:20px;font-weight:700;display:block}
  .metric-lbl{font-size:11px;color:#888}
</style>
</head><body>

<div style="background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px">
  <div style="font-size:22px;font-weight:700">PSX Portfolio Analysis</div>
  <div style="opacity:0.75;font-size:13px;margin-top:4px">${dateStr} &nbsp;|&nbsp; Shariah: ${output.config.shariahMode} &nbsp;|&nbsp; Index: ${output.config.indexFilter}</div>
</div>

${circuitBreakerActive ? `
<div style="background:#fff3cd;border:1px solid #ffc107;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600;color:#856404">
  ⚠️ CIRCUIT BREAKER ACTIVE — KSE-100 down ${Math.abs(m.kse100ChangePct)}% today. All BUY recommendations are paused.
</div>` : ''}

<h2>Portfolio Summary</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
  <div class="metric"><span class="metric-val">${formatPkr(totalPortfolioValue)}</span><span class="metric-lbl">Total Portfolio Value</span></div>
  <div class="metric"><span class="metric-val" style="color:${plColor}">${formatPkr(totalUnrealisedPl)}</span><span class="metric-lbl">Unrealised P&L</span></div>
  <div class="metric"><span class="metric-val">${m.kse100Level.toLocaleString()}</span><span class="metric-lbl">KSE-100 (${formatPct(m.kse100ChangePct)})</span></div>
  <div class="metric"><span class="metric-val">${m.pkrUsdOfficial}</span><span class="metric-lbl">PKR/USD</span></div>
  <div class="metric"><span class="metric-val">${m.sbpPolicyRate}%</span><span class="metric-lbl">SBP Rate</span></div>
  <div class="metric"><span class="metric-val">$${m.brentCrude}</span><span class="metric-lbl">Brent Crude</span></div>
</div>

<h2>AI Market View</h2>
<div style="background:#f9f9ff;border-radius:8px;padding:14px">
  <div style="margin-bottom:8px">
    <strong>Stance: </strong>
    <span style="background:${stanceColor[aiReview.overallMarketView.stance]};color:#fff;padding:2px 10px;border-radius:4px;font-size:13px;text-transform:uppercase">${aiReview.overallMarketView.stance}</span>
  </div>
  <p style="margin:8px 0;font-size:14px;line-height:1.6">${aiReview.overallMarketView.summary}</p>
  <div style="font-size:12px;color:#666">
    <strong>Key drivers:</strong> ${aiReview.overallMarketView.keyDrivers.join(' &nbsp;·&nbsp; ')}
  </div>
  ${aiReview.globalRiskFlags.length > 0 ? `
    <div style="margin-top:10px;font-size:12px;color:#c0392b">
      <strong>Risk flags:</strong> ${aiReview.globalRiskFlags.join(' &nbsp;·&nbsp; ')}
    </div>` : ''}
</div>

<h2>Active Alerts (${alerts.length})</h2>
${alertsHtml}

<h2>Portfolio Holdings</h2>
<div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>Ticker</th><th>Name</th><th>Shares</th><th>Avg Cost</th>
      <th>Price</th><th>P&L%</th><th>P&L PKR</th>
      <th>Signal</th><th>Buy At</th><th>Sell At</th><th>Stop Loss</th><th>AI Conf.</th>
    </tr></thead>
    <tbody>${portfolioRows}</tbody>
  </table>
</div>

<h2>AI Portfolio Commentary</h2>
${aiReview.portfolioReview.map((r) => `
  <div style="padding:10px 14px;margin:6px 0;border:1px solid #e8e8e8;border-radius:8px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <strong>${r.ticker}</strong>
      <span style="font-size:12px;color:#888">${r.name}</span>
      <span style="font-size:12px;background:${r.aiValidation === 'AGREE' ? '#e8f5e9' : r.aiValidation === 'DISAGREE' ? '#fce4e4' : '#fff8e1'};
        color:${r.aiValidation === 'AGREE' ? '#2d8a4e' : r.aiValidation === 'DISAGREE' ? '#c0392b' : '#b08000'};
        padding:2px 8px;border-radius:4px">${r.aiValidation}</span>
      <span style="font-size:12px;color:#888">Conf: ${r.confidence}</span>
    </div>
    <p style="margin:0;font-size:13px;color:#444;line-height:1.5">${r.reasoning}</p>
    ${r.riskFlags.length > 0 ? `<div style="margin-top:6px;font-size:11px;color:#c0392b">⚠ ${r.riskFlags.join(' · ')}</div>` : ''}
  </div>`).join('')}

<h2>Discovery Picks</h2>
<div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>Ticker</th><th>Name</th><th>Sector</th><th>Price</th>
      <th>Score</th><th>Buy At</th><th>Sell At</th><th>Stop Loss</th>
      <th>AI View</th><th>Reasoning</th>
    </tr></thead>
    <tbody>${discoveryRows}</tbody>
  </table>
</div>

<h2>Sector Concentration</h2>
<div style="max-width:400px">${sectorHtml}</div>
${aiReview.sectorAnalysis.concentrationWarnings.length > 0 ? `
  <div style="margin-top:10px;font-size:13px;color:#c0392b">
    ${aiReview.sectorAnalysis.concentrationWarnings.map((w) => `⚠ ${w}`).join('<br>')}
  </div>` : ''}

<h2>Macro Overlay (AI Assessment)</h2>
<div style="background:#f5f5f5;border-radius:8px;padding:14px;font-size:13px;line-height:1.8">
  <strong>PKR/USD:</strong> ${aiReview.macroOverlay.pkrUsdView}<br>
  <strong>SBP Rate:</strong> ${aiReview.macroOverlay.sbpRateView}<br>
  <strong>Commodities:</strong> ${aiReview.macroOverlay.commodityImpact}<br>
  <strong>IMF Risk:</strong> ${aiReview.macroOverlay.imfRisk}
</div>

<div style="margin-top:30px;padding:14px;background:#f9f9f9;border-radius:8px;font-size:11px;color:#888;line-height:1.6">
  <strong>Disclaimer:</strong> This report is generated by an automated system for informational purposes only.
  It does not constitute financial advice. Always conduct your own due diligence before making investment decisions.
  Past performance does not guarantee future results. Investing in equities involves risk of capital loss.
  Generated at ${format(runAt, 'HH:mm:ss')} PKT | Run ID: ${output.runId}
</div>

</body></html>`;
}

// ─── WhatsApp Plain Text Report ───────────────────────────────────────────────

export function buildWhatsAppMessage(output: RunOutput): string {
  const { runAt, macroSnapshot: m, portfolioRecommendations, discoveryPicks,
          alerts, aiReview, totalPortfolioValue, totalUnrealisedPl, circuitBreakerActive } = output;

  const dateStr = format(runAt, 'dd MMM yyyy');
  const plSign  = totalUnrealisedPl >= 0 ? '+' : '';
  const plPct   = totalPortfolioValue > 0
    ? ((totalUnrealisedPl / (totalPortfolioValue - totalUnrealisedPl)) * 100).toFixed(1)
    : '0.0';

  const criticalAlerts = alerts.filter((a) => a.severity === 'CRITICAL');

  const holdingLines = portfolioRecommendations
    .filter((r) => r.signal !== 'HOLD')
    .slice(0, 5)
    .map((r) => {
      const emoji = SIGNAL_EMOJI[r.signal] ?? '';
      const pct = r.unrealisedPlPct ?? 0;
      return `${emoji} *${r.ticker}* — ${r.signal} | ${formatPct(pct)} P&L`;
    }).join('\n');

  const discoveryLines = discoveryPicks
    .slice(0, 3)
    .map((r) => `• *${r.ticker}* (${r.sector}) — Buy @ PKR ${r.priceTargets.buyAt}, Target ${r.priceTargets.sellAt}, SL ${r.priceTargets.stopLoss}`)
    .join('\n');

  const alertLines = criticalAlerts.length > 0
    ? criticalAlerts.slice(0, 3).map((a) => `🚨 *${a.ticker}* — ${a.type}`).join('\n')
    : 'No critical alerts';

  let message = `*PSX Analysis — ${dateStr}*\n`;
  message += `Market: *${aiReview.overallMarketView.stance.toUpperCase()}*\n`;
  if (circuitBreakerActive) message += `⚠️ _Circuit breaker active — KSE-100 down ${Math.abs(m.kse100ChangePct)}%_\n`;
  message += `\n`;

  message += `*Portfolio*\n`;
  message += `Value: ${formatPkr(totalPortfolioValue)} | P&L: ${plSign}PKR ${Math.abs(totalUnrealisedPl).toLocaleString()} (${plSign}${plPct}%)\n\n`;

  if (criticalAlerts.length > 0) {
    message += `*🚨 Alerts*\n${alertLines}\n\n`;
  }

  if (holdingLines) {
    message += `*Portfolio Signals*\n${holdingLines}\n\n`;
  }

  if (discoveryLines) {
    message += `*Top Picks Today*\n${discoveryLines}\n\n`;
  }

  message += `*Macro*\n`;
  message += `PKR ${m.pkrUsdOfficial} | SBP ${m.sbpPolicyRate}% | Crude $${m.brentCrude}\n\n`;

  message += `*AI View:* ${aiReview.overallMarketView.summary.slice(0, 150)}…\n\n`;
  message += `_Full report sent to email | ID: ${output.runId.slice(0, 8)}_`;

  // Truncate to WhatsApp safe limit
  return message.slice(0, 1500);
}
