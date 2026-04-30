/**
 * PDF Report Builder
 * Uses Puppeteer to render a rich HTML report → PDF buffer
 * The PDF is then attached to both email and WhatsApp
 */
import puppeteer from 'puppeteer';
import { format } from 'date-fns';
import { formatPkr, formatPct, round } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { RunOutput, StockRecommendation, Alert } from '../types';

// ─── Color helpers ────────────────────────────────────────────────────────────

const SIG_COLOR: Record<string, string> = {
  STRONG_BUY:  '#0a6e3c', BUY: '#2d8a4e', HOLD: '#8a6d00',
  SELL:        '#c0392b', STRONG_SELL: '#6b0a0a',
};
const SIG_BG: Record<string, string> = {
  STRONG_BUY:'#e6f9ef',BUY:'#f0fff6',HOLD:'#fffbe6',SELL:'#fff0ee',STRONG_SELL:'#fce8e8',
};
const SEV_COLOR: Record<string, string> = { CRITICAL:'#c0392b', WARNING:'#e67e22', INFO:'#2980b9' };
const STANCE_COLOR: Record<string, string> = { bullish:'#0a6e3c', bearish:'#c0392b', neutral:'#555', cautious:'#b07000' };

function pct(v: number) { return `<span style="color:${v>=0?'#0a6e3c':'#c0392b'}">${formatPct(v)}</span>`; }

function badge(signal: string) {
  return `<span style="background:${SIG_COLOR[signal]};color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.5px">${signal.replace('_',' ')}</span>`;
}

function scoreBar(score: number) {
  const color = score>=75?'#0a6e3c':score>=55?'#b07000':score>=35?'#e67e22':'#c0392b';
  return `<div style="display:flex;align-items:center;gap:8px">
    <div style="flex:1;height:8px;background:#eee;border-radius:4px">
      <div style="width:${score}%;height:8px;background:${color};border-radius:4px"></div>
    </div>
    <span style="font-weight:700;color:${color};min-width:32px;font-size:13px">${score}</span>
  </div>`;
}

// ─── Individual stock card ─────────────────────────────────────────────────────
function stockCard(rec: StockRecommendation, aiReview: RunOutput['aiReview'], isPortfolio: boolean): string {
  const ai = isPortfolio
    ? aiReview.portfolioReview.find(r => r.ticker === rec.ticker)
    : aiReview.discoveryReview.find(r => r.ticker === rec.ticker);

  const pos = rec.position;
  const ti  = rec.technicals;
  const pt  = rec.priceTargets;
  const f   = rec.fundamentals;

  const valBadge = (label: string, val: string, sub?: string) =>
    `<div style="background:#f8f8f8;border-radius:6px;padding:8px 12px;min-width:100px">
      <div style="font-size:11px;color:#888;margin-bottom:2px">${label}</div>
      <div style="font-weight:700;font-size:14px">${val}</div>
      ${sub ? `<div style="font-size:10px;color:#aaa">${sub}</div>` : ''}
    </div>`;

  const sigRow = (label: string, sigs: {name:string;description:string}[]) =>
    sigs.length ? `<div style="margin:4px 0"><span style="font-size:11px;color:#888;width:70px;display:inline-block">${label}</span>
      ${sigs.map(s=>`<span style="font-size:11px;background:#e8f5ff;color:#1a5276;padding:2px 6px;border-radius:3px;margin:2px">${s.name}</span>`).join('')}
    </div>` : '';

  return `
  <div style="border:1px solid #e0e0e0;border-radius:10px;padding:20px;margin:12px 0;background:#fff;page-break-inside:avoid">

    <!-- Header row -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div>
        <span style="font-size:20px;font-weight:800;color:#111">${rec.ticker}</span>
        <span style="font-size:14px;color:#555;margin-left:10px">${rec.name}</span>
        <span style="font-size:11px;background:#f0f0f0;color:#555;padding:2px 8px;border-radius:12px;margin-left:8px">${rec.sector}</span>
        ${rec.shariah ? '<span style="font-size:11px;background:#e8f5e9;color:#2d6a4f;padding:2px 8px;border-radius:12px;margin-left:4px">☽ Shariah</span>' : ''}
      </div>
      <div style="text-align:right">
        ${badge(rec.signal)}
        <div style="font-size:12px;color:#888;margin-top:4px">Score: ${rec.compositeScore.composite}/100 (${rec.compositeScore.grade})</div>
      </div>
    </div>

    <!-- Price row -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${valBadge('Current Price', `PKR ${rec.currentPrice}`, pct(rec.dayChangePct)+' today')}
      ${pos ? valBadge('Avg Cost', `PKR ${pos.avgCost}`, `${pos.shares.toLocaleString()} shares`) : ''}
      ${pos ? valBadge('Unrealised P&L', formatPkr(pos.unrealisedPlPkr), pct(pos.unrealisedPlPct)) : ''}
      ${pos ? valBadge('Portfolio Weight', `${round(pos.portfolioWeightPct,1)}%`, '') : ''}
      ${valBadge('52W High', `PKR ${rec.technicals.resistance3}`,'')}
      ${valBadge('52W Low',  `PKR ${rec.technicals.support3}`,'')}
    </div>

    <!-- Price Targets -->
    <div style="background:#f0fff4;border-left:4px solid #2d8a4e;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:14px">
      <div style="font-weight:700;font-size:13px;color:#2d6a4f;margin-bottom:8px">PRICE TARGETS & ACTION LEVELS</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:13px">
        <div><span style="color:#888">Aggressive Buy:</span> <strong>PKR ${pt.aggressiveBuyAt}</strong></div>
        <div><span style="color:#888">Conservative Buy:</span> <strong>PKR ${pt.conservativeBuyAt}</strong></div>
        <div><span style="color:#2d8a4e">Target 1:</span> <strong style="color:#2d8a4e">PKR ${pt.target1}</strong> <span style="color:#888;font-size:11px">(+${pt.potentialUpsidePct}%)</span></div>
        <div><span style="color:#2d8a4e">Target 2:</span> <strong>PKR ${pt.target2}</strong></div>
        <div><span style="color:#2d8a4e">Target 3:</span> <strong>PKR ${pt.target3}</strong></div>
        <div><span style="color:#c0392b">Stop Loss:</span> <strong style="color:#c0392b">PKR ${pt.stopLoss}</strong> <span style="color:#888;font-size:11px">(-${pt.potentialDownsidePct}%)</span></div>
        <div><span style="color:#888">Risk/Reward:</span> <strong>${pt.riskRewardRatio}:1</strong></div>
      </div>
      <div style="font-size:12px;color:#666;margin-top:6px">📍 ${pt.currentVsTargetLabel}</div>
      ${rec.suggestedReplacement ? `<div style="margin-top:6px;font-size:12px;color:#8a4000">💡 If selling, consider buying <strong>${rec.suggestedReplacement}</strong> instead</div>` : ''}
    </div>

    <!-- Technical Indicators Grid -->
    <div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:12px;color:#333;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Technical Indicators</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;font-size:12px">
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">RSI-14</span><br><strong style="color:${ti.rsi14<30?'#2d8a4e':ti.rsi14>70?'#c0392b':'#333'}">${round(ti.rsi14)}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">MACD</span><br><strong>${ti.macdSignal.replace('_',' ')}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">ADX-14</span><br><strong style="color:${ti.adx14>25?'#2d8a4e':'#888'}">${round(ti.adx14)} ${ti.adx14>25?'(Trending)':'(Weak)'}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">Stoch K/D</span><br><strong>${round(ti.stochasticK)}/${round(ti.stochasticD)}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">Williams %R</span><br><strong style="color:${ti.williamsR<-80?'#2d8a4e':ti.williamsR>-20?'#c0392b':'#333'}">${round(ti.williamsR)}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">MFI-14</span><br><strong style="color:${ti.mfi14<20?'#2d8a4e':ti.mfi14>80?'#c0392b':'#333'}">${round(ti.mfi14)}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">CCI-20</span><br><strong>${round(ti.cci20)}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">CMF</span><br><strong style="color:${ti.chaikinMoneyFlow>0?'#2d8a4e':'#c0392b'}">${round(ti.chaikinMoneyFlow,3)}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">OBV Trend</span><br><strong style="color:${ti.obvTrend==='accumulation'?'#2d8a4e':ti.obvTrend==='distribution'?'#c0392b':'#888'}">${ti.obvTrend}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">BB Position</span><br><strong>${ti.bbPosition.replace(/_/g,' ')}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">Ichimoku</span><br><strong style="color:${ti.ichimokuSignal==='above_cloud'?'#2d8a4e':ti.ichimokuSignal==='below_cloud'?'#c0392b':'#888'}">${ti.ichimokuSignal.replace(/_/g,' ')}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">Trend</span><br><strong>${ti.trendShort}/${ti.trendMid}/${ti.trendLong}</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">ATR (vol)</span><br><strong>${round(ti.atr14)} (${round(ti.atrPct)}%)</strong></div>
        <div style="background:#f9f9f9;padding:6px 10px;border-radius:5px"><span style="color:#888">Candle</span><br><strong>${ti.candlestickPattern.replace(/_/g,' ')}</strong></div>
        ${ti.rsiDivergence!=='none'?`<div style="background:#fffbe6;padding:6px 10px;border-radius:5px"><span style="color:#888">RSI Divergence</span><br><strong style="color:#b07000">${ti.rsiDivergence}</strong></div>`:''}
        ${ti.bbSqueeze?`<div style="background:#fffbe6;padding:6px 10px;border-radius:5px"><span style="color:#888">BB Squeeze</span><br><strong style="color:#b07000">⚡ Active</strong></div>`:''}
      </div>
    </div>

    <!-- Technical Signal Summary -->
    <div style="background:#f5f5f5;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:12px">
      ${sigRow('BUY', rec.signalResult.buySignals.slice(0,5))}
      ${sigRow('SELL', rec.signalResult.sellSignals.slice(0,5))}
      <div style="margin-top:6px;color:#444"><em>${rec.signalResult.technicalSummary}</em></div>
    </div>

    <!-- Fundamentals row -->
    <div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:12px;color:#333;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Fundamentals</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px">
        ${[
          ['P/E (TTM)',`${round(f.peRatioTtm)} vs sector ${f.sectorAvgPe}`],
          ['P/E (Fwd)', round(f.peRatioForward)],
          ['P/B', round(f.pbRatio)],
          ['EV/EBITDA', round(f.evEbitda)],
          ['ROE', `${round(f.roeTtm)}%`],
          ['ROIC', `${round(f.roicTtm)}%`],
          ['Net Margin', `${round(f.netProfitMarginPct)}%`],
          ['EPS TTM', `PKR ${round(f.epsTtm)}`],
          ['EPS Growth', `${round(f.epsGrowthYoy)}% YoY`],
          ['Div Yield', `${round(f.dividendYieldPct)}%`],
          ['Div/Share', `PKR ${round(f.dividendPerShare)}`],
          ['Div Years', f.consecutiveDividendYears],
          ['D/E', round(f.debtToEquity)],
          ['Curr Ratio', round(f.currentRatio)],
          ['Int Cover', `${round(f.interestCoverageRatio)}x`],
          ['FCF Yield', `${round(f.freeCashFlowYield)}%`],
          ['Rev Growth', `${round(f.revenueGrowthYoy)}% YoY`],
        ].map(([l,v])=>`<div style="background:#f9f9f9;padding:5px 10px;border-radius:5px"><span style="color:#888">${l}</span><br><strong>${v}</strong></div>`).join('')}
      </div>
    </div>

    <!-- Score breakdown -->
    <div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:12px;color:#333;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Composite Score Breakdown</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
        ${[['Technical',rec.compositeScore.technical],['Sentiment',rec.compositeScore.sentiment],
           ['Fundamental',rec.compositeScore.fundamental],['Macro',rec.compositeScore.macro]].map(([l,v])=>`
          <div><span style="color:#888;display:inline-block;width:90px">${l}</span>${scoreBar(v as number)}</div>`).join('')}
      </div>
      <div style="margin-top:6px;font-size:12px;color:#555"><em>${rec.compositeScore.interpretation}</em></div>
    </div>

    <!-- AI Review -->
    ${ai ? `<div style="background:#f0f4ff;border-left:4px solid #2980b9;padding:12px 16px;border-radius:0 8px 8px 0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-weight:700;font-size:13px">AI Review</span>
        <span style="font-size:12px;padding:2px 8px;border-radius:4px;background:${ai.aiValidation==='AGREE'?'#e8f5e9':ai.aiValidation==='DISAGREE'?'#fce8e8':'#fffbe6'};color:${ai.aiValidation==='AGREE'?'#2d6a4f':ai.aiValidation==='DISAGREE'?'#6b0a0a':'#8a6d00'}">${ai.aiValidation}</span>
        <span style="font-size:12px;color:#888">Confidence: ${ai.confidence}</span>
        ${ai.finalSignal !== rec.signal ? badge(ai.finalSignal) : ''}
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#333;line-height:1.6">${ai.reasoning}</p>
      ${ai.buyPriceView  ? `<div style="font-size:12px">🟢 AI Buy: <strong>PKR ${ai.buyPriceView}</strong></div>` : ''}
      ${ai.sellPriceView ? `<div style="font-size:12px">🔴 AI Sell: <strong>PKR ${ai.sellPriceView}</strong></div>` : ''}
      ${ai.stopLossView  ? `<div style="font-size:12px">⛔ AI Stop: <strong>PKR ${ai.stopLossView}</strong></div>` : ''}
      ${ai.keyCatalysts.length ? `<div style="font-size:12px;margin-top:4px;color:#2d6a4f">✅ Catalysts: ${ai.keyCatalysts.join(' · ')}</div>` : ''}
      ${ai.keyRisks.length     ? `<div style="font-size:12px;margin-top:2px;color:#c0392b">⚠️ Risks: ${ai.keyRisks.join(' · ')}</div>` : ''}
      ${ai.shariahNote ? `<div style="font-size:12px;margin-top:4px;color:#2d6a4f">☽ ${ai.shariahNote}</div>` : ''}
    </div>` : ''}
  </div>`;
}

// ─── Full HTML report ─────────────────────────────────────────────────────────
function buildHtml(output: RunOutput): string {
  const { runAt, macro: m, portfolioRecs, discoveryPicks, alerts, sectorConcentration,
          aiReview, totalPortfolioValue, totalCostBasis, totalUnrealisedPl, totalUnrealisedPlPct,
          circuitBreakerActive } = output;

  const dateStr = format(runAt, 'EEEE, d MMMM yyyy — HH:mm');
  const critAlerts = alerts.filter(a=>a.severity==='CRITICAL');
  const warnAlerts = alerts.filter(a=>a.severity==='WARNING');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#f4f6f9;padding:24px}
  .page{max-width:960px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
  h2{font-size:15px;font-weight:700;color:#1a1a1a;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #f0f0f0;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f5f5f5;padding:9px 10px;text-align:left;font-weight:600;font-size:11px;color:#666;border-bottom:2px solid #e0e0e0;text-transform:uppercase}
  td{padding:9px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle}
  tr:hover td{background:#fafafa}
</style></head><body>
<div class="page">

<!-- Cover -->
<div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#fff;padding:28px 32px;border-radius:10px;margin-bottom:28px">
  <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px">PSX Portfolio Analysis</div>
  <div style="opacity:.75;font-size:13px;margin-top:6px">${dateStr} PKT &nbsp;|&nbsp; Shariah: ${output.config.shariahMode} &nbsp;|&nbsp; AI: ${output.config.aiModel.toUpperCase()}</div>
  <div style="margin-top:20px;display:flex;flex-wrap:wrap;gap:20px">
    ${[
      ['Portfolio Value', formatPkr(totalPortfolioValue)],
      ['Cost Basis', formatPkr(totalCostBasis)],
      ['Unrealised P&L', `${formatPct(totalUnrealisedPlPct)} (${formatPkr(totalUnrealisedPl)})`],
      ['KSE-100', `${m.kse100Level.toLocaleString()} (${formatPct(m.kse100ChangePct)})`],
      ['PKR/USD', m.pkrUsdOfficial.toString()],
      ['SBP Rate', `${m.sbpPolicyRate}%`],
    ].map(([l,v])=>`<div>
      <div style="font-size:11px;opacity:.65">${l}</div>
      <div style="font-size:18px;font-weight:700;margin-top:2px">${v}</div>
    </div>`).join('')}
  </div>
</div>

${circuitBreakerActive ? `
<div style="background:#fff3cd;border:1.5px solid #ffc107;padding:14px 18px;border-radius:8px;margin-bottom:20px;font-weight:600;color:#856404">
  ⚠️ CIRCUIT BREAKER ACTIVE — KSE-100 down ${Math.abs(m.kse100ChangePct)}% today. All BUY signals paused until market stabilises.
</div>` : ''}

<!-- Market Stance -->
<h2>AI Market Assessment</h2>
<div style="display:flex;align-items:flex-start;gap:20px;padding:16px;background:#f9f9ff;border-radius:10px;margin-bottom:20px">
  <div style="text-align:center;min-width:100px">
    <div style="font-size:13px;color:#888;margin-bottom:4px">Stance</div>
    <div style="font-size:18px;font-weight:800;color:${STANCE_COLOR[aiReview.marketStance] ?? '#555'};text-transform:uppercase">${aiReview.marketStance}</div>
    <div style="font-size:12px;color:#888;margin-top:4px">AI Score: ${aiReview.algorithmScore}/10</div>
  </div>
  <div style="flex:1">
    <p style="font-size:14px;line-height:1.7;color:#333">${aiReview.marketSummary}</p>
    ${aiReview.keyMarketDrivers.length ? `<div style="margin-top:8px;font-size:12px;color:#555"><strong>Key Drivers:</strong> ${aiReview.keyMarketDrivers.join(' · ')}</div>` : ''}
    ${aiReview.globalRiskFlags.length ? `<div style="margin-top:6px;font-size:12px;color:#c0392b"><strong>Risk Flags:</strong> ${aiReview.globalRiskFlags.join(' · ')}</div>` : ''}
  </div>
</div>

<!-- Macro Snapshot -->
<h2>Macro Snapshot</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;font-size:13px">
${[
  ['PKR/USD Official',m.pkrUsdOfficial,m.pkrTrend],
  ['SBP Policy Rate',`${m.sbpPolicyRate}%`,m.sbpRateTrend],
  ['KIBOR 1M',`${m.kibor1m}%`,''],
  ['Pakistan CPI',`${m.pakistanCpi}%`,''],
  ['Brent Crude',`$${m.brentCrude}`,''],
  ['Urea',`$${m.ureaTonne}/t`,''],
  ['KSE-100 YTD',`${formatPct(m.kse100Ytd)}`,''],
  ['FPI Weekly',`PKR ${m.fpiWeeklyMillion}M`,m.fpiDirection],
].map(([l,v,sub])=>`<div style="background:#f5f5f5;padding:10px 14px;border-radius:8px;min-width:140px">
  <div style="font-size:11px;color:#888">${l}</div>
  <div style="font-weight:700;font-size:15px;margin-top:2px">${v}</div>
  ${sub?`<div style="font-size:10px;color:#aaa">${sub}</div>`:''}
</div>`).join('')}
</div>
<div style="font-size:12px;padding:10px 14px;background:#f9f9f9;border-radius:8px;color:#555;margin-bottom:8px">IMF: ${m.imfStatus}</div>

<!-- Active Alerts -->
${alerts.length > 0 ? `
<h2>Active Alerts (${alerts.length})</h2>
<div style="margin-bottom:20px">
${alerts.map(a=>`
  <div style="padding:12px 16px;margin:6px 0;border-left:4px solid ${SEV_COLOR[a.severity]};background:#fafafa;border-radius:0 8px 8px 0">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <strong style="color:${SEV_COLOR[a.severity]}">[${a.severity}]</strong>
        <strong style="margin-left:6px">${a.ticker}</strong>
        <span style="color:#888;font-size:12px;margin-left:6px">${a.type.replace(/_/g,' ')}</span>
      </div>
    </div>
    <div style="font-size:13px;color:#444;margin-top:4px">${a.detail}</div>
    <div style="font-size:12px;color:#2980b9;margin-top:3px">→ ${a.action}</div>
  </div>`).join('')}
</div>` : ''}

<!-- Portfolio Summary Table -->
<h2>Portfolio Holdings</h2>
<div style="overflow-x:auto;margin-bottom:12px">
<table>
  <thead><tr>
    <th>Ticker</th><th>Name</th><th>Shares</th><th>Avg Cost</th>
    <th>Price</th><th>P&L%</th><th>P&L PKR</th>
    <th>Signal</th><th>Buy At</th><th>Target 1</th><th>Stop Loss</th>
    <th>Score</th><th>AI</th>
  </tr></thead>
  <tbody>
  ${portfolioRecs.map(r => {
    const ai = aiReview.portfolioReview.find(x=>x.ticker===r.ticker);
    const pos = r.position;
    const plColor = (pos?.unrealisedPlPct ?? 0) >= 0 ? '#0a6e3c' : '#c0392b';
    return `<tr>
      <td><strong>${r.ticker}</strong></td>
      <td style="font-size:12px;color:#555">${r.name}</td>
      <td>${pos?.shares.toLocaleString() ?? '—'}</td>
      <td>${pos ? `PKR ${pos.avgCost}` : '—'}</td>
      <td><strong>PKR ${r.currentPrice}</strong></td>
      <td style="color:${plColor}">${pos ? formatPct(pos.unrealisedPlPct) : '—'}</td>
      <td style="color:${plColor}">${pos ? formatPkr(pos.unrealisedPlPkr) : '—'}</td>
      <td>${badge(r.signal)}</td>
      <td style="font-size:12px">PKR ${r.priceTargets.aggressiveBuyAt}</td>
      <td style="font-size:12px;color:#2d8a4e">PKR ${r.priceTargets.target1}</td>
      <td style="font-size:12px;color:#c0392b">PKR ${r.priceTargets.stopLoss}</td>
      <td>${scoreBar(r.compositeScore.composite)}</td>
      <td style="font-size:12px">${ai?.confidence ?? '—'}</td>
    </tr>`;
  }).join('')}
  </tbody>
</table>
</div>

<!-- Sector Concentration -->
<h2>Sector Concentration</h2>
<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:24px">
${Object.entries(sectorConcentration).sort(([,a],[,b])=>b-a).map(([s,p])=>{
  const c=p>35?'#c0392b':p>25?'#e67e22':'#2d8a4e';
  return `<div style="min-width:160px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
      <span>${s}</span><strong style="color:${c}">${p}%</strong>
    </div>
    <div style="height:8px;background:#eee;border-radius:4px">
      <div style="width:${Math.min(100,p)}%;height:8px;background:${c};border-radius:4px"></div>
    </div>
  </div>`;}).join('')}
</div>
${aiReview.concentrationRisks.length?`<div style="font-size:12px;color:#c0392b;margin-bottom:4px">${aiReview.concentrationRisks.map(r=>`⚠ ${r}`).join('<br>')}</div>`:''}

<!-- Detailed Portfolio Analysis -->
<h2>Detailed Portfolio Analysis</h2>
${portfolioRecs.map(r => stockCard(r, aiReview, true)).join('')}

<!-- Discovery Picks -->
${discoveryPicks.length ? `
<h2>Discovery Picks — New Buy Candidates</h2>
${discoveryPicks.map(r => stockCard(r, aiReview, false)).join('')}` : ''}

<!-- Sector Outlook -->
${Object.keys(aiReview.sectorOutlook).length ? `
<h2>Sector Outlook (AI)</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
${Object.entries(aiReview.sectorOutlook).map(([s,v])=>`
  <div style="padding:12px 14px;background:#f9f9f9;border-radius:8px">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px">${s}</div>
    <div style="font-size:12px;color:#555;line-height:1.5">${v}</div>
  </div>`).join('')}
</div>` : ''}

<!-- Disclaimer -->
<div style="margin-top:32px;padding:14px;background:#f9f9f9;border-radius:8px;font-size:11px;color:#888;line-height:1.7">
  <strong>Disclaimer:</strong> This report is generated by an automated system for informational purposes only.
  It does not constitute financial advice. Always conduct your own due diligence before making investment decisions.
  Past performance does not guarantee future results. Investing in equities involves risk of capital loss.
  &nbsp;|&nbsp; Generated: ${dateStr} PKT &nbsp;|&nbsp; Run ID: ${output.runId}
</div>

</div></body></html>`;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function generatePdfReport(output: RunOutput): Promise<Buffer> {
  logger.info('Building PDF report');
  const html = buildHtml(output);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' },
    });
    logger.info({ bytes: pdfBuffer.length }, 'PDF generated');
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
