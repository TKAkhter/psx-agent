import { round } from '../utils/helpers';
import type { RunOutput } from '../types';

export const SYSTEM_PROMPT = `You are a senior investment analyst and portfolio advisor for the Pakistan Stock Exchange (PSX).
You have deep expertise in: Pakistani macro-economics, SBP monetary policy cycles, PKR/USD dynamics,
IMF programme conditions, commodity impacts on Pakistan industries (oil, gas, fertiliser, cement, banking),
and Shariah-compliant investing per AAOIFI standards. You understand both fundamental and technical analysis deeply.

Your job is to validate a quantitative analysis report, add Pakistan-specific context, and give clear buy/sell/hold
guidance including EXACT prices at which to act — guidance that works for both a novice investor and a professional analyst.

For SELL recommendations: always suggest which stock to buy instead (preferring stocks already in the portfolio).

STRICT RULES:
- Respond ONLY in valid JSON matching the schema below — zero text before/after
- All prices in PKR
- reasoning: max 4 sentences, plain language, no jargon where possible
- Always specify exact buy/sell/stop prices in your ai views
- Set run_id to the run_id from the prompt

RESPONSE SCHEMA:
{
  "run_id": "string",
  "timestamp": "ISO8601",
  "market_stance": "bullish|bearish|neutral|cautious",
  "market_summary": "3-sentence PSX overview using current macro data",
  "key_market_drivers": ["string"],
  "portfolio_review": [
    {
      "ticker": "string",
      "name": "string",
      "algorithm_signal": "HOLD",
      "algorithm_score": 58,
      "ai_validation": "AGREE|PARTIALLY_AGREE|DISAGREE",
      "final_signal": "HOLD",
      "confidence": "High|Medium|Low",
      "reasoning": "Plain English — what should I do and why?",
      "key_risks": ["string"],
      "key_catalysts": ["string"],
      "buy_price_view": null,
      "sell_price_view": null,
      "stop_loss_view": null,
      "shariah_note": null,
      "suggested_replacement": null
    }
  ],
  "discovery_review": [
    {
      "ticker": "string",
      "name": "string",
      "algorithm_signal": "BUY",
      "algorithm_score": 72,
      "ai_validation": "AGREE",
      "final_signal": "BUY",
      "confidence": "Medium",
      "reasoning": "string",
      "key_risks": [],
      "key_catalysts": [],
      "buy_price_view": null,
      "sell_price_view": null,
      "stop_loss_view": null,
      "shariah_note": null,
      "suggested_replacement": null
    }
  ],
  "sector_outlook": {
    "Banking": "string",
    "Oil & Gas": "string",
    "Energy": "string",
    "Fertilizer": "string",
    "Cement": "string",
    "Technology": "string",
    "Conglomerate": "string"
  },
  "concentration_risks": ["string"],
  "macro_risks": ["string"],
  "macro_opportunities": ["string"],
  "algorithm_score": 7,
  "algorithm_feedback": "What is accurate vs what might be misleading in the algorithm output?",
  "global_risk_flags": ["string"],
  "notification_headline": "max 120 chars",
  "email_subject": "string"
}`.trim();

export function buildPrompt(output: RunOutput): string {
  const { runId, runAt, macro: m, portfolioRecs, discoveryPicks, alerts, sectorConcentration, circuitBreakerActive, config } = output;

  const portJson = portfolioRecs.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector, shariah: r.shariah,
    shares: r.position?.shares, avg_cost: r.position?.avgCost,
    current_price: r.currentPrice, day_change_pct: r.dayChangePct,
    unrealised_pl_pkr: r.position ? round(r.position.unrealisedPlPkr) : null,
    unrealised_pl_pct: r.position ? round(r.position.unrealisedPlPct) : null,
    portfolio_weight_pct: r.position ? round(r.position.portfolioWeightPct) : null,
    technicals: {
      rsi_14: round(r.technicals.rsi14), rsi_9: round(r.technicals.rsi9),
      rsi_divergence: r.technicals.rsiDivergence,
      macd_signal: r.technicals.macdSignal,
      macd_histogram: round(r.technicals.macdHistogram),
      stoch_k: round(r.technicals.stochasticK), stoch_d: round(r.technicals.stochasticD),
      williams_r: round(r.technicals.williamsR),
      cci_20: round(r.technicals.cci20), mfi_14: round(r.technicals.mfi14),
      adx_14: round(r.technicals.adx14), di_plus: round(r.technicals.diPlus), di_minus: round(r.technicals.diMinus),
      atr_14: round(r.technicals.atr14), atr_pct: round(r.technicals.atrPct),
      bb_position: r.technicals.bbPosition, bb_squeeze: r.technicals.bbSqueeze,
      obv_trend: r.technicals.obvTrend, cmf: round(r.technicals.chaikinMoneyFlow),
      volume_ratio: round(r.technicals.volumeRatio),
      ichimoku: r.technicals.ichimokuSignal,
      trend_short: r.technicals.trendShort, trend_mid: r.technicals.trendMid, trend_long: r.technicals.trendLong,
      candlestick: r.technicals.candlestickPattern,
      support1: r.technicals.support1, resistance1: r.technicals.resistance1,
      fib_618: r.technicals.fibRetracement618,
      conviction_score: round(r.signalResult.convictionScore),
      summary: r.signalResult.technicalSummary,
    },
    fundamentals: {
      pe_ttm: round(r.fundamentals.peRatioTtm), pe_forward: round(r.fundamentals.peRatioForward),
      sector_avg_pe: r.fundamentals.sectorAvgPe,
      pb_ratio: round(r.fundamentals.pbRatio), ev_ebitda: round(r.fundamentals.evEbitda),
      eps_ttm: round(r.fundamentals.epsTtm), eps_growth_yoy: round(r.fundamentals.epsGrowthYoy),
      roe: round(r.fundamentals.roeTtm), roic: round(r.fundamentals.roicTtm),
      net_margin: round(r.fundamentals.netProfitMarginPct),
      revenue_growth_yoy: round(r.fundamentals.revenueGrowthYoy),
      earnings_growth_yoy: round(r.fundamentals.earningsGrowthYoy),
      dividend_yield: round(r.fundamentals.dividendYieldPct),
      dividend_per_share: round(r.fundamentals.dividendPerShare),
      consecutive_div_years: r.fundamentals.consecutiveDividendYears,
      debt_to_equity: round(r.fundamentals.debtToEquity),
      interest_coverage: round(r.fundamentals.interestCoverageRatio),
      net_debt_to_ebitda: round(r.fundamentals.netDebtToEbitda),
      fcf_yield: round(r.fundamentals.freeCashFlowYield),
      upcoming_dividend: r.fundamentals.upcomingDividendDate ?? null,
      next_earnings: r.fundamentals.upcomingEarningsDate ?? null,
    },
    sentiment: { score: r.sentiment.score, articles: r.sentiment.articleCount, confidence: r.sentiment.confidence, catalysts: r.sentiment.recentCatalysts },
    algorithm: {
      composite_score: r.compositeScore.composite, grade: r.compositeScore.grade,
      score_breakdown: r.compositeScore, signal: r.signal, signal_label: r.signalLabel,
      aggressive_buy_at: r.priceTargets.aggressiveBuyAt, conservative_buy_at: r.priceTargets.conservativeBuyAt,
      target_1: r.priceTargets.target1, target_2: r.priceTargets.target2, target_3: r.priceTargets.target3,
      stop_loss: r.priceTargets.stopLoss, hard_stop: r.priceTargets.hardStopLoss,
      rr_ratio: r.priceTargets.riskRewardRatio,
      upside_pct: r.priceTargets.potentialUpsidePct, downside_pct: r.priceTargets.potentialDownsidePct,
      context: r.priceTargets.currentVsTargetLabel,
      suggested_shares: r.positionSizing.suggestedShares,
      flags: r.flags,
    },
  }));

  const discJson = discoveryPicks.slice(0,10).map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector, shariah: r.shariah,
    current_price: r.currentPrice,
    signal: r.signal, composite_score: r.compositeScore.composite, grade: r.compositeScore.grade,
    aggressive_buy_at: r.priceTargets.aggressiveBuyAt, target_1: r.priceTargets.target1,
    stop_loss: r.priceTargets.stopLoss, rr_ratio: r.priceTargets.riskRewardRatio,
    rsi_14: round(r.technicals.rsi14), adx: round(r.technicals.adx14),
    dividend_yield: round(r.fundamentals.dividendYieldPct), pe_ttm: round(r.fundamentals.peRatioTtm),
    summary: r.signalResult.technicalSummary,
  }));

  return `RUN_ID: ${runId}
DATE: ${runAt.toISOString()}
SHARIAH_MODE: ${config.shariahMode}
CIRCUIT_BREAKER_ACTIVE: ${circuitBreakerActive}

MACRO:
PKR/USD official=${m.pkrUsdOfficial} open=${m.pkrUsdOpen} trend=${m.pkrTrend}
SBP_RATE=${m.sbpPolicyRate}% trend=${m.sbpRateTrend}
KIBOR 1w=${m.kibor1w}% 1m=${m.kibor1m}% 3m=${m.kibor3m}%
CPI=${m.pakistanCpi}% core=${m.coreCpi}% GDP_growth=${m.gdpGrowthPct}%
FPI_weekly=PKR${m.fpiWeeklyMillion}M (${m.fpiDirection})
KSE100=${m.kse100Level} (day=${m.kse100ChangePct}% YTD=${m.kse100Ytd}%)
BRENT=$${m.brentCrude} UREA=$${m.ureaTonne}/t
IMF: ${m.imfStatus}

PORTFOLIO:
${JSON.stringify(portJson, null, 2)}

DISCOVERY_CANDIDATES:
${JSON.stringify(discJson, null, 2)}

SECTOR_CONCENTRATION_%:
${JSON.stringify(sectorConcentration, null, 2)}

ACTIVE_ALERTS:
${JSON.stringify(alerts.map(a=>({ticker:a.ticker,type:a.type,severity:a.severity,detail:a.detail,action:a.action})), null, 2)}`;
}
