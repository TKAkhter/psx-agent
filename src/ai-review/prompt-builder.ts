import { round } from '../utils/helpers';
import type { RunOutput } from '../types';

// ─── System Prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a senior investment analyst and portfolio advisor specialising
exclusively in the Pakistan Stock Exchange (PSX). You have deep expertise in Pakistani
macroeconomics, corporate earnings, the SBP monetary policy cycle, PKR/USD dynamics,
IMF programme conditions, commodity price impacts on Pakistani industries (oil, gas,
fertiliser, cement), and Shariah-compliant investing per AAOIFI standards.

Your task:
1. VALIDATE each signal — confirm, partially agree, or override with clear reasoning
2. NARRATIVE — 2–4 sentences per stock on why the recommendation makes or doesn't make sense
3. MISSING RISKS — anything the algorithm may not have captured (political, regulatory, sector news)
4. CONFIDENCE — High / Medium / Low per signal
5. ACCURACY RATING — score the overall algorithm output 1–10
6. SECTOR COMMENTARY — concentration risks, rebalancing opportunities
7. MACRO OVERLAY — how PKR, SBP rate, IMF, and commodities affect this portfolio right now

STRICT RULES:
- Respond ONLY with valid JSON — no text before or after the JSON object
- All price values in PKR
- Keep each reasoning field ≤ 4 sentences; discovery reviews ≤ 2 sentences
- If data is insufficient for a stock, state so and assign confidence: "Low"
- Set run_id to the value provided in the user prompt

JSON SCHEMA (your response must match this exactly):
{
  "run_id": "string",
  "analysis_timestamp": "ISO8601",
  "overall_market_view": {
    "stance": "bullish|bearish|neutral|cautious",
    "summary": "3-sentence PSX market overview",
    "key_drivers": ["string"]
  },
  "algorithm_accuracy_rating": {
    "score": 7,
    "rationale": "string",
    "strong_areas": ["string"],
    "weak_areas": ["string"]
  },
  "macro_overlay": {
    "pkr_usd_view": "string",
    "sbp_rate_view": "string",
    "commodity_impact": "string",
    "imf_risk": "string",
    "overall_macro_score": 0.2
  },
  "portfolio_review": [
    {
      "ticker": "MEBL",
      "name": "Meezan Bank",
      "algorithm_signal": "HOLD",
      "algorithm_composite_score": 58,
      "ai_validation": "AGREE",
      "ai_suggested_signal": "HOLD",
      "confidence": "High",
      "reasoning": "string",
      "shariah_note": null,
      "risk_flags": ["string"],
      "upcoming_catalysts": ["string"],
      "buy_price_view": null,
      "sell_price_view": null,
      "stop_loss_view": null
    }
  ],
  "discovery_picks_review": [
    {
      "ticker": "string",
      "name": "string",
      "ai_endorsement": "ENDORSE|NEUTRAL|AVOID",
      "confidence": "High|Medium|Low",
      "reasoning": "string",
      "sector_fit_for_portfolio": "string"
    }
  ],
  "sector_analysis": {
    "concentration_warnings": ["string"],
    "rebalancing_suggestions": ["string"],
    "sector_macro_outlook": {
      "Banking": "string",
      "Oil & Gas": "string",
      "Energy": "string",
      "Fertilizer": "string",
      "Cement": "string",
      "Technology": "string",
      "Conglomerate": "string"
    }
  },
  "active_alerts_commentary": [
    {
      "ticker": "string",
      "alert_type": "string",
      "ai_action_recommendation": "string"
    }
  ],
  "global_risk_flags": ["string"],
  "notification_headline": "max 120 chars for WhatsApp header",
  "email_subject_line": "string"
}`.trim();

// ─── User Prompt Builder ──────────────────────────────────────────────────────

export function buildAnalysisPrompt(output: RunOutput): string {
  const { runId, runAt, macroSnapshot: m, portfolioRecommendations,
          discoveryPicks, alerts, sectorConcentration, circuitBreakerActive, config } = output;

  const portfolioJson = portfolioRecommendations.map((rec) => ({
    ticker:              rec.ticker,
    name:                rec.name,
    sector:              rec.sector,
    shariah:             rec.shariah,
    shares:              rec.holding?.shares,
    avg_cost:            rec.holding?.avgCost,
    current_price:       rec.currentPrice,
    unrealised_pl_pkr:   rec.unrealisedPlPkr != null ? round(rec.unrealisedPlPkr) : null,
    unrealised_pl_pct:   rec.unrealisedPlPct != null ? round(rec.unrealisedPlPct) : null,
    portfolio_weight_pct: rec.portfolioWeightPct != null ? round(rec.portfolioWeightPct) : null,
    technicals: {
      rsi_14:             round(rec.technicals.rsi14),
      macd_signal:        rec.technicals.macdSignal,
      bb_position:        rec.technicals.bbPosition,
      trend_short:        rec.technicals.trendShort,
      trend_mid:          rec.technicals.trendMid,
      trend_long:         rec.technicals.trendLong,
      obv_trend:          rec.technicals.obvTrend,
      candlestick_pattern: rec.technicals.candlestickPattern,
      volume_signal:      rec.technicals.volumeSignal,
      atr_14:             round(rec.technicals.atr14),
      conviction_score:   round(rec.signalResult.convictionScore),
      active_buy_signals: rec.signalResult.buySignals.map((s) => s.name),
      active_sell_signals: rec.signalResult.sellSignals.map((s) => s.name),
    },
    fundamentals: {
      pe_ratio:           round(rec.fundamentals.peRatio),
      sector_avg_pe:      round(rec.fundamentals.sectorAvgPe),
      eps_ttm:            round(rec.fundamentals.epsTtm),
      dividend_yield_pct: round(rec.fundamentals.dividendYieldPct),
      roe_pct:            round(rec.fundamentals.roe),
      debt_to_equity:     round(rec.fundamentals.debtToEquity),
      upcoming_dividend:  rec.fundamentals.upcomingDividendDate ?? null,
      next_earnings:      rec.fundamentals.upcomingEarningsDate ?? null,
    },
    sentiment: {
      score:         rec.sentiment.score,
      article_count: rec.sentiment.articleCount,
      confidence:    rec.sentiment.confidence,
    },
    algorithm_output: {
      composite_score:          rec.compositeScore.composite,
      score_breakdown:          rec.compositeScore,
      signal:                   rec.signal,
      buy_at:                   rec.priceTargets.buyAt,
      sell_at:                  rec.priceTargets.sellAt,
      stop_loss:                rec.priceTargets.stopLoss,
      target_1:                 rec.priceTargets.target1,
      risk_reward_ratio:        rec.priceTargets.riskRewardRatio,
      suggested_shares_to_add:  rec.positionSizing.suggestedShares,
      flags:                    rec.flags,
    },
  }));

  const discoveryJson = discoveryPicks.slice(0, 10).map((rec) => ({
    ticker:        rec.ticker,
    name:          rec.name,
    sector:        rec.sector,
    shariah:       rec.shariah,
    current_price: rec.currentPrice,
    composite_score: rec.compositeScore.composite,
    signal:        rec.signal,
    buy_at:        rec.priceTargets.buyAt,
    sell_at:       rec.priceTargets.sellAt,
    stop_loss:     rec.priceTargets.stopLoss,
    rr_ratio:      rec.priceTargets.riskRewardRatio,
    rsi_14:        round(rec.technicals.rsi14),
    macd_signal:   rec.technicals.macdSignal,
    dividend_yield: round(rec.fundamentals.dividendYieldPct),
    pe_ratio:      round(rec.fundamentals.peRatio),
  }));

  const alertsJson = alerts.map((a) => ({
    ticker:   a.ticker,
    type:     a.type,
    severity: a.severity,
    detail:   a.detail,
  }));

  return `
RUN_ID: ${runId}
DATE: ${runAt.toISOString()}
SHARIAH_MODE: ${config.shariahMode}
INDEX_FILTER: ${config.indexFilter}
CIRCUIT_BREAKER_ACTIVE: ${circuitBreakerActive}

MACRO_SNAPSHOT:
PKR/USD official=${m.pkrUsdOfficial} open=${m.pkrUsdOpen}
SBP_RATE=${m.sbpPolicyRate}%  KIBOR_1M=${m.kibor1m}%  CPI=${m.pakistanCpi}%
BRENT=${m.brentCrude}  FPI_WEEKLY=PKR${m.fpiWeeklyMillion}M (${m.fpiDirection})
KSE100=${m.kse100Level} (${m.kse100ChangePct > 0 ? '+' : ''}${m.kse100ChangePct}%)
IMF: ${m.imfStatus}

PORTFOLIO_ANALYSIS:
${JSON.stringify(portfolioJson, null, 2)}

DISCOVERY_CANDIDATES:
${JSON.stringify(discoveryJson, null, 2)}

SECTOR_CONCENTRATION_%:
${JSON.stringify(sectorConcentration, null, 2)}

ACTIVE_ALERTS:
${JSON.stringify(alertsJson, null, 2)}
`.trim();
}
