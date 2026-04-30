import { CONFIG } from '../config';
import { normalise, round, safeDiv, scoreGrade, signalLabel } from '../utils/helpers';
import type {
  TechnicalIndicators, SignalResult, FundamentalData,
  SentimentResult, MacroSnapshot, CompositeScore, PriceTargets, PositionSizing, Signal,
} from '../types';

// ─── Fundamental Score (0–100) ────────────────────────────────────────────────
function scoreFundamentals(f: FundamentalData): number {
  let score = 50;

  // ── Valuation ──────────────────────────────────────────────────────────────
  // P/E vs sector: discount to sector is bullish
  if (f.sectorAvgPe > 0) {
    const peRel = safeDiv(f.peRatioTtm, f.sectorAvgPe);
    if (peRel < 0.6)       score += 18;
    else if (peRel < 0.8)  score += 12;
    else if (peRel < 1.0)  score += 6;
    else if (peRel > 1.5)  score -= 10;
    else if (peRel > 2.0)  score -= 20;
  }
  // P/B: below book value = strong value signal
  if (f.pbRatio < 1.0)      score += 10;
  else if (f.pbRatio < 1.5) score += 5;
  else if (f.pbRatio > 4.0) score -= 8;
  // EV/EBITDA
  if (f.evEbitda < 5)        score += 8;
  else if (f.evEbitda > 12)  score -= 8;
  // FCF yield
  if (f.freeCashFlowYield > 8)  score += 10;
  else if (f.freeCashFlowYield > 5) score += 5;
  else if (f.freeCashFlowYield < 0) score -= 10;

  // ── Profitability ──────────────────────────────────────────────────────────
  if (f.roeTtm > 30)        score += 12;
  else if (f.roeTtm > 20)   score += 8;
  else if (f.roeTtm > 12)   score += 4;
  else if (f.roeTtm < 8)    score -= 8;

  if (f.roicTtm > 20)       score += 6;
  else if (f.roicTtm < 8)   score -= 6;

  if (f.netProfitMarginPct > 25) score += 8;
  else if (f.netProfitMarginPct > 15) score += 4;
  else if (f.netProfitMarginPct < 5)  score -= 8;

  // ── Growth ─────────────────────────────────────────────────────────────────
  if (f.earningsGrowthYoy > 25) score += 10;
  else if (f.earningsGrowthYoy > 10) score += 5;
  else if (f.earningsGrowthYoy < -15) score -= 12;

  if (f.revenueGrowthYoy > 20)  score += 6;
  else if (f.revenueGrowthYoy < -10) score -= 8;

  if (f.epsGrowthYoy > 15) score += 5;
  else if (f.epsGrowthYoy < -10) score -= 5;

  // ── Dividends (PSX investors highly value yield) ──────────────────────────
  if (f.dividendYieldPct > 12)  score += 14;
  else if (f.dividendYieldPct > 8)  score += 10;
  else if (f.dividendYieldPct > 5)  score += 6;
  else if (f.dividendYieldPct < 2)  score -= 4;

  if (f.consecutiveDividendYears > 10) score += 8;
  else if (f.consecutiveDividendYears > 5) score += 4;

  // ── Balance Sheet ──────────────────────────────────────────────────────────
  if (f.debtToEquity < 0.2)      score += 8;
  else if (f.debtToEquity < 0.5) score += 4;
  else if (f.debtToEquity > 2.0) score -= 10;
  else if (f.debtToEquity > 4.0) score -= 20;

  if (f.currentRatio > 2.0)      score += 6;
  else if (f.currentRatio < 1.0) score -= 10;

  if (f.interestCoverageRatio > 8)   score += 6;
  else if (f.interestCoverageRatio < 2) score -= 12;
  else if (f.interestCoverageRatio < 1) score -= 20;

  if (f.netDebtToEbitda < 0)       score += 8;  // net cash position
  else if (f.netDebtToEbitda > 3)  score -= 10;

  return Math.max(0, Math.min(100, score));
}

// ─── Macro Score (0–100) ──────────────────────────────────────────────────────
function scoreMacro(m: MacroSnapshot): number {
  let score = 50;

  // PKR stability
  const pkrSpread = Math.abs(m.pkrUsdOpen - m.pkrUsdOfficial) / m.pkrUsdOfficial * 100;
  if (m.pkrTrend === 'appreciating') score += 12;
  else if (m.pkrTrend === 'depreciating') score -= 15;
  if (pkrSpread > 4) score -= 12;

  // SBP rate cycle
  if (m.sbpRateTrend === 'cutting')  score += 15;
  else if (m.sbpRateTrend === 'hiking') score -= 12;
  if (m.sbpPolicyRate > 22) score -= 15;
  else if (m.sbpPolicyRate < 16) score += 12;

  // FPI flows
  if (m.fpiDirection === 'inflow')  score += 12;
  if (m.fpiDirection === 'outflow') score -= 10;

  // Index momentum
  if (m.kse100ChangePct > 1.5)  score += 10;
  else if (m.kse100ChangePct < -2) score -= 12;
  if (m.kse100Ytd > 15) score += 6;

  // Inflation
  if (m.pakistanCpi < 10)   score += 12;
  else if (m.pakistanCpi > 25) score -= 12;
  else if (m.pakistanCpi > 30) score -= 20;

  // IMF / external support
  if (m.imfProgrammeActive)  score += 10;
  if (/default|crisis|halt/i.test(m.imfStatus)) score -= 25;
  if (/disburse|approved|track/i.test(m.imfStatus)) score += 8;

  // Commodity context (broadly positive for PSX energy names)
  if (m.brentCrude > 90)     score += 5;   // good for OGDC/MARI/POL
  else if (m.brentCrude < 65) score -= 5;

  return Math.max(0, Math.min(100, score));
}

// ─── Composite Score ──────────────────────────────────────────────────────────
export function computeCompositeScore(
  signalResult: SignalResult,
  sentiment:    SentimentResult,
  fundamentals: FundamentalData,
  macro:        MacroSnapshot,
): CompositeScore {
  const technical   = round(normalise(signalResult.convictionScore, -10, 10));
  const sentScore   = round(normalise(sentiment.score, -1, 1));
  const fundamental = round(scoreFundamentals(fundamentals));
  const macroScore  = round(scoreMacro(macro));

  const composite = round(
    technical   * CONFIG.WEIGHTS.TECHNICAL   +
    sentScore   * CONFIG.WEIGHTS.SENTIMENT   +
    fundamental * CONFIG.WEIGHTS.FUNDAMENTAL +
    macroScore  * CONFIG.WEIGHTS.MACRO,
  );

  const grade = scoreGrade(composite);
  const interpretation =
    composite >= 80 ? 'Excellent — strong multi-factor bullish alignment' :
    composite >= 65 ? 'Good — majority of factors bullish' :
    composite >= 50 ? 'Neutral — mixed signals, monitor closely' :
    composite >= 35 ? 'Weak — majority of factors bearish' :
                      'Poor — strong multi-factor bearish alignment';

  return { technical, sentiment: sentScore, fundamental, macro: macroScore, composite, grade, interpretation };
}

// ─── Price Targets ────────────────────────────────────────────────────────────
export function computePriceTargets(
  ti:           TechnicalIndicators,
  fundamentals: FundamentalData,
  currentPrice: number,
  avgCost?:     number,
): PriceTargets {
  // Entry levels
  // Aggressive: nearest support or Fib 61.8%
  const aggressiveBuyAt = round(Math.max(
    Math.min(ti.support1, ti.bbLower, ti.s1),
    currentPrice * 0.97,      // no more than 3% below current
  ));
  // Conservative: confirmed demand zone (2nd support)
  const conservativeBuyAt = round(Math.max(
    Math.min(ti.support2, ti.fibRetracement618),
    currentPrice * 0.93,
  ));

  // Upside targets based on resistance levels + Fib extensions
  const target1 = round(Math.min(ti.resistance1, ti.r1, ti.bbUpper));
  const target2 = round(Math.min(ti.resistance2, ti.r2));
  const target3 = round(Math.max(ti.resistance3, currentPrice * 1.20));

  // Stop loss: 2×ATR below current or 8% below avg cost, whichever is higher floor
  const atrStop     = round(currentPrice - 2 * ti.atr14);
  const hardStop    = round(avgCost ? avgCost * 0.92 : currentPrice * 0.92);
  const stopLoss    = round(Math.max(atrStop, hardStop * 0.98));  // slight buffer
  const hardStopLoss = round(hardStop);

  const riskRewardRatio    = round(safeDiv(target1 - aggressiveBuyAt, aggressiveBuyAt - stopLoss));
  const potentialUpsidePct = round(safeDiv(target1 - currentPrice, currentPrice) * 100);
  const potentialDownsidePct = round(safeDiv(currentPrice - stopLoss, currentPrice) * 100);

  const pct = potentialUpsidePct;
  const currentVsTargetLabel =
    currentPrice <= aggressiveBuyAt ? `At buy zone — Target 1 is +${pct.toFixed(1)}% (PKR ${target1})` :
    currentPrice <= target1          ? `Below T1 — ${pct.toFixed(1)}% upside to PKR ${target1}` :
    currentPrice <= target2          ? `Between T1/T2 — T2 is PKR ${target2}` :
                                       `Near/above T2 — consider trimming`;

  return {
    aggressiveBuyAt, conservativeBuyAt,
    target1, target2, target3,
    stopLoss, hardStopLoss,
    riskRewardRatio, potentialUpsidePct, potentialDownsidePct,
    currentVsTargetLabel,
  };
}

// ─── Position Sizing ──────────────────────────────────────────────────────────
export function computePositionSizing(
  targets:             PriceTargets,
  totalPortfolioValue: number,
  riskPct = 0.02,                    // risk 2% of portfolio per trade
): PositionSizing {
  const riskPerSharePkr  = round(Math.max(0.01, targets.aggressiveBuyAt - targets.stopLoss));
  const riskBudget       = totalPortfolioValue * riskPct;
  const suggestedShares  = riskPerSharePkr > 0 ? Math.floor(riskBudget / riskPerSharePkr) : 0;
  const suggestedValuePkr = round(suggestedShares * targets.aggressiveBuyAt);
  const portfolioRiskPct  = round(safeDiv(riskBudget, totalPortfolioValue) * 100);
  const maxSharesForRiskBudget = suggestedShares;

  return { suggestedShares, suggestedValuePkr, portfolioRiskPct, riskPerSharePkr, maxSharesForRiskBudget };
}

// ─── Signal label ─────────────────────────────────────────────────────────────
export function buildSignalLabel(signal: Signal, score: number): string {
  return signalLabel(signal, score);
}
