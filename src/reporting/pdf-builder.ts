/**
 * PDF Report Builder — PSX Analyzer v3
 *
 * A4 portrait, print-ready, two-section design:
 *
 *   PAGE 1  Cover + Market Overview + Portfolio Summary table
 *   PAGE 2+ Noob Cards  — one per holding/pick (large, colour-coded, plain English)
 *   PAGE 3+ Pro Panels  — full indicator grids, signal breakdown, fundamentals
 *
 * Uses Puppeteer (Chromium headless) for HTML → PDF.
 */
import puppeteer from 'puppeteer';
import { format } from 'date-fns';
import { round, formatPkr, formatPct, formatPkrCompact } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { RunOutput, StockRecommendation } from '../types';

// ─── Safe number formatters (never emit NaN in HTML) ──────────────────────────

function safeNum(v: unknown, decimals = 2): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (isNaN(n) || !isFinite(n)) return '—';
  return n.toFixed(decimals);
}

function safePkr(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (isNaN(n) || !isFinite(n)) return '—';
  // Use compact for large values, full for small
  if (Math.abs(n) >= 1_000_000) return `₨${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `₨${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
  return `₨${n.toFixed(2)}`;
}

function safePct(v: unknown, decimals = 1): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (isNaN(n) || !isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function safePrice(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (isNaN(n) || !isFinite(n) || n <= 0) return '—';
  return `₨${n.toFixed(2)}`;
}

// ─── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  strongBuy:  { bg:'#e6f9ef', border:'#0a6e3c', text:'#0a6e3c', badge:'#0a6e3c' },
  buy:        { bg:'#f0fdf4', border:'#1a8a50', text:'#1a8a50', badge:'#1a8a50' },
  hold:       { bg:'#fffbe6', border:'#b08000', text:'#b08000', badge:'#b08000' },
  sell:       { bg:'#fff1ee', border:'#b83232', text:'#b83232', badge:'#b83232' },
  strongSell: { bg:'#fde8e8', border:'#7a0a0a', text:'#7a0a0a', badge:'#7a0a0a' },
};
function sigColors(s: string) {
  return C[s === 'STRONG_BUY' ? 'strongBuy' : s === 'BUY' ? 'buy' : s === 'HOLD' ? 'hold' : s === 'SELL' ? 'sell' : 'strongSell'] ?? C.hold;
}
const SEV = { CRITICAL:'#b83232', WARNING:'#c97a00', INFO:'#1a6fb5' };
const STANCE = { bullish:'#0a6e3c', bearish:'#b83232', neutral:'#555', cautious:'#c97a00' };

function plC(v: number) { return v >= 0 ? '#0a6e3c' : '#b83232'; }

// ─── Micro components ──────────────────────────────────────────────────────────

function chip(label: string): string {
  return `<span style="display:inline-block;background:#f0f0f0;color:#555;font-size:10px;padding:1px 7px;border-radius:10px;margin:1px">${label}</span>`;
}

function badge(signal: string, large = false): string {
  const c = sigColors(signal);
  const sz = large ? 'font-size:14px;padding:5px 16px' : 'font-size:11px;padding:2px 9px';
  return `<span style="background:${c.badge};color:#fff;${sz};border-radius:4px;font-weight:700;white-space:nowrap;letter-spacing:.3px">${signal.replace('_',' ')}</span>`;
}

function progressBar(value: number, label: string, width = '100%'): string {
  const color = value >= 72 ? '#0a6e3c' : value >= 52 ? '#b08000' : '#b83232';
  return `
  <div style="margin:3px 0">
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;margin-bottom:2px">
      <span>${label}</span><span style="font-weight:700;color:${color}">${value}</span>
    </div>
    <div style="height:5px;background:#eee;border-radius:3px;width:${width}">
      <div style="height:5px;width:${Math.min(100,value)}%;background:${color};border-radius:3px"></div>
    </div>
  </div>`;
}

function kv(label: string, value: string | number, color?: string): string {
  return `
  <div style="background:#f8f8f8;border-radius:5px;padding:6px 9px;min-width:95px;flex:0 0 auto">
    <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px">${label}</div>
    <div style="font-weight:700;font-size:12px;color:${color ?? '#1a1a1a'}">${value}</div>
  </div>`;
}

function priceBox(label: string, value: string, sub: string, color: string, accent: string): string {
  return `
  <div style="background:${color};border:1.5px solid ${accent};border-radius:8px;padding:10px 12px;text-align:center;min-width:120px;flex:1">
    <div style="font-size:9px;color:${accent};text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">${label}</div>
    <div style="font-size:18px;font-weight:800;color:${accent}">${value}</div>
    <div style="font-size:10px;color:${accent};opacity:.75;margin-top:2px">${sub}</div>
  </div>`;
}

function donut(score: number, grade: string): string {
  const color = score >= 72 ? '#0a6e3c' : score >= 52 ? '#b08000' : '#b83232';
  const deg   = score * 3.6;
  return `
  <div style="display:flex;flex-direction:column;align-items:center;min-width:58px">
    <div style="width:52px;height:52px;border-radius:50%;background:conic-gradient(${color} ${deg}deg,#e8e8e8 0);display:flex;align-items:center;justify-content:center">
      <div style="width:38px;height:38px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:${color}">${score}</div>
    </div>
    <div style="font-size:10px;font-weight:700;color:${color};margin-top:2px">Grade ${grade}</div>
  </div>`;
}

// ─── Noob Card ─────────────────────────────────────────────────────────────────
// WHAT A BEGINNER NEEDS: verdict, plain-English reason, 4 price boxes

function noobCard(rec: StockRecommendation, aiReview: RunOutput['aiReview']): string {
  const ai  = aiReview.portfolioReview.find(r => r.ticker === rec.ticker)
           ?? aiReview.discoveryReview.find(r => r.ticker === rec.ticker);
  const sig = ai?.finalSignal ?? rec.signal;
  const c   = sigColors(sig);
  const pos = rec.position;
  const pt  = rec.priceTargets;

  // Extract noob / pro from AI reasoning
  const raw   = ai?.reasoning ?? '';
  const noob  = raw.match(/NOOB:\s*([^]*?)(?=PRO:|$)/i)?.[1]?.trim() ?? raw.split('.')[0] + '.';
  const pro   = raw.match(/PRO:\s*([^]+)/i)?.[1]?.trim() ?? '';

  const ACTION: Record<string, string> = {
    STRONG_BUY:'🟢 BUY NOW — Strong opportunity', BUY:'🟢 BUY — Good entry here',
    HOLD:'🟡 HOLD — Keep your position',
    SELL:'🔴 SELL — Time to exit', STRONG_SELL:'🔴 SELL IMMEDIATELY',
  };

  return `
<div style="border:2px solid ${c.border};border-radius:10px;padding:18px 20px;margin:10px 0;background:${c.bg};page-break-inside:avoid">

  <!-- Header row -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:14px">
    <div style="flex:1">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:22px;font-weight:900;color:#111">${rec.ticker}</span>
        <span style="font-size:13px;color:#444">${rec.name}</span>
        ${chip(rec.sector)}
        ${rec.shariah ? '<span style="background:#e8f5e9;color:#2d6a4f;font-size:10px;padding:1px 7px;border-radius:10px">☽ Shariah</span>' : ''}
        ${rec.flags.includes('AI_OVERRIDE') ? '<span style="background:#fff3cd;color:#856404;font-size:10px;padding:1px 7px;border-radius:10px">🔄 AI Override</span>' : ''}
        ${rec.flags.includes('AI_CAUTION') ? '<span style="background:#fff3cd;color:#856404;font-size:10px;padding:1px 7px;border-radius:10px">⚠ AI Caution</span>' : ''}
      </div>
      <div style="font-size:20px;font-weight:800;color:${c.text}">${ACTION[sig] ?? sig}</div>
    </div>
    ${donut(rec.compositeScore.composite, rec.compositeScore.grade)}
  </div>

  <!-- Price boxes -->
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
    ${priceBox('Current Price', `${safePrice(rec.currentPrice)}`, `${rec.dayChangePct >= 0 ? '▲' : '▼'} ${safePct(rec.dayChangePct)} today`, '#fff', '#444')}
    ${priceBox('Buy at or below', `${safePrice(pt.aggressiveBuyAt)}`, 'Aggressive entry', '#f0fdf4', '#0a6e3c')}
    ${priceBox('Take profit at', `${safePrice(pt.target1)}`, `${safeNum(pt.potentialUpsidePct)}% upside`, '#f0fdf4', '#1a8a50')}
    ${priceBox('Exit if falls to', `${safePrice(pt.stopLoss)}`, `${safeNum(pt.potentialDownsidePct)}% stop`, '#fff1ee', '#b83232')}
    ${pos
      ? priceBox('Your P&L', safePct(pos.unrealisedPlPct), safePkr(pos.unrealisedPlPkr), pos.unrealisedPlPct >= 0 ? '#f0fdf4' : '#fff1ee', plC(pos.unrealisedPlPct))
      : ''}
  </div>

  <!-- Context label -->
  <div style="font-size:11px;color:${c.text};background:rgba(255,255,255,0.6);border-radius:5px;padding:6px 10px;margin-bottom:10px">
    📍 ${pt.currentVsTargetLabel}
  </div>

  <!-- Plain-English explanation -->
  <div style="font-size:13px;color:#222;line-height:1.7;background:rgba(255,255,255,0.7);border-radius:6px;padding:10px 12px;margin-bottom:${pro ? '8px' : '0'}">
    ${noob}
  </div>

  ${pro ? `
  <div style="font-size:11px;color:#444;background:rgba(0,0,0,0.04);border-left:3px solid ${c.border};border-radius:0 6px 6px 0;padding:8px 12px">
    <strong style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:.3px">Analyst:</strong>
    ${pro}
  </div>` : ''}

  <!-- AI price views -->
  ${ai && (ai.buyPriceView || ai.sellPriceView || ai.stopLossView) ? `
  <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:#555">
    ${ai.buyPriceView  ? `<span>🤖 AI Buy: <strong>PKR ${ai.buyPriceView}</strong></span>` : ''}
    ${ai.sellPriceView ? `<span>🤖 Sell: <strong>PKR ${ai.sellPriceView}</strong></span>` : ''}
    ${ai.stopLossView  ? `<span>🤖 Stop: <strong>PKR ${ai.stopLossView}</strong></span>` : ''}
  </div>` : ''}

  <!-- Replacement suggestion -->
  ${rec.suggestedReplacement ? `
  <div style="margin-top:8px;padding:8px 12px;background:rgba(255,248,225,0.9);border-radius:6px;font-size:12px;color:#7a5000">
    💡 If selling ${rec.ticker}, consider switching to <strong>${rec.suggestedReplacement}</strong> (currently your highest-rated holding)
  </div>` : ''}

  <!-- Risk / Catalyst pills -->
  ${(ai?.keyRisks?.length ?? 0) > 0 ? `
  <div style="margin-top:6px;font-size:11px;color:#b83232">⚠ Risks: ${ai!.keyRisks.join(' · ')}</div>` : ''}
  ${(ai?.keyCatalysts?.length ?? 0) > 0 ? `
  <div style="margin-top:3px;font-size:11px;color:#0a6e3c">✅ Catalysts: ${ai!.keyCatalysts.join(' · ')}</div>` : ''}

  ${pos ? `
  <div style="margin-top:8px;font-size:11px;color:#888">
    Holding: ${pos.shares.toLocaleString()} shares · Avg cost: PKR ${pos.avgCost} · Weight: ${round(pos.portfolioWeightPct, 1)}%
  </div>` : ''}
</div>`;
}

// ─── Pro Panel ─────────────────────────────────────────────────────────────────
// WHAT AN ANALYST NEEDS: all indicators, signal breakdown, full fundamentals

function proPanel(rec: StockRecommendation): string {
  const ti = rec.technicals;
  const f  = rec.fundamentals;
  const pt = rec.priceTargets;
  const sig = rec.signal;
  const c   = sigColors(sig);

  const indRow = (items: [string, string | number, string?][]) =>
    items.map(([l, v, col]) => kv(l, v, col)).join('');

  const rsiCol  = ti.rsi14 < 30 ? '#0a6e3c' : ti.rsi14 > 70 ? '#b83232' : '#1a1a1a';
  const adxCol  = ti.adx14 > 25 ? '#0a6e3c' : '#b08000';
  const cmfCol  = ti.chaikinMoneyFlow > 0.1 ? '#0a6e3c' : ti.chaikinMoneyFlow < -0.1 ? '#b83232' : '#1a1a1a';
  const obvCol  = ti.obvTrend === 'accumulation' ? '#0a6e3c' : ti.obvTrend === 'distribution' ? '#b83232' : '#1a1a1a';

  return `
<div style="border:1px solid #e0e0e0;border-radius:10px;padding:16px 18px;margin:6px 0 14px;background:#fff;page-break-inside:avoid">

  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <span style="font-size:15px;font-weight:800;color:#111">${rec.ticker}</span>
    ${badge(sig)}
    <span style="font-size:11px;color:#888;flex:1">${rec.signalLabel}</span>
    <span style="font-size:11px;color:#888">Conviction: <strong style="color:${rec.signalResult.convictionScore >= 0 ? '#0a6e3c' : '#b83232'}">${rec.signalResult.convictionScore.toFixed(1)}</strong></span>
  </div>

  <!-- Score breakdown -->
  <div style="margin-bottom:14px;max-width:350px">
    ${progressBar(Math.round(rec.compositeScore.technical || 0),   'Technical'  )}
    ${progressBar(Math.round(rec.compositeScore.fundamental || 0), 'Fundamental')}
    ${progressBar(Math.round(rec.compositeScore.macro        || 0), 'Macro'      )}
    ${progressBar(Math.round(rec.compositeScore.sentiment    || 0), 'Sentiment'  )}
    <div style="font-size:10px;color:#666;margin-top:4px;font-style:italic">${rec.compositeScore.interpretation}</div>
  </div>

  <!-- Price Levels -->
  <div style="background:#f0fdf4;border-left:3px solid #0a6e3c;padding:10px 14px;border-radius:0 7px 7px 0;margin-bottom:14px;font-size:11px">
    <div style="font-weight:700;color:#0a6e3c;font-size:12px;margin-bottom:6px">ACTION LEVELS</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      ${[
        ['Aggr. Buy ↓',  `${safePrice(pt.aggressiveBuyAt)}`,   '#0a6e3c'],
        ['Consv. Buy ↓', `${safePrice(pt.conservativeBuyAt)}`,  '#1a8a50'],
        ['Target 1 ↑',   `${safePrice(pt.target1)}  +${safeNum(pt.potentialUpsidePct,1)}%`, '#0a6e3c'],
        ['Target 2 ↑',   `${safePrice(pt.target2)}`,            '#1a8a50'],
        ['Target 3 ↑',   `${safePrice(pt.target3)}`,            '#555'  ],
        ['Stop Loss ↓',  `${safePrice(pt.stopLoss)}  -${safeNum(pt.potentialDownsidePct,1)}%`, '#b83232'],
        ['Hard Stop ↓',  `${safePrice(pt.hardStopLoss)}`,       '#7a0a0a'],
        ['R/R Ratio',    `${pt.riskRewardRatio}:1`,       pt.riskRewardRatio >= 2 ? '#0a6e3c' : '#b08000'],
        ['Fib 61.8%',    `${safePrice(ti.fibRetracement618)}`, '#555'],
        ['Pivot',        `${safePrice(ti.pivot)}`,   '#555'],
      ].map(([l,v,col]) => `<span style="white-space:nowrap;font-size:11px"><span style="color:#888">${l}:</span> <strong style="color:${col ?? '#1a1a1a'}">${v}</strong></span>`).join('')}
    </div>
    <div style="margin-top:6px;color:${c.text};font-size:10px">📍 ${pt.currentVsTargetLabel}</div>
  </div>

  <!-- Indicator grid -->
  <div style="margin-bottom:14px">
    <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">TECHNICAL INDICATORS</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">
      ${indRow([
        ['RSI-14', safeNum(ti.rsi14, 1), rsiCol],
        ['RSI-9',  safeNum(ti.rsi9, 1)],
        ['RSI Div', ti.rsiDivergence !== 'none' ? ti.rsiDivergence : '—', ti.rsiDivergence==='bullish'?'#0a6e3c':ti.rsiDivergence==='bearish'?'#b83232':undefined],
        ['MACD', ti.macdSignal.replace(/_/g,' '), ti.macdSignal.includes('bullish')?'#0a6e3c':ti.macdSignal.includes('bearish')?'#b83232':undefined],
        ['Hist', safeNum(ti.macdHistogram, 3)],
        ['Stoch K/D', `${safeNum(ti.stochasticK, 0)}/${safeNum(ti.stochasticD, 0)}`],
        ['Will%R', safeNum(ti.williamsR, 0), ti.williamsR<-80?'#0a6e3c':ti.williamsR>-20?'#b83232':undefined],
        ['CCI-20', safeNum(ti.cci20, 0), ti.cci20<-100?'#0a6e3c':ti.cci20>100?'#b83232':undefined],
        ['MFI-14', safeNum(ti.mfi14, 0), ti.mfi14<20?'#0a6e3c':ti.mfi14>80?'#b83232':undefined],
        ['ROC-10', `${safeNum(ti.roc10, 1)}%`],
      ])}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px">
      ${indRow([
        ['ADX-14', `${safeNum(ti.adx14, 0)} ${ti.adx14>25?'✓':'~'}`, adxCol],
        ['+DI/-DI', `${safeNum(ti.diPlus, 0)}/${safeNum(ti.diMinus, 0)}`, ti.diPlus>ti.diMinus?'#0a6e3c':'#b83232'],
        ['Trend S/M/L', `${ti.trendShort}/${ti.trendMid}/${ti.trendLong}`],
        ['Consistency', `${ti.trendConsistency}%`, ti.trendConsistency>=66?'#0a6e3c':ti.trendConsistency<=33?'#b83232':'#b08000'],
        ['Golden/Death', ti.goldenCrossActive?'✅ Golden':ti.deathCrossActive?'❌ Death':'—', ti.goldenCrossActive?'#0a6e3c':ti.deathCrossActive?'#b83232':undefined],
        ['PSAR', ti.parabolicSarSignal, ti.parabolicSarSignal==='bullish'?'#0a6e3c':'#b83232'],
        ['Ichimoku', ti.ichimokuSignal.replace(/_/g,' '), ti.ichimokuSignal==='above_cloud'?'#0a6e3c':ti.ichimokuSignal==='below_cloud'?'#b83232':'#b08000'],
        ['BB Pos', ti.bbPosition.replace(/_/g,' ')],
        ['Squeeze', ti.bbSqueeze?'⚡ YES':'No', ti.bbSqueeze?'#b08000':undefined],
        ['Keltner', ti.keltnerPosition, ti.keltnerPosition==='below'?'#0a6e3c':ti.keltnerPosition==='above'?'#b83232':undefined],
      ])}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px">
      ${indRow([
        ['OBV', ti.obvTrend, obvCol],
        ['OBV Div', ti.obvDivergence!=='none'?ti.obvDivergence:'—', ti.obvDivergence==='bullish'?'#0a6e3c':ti.obvDivergence==='bearish'?'#b83232':undefined],
        ['CMF', safeNum(ti.chaikinMoneyFlow, 3), cmfCol],
        ['Vol Ratio', `${safeNum(ti.volumeRatio, 1)}×`, ti.volumeRatio>2?'#b08000':undefined],
        ['Vol Signal', ti.volumeSignal.replace(/_/g,' ')],
        ['ATR-14', `${safeNum(ti.atr14, 2)} (${safeNum(ti.atrPct, 1)}%)`],
        ['HV-30', `${safeNum(ti.historicalVolatility30d, 1)}%`],
        ['vs VWAP', `${safeNum(ti.priceVsVwapPct, 1)}%`, ti.priceVsVwapPct<-3?'#0a6e3c':ti.priceVsVwapPct>3?'#b83232':undefined],
        ['vs 52wH', `${safeNum(ti.priceVs52wHighPct, 1)}%`],
        ['Candle', ti.candlestickPattern.replace(/_/g,' ')],
      ])}
    </div>
  </div>

  <!-- Active signals -->
  <div style="margin-bottom:14px">
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      ${rec.signalResult.buySignals.length > 0 ? `
      <div style="flex:1;min-width:200px">
        <div style="font-size:10px;font-weight:700;color:#0a6e3c;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px">
          Bullish Signals (${rec.signalResult.buySignals.length})
        </div>
        ${rec.signalResult.buySignals.slice(0,6).map(s => `
          <div style="font-size:10px;color:#333;padding:2px 0;border-bottom:1px solid #f5f5f5;line-height:1.4">
            <span style="background:#e6f9ef;color:#0a6e3c;font-size:9px;padding:1px 5px;border-radius:2px;margin-right:4px;font-weight:600">${s.name}</span>${s.description.split('—')[1]?.trim() ?? s.description}
          </div>`).join('')}
      </div>` : ''}
      ${rec.signalResult.sellSignals.length > 0 ? `
      <div style="flex:1;min-width:200px">
        <div style="font-size:10px;font-weight:700;color:#b83232;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px">
          Bearish Signals (${rec.signalResult.sellSignals.length})
        </div>
        ${rec.signalResult.sellSignals.slice(0,6).map(s => `
          <div style="font-size:10px;color:#333;padding:2px 0;border-bottom:1px solid #f5f5f5;line-height:1.4">
            <span style="background:#fde8e8;color:#b83232;font-size:9px;padding:1px 5px;border-radius:2px;margin-right:4px;font-weight:600">${s.name}</span>${s.description.split('—')[1]?.trim() ?? s.description}
          </div>`).join('')}
      </div>` : ''}
    </div>
  </div>

  <!-- Fundamentals -->
  <div>
    <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">FUNDAMENTALS</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">
      ${indRow([
        ['P/E TTM',    `${safeNum(f.peRatioTtm)} / ${f.sectorAvgPe}`, f.peRatioTtm < f.sectorAvgPe*0.9 ? '#0a6e3c' : undefined],
        ['P/E Fwd',    safeNum(f.peRatioForward)],
        ['P/B',        safeNum(f.pbRatio), f.pbRatio<1?'#0a6e3c':undefined],
        ['EV/EBITDA',  safeNum(f.evEbitda)],
        ['EPS TTM',    `₨${safeNum(f.epsTtm)}`],
        ['EPS Grw',    `${safeNum(f.epsGrowthYoy, 1)}%`, f.epsGrowthYoy>15?'#0a6e3c':f.epsGrowthYoy<0?'#b83232':undefined],
        ['ROE',        `${safeNum(f.roeTtm, 1)}%`, f.roeTtm>20?'#0a6e3c':f.roeTtm<10?'#b83232':undefined],
        ['ROIC',       `${safeNum(f.roicTtm, 1)}%`],
        ['Net Margin', `${safeNum(f.netProfitMarginPct, 1)}%`],
        ['Rev Grw',    `${safeNum(f.revenueGrowthYoy, 1)}%`, f.revenueGrowthYoy>15?'#0a6e3c':undefined],
      ])}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px">
      ${indRow([
        ['Div Yield',  `${safeNum(f.dividendYieldPct, 1)}%`, f.dividendYieldPct>8?'#0a6e3c':undefined],
        ['Div/Share',  `₨${safeNum(f.dividendPerShare)}`],
        ['Div Payout', `${safeNum(f.dividendPayoutRatioPct, 0)}%`],
        ['Div Years',  f.consecutiveDividendYears, f.consecutiveDividendYears>=10?'#0a6e3c':undefined],
        ['D/E',        safeNum(f.debtToEquity, 2), f.debtToEquity>1.5?'#b83232':f.debtToEquity<0.3?'#0a6e3c':undefined],
        ['Curr Ratio', safeNum(f.currentRatio, 2), f.currentRatio<1?'#b83232':f.currentRatio>2?'#0a6e3c':undefined],
        ['Int Cover',  `${safeNum(f.interestCoverageRatio, 1)}×`, f.interestCoverageRatio<2?'#b83232':f.interestCoverageRatio>8?'#0a6e3c':undefined],
        ['ND/EBITDA',  safeNum(f.netDebtToEbitda, 2), f.netDebtToEbitda<0?'#0a6e3c':f.netDebtToEbitda>3?'#b83232':undefined],
        ['FCF Yield',  `${safeNum(f.freeCashFlowYield, 1)}%`, f.freeCashFlowYield>7?'#0a6e3c':undefined],
        ['Book/Sh',    `₨${safeNum(f.bookValuePerShare, 0)}`],
      ])}
    </div>
    ${f.upcomingDividendDate  ? `<div style="margin-top:5px;font-size:10px;color:#0a6e3c">📅 Dividend ex-date: <strong>${f.upcomingDividendDate}</strong></div>` : ''}
    ${f.upcomingEarningsDate  ? `<div style="margin-top:2px;font-size:10px;color:#1a6fb5">📅 Earnings: <strong>${f.upcomingEarningsDate}</strong></div>` : ''}
  </div>

</div>`;
}

// ─── Full HTML ─────────────────────────────────────────────────────────────────

function buildHtml(output: RunOutput): string {
  const {
    runAt, macro: m, portfolioRecs, discoveryPicks,
    alerts, sectorConcentration, aiReview,
    totalPortfolioValue, totalCostBasis,
    totalUnrealisedPl, totalUnrealisedPlPct,
    circuitBreakerActive, notifSubject,
  } = output;

  const dt      = format(runAt, 'EEEE, d MMMM yyyy — HH:mm');
  const crit    = alerts.filter(a => a.severity === 'CRITICAL');
  const warn    = alerts.filter(a => a.severity === 'WARNING');

  // Sort portfolio: CRITICAL alerts first, then by signal severity, then by score
  const sigOrder: Record<string,number> = { STRONG_SELL:0, SELL:1, STRONG_BUY:2, BUY:3, HOLD:4 };
  const sortedPort = [...portfolioRecs].sort((a, b) => {
    const aAlert = crit.some(x => x.ticker === a.ticker) ? -1 : 0;
    const bAlert = crit.some(x => x.ticker === b.ticker) ? -1 : 0;
    if (aAlert !== bAlert) return aAlert - bAlert;
    return (sigOrder[a.signal] ?? 5) - (sigOrder[b.signal] ?? 5);
  });

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#eef0f4;padding:16px}
    .page{max-width:960px;margin:0 auto;background:#fff;border-radius:10px;padding:28px 32px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
    h2{font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.6px;margin:26px 0 10px;padding-bottom:5px;border-bottom:1.5px solid #f0f0f0}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f5f5f5;padding:7px 9px;text-align:left;font-weight:600;font-size:10px;color:#777;border-bottom:1.5px solid #e5e5e5;text-transform:uppercase;letter-spacing:.3px}
    td{padding:8px 9px;border-bottom:1px solid #f2f2f2;vertical-align:middle}
    tr:hover td{background:#fafafa}
    @media print{.page{box-shadow:none;padding:20px}}
  `;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="page">

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  COVER                                                       ║
     ╚══════════════════════════════════════════════════════════════╝ -->
<div style="background:linear-gradient(135deg,#0d1b3e 0%,#173a6e 55%,#1e4fa0 100%);color:#fff;padding:26px 28px;border-radius:10px;margin-bottom:20px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-size:9px;opacity:.6;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Pakistan Stock Exchange</div>
      <div style="font-size:26px;font-weight:900;letter-spacing:-.5px">Portfolio Analysis</div>
      <div style="font-size:12px;opacity:.65;margin-top:4px">${dt} PKT &nbsp;·&nbsp; ${output.config.shariahMode} mode &nbsp;·&nbsp; AI: ${output.config.aiModel.toUpperCase()}</div>
      ${notifSubject ? `<div style="font-size:11px;opacity:.5;margin-top:2px">${notifSubject}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div style="font-size:28px;font-weight:900">${safePkr(totalPortfolioValue)}</div>
      <div style="font-size:12px;opacity:.7">Portfolio Value</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px;color:${totalUnrealisedPl>=0?'#7fe8b0':'#f99'}">${safePct(totalUnrealisedPlPct)} &nbsp;<span style="font-size:13px">(${safePkr(totalUnrealisedPl)})</span></div>
      <div style="font-size:11px;opacity:.6">Unrealised P&L</div>
    </div>
  </div>

  <!-- Macro strip -->
  <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.15)">
    ${[
      ['KSE-100', `${m.kse100Level.toLocaleString()}`, `${m.kse100ChangePct>=0?'▲':'▼'} ${safePct(m.kse100ChangePct)}`],
      ['PKR/USD', m.pkrUsdOfficial, m.pkrTrend],
      ['SBP Rate', `${m.sbpPolicyRate}%`, m.sbpRateTrend],
      ['CPI', `${m.pakistanCpi}%`, ''],
      ['Brent', `$${m.brentCrude}`, ''],
      ['FPI/wk', `${m.fpiWeeklyMillion}M`, m.fpiDirection],
      ['KSE YTD', safePct(m.kse100Ytd), ''],
    ].map(([l,v,s]) => `<div>
      <div style="font-size:9px;opacity:.5;margin-bottom:2px">${l}</div>
      <div style="font-size:14px;font-weight:700">${v}</div>
      ${s?`<div style="font-size:9px;opacity:.5">${s}</div>`:''}
    </div>`).join('')}
  </div>
</div>

${circuitBreakerActive ? `
<div style="background:#fff3cd;border:1.5px solid #e0a800;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600;color:#664d00">
  ⚠️ CIRCUIT BREAKER — KSE-100 is down ${Math.abs(m.kse100ChangePct)}% today. All BUY signals are paused.
</div>` : ''}

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  AI MARKET VIEW                                              ║
     ╚══════════════════════════════════════════════════════════════╝ -->
<h2>AI Market Assessment</h2>
<div style="display:flex;gap:18px;padding:14px;background:#f9f9ff;border-radius:8px;margin-bottom:18px;flex-wrap:wrap">
  <div style="text-align:center;min-width:80px">
    <div style="font-size:10px;color:#999;margin-bottom:3px">Stance</div>
    <div style="font-size:18px;font-weight:900;color:${STANCE[aiReview.marketStance]??'#555'};text-transform:uppercase">${aiReview.marketStance}</div>
    <div style="font-size:10px;color:#999;margin-top:3px">AI: ${aiReview.algorithmScore}/10</div>
  </div>
  <div style="flex:1;min-width:200px">
    <div style="font-size:13px;line-height:1.7;color:#333">${aiReview.marketSummary}</div>
    ${aiReview.keyMarketDrivers.length?`<div style="margin-top:6px;font-size:11px;color:#555"><strong>Drivers:</strong> ${aiReview.keyMarketDrivers.join(' · ')}</div>`:''}
    ${aiReview.globalRiskFlags.length?`<div style="margin-top:4px;font-size:11px;color:#b83232">⚠ ${aiReview.globalRiskFlags.join(' · ')}</div>`:''}
    ${aiReview.macroOpportunities?.length?`<div style="margin-top:4px;font-size:11px;color:#0a6e3c">✅ ${aiReview.macroOpportunities.join(' · ')}</div>`:''}
    <div style="font-size:10px;color:#999;margin-top:4px;font-style:italic">${aiReview.algorithmFeedback}</div>
  </div>
</div>

<!-- IMF strip -->
<div style="padding:8px 12px;background:#f5f5f5;border-radius:6px;font-size:11px;color:#555;margin-bottom:16px">
  🏦 <strong>IMF:</strong> ${m.imfStatus}
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  CRITICAL ALERTS                                             ║
     ╚══════════════════════════════════════════════════════════════╝ -->
${crit.length > 0 ? `
<h2>🚨 Critical Alerts (${crit.length})</h2>
${crit.map(a => `
<div style="padding:10px 14px;margin:5px 0;border-left:4px solid ${SEV[a.severity]};background:#fafafa;border-radius:0 7px 7px 0">
  <div style="font-weight:700;color:${SEV[a.severity]}">${a.ticker} — ${a.type.replace(/_/g,' ')}</div>
  <div style="font-size:12px;color:#444;margin-top:2px">${a.detail}</div>
  <div style="font-size:11px;color:#1a6fb5;margin-top:3px;font-weight:600">→ ${a.action}</div>
</div>`).join('')}` : ''}

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  PORTFOLIO SUMMARY TABLE                                     ║
     ╚══════════════════════════════════════════════════════════════╝ -->
<h2>Portfolio at a Glance</h2>
<div style="overflow-x:auto;margin-bottom:18px">
<table>
  <thead><tr>
    <th>Ticker</th><th>Name</th><th>Shares</th><th>Avg Cost</th>
    <th>Price</th><th>Day</th><th>P&L%</th><th>P&L PKR</th>
    <th>Signal</th><th>Buy≤</th><th>Target 1</th><th>Stop</th><th>Score</th>
  </tr></thead>
  <tbody>
  ${sortedPort.map(r => {
    const p    = r.position;
    const hasCrit = crit.some(a => a.ticker === r.ticker);
    return `<tr style="${hasCrit?'background:#fff5f5':''}">
      <td><strong>${r.ticker}</strong>${hasCrit?' 🚨':''}</td>
      <td style="color:#555;font-size:11px">${r.name}</td>
      <td style="text-align:right">${p?.shares.toLocaleString()??'—'}</td>
      <td style="text-align:right">${p?safePrice(p.avgCost):'—'}</td>
      <td style="text-align:right"><strong>${safePrice(r.currentPrice)}</strong></td>
      <td style="text-align:right;color:${plC(r.dayChangePct)};font-size:11px">${safePct(r.dayChangePct)}</td>
      <td style="text-align:right;color:${plC(p?.unrealisedPlPct??0)};font-weight:600">${p?safePct(p.unrealisedPlPct):'—'}</td>
      <td style="text-align:right;color:${plC(p?.unrealisedPlPkr??0)}">${p?safePkr(p.unrealisedPlPkr):'—'}</td>
      <td>${badge(r.signal)}</td>
      <td style="color:#0a6e3c;font-weight:600;white-space:nowrap">${safePrice(r.priceTargets.aggressiveBuyAt)}</td>
      <td style="color:#1a8a50;white-space:nowrap">${safePrice(r.priceTargets.target1)}</td>
      <td style="color:#b83232;white-space:nowrap">${safePrice(r.priceTargets.stopLoss)}</td>
      <td style="min-width:80px">${progressBar(r.compositeScore.composite,'','80px')}</td>
    </tr>`;
  }).join('')}
  </tbody>
</table>
</div>

<!-- Sector concentration -->
<h2>Sector Concentration</h2>
<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px">
${Object.entries(sectorConcentration).sort(([,a],[,b])=>b-a).map(([s,p])=>{
  const col = p>35?'#b83232':p>25?'#c97a00':'#0a6e3c';
  return `<div style="min-width:140px">
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span>${s}</span><strong style="color:${col}">${p}%</strong></div>
    <div style="height:7px;background:#eee;border-radius:4px"><div style="height:7px;width:${Math.min(100,p)}%;background:${col};border-radius:4px"></div></div>
  </div>`;}).join('')}
</div>
${aiReview.concentrationRisks?.length?`<div style="font-size:11px;color:#b83232;margin-bottom:6px">${aiReview.concentrationRisks.map(r=>`⚠ ${r}`).join('<br>')}</div>`:''}

<!-- All alerts summary -->
${alerts.length > 0 ? `
<h2>All Active Alerts (${alerts.length})</h2>
${alerts.map(a=>`
<div style="padding:8px 12px;margin:4px 0;border-left:3px solid ${SEV[a.severity]};background:#fafafa;border-radius:0 6px 6px 0;font-size:12px">
  <span style="font-weight:700;color:${SEV[a.severity]}">[${a.severity}]</span>
  <strong style="margin:0 6px">${a.ticker}</strong><span style="color:#888">${a.type.replace(/_/g,' ')}</span>
  <div style="color:#444;margin-top:2px">${a.detail}</div>
  <div style="color:#1a6fb5;margin-top:2px">→ ${a.action}</div>
</div>`).join('')}` : ''}

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  NOOB SECTION — Plain English per stock                      ║
     ╚══════════════════════════════════════════════════════════════╝ -->
<h2>📖 What Should You Do? (Plain English)</h2>
<p style="font-size:11px;color:#888;margin-bottom:12px">Each card tells you exactly what to do, at what price to buy, where to take profit, and when to exit. No jargon.</p>
${sortedPort.map(r => noobCard(r, aiReview)).join('')}

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  PRO SECTION — Full technical + fundamental breakdown        ║
     ╚══════════════════════════════════════════════════════════════╝ -->
<h2>🔬 Professional Technical & Fundamental Analysis</h2>
${sortedPort.map(r => proPanel(r)).join('')}

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  DISCOVERY PICKS                                             ║
     ╚══════════════════════════════════════════════════════════════╝ -->
${discoveryPicks.length > 0 ? `
<h2>🔍 New Buy Candidates (Outside Your Portfolio)</h2>
<p style="font-size:11px;color:#888;margin-bottom:12px">Stocks not in your portfolio that the algorithm and AI both rate as Buy opportunities.</p>
${discoveryPicks.map(r => noobCard(r, aiReview)).join('')}
${discoveryPicks.map(r => proPanel(r)).join('')}` : ''}

<!-- ╔══════════════════════════════════════════════════════════════╗
     ║  SECTOR OUTLOOK                                              ║
     ╚══════════════════════════════════════════════════════════════╝ -->
${Object.keys(aiReview.sectorOutlook??{}).length>0?`
<h2>Sector Outlook</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">
${Object.entries(aiReview.sectorOutlook).map(([s,v])=>`
  <div style="padding:10px 12px;background:#f9f9f9;border-radius:7px">
    <div style="font-weight:700;font-size:12px;margin-bottom:3px">${s}</div>
    <div style="font-size:11px;color:#555;line-height:1.5">${v}</div>
  </div>`).join('')}
</div>`:''}

<!-- Disclaimer -->
<div style="margin-top:28px;padding:12px;background:#f5f5f5;border-radius:7px;font-size:10px;color:#999;line-height:1.7">
  <strong>Disclaimer:</strong> This report is for informational purposes only and does not constitute financial advice. Always conduct your own due diligence. Past performance does not guarantee future results. Investing involves risk of capital loss. &nbsp;|&nbsp; ${dt} PKT &nbsp;|&nbsp; Run ${output.runId.slice(0,8)}
</div>

</div></body></html>`;
}

// ─── Export ────────────────────────────────────────────────────────────────────

export async function generatePdfReport(output: RunOutput): Promise<Buffer> {
  logger.info('Building PDF report');
  const html = buildHtml(output);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top:'12mm', bottom:'12mm', left:'10mm', right:'10mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;color:#aaa;width:100%;text-align:right;padding-right:15mm">PSX Analysis ${format(output.runAt,'d MMM yyyy')}</div>`,
      footerTemplate: `<div style="font-size:8px;color:#aaa;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });
    const buf = Buffer.from(pdf);
    logger.info({ kb: Math.round(buf.length/1024) }, 'PDF generated');
    return buf;
  } finally {
    await browser.close();
  }
}
