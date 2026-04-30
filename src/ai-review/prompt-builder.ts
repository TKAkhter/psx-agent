import { round } from '../utils/helpers';
import type { RunOutput } from '../types';

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a senior investment analyst and portfolio advisor for the Pakistan Stock Exchange (PSX).
You have deep expertise in: Pakistani macroeconomics, SBP monetary policy cycles, PKR/USD dynamics,
IMF programme conditions, commodity price impacts on Pakistan industries (oil, gas, fertiliser, cement, banking),
and Shariah-compliant investing per AAOIFI standards.

You serve TWO audiences simultaneously — both need clear, actionable guidance:
1. NOVICE INVESTOR: Plain English, no jargon, clear "what to do" instruction
2. PROFESSIONAL ANALYST: Full technical context, indicator confluence, risk/reward ratios

For each stock you must provide:
- A plain English decision: BUY / SELL / HOLD and exactly WHY in one sentence
- Exact price levels: at what PKR price to buy, at what PKR price to sell/take profit, and stop-loss
- For SELL signals: which portfolio stock to buy INSTEAD (prefer existing holdings first)

KEY RULES:
- Respond ONLY with valid JSON matching the schema — zero text before or after
- All prices in PKR (Pakistani Rupee)
- reasoning field: first sentence for noob (what to do, why simply), second sentence for pro (key indicator confluence)
- Always specify exact buy/sell/stop prices — never leave them null unless truly no data
- Set run_id to the run_id value from the prompt
- Consider PSX-specific factors: dividend yield matters more here than most markets, high SBP rate = avoid high-debt companies

JSON SCHEMA (respond with this exact structure):
{
  "run_id": "string",
  "timestamp": "ISO8601",
  "market_stance": "bullish|bearish|neutral|cautious",
  "market_summary": "2 sentences: first for noob (simple market overview), second for pro (technical/macro context)",
  "key_market_drivers": ["string — each driver in plain English"],
  "portfolio_review": [
    {
      "ticker": "string",
      "name": "string",
      "algorithm_signal": "HOLD",
      "algorithm_score": 58,
      "ai_validation": "AGREE|PARTIALLY_AGREE|DISAGREE",
      "final_signal": "HOLD",
      "confidence": "High|Medium|Low",
      "reasoning": "NOOB: [one sentence, plain English action]. PRO: [key indicator confluence supporting this call].",
      "key_risks": ["plain English risk description"],
      "key_catalysts": ["plain English catalyst description"],
      "buy_price_view": 0.0,
      "sell_price_view": 0.0,
      "stop_loss_view": 0.0,
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
      "reasoning": "NOOB: [action + simple reason]. PRO: [indicator summary].",
      "key_risks": [],
      "key_catalysts": [],
      "buy_price_view": 0.0,
      "sell_price_view": 0.0,
      "stop_loss_view": 0.0,
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
  "macro_risks": ["plain English macro risk"],
  "macro_opportunities": ["plain English macro opportunity"],
  "algorithm_score": 7,
  "algorithm_feedback": "string",
  "global_risk_flags": ["string"],
  "notification_headline": "max 120 chars — suitable for WhatsApp first line",
  "email_subject": "string"
}`.trim();

// ─── User prompt builder ──────────────────────────────────────────────────────

export function buildPrompt(output: RunOutput): string {
  const {
    runId, runAt, macro: m,
    portfolioRecs, discoveryPicks,
    alerts, sectorConcentration,
    circuitBreakerActive, config,
  } = output;

  const portJson = portfolioRecs.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector, shariah: r.shariah,
    shares: r.position?.shares,
    avg_cost: r.position?.avgCost,
    current_price: r.currentPrice,
    day_change_pct: r.dayChangePct,
    unrealised_pl_pkr:  r.position ? round(r.position.unrealisedPlPkr) : null,
    unrealised_pl_pct:  r.position ? round(r.position.unrealisedPlPct) : null,
    portfolio_weight_pct: r.position ? round(r.position.portfolioWeightPct) : null,

    // ── Technical summary ──────────────────────────────────────────────────
    technicals: {
      // Momentum
      rsi_14:          round(r.technicals.rsi14),
      rsi_9:           round(r.technicals.rsi9),
      rsi_divergence:  r.technicals.rsiDivergence,
      macd_signal:     r.technicals.macdSignal,
      macd_histogram:  round(r.technicals.macdHistogram),
      stoch_k:         round(r.technicals.stochasticK),
      stoch_d:         round(r.technicals.stochasticD),
      williams_r:      round(r.technicals.williamsR),
      cci_20:          round(r.technicals.cci20),
      mfi_14:          round(r.technicals.mfi14),
      roc_10:          round(r.technicals.roc10),
      // Trend
      adx_14:          round(r.technicals.adx14),
      di_plus:         round(r.technicals.diPlus),
      di_minus:        round(r.technicals.diMinus),
      trend_short:     r.technicals.trendShort,
      trend_mid:       r.technicals.trendMid,
      trend_long:      r.technicals.trendLong,
      trend_consistency: r.technicals.trendConsistency,
      golden_cross:    r.technicals.goldenCrossActive,
      death_cross:     r.technicals.deathCrossActive,
      ichimoku:        r.technicals.ichimokuSignal,
      psar_signal:     r.technicals.parabolicSarSignal,
      psar_value:      round(r.technicals.parabolicSarValue),
      // Volatility
      atr_14:          round(r.technicals.atr14),
      atr_pct:         round(r.technicals.atrPct),
      bb_position:     r.technicals.bbPosition,
      bb_squeeze:      r.technicals.bbSqueeze,
      keltner_position: r.technicals.keltnerPosition,
      hv30:            round(r.technicals.historicalVolatility30d),
      // Volume
      obv_trend:       r.technicals.obvTrend,
      obv_divergence:  r.technicals.obvDivergence,
      cmf:             round(r.technicals.chaikinMoneyFlow),
      volume_ratio:    round(r.technicals.volumeRatio),
      volume_signal:   r.technicals.volumeSignal,
      // Price context
      price_vs_vwap_pct:   round(r.technicals.priceVsVwapPct),
      price_vs_52w_high:   round(r.technicals.priceVs52wHighPct),
      price_vs_52w_low:    round(r.technicals.priceVs52wLowPct),
      // Levels
      support1: r.technicals.support1,
      resistance1: r.technicals.resistance1,
      fib_618: r.technicals.fibRetracement618,
      pivot: round(r.technicals.pivot),
      // Candle
      candlestick: r.technicals.candlestickPattern,
      // Summary
      conviction_score: round(r.signalResult.convictionScore),
      top_buy_signals:  r.signalResult.buySignals.slice(0,4).map(s => s.name),
      top_sell_signals: r.signalResult.sellSignals.slice(0,4).map(s => s.name),
      technical_summary: r.signalResult.technicalSummary,
    },

    // ── Fundamentals ───────────────────────────────────────────────────────
    fundamentals: {
      pe_ttm:           round(r.fundamentals.peRatioTtm),
      pe_forward:       round(r.fundamentals.peRatioForward),
      sector_avg_pe:    r.fundamentals.sectorAvgPe,
      pb_ratio:         round(r.fundamentals.pbRatio),
      ev_ebitda:        round(r.fundamentals.evEbitda),
      eps_ttm:          round(r.fundamentals.epsTtm),
      eps_growth_yoy:   round(r.fundamentals.epsGrowthYoy),
      roe:              round(r.fundamentals.roeTtm),
      roic:             round(r.fundamentals.roicTtm),
      net_margin:       round(r.fundamentals.netProfitMarginPct),
      revenue_growth:   round(r.fundamentals.revenueGrowthYoy),
      earnings_growth:  round(r.fundamentals.earningsGrowthYoy),
      dividend_yield:   round(r.fundamentals.dividendYieldPct),
      dividend_per_share: round(r.fundamentals.dividendPerShare),
      div_payout_ratio: round(r.fundamentals.dividendPayoutRatioPct),
      consecutive_div_years: r.fundamentals.consecutiveDividendYears,
      debt_to_equity:   round(r.fundamentals.debtToEquity),
      current_ratio:    round(r.fundamentals.currentRatio),
      interest_coverage: round(r.fundamentals.interestCoverageRatio),
      net_debt_ebitda:  round(r.fundamentals.netDebtToEbitda),
      fcf_yield:        round(r.fundamentals.freeCashFlowYield),
      book_value_ps:    round(r.fundamentals.bookValuePerShare),
      pb_discount:      round(r.fundamentals.priceToBookDiscount),
      upcoming_dividend: r.fundamentals.upcomingDividendDate ?? null,
      next_earnings:     r.fundamentals.upcomingEarningsDate ?? null,
    },

    // ── Sentiment ──────────────────────────────────────────────────────────
    sentiment: {
      score:       r.sentiment.score,
      articles:    r.sentiment.articleCount,
      confidence:  r.sentiment.confidence,
      catalysts:   r.sentiment.recentCatalysts.slice(0, 3),
      headlines:   r.sentiment.topHeadlines.slice(0, 2),
    },

    // ── Algorithm output ───────────────────────────────────────────────────
    algorithm: {
      composite_score:     r.compositeScore.composite,
      grade:               r.compositeScore.grade,
      score_breakdown: {
        technical:   r.compositeScore.technical,
        sentiment:   r.compositeScore.sentiment,
        fundamental: r.compositeScore.fundamental,
        macro:       r.compositeScore.macro,
      },
      signal:              r.signal,
      signal_label:        r.signalLabel,
      aggressive_buy_at:   r.priceTargets.aggressiveBuyAt,
      conservative_buy_at: r.priceTargets.conservativeBuyAt,
      target_1:            r.priceTargets.target1,
      target_2:            r.priceTargets.target2,
      target_3:            r.priceTargets.target3,
      stop_loss:           r.priceTargets.stopLoss,
      hard_stop:           r.priceTargets.hardStopLoss,
      rr_ratio:            r.priceTargets.riskRewardRatio,
      upside_pct:          r.priceTargets.potentialUpsidePct,
      downside_pct:        r.priceTargets.potentialDownsidePct,
      context:             r.priceTargets.currentVsTargetLabel,
      suggested_shares:    r.positionSizing.suggestedShares,
      flags:               r.flags,
    },
  }));

  const discJson = discoveryPicks.slice(0, 10).map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector, shariah: r.shariah,
    current_price: r.currentPrice,
    signal: r.signal,
    composite_score: r.compositeScore.composite,
    grade: r.compositeScore.grade,
    aggressive_buy_at: r.priceTargets.aggressiveBuyAt,
    target_1: r.priceTargets.target1,
    stop_loss: r.priceTargets.stopLoss,
    rr_ratio: r.priceTargets.riskRewardRatio,
    rsi_14: round(r.technicals.rsi14),
    adx: round(r.technicals.adx14),
    trend_consistency: r.technicals.trendConsistency,
    golden_cross: r.technicals.goldenCrossActive,
    psar: r.technicals.parabolicSarSignal,
    dividend_yield: round(r.fundamentals.dividendYieldPct),
    pe_ttm: round(r.fundamentals.peRatioTtm),
    summary: r.signalResult.technicalSummary,
    flags: r.flags,
  }));

  return `RUN_ID: ${runId}
DATE: ${runAt.toISOString()}
SHARIAH_MODE: ${config.shariahMode}
CIRCUIT_BREAKER_ACTIVE: ${circuitBreakerActive}

MACRO_SNAPSHOT:
PKR/USD official=${m.pkrUsdOfficial} open=${m.pkrUsdOpen} trend=${m.pkrTrend}
SBP_RATE=${m.sbpPolicyRate}% trend=${m.sbpRateTrend}
KIBOR 1w=${m.kibor1w}% 1m=${m.kibor1m}% 3m=${m.kibor3m}%
CPI=${m.pakistanCpi}% core=${m.coreCpi}% GDP=${m.gdpGrowthPct}%
FPI_weekly=PKR${m.fpiWeeklyMillion}M direction=${m.fpiDirection}
KSE100=${m.kse100Level} day=${m.kse100ChangePct}% YTD=${m.kse100Ytd}%
BRENT=$${m.brentCrude} UREA=$${m.ureaTonne}/t
IMF: ${m.imfStatus} active=${m.imfProgrammeActive}

PORTFOLIO_ANALYSIS:
${JSON.stringify(portJson, null, 2)}

DISCOVERY_CANDIDATES (algorithm top picks outside portfolio):
${JSON.stringify(discJson, null, 2)}

SECTOR_CONCENTRATION_%:
${JSON.stringify(sectorConcentration, null, 2)}

ACTIVE_ALERTS:
${JSON.stringify(
  alerts.map(a => ({
    ticker: a.ticker, type: a.type, severity: a.severity,
    detail: a.detail, action: a.action,
  })),
  null, 2
)}`.trim();
}
