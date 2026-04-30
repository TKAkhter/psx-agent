/**
 * PDF Report Builder — PSX Analyzer v2
 *
 * Generates a rich HTML report then converts to PDF via Puppeteer.
 * Designed for TWO audiences:
 *   - NOOB SECTION: Large, colour-coded verdict cards with plain-English guidance
 *   - PRO SECTION: Full indicator grid, signal breakdown, score breakdown
 */
import puppeteer from 'puppeteer';
import { format } from 'date-fns';
import { round, formatPkr, formatPct } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { RunOutput, StockRecommendation } from '../types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const SIG_COLOR: Record<string, string> = {
  STRONG_BUY: '#0a6e3c', BUY: '#1a8a50', HOLD: '#8a6d00',
  SELL: '#b83232', STRONG_SELL: '#7a0a0a',
};
const SIG_BG: Record<string, string> = {
  STRONG_BUY: '#e6f9ef', BUY: '#f0fff6', HOLD: '#fffbe6',
  SELL: '#fff0ee', STRONG_SELL: '#fde8e8',
};
const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#b83232', WARNING: '#c97a00', INFO: '#1a6fb5',
};
const STANCE_COLOR: Record<string, string> = {
  bullish: '#0a6e3c', bearish: '#b83232', neutral: '#555555', cautious: '#c97a00',
};

// ─── Utility helpers ─────────────────────────────────────────────────────────

function badge(signal: string, large = false): string {
  const sz = large ? 'font-size:15px;padding:6px 18px' : 'font-size:12px;padding:3px 10px';
  return `<span style="background:${SIG_COLOR[signal] ?? '#555'};color:#fff;${sz};border-radius:5px;font-weight:700;letter-spacing:.4px;white-space:nowrap">${signal.replace('_', ' ')}</span>`;
}

function scoreDonut(score: number, grade: string): string {
  const color = score >= 75 ? '#0a6e3c' : score >= 55 ? '#c97a00' : score >= 35 ? '#e67e22' : '#b83232';
  return `<div style="display:inline-flex;flex-direction:column;align-items:center;min-width:64px">
    <div style="width:56px;height:56px;border-radius:50%;background:conic-gradient(${color} ${score * 3.6}deg,#e8e8e8 0deg);display:flex;align-items:center;justify-content:center">
      <div style="width:42px;height:42px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:${color}">${score}</div>
    </div>
    <div style="font-size:11px;font-weight:700;color:${color};margin-top:3px">Grade ${grade}</div>
  </div>`;
}

function scoreBar(label: string, value: number, maxWidth = '160px'): string {
  const color = value >= 70 ? '#0a6e3c' : value >= 50 ? '#c97a00' : '#b83232';
  return `<div style="margin:4px 0">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:2px">
      <span>${label}</span><span style="font-weight:700;color:${color}">${value}</span>
    </div>
    <div style="height:6px;background:#eee;border-radius:3px;max-width:${maxWidth}">
      <div style="height:6px;width:${value}%;background:${color};border-radius:3px"></div>
    </div>
  </div>`;
}

function indCell(label: string, value: string | number, highlight?: 'green' | 'red' | 'amber'): string {
  const color = highlight === 'green' ? '#0a6e3c' : highlight === 'red' ? '#b83232' : highlight === 'amber' ? '#c97a00' : '#1a1a1a';
  return `<div style="background:#f7f7f7;border-radius:6px;padding:7px 10px;min-width:110px">
    <div style="font-size:10px;color:#888;margin-bottom:2px;text-transform:uppercase;letter-spacing:.3px">${label}</div>
    <div style="font-weight:700;font-size:13px;color:${color}">${value}</div>
  </div>`;
}

function plColor(v: number): string { return v >= 0 ? '#0a6e3c' : '#b83232'; }

// ─── Noob verdict card ─────────────────────────────────────────────────────────
// Large, simple, colour-coded — the first thing anyone sees for each stock

function noobCard(rec: StockRecommendation, aiReview: RunOutput['aiReview']): string {
  const ai   = aiReview.portfolioReview.find(r => r.ticker === rec.ticker)
            ?? aiReview.discoveryReview.find(r => r.ticker === rec.ticker);
  const sig  = ai?.finalSignal ?? rec.signal;
  const bg   = SIG_BG[sig] ?? '#f9f9f9';
  const col  = SIG_COLOR[sig] ?? '#555';
  const pos  = rec.position;

  // Extract noob sentence from AI reasoning
  const reasoning = ai?.reasoning ?? '';
  const noobMatch = reasoning.match(/NOOB:\s*([^.]+\.)/i);
  const proMatch  = reasoning.match(/PRO:\s*(.+)$/i);
  const noobText  = noobMatch ? noobMatch[1].trim() : reasoning.split('.')[0] + '.';
  const proText   = proMatch  ? proMatch[1].trim()  : '';

  // Decide action phrase
  const actionMap: Record<string, string> = {
    STRONG_BUY:  '🟢 BUY NOW — Strong opportunity',
    BUY:         '🟢 BUY — Good entry here',
    HOLD:        '🟡 HOLD — Keep your position',
    SELL:        '🔴 SELL — Time to exit',
    STRONG_SELL: '🔴 SELL IMMEDIATELY — Exit now',
  };
  const action = actionMap[sig] ?? sig;

  return `
<div style="border:2px solid ${col};border-radius:12px;padding:20px 24px;margin:10px 0;background:${bg};page-break-inside:avoid">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:22px;font-weight:900;color:#111">${rec.ticker}</span>
        <span style="font-size:14px;color:#555">${rec.name}</span>
        <span style="font-size:11px;background:#f0f0f0;color:#555;padding:2px 8px;border-radius:10px">${rec.sector}</span>
        ${rec.shariah ? '<span style="font-size:11px;background:#e8f5e9;color:#2d6a4f;padding:2px 8px;border-radius:10px">☽ Shariah</span>' : ''}
      </div>
      <div style="margin-top:6px;font-size:24px;font-weight:800;color:${col}">${action}</div>
    </div>
    ${scoreDonut(rec.compositeScore.composite, rec.compositeScore.grade)}
  </div>

  <!-- Simple price boxes — what matters to a noob -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
    <div style="background:#fff;border:1.5px solid #e0e0e0;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#888;margin-bottom:4px">Current Price</div>
      <div style="font-size:20px;font-weight:800">PKR ${rec.currentPrice}</div>
      <div style="font-size:11px;color:${plColor(rec.dayChangePct)}">${formatPct(rec.dayChangePct)} today</div>
    </div>
    <div style="background:#e6f9ef;border:1.5px solid #a0d9b4;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#2d6a4f;margin-bottom:4px">Buy at or below</div>
      <div style="font-size:20px;font-weight:800;color:#0a6e3c">PKR ${rec.priceTargets.aggressiveBuyAt}</div>
      <div style="font-size:10px;color:#555">Aggressive entry</div>
    </div>
    <div style="background:#e6f9ef;border:1.5px solid #a0d9b4;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#2d6a4f;margin-bottom:4px">Take profit at</div>
      <div style="font-size:20px;font-weight:800;color:#0a6e3c">PKR ${rec.priceTargets.target1}</div>
      <div style="font-size:10px;color:#555">+${rec.priceTargets.potentialUpsidePct}% upside</div>
    </div>
    <div style="background:#fff0ee;border:1.5px solid #f0b4b4;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#8a2222;margin-bottom:4px">Exit if falls to</div>
      <div style="font-size:20px;font-weight:800;color:#b83232">PKR ${rec.priceTargets.stopLoss}</div>
      <div style="font-size:10px;color:#555">Stop-loss (-${rec.priceTargets.potentialDownsidePct}%)</div>
    </div>
    ${pos ? `<div style="background:#fff;border:1.5px solid #e0e0e0;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#888;margin-bottom:4px">Your P&L</div>
      <div style="font-size:20px;font-weight:800;color:${plColor(pos.unrealisedPlPct)}">${formatPct(pos.unrealisedPlPct)}</div>
      <div style="font-size:11px;color:${plColor(pos.unrealisedPlPkr)}">${formatPkr(pos.unrealisedPlPkr)}</div>
    </div>` : ''}
  </div>

  <!-- Plain English explanation -->
  <div style="background:rgba(255,255,255,0.7);border-radius:8px;padding:14px 16px;margin-bottom:${proText ? '10px' : '0'}">
    <div style="font-size:13px;color:#333;line-height:1.7">${noobText}</div>
  </div>

  ${proText ? `<div style="background:rgba(0,0,0,0.03);border-radius:8px;padding:10px 14px;border-left:3px solid ${col}">
    <div style="font-size:11px;color:#888;margin-bottom:3px;font-weight:600">ANALYST NOTE</div>
    <div style="font-size:12px;color:#444;line-height:1.6">${proText}</div>
  </div>` : ''}

  <!-- AI price views if they differ from algorithm -->
  ${ai && (ai.buyPriceView || ai.sellPriceView) ? `
  <div style="margin-top:10px;font-size:12px;color:#555;display:flex;gap:12px;flex-wrap:wrap">
    ${ai.buyPriceView  ? `<span>🤖 AI Buy view: <strong>PKR ${ai.buyPriceView}</strong></span>`  : ''}
    ${ai.sellPriceView ? `<span>🤖 AI Sell view: <strong>PKR ${ai.sellPriceView}</strong></span>` : ''}
    ${ai.stopLossView  ? `<span>🤖 AI Stop: <strong>PKR ${ai.stopLossView}</strong></span>`       : ''}
  </div>` : ''}

  ${rec.suggestedReplacement ? `
  <div style="margin-top:10px;padding:10px 14px;background:#fff8e6;border-radius:6px;font-size:13px;color:#7a5000">
    💡 <strong>If you sell ${rec.ticker}:</strong> Consider buying <strong>${rec.suggestedReplacement}</strong> instead (currently rated higher in your portfolio)
  </div>` : ''}

  ${ai?.keyRisks?.length ? `
  <div style="margin-top:8px;font-size:11px;color:#b83232">
    ⚠️ <strong>Risks:</strong> ${ai.keyRisks.join(' · ')}
  </div>` : ''}
  ${ai?.keyCatalysts?.length ? `
  <div style="margin-top:4px;font-size:11px;color:#0a6e3c">
    ✅ <strong>Catalysts:</strong> ${ai.keyCatalysts.join(' · ')}
  </div>` : ''}
</div>`;
}

// ─── Pro indicator panel ──────────────────────────────────────────────────────

function proPanel(rec: StockRecommendation): string {
  const ti = rec.technicals;
  const f  = rec.fundamentals;
  const pt = rec.priceTargets;

  const rsiColor = ti.rsi14 < 30 ? 'green' : ti.rsi14 > 70 ? 'red' : undefined;
  const adxStr   = `${round(ti.adx14)} ${ti.adx14 > 25 ? '(Trending)' : '(Weak)'}`;
  const cmfColor = ti.chaikinMoneyFlow > 0.1 ? 'green' : ti.chaikinMoneyFlow < -0.1 ? 'red' : undefined;

  return `
<div style="border:1px solid #e0e0e0;border-radius:10px;padding:18px;margin:6px 0 16px;background:#fff;page-break-inside:avoid">
  <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">
    ${rec.ticker} — Professional Analysis
  </div>

  <!-- Price Targets Full Table -->
  <div style="background:#f0fff4;border-left:3px solid #0a6e3c;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:14px;font-size:12px">
    <div style="font-weight:700;color:#0a6e3c;margin-bottom:6px">PRICE LEVELS</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      ${[
        ['Conservative Buy', `PKR ${pt.conservativeBuyAt}`, ''],
        ['Aggressive Buy',   `PKR ${pt.aggressiveBuyAt}`, ''],
        ['Target 1 (+' + pt.potentialUpsidePct + '%)', `PKR ${pt.target1}`, ''],
        ['Target 2',         `PKR ${pt.target2}`, ''],
        ['Target 3',         `PKR ${pt.target3}`, ''],
        ['ATR Stop-Loss',    `PKR ${pt.stopLoss}`, ''],
        ['Hard Stop (8%)',   `PKR ${pt.hardStopLoss}`, ''],
        ['Risk/Reward',      `${pt.riskRewardRatio}:1`, ''],
        ['Fib 61.8%',        `PKR ${ti.fibRetracement618.toFixed(2)}`, ''],
        ['Pivot',            `PKR ${ti.pivot.toFixed(2)}`, ''],
      ].map(([l, v]) => `<div style="white-space:nowrap"><span style="color:#666">${l}:</span> <strong>${v}</strong></div>`).join('')}
    </div>
    <div style="margin-top:6px;color:#555;font-size:11px">📍 ${pt.currentVsTargetLabel}</div>
  </div>

  <!-- Score Breakdown -->
  <div style="margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:8px">COMPOSITE SCORE BREAKDOWN</div>
    ${scoreBar('Technical', rec.compositeScore.technical)}
    ${scoreBar('Fundamental', rec.compositeScore.fundamental)}
    ${scoreBar('Macro', rec.compositeScore.macro)}
    ${scoreBar('Sentiment', rec.compositeScore.sentiment)}
    <div style="margin-top:6px;font-size:11px;color:#555;font-style:italic">${rec.compositeScore.interpretation}</div>
  </div>

  <!-- Technical Indicators Grid -->
  <div style="margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:8px">TECHNICAL INDICATORS</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${indCell('RSI-14', round(ti.rsi14), rsiColor as any)}
      ${indCell('RSI-9', round(ti.rsi9))}
      ${indCell('RSI Div', ti.rsiDivergence !== 'none' ? ti.rsiDivergence : '—', ti.rsiDivergence === 'bullish' ? 'green' : ti.rsiDivergence === 'bearish' ? 'red' : undefined)}
      ${indCell('MACD', ti.macdSignal.replace('_',' '), ti.macdSignal.includes('bullish') ? 'green' : ti.macdSignal.includes('bearish') ? 'red' : undefined)}
      ${indCell('Stoch K/D', `${round(ti.stochasticK)}/${round(ti.stochasticD)}`)}
      ${indCell('Williams %R', round(ti.williamsR), ti.williamsR < -80 ? 'green' : ti.williamsR > -20 ? 'red' : undefined)}
      ${indCell('CCI-20', round(ti.cci20), ti.cci20 < -100 ? 'green' : ti.cci20 > 100 ? 'red' : undefined)}
      ${indCell('MFI-14', round(ti.mfi14), ti.mfi14 < 20 ? 'green' : ti.mfi14 > 80 ? 'red' : undefined)}
      ${indCell('ADX-14', adxStr, ti.adx14 > 25 ? 'green' : 'amber')}
      ${indCell('+DI / -DI', `${round(ti.diPlus)} / ${round(ti.diMinus)}`, ti.diPlus > ti.diMinus ? 'green' : 'red')}
      ${indCell('BB Position', ti.bbPosition.replace(/_/g,' '))}
      ${indCell('BB Squeeze', ti.bbSqueeze ? '⚡ YES' : 'No', ti.bbSqueeze ? 'amber' : undefined)}
      ${indCell('Keltner', ti.keltnerPosition, ti.keltnerPosition === 'below' ? 'green' : ti.keltnerPosition === 'above' ? 'red' : undefined)}
      ${indCell('PSAR', ti.parabolicSarSignal, ti.parabolicSarSignal === 'bullish' ? 'green' : 'red')}
      ${indCell('Ichimoku', ti.ichimokuSignal.replace(/_/g,' '), ti.ichimokuSignal === 'above_cloud' ? 'green' : ti.ichimokuSignal === 'below_cloud' ? 'red' : 'amber')}
      ${indCell('OBV Trend', ti.obvTrend, ti.obvTrend === 'accumulation' ? 'green' : ti.obvTrend === 'distribution' ? 'red' : undefined)}
      ${indCell('OBV Div', ti.obvDivergence !== 'none' ? ti.obvDivergence : '—', ti.obvDivergence === 'bullish' ? 'green' : ti.obvDivergence === 'bearish' ? 'red' : undefined)}
      ${indCell('CMF', round(ti.chaikinMoneyFlow, 3), cmfColor as any)}
      ${indCell('Vol Ratio', `${round(ti.volumeRatio)}×`, ti.volumeRatio > 2 ? 'amber' : undefined)}
      ${indCell('ATR (14)', `${round(ti.atr14)} (${round(ti.atrPct)}%)`)}
      ${indCell('HV-30', `${round(ti.historicalVolatility30d)}%`)}
      ${indCell('Vs VWAP', `${round(ti.priceVsVwapPct)}%`, ti.priceVsVwapPct < -3 ? 'green' : ti.priceVsVwapPct > 3 ? 'red' : undefined)}
      ${indCell('Vs 52W Hi', `${round(ti.priceVs52wHighPct)}%`, ti.priceVs52wHighPct > -5 ? 'red' : 'green')}
      ${indCell('Trend S/M/L', `${ti.trendShort}/${ti.trendMid}/${ti.trendLong}`)}
      ${indCell('Trend Consist.', `${ti.trendConsistency}%`, ti.trendConsistency >= 66 ? 'green' : ti.trendConsistency <= 33 ? 'red' : 'amber')}
      ${indCell('Golden/Death', ti.goldenCrossActive ? '✅ Golden' : ti.deathCrossActive ? '❌ Death' : '—', ti.goldenCrossActive ? 'green' : ti.deathCrossActive ? 'red' : undefined)}
      ${indCell('Candle', ti.candlestickPattern.replace(/_/g,' '))}
    </div>
  </div>

  <!-- Signal Breakdown -->
  <div style="margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:6px">
      ACTIVE SIGNALS — Conviction Score: <span style="color:${rec.signalResult.convictionScore >= 0 ? '#0a6e3c' : '#b83232'}">${rec.signalResult.convictionScore.toFixed(1)}</span>
    </div>
    ${rec.signalResult.buySignals.length > 0 ? `
      <div style="margin-bottom:6px">
        <div style="font-size:10px;color:#0a6e3c;font-weight:600;margin-bottom:4px">BULLISH SIGNALS (${rec.signalResult.buySignals.length})</div>
        ${rec.signalResult.buySignals.map(s =>
          `<div style="font-size:11px;color:#333;padding:3px 0;border-bottom:1px solid #f5f5f5">
            <span style="background:#e6f9ef;color:#0a6e3c;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;margin-right:6px">${s.name}</span>
            ${s.description}
          </div>`
        ).join('')}
      </div>` : ''}
    ${rec.signalResult.sellSignals.length > 0 ? `
      <div>
        <div style="font-size:10px;color:#b83232;font-weight:600;margin-bottom:4px">BEARISH SIGNALS (${rec.signalResult.sellSignals.length})</div>
        ${rec.signalResult.sellSignals.map(s =>
          `<div style="font-size:11px;color:#333;padding:3px 0;border-bottom:1px solid #f5f5f5">
            <span style="background:#fde8e8;color:#b83232;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;margin-right:6px">${s.name}</span>
            ${s.description}
          </div>`
        ).join('')}
      </div>` : ''}
  </div>

  <!-- Fundamentals -->
  <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:8px">FUNDAMENTALS</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
    ${[
      ['P/E (TTM)',      `${round(f.peRatioTtm)} vs ${f.sectorAvgPe} sector`],
      ['P/E (Fwd)',      round(f.peRatioForward)],
      ['P/B',           round(f.pbRatio)],
      ['EV/EBITDA',     round(f.evEbitda)],
      ['EPS TTM',       `PKR ${round(f.epsTtm)}`],
      ['EPS Growth',    `${round(f.epsGrowthYoy)}% YoY`],
      ['ROE',           `${round(f.roeTtm)}%`],
      ['ROIC',          `${round(f.roicTtm)}%`],
      ['Net Margin',    `${round(f.netProfitMarginPct)}%`],
      ['Rev Growth',    `${round(f.revenueGrowthYoy)}% YoY`],
      ['Div Yield',     `${round(f.dividendYieldPct)}%`],
      ['Div/Share',     `PKR ${round(f.dividendPerShare)}`],
      ['Div Years',     f.consecutiveDividendYears],
      ['D/E',           round(f.debtToEquity)],
      ['Curr Ratio',    round(f.currentRatio)],
      ['Int Coverage',  `${round(f.interestCoverageRatio)}×`],
      ['Net Debt/EBITDA', round(f.netDebtToEbitda)],
      ['FCF Yield',     `${round(f.freeCashFlowYield)}%`],
      ['Book Value/Sh', `PKR ${round(f.bookValuePerShare)}`],
    ].map(([l, v]) => `<div style="background:#f7f7f7;border-radius:5px;padding:5px 9px;min-width:100px">
      <div style="font-size:10px;color:#888">${l}</div>
      <div style="font-weight:700;font-size:12px">${v}</div>
    </div>`).join('')}
  </div>
  ${f.upcomingDividendDate  ? `<div style="font-size:11px;color:#0a6e3c;margin-top:4px">📅 Dividend ex-date: <strong>${f.upcomingDividendDate}</strong></div>` : ''}
  ${f.upcomingEarningsDate  ? `<div style="font-size:11px;color:#1a6fb5;margin-top:2px">📅 Earnings: <strong>${f.upcomingEarningsDate}</strong></div>` : ''}
  ${rec.flags.filter(f => !f.includes('warn')).length > 0
    ? `<div style="margin-top:6px;font-size:11px;color:#888">Flags: ${rec.flags.join(' · ')}</div>` : ''}
</div>`;
}

// ─── Build full HTML ───────────────────────────────────────────────────────────

function buildHtml(output: RunOutput): string {
  const {
    runAt, macro: m, portfolioRecs, discoveryPicks,
    alerts, sectorConcentration, aiReview,
    totalPortfolioValue, totalCostBasis, totalUnrealisedPl, totalUnrealisedPlPct,
    circuitBreakerActive,
  } = output;

  const dateStr    = format(runAt, 'EEEE, d MMMM yyyy — HH:mm');
  const critAlerts = alerts.filter(a => a.severity === 'CRITICAL');

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#f2f4f8;padding:20px}
    .page{max-width:980px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 36px;box-shadow:0 2px 20px rgba(0,0,0,.07)}
    h2{font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.6px;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #f0f0f0}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f5f5f5;padding:8px 10px;text-align:left;font-weight:600;font-size:11px;color:#666;border-bottom:2px solid #e0e0e0;text-transform:uppercase;letter-spacing:.3px}
    td{padding:9px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle}
  `;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="page">

<!-- ═══════════════════════════════════════════════════════════════════════
     COVER
════════════════════════════════════════════════════════════════════════ -->
<div style="background:linear-gradient(135deg,#0f1729 0%,#16213e 55%,#1a3a6e 100%);color:#fff;padding:28px 32px;border-radius:10px;margin-bottom:24px">
  <div style="font-size:28px;font-weight:900;letter-spacing:-0.5px">📊 PSX Portfolio Analysis</div>
  <div style="opacity:.7;font-size:13px;margin-top:5px">${dateStr} PKT &nbsp;|&nbsp; Shariah: ${output.config.shariahMode} &nbsp;|&nbsp; AI: ${output.config.aiModel.toUpperCase()}</div>
  <div style="display:flex;flex-wrap:wrap;gap:20px;margin-top:20px">
    ${[
      ['Total Portfolio', formatPkr(totalPortfolioValue)],
      ['Cost Basis', formatPkr(totalCostBasis)],
      ['Unrealised P&L', `${formatPct(totalUnrealisedPlPct)} / ${formatPkr(totalUnrealisedPl)}`],
      ['KSE-100', `${m.kse100Level.toLocaleString()} (${formatPct(m.kse100ChangePct)})`],
      ['PKR/USD', `${m.pkrUsdOfficial} (${m.pkrTrend})`],
      ['SBP Rate', `${m.sbpPolicyRate}% (${m.sbpRateTrend})`],
      ['Brent', `$${m.brentCrude}`],
    ].map(([l, v]) => `<div>
      <div style="font-size:11px;opacity:.55">${l}</div>
      <div style="font-size:17px;font-weight:700;margin-top:2px">${v}</div>
    </div>`).join('')}
  </div>
</div>

${circuitBreakerActive ? `
<div style="background:#fff3cd;border:1.5px solid #ffc107;padding:14px 18px;border-radius:8px;margin-bottom:18px;font-weight:600;color:#6a4d00;font-size:14px">
  ⚠️ CIRCUIT BREAKER ACTIVE — KSE-100 is down ${Math.abs(m.kse100ChangePct)}% today.
  All BUY recommendations are paused until the market stabilises.
</div>` : ''}

<!-- ═══════════════════════════════════════════════════════════════════════
     CRITICAL ALERTS (shown at top if any)
════════════════════════════════════════════════════════════════════════ -->
${critAlerts.length > 0 ? `
<h2>🚨 Critical Alerts (${critAlerts.length})</h2>
<div style="margin-bottom:20px">
${critAlerts.map(a => `
  <div style="padding:12px 16px;margin:6px 0;border-left:4px solid ${SEV_COLOR[a.severity]};background:#fafafa;border-radius:0 8px 8px 0">
    <div style="font-weight:700;color:${SEV_COLOR[a.severity]};font-size:14px">${a.ticker} — ${a.type.replace(/_/g,' ')}</div>
    <div style="font-size:13px;color:#444;margin-top:3px">${a.detail}</div>
    <div style="font-size:12px;color:#1a6fb5;margin-top:4px;font-weight:600">→ Action: ${a.action}</div>
  </div>`).join('')}
</div>` : ''}

<!-- ═══════════════════════════════════════════════════════════════════════
     AI MARKET OVERVIEW
════════════════════════════════════════════════════════════════════════ -->
<h2>AI Market Overview</h2>
<div style="display:flex;gap:20px;align-items:flex-start;padding:16px;background:#f9f9ff;border-radius:10px;margin-bottom:20px;flex-wrap:wrap">
  <div style="text-align:center;min-width:90px">
    <div style="font-size:11px;color:#888;margin-bottom:4px">Stance</div>
    <div style="font-size:20px;font-weight:900;color:${STANCE_COLOR[aiReview.marketStance] ?? '#555'};text-transform:uppercase">${aiReview.marketStance}</div>
    <div style="font-size:11px;color:#888;margin-top:4px">AI Score: ${aiReview.algorithmScore}/10</div>
  </div>
  <div style="flex:1;min-width:220px">
    <div style="font-size:14px;line-height:1.7;color:#333">${aiReview.marketSummary}</div>
    ${aiReview.keyMarketDrivers.length > 0 ? `
      <div style="margin-top:8px;font-size:12px;color:#555">
        <strong>Key Drivers:</strong> ${aiReview.keyMarketDrivers.join(' · ')}
      </div>` : ''}
    ${aiReview.globalRiskFlags.length > 0 ? `
      <div style="margin-top:6px;font-size:12px;color:#b83232">
        <strong>⚠ Risk Flags:</strong> ${aiReview.globalRiskFlags.join(' · ')}
      </div>` : ''}
    ${aiReview.macroOpportunities.length > 0 ? `
      <div style="margin-top:6px;font-size:12px;color:#0a6e3c">
        <strong>✅ Opportunities:</strong> ${aiReview.macroOpportunities.join(' · ')}
      </div>` : ''}
  </div>
</div>

<!-- Macro Snapshot -->
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px;font-size:12px">
${[
  ['PKR/USD', m.pkrUsdOfficial, m.pkrTrend],
  ['SBP Rate', `${m.sbpPolicyRate}%`, m.sbpRateTrend],
  ['KIBOR 1M', `${m.kibor1m}%`, ''],
  ['CPI', `${m.pakistanCpi}%`, ''],
  ['Core CPI', `${m.coreCpi}%`, ''],
  ['Brent', `$${m.brentCrude}`, ''],
  ['Urea', `$${m.ureaTonne}/t`, ''],
  ['KSE YTD', formatPct(m.kse100Ytd), ''],
  ['FPI/wk', `PKR ${m.fpiWeeklyMillion}M`, m.fpiDirection],
].map(([l, v, sub]) => `<div style="background:#f5f5f5;padding:9px 13px;border-radius:8px;min-width:110px">
  <div style="font-size:10px;color:#888">${l}</div>
  <div style="font-weight:700;font-size:14px;margin-top:1px">${v}</div>
  ${sub ? `<div style="font-size:10px;color:#aaa">${sub}</div>` : ''}
</div>`).join('')}
</div>
<div style="padding:10px 14px;background:#f5f5f5;border-radius:8px;font-size:12px;color:#555;margin-bottom:6px">
  <strong>IMF:</strong> ${m.imfStatus}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════
     PORTFOLIO SUMMARY TABLE
════════════════════════════════════════════════════════════════════════ -->
<h2>Portfolio Summary</h2>
<div style="overflow-x:auto;margin-bottom:20px">
<table>
  <thead><tr>
    <th>Ticker</th><th>Name</th><th>Shares</th><th>Avg Cost</th>
    <th>Price</th><th>P&L%</th><th>P&L PKR</th>
    <th>Signal</th><th>Buy At</th><th>Target 1</th><th>Stop Loss</th>
    <th>Score</th>
  </tr></thead>
  <tbody>
  ${portfolioRecs.map(r => {
    const p = r.position;
    const pc = p ? plColor(p.unrealisedPlPct) : '#333';
    return `<tr>
      <td><strong>${r.ticker}</strong></td>
      <td style="font-size:11px;color:#555">${r.name}</td>
      <td>${p?.shares.toLocaleString() ?? '—'}</td>
      <td>${p ? `PKR ${p.avgCost}` : '—'}</td>
      <td><strong>PKR ${r.currentPrice}</strong> <span style="font-size:10px;color:${plColor(r.dayChangePct)}">${formatPct(r.dayChangePct)}</span></td>
      <td style="color:${pc};font-weight:600">${p ? formatPct(p.unrealisedPlPct) : '—'}</td>
      <td style="color:${pc}">${p ? formatPkr(p.unrealisedPlPkr) : '—'}</td>
      <td>${badge(r.signal)}</td>
      <td style="color:#0a6e3c;font-weight:600">PKR ${r.priceTargets.aggressiveBuyAt}</td>
      <td style="color:#0a6e3c">PKR ${r.priceTargets.target1}</td>
      <td style="color:#b83232">PKR ${r.priceTargets.stopLoss}</td>
      <td>${scoreBar('', r.compositeScore.composite, '80px')}</td>
    </tr>`;
  }).join('')}
  </tbody>
</table>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════
     SECTOR CONCENTRATION
════════════════════════════════════════════════════════════════════════ -->
<h2>Sector Concentration</h2>
<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px">
${Object.entries(sectorConcentration).sort(([,a],[,b]) => b - a).map(([s, p]) => {
  const c = p > 35 ? '#b83232' : p > 25 ? '#c97a00' : '#0a6e3c';
  return `<div style="min-width:150px">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
      <span>${s}</span><strong style="color:${c}">${p}%</strong>
    </div>
    <div style="height:8px;background:#eee;border-radius:4px">
      <div style="width:${Math.min(100,p)}%;height:8px;background:${c};border-radius:4px"></div>
    </div>
  </div>`;}).join('')}
</div>
${aiReview.concentrationRisks.length > 0 ? `
  <div style="font-size:12px;color:#b83232;margin-bottom:20px">${aiReview.concentrationRisks.map(r=>`⚠ ${r}`).join('<br>')}</div>` : ''}

<!-- ═══════════════════════════════════════════════════════════════════════
     ALL ALERTS
════════════════════════════════════════════════════════════════════════ -->
${alerts.length > 0 ? `
<h2>All Active Alerts (${alerts.length})</h2>
<div style="margin-bottom:20px">
${alerts.map(a => `
  <div style="padding:10px 14px;margin:5px 0;border-left:4px solid ${SEV_COLOR[a.severity]};background:#fafafa;border-radius:0 8px 8px 0">
    <span style="font-size:11px;font-weight:700;color:${SEV_COLOR[a.severity]}">[${a.severity}]</span>
    <strong style="margin-left:6px">${a.ticker}</strong>
    <span style="font-size:11px;color:#888;margin-left:4px">${a.type.replace(/_/g,' ')}</span>
    <div style="font-size:12px;color:#444;margin-top:2px">${a.detail}</div>
    <div style="font-size:11px;color:#1a6fb5;margin-top:2px">→ ${a.action}</div>
  </div>`).join('')}
</div>` : ''}

<!-- ═══════════════════════════════════════════════════════════════════════
     PORTFOLIO — NOOB SECTION
════════════════════════════════════════════════════════════════════════ -->
<h2>📖 Portfolio — What Should You Do? (Plain English)</h2>
<p style="font-size:12px;color:#888;margin-bottom:14px">Each card below tells you exactly what to do with this stock, at what price to buy, take profit, and exit.</p>
${portfolioRecs.map(r => noobCard(r, aiReview)).join('')}

<!-- ═══════════════════════════════════════════════════════════════════════
     PORTFOLIO — PRO SECTION
════════════════════════════════════════════════════════════════════════ -->
<h2>🔬 Portfolio — Detailed Technical & Fundamental Analysis (Professional)</h2>
${portfolioRecs.map(r => proPanel(r)).join('')}

<!-- ═══════════════════════════════════════════════════════════════════════
     DISCOVERY PICKS
════════════════════════════════════════════════════════════════════════ -->
${discoveryPicks.length > 0 ? `
<h2>🔍 New Buy Candidates (Outside Portfolio)</h2>
<p style="font-size:12px;color:#888;margin-bottom:14px">Stocks not currently in your portfolio that the algorithm and AI both rate highly.</p>
${discoveryPicks.map(r => noobCard(r, aiReview)).join('')}
${discoveryPicks.map(r => proPanel(r)).join('')}` : ''}

<!-- ═══════════════════════════════════════════════════════════════════════
     SECTOR OUTLOOK
════════════════════════════════════════════════════════════════════════ -->
${Object.keys(aiReview.sectorOutlook).length > 0 ? `
<h2>Sector Outlook (AI)</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px">
${Object.entries(aiReview.sectorOutlook).map(([s, v]) => `
  <div style="padding:12px 14px;background:#f9f9f9;border-radius:8px">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px">${s}</div>
    <div style="font-size:12px;color:#555;line-height:1.5">${v}</div>
  </div>`).join('')}
</div>` : ''}

<!-- Disclaimer -->
<div style="margin-top:32px;padding:14px;background:#f9f9f9;border-radius:8px;font-size:10px;color:#888;line-height:1.7">
  <strong>Disclaimer:</strong> This report is generated by an automated system for informational purposes only.
  It does not constitute financial advice. Always conduct your own due diligence before investing.
  Past performance does not guarantee future results. Investing in equities involves risk of capital loss.
  &nbsp;|&nbsp; ${dateStr} PKT &nbsp;|&nbsp; Run: ${output.runId}
</div>

</div></body></html>`;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function generatePdfReport(output: RunOutput): Promise<Buffer> {
  logger.info('Generating PDF report');
  const html = buildHtml(output);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
    });
    const buf = Buffer.from(pdf);
    logger.info({ bytes: buf.length }, 'PDF generated');
    return buf;
  } finally {
    await browser.close();
  }
}
