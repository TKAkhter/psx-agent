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
// Uses multiple confluence zones for accuracy:
//   - Technical: support/resistance, Bollinger, Keltner, Fibonacci, Pivot
//   - Volatility-adjusted stop loss (2× ATR)
//   - Hard stop: 8% below avg cost (capital preservation)
//   - Parabolic SAR as trailing stop reference

export function computePriceTargets(
  ti:           TechnicalIndicators,
  fundamentals: FundamentalData,
  currentPrice: number,
  avgCost?:     number,
): PriceTargets {
  // ── Aggressive entry: best nearby buy zone ──────────────────────────────
  // Take the highest of: (nearest support, BB lower, Keltner lower, S1 pivot)
  // then ensure we're not more than 4% below current price (realistic entry)
  const buyZoneCandidates = [
    ti.support1,
    ti.bbLower,
    ti.keltnerLower,
    ti.s1,
    ti.fibRetracement618,
  ].filter(v => v > 0 && v < currentPrice);

  const aggressiveBuyAt = round(
    buyZoneCandidates.length > 0
      ? Math.max(Math.max(...buyZoneCandidates), currentPrice * 0.96)
      : currentPrice * 0.97,
  );

  // ── Conservative entry: deeper confirmed demand zone ────────────────────
  const conservativeCandidates = [
    ti.support2,
    ti.fibRetracement618,
    ti.parabolicSarSignal === 'bullish' ? ti.parabolicSarValue : 0,
  ].filter(v => v > 0 && v < currentPrice * 0.98);

  const conservativeBuyAt = round(
    conservativeCandidates.length > 0
      ? Math.max(Math.min(...conservativeCandidates), currentPrice * 0.91)
      : currentPrice * 0.93,
  );

  // ── Upside targets ──────────────────────────────────────────────────────
  // T1: nearest resistance (short-term, ~5–10% typically)
  const t1Candidates = [ti.resistance1, ti.r1, ti.bbUpper, ti.keltnerUpper].filter(v => v > currentPrice);
  const target1 = round(t1Candidates.length > 0 ? Math.min(...t1Candidates) : currentPrice * 1.07);

  // T2: medium resistance (~12–18%)
  const t2Candidates = [ti.resistance2, ti.r2, ti.fibRetracement382].filter(v => v > target1);
  const target2 = round(t2Candidates.length > 0 ? Math.min(...t2Candidates) : currentPrice * 1.15);

  // T3: full swing target — 52w high or +20–25% whichever is reasonable
  const target3 = round(Math.max(ti.resistance3, currentPrice * 1.22));

  // ── Stop loss ───────────────────────────────────────────────────────────
  // Primary: 2× ATR below current (volatility-adjusted)
  const atrStop = currentPrice - 2 * ti.atr14;
  // Hard stop: 8% below avg cost (max pain before capital preservation kicks in)
  const hardStop = avgCost ? avgCost * 0.92 : currentPrice * 0.92;
  // Parabolic SAR provides an alternative trailing stop
  const psarStop = ti.parabolicSarSignal === 'bullish' ? ti.parabolicSarValue : 0;
  // Use the least restrictive (highest) of the technical stops, but never above current
  const stopLoss    = round(Math.min(currentPrice * 0.995, Math.max(atrStop, psarStop > 0 ? psarStop * 0.995 : 0)));
  const hardStopLoss = round(Math.max(hardStop, atrStop * 0.99));  // absolute floor

  // ── Risk metrics ─────────────────────────────────────────────────────────
  const riskPerUnit          = aggressiveBuyAt - stopLoss;
  const rewardPerUnit        = target1 - aggressiveBuyAt;
  const riskRewardRatio      = round(safeDiv(rewardPerUnit, Math.max(0.01, riskPerUnit)));
  const potentialUpsidePct   = round(safeDiv(target1 - currentPrice, currentPrice) * 100);
  const potentialDownsidePct = round(safeDiv(currentPrice - stopLoss, currentPrice) * 100);

  // ── Human-readable context label ─────────────────────────────────────────
  let currentVsTargetLabel: string;
  if (currentPrice <= aggressiveBuyAt) {
    currentVsTargetLabel = `✅ IN BUY ZONE — Entry PKR ${aggressiveBuyAt}, Target 1 is +${potentialUpsidePct.toFixed(1)}% at PKR ${target1}`;
  } else if (currentPrice <= target1 * 0.97) {
    currentVsTargetLabel = `📈 ${potentialUpsidePct.toFixed(1)}% upside to Target 1 (PKR ${target1}). Stop at PKR ${stopLoss}`;
  } else if (currentPrice <= target2) {
    currentVsTargetLabel = `⚠️ Between T1/T2 — partially take profits. T2 at PKR ${target2}`;
  } else {
    currentVsTargetLabel = `🔴 Near/above T2 (PKR ${target2}) — consider full profit-taking`;
  }

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
