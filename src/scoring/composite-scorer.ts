import { CONFIG } from '../config';
import { normalise, round, safeDivide } from '../utils/helpers';
import type {
  TechnicalIndicators, SignalResult, FundamentalData,
  SentimentResult, MacroSnapshot, CompositeScore, PriceTargets, PositionSizing,
} from '../types';

// ─── Fundamental Scorer ───────────────────────────────────────────────────────

function scoreFundamentals(f: FundamentalData): number {
  let score = 50; // base

  // P/E vs sector (lower is better for value)
  if (f.sectorAvgPe > 0) {
    const peRatio = safeDivide(f.peRatio, f.sectorAvgPe);
    if (peRatio < 0.8) score += 15;
    else if (peRatio < 1.0) score += 8;
    else if (peRatio > 1.3) score -= 10;
    else if (peRatio > 1.5) score -= 20;
  }

  // Dividend yield (higher is better)
  if (f.dividendYieldPct > 10) score += 15;
  else if (f.dividendYieldPct > 6) score += 8;
  else if (f.dividendYieldPct < 2) score -= 5;

  // ROE (higher is better)
  if (f.roe > 25) score += 12;
  else if (f.roe > 15) score += 6;
  else if (f.roe < 8) score -= 10;

  // Debt-to-equity (lower is better)
  if (f.debtToEquity < 0.3) score += 8;
  else if (f.debtToEquity > 1.5) score -= 10;
  else if (f.debtToEquity > 3.0) score -= 20;

  // Revenue growth
  if (f.revenueGrowthYoy > 20) score += 10;
  else if (f.revenueGrowthYoy > 10) score += 5;
  else if (f.revenueGrowthYoy < -10) score -= 15;

  // Interest coverage
  if (f.interestCoverageRatio > 5) score += 5;
  else if (f.interestCoverageRatio < 1.5) score -= 15;

  return Math.max(0, Math.min(100, score));
}

// ─── Macro Scorer ─────────────────────────────────────────────────────────────

function scoreMacro(macro: MacroSnapshot): number {
  let score = 50;

  // PKR stability (open vs official spread)
  const pkrSpreadPct = Math.abs(macro.pkrUsdOpen - macro.pkrUsdOfficial) / macro.pkrUsdOfficial * 100;
  if (pkrSpreadPct < 1) score += 10;
  else if (pkrSpreadPct > 3) score -= 15;
  else if (pkrSpreadPct > 5) score -= 25;

  // SBP policy rate (lower rates = better for equities)
  if (macro.sbpPolicyRate < 15) score += 15;
  else if (macro.sbpPolicyRate < 18) score += 5;
  else if (macro.sbpPolicyRate > 20) score -= 10;
  else if (macro.sbpPolicyRate > 22) score -= 20;

  // FPI flows
  if (macro.fpiDirection === 'inflow')  score += 12;
  if (macro.fpiDirection === 'outflow') score -= 12;

  // KSE-100 market momentum
  if (macro.kse100ChangePct > 1.0) score += 8;
  else if (macro.kse100ChangePct < -2.0) score -= 15;

  // CPI (lower inflation = better)
  if (macro.pakistanCpi < 10) score += 10;
  else if (macro.pakistanCpi > 25) score -= 15;
  else if (macro.pakistanCpi > 30) score -= 25;

  // IMF positive signal
  if (macro.imfStatus.toLowerCase().includes('track')) score += 8;
  if (macro.imfStatus.toLowerCase().includes('default') ||
      macro.imfStatus.toLowerCase().includes('breach')) score -= 20;

  return Math.max(0, Math.min(100, score));
}

// ─── Main Composite Score ─────────────────────────────────────────────────────

export function computeCompositeScore(
  signalResult: SignalResult,
  sentiment: SentimentResult,
  fundamentals: FundamentalData,
  macro: MacroSnapshot
): CompositeScore {
  const technicalScore    = normalise(signalResult.convictionScore, -8, 8, 0, 100);
  const sentimentScore    = normalise(sentiment.score, -1, 1, 0, 100);
  const fundamentalScore  = scoreFundamentals(fundamentals);
  const macroScore        = scoreMacro(macro);

  const composite =
    technicalScore    * CONFIG.WEIGHTS.TECHNICAL   +
    sentimentScore    * CONFIG.WEIGHTS.SENTIMENT   +
    fundamentalScore  * CONFIG.WEIGHTS.FUNDAMENTAL +
    macroScore        * CONFIG.WEIGHTS.MACRO;

  return {
    technical:    round(technicalScore),
    sentiment:    round(sentimentScore),
    fundamental:  round(fundamentalScore),
    macro:        round(macroScore),
    composite:    round(composite),
  };
}

// ─── Price Target Calculator ──────────────────────────────────────────────────

export function computePriceTargets(
  ti: TechnicalIndicators,
  currentPrice: number,
  avgCost?: number
): PriceTargets {
  const buyAt    = Math.min(ti.support1, ti.bbLower, currentPrice - ti.atr14);
  const sellAt   = Math.min(ti.resistance1, ti.bbUpper);

  const rawStopLoss = currentPrice - 2 * ti.atr14;
  const costFloor   = avgCost ? avgCost * 0.92 : 0;
  const stopLoss    = Math.max(rawStopLoss, costFloor);

  const target1 = ti.resistance1;
  const target2 = ti.resistance2;
  const target3 = currentPrice * 1.15;

  const riskRewardRatio = stopLoss < buyAt
    ? round(safeDivide(sellAt - buyAt, buyAt - stopLoss))
    : 0;

  return {
    buyAt:            round(buyAt),
    sellAt:           round(sellAt),
    stopLoss:         round(stopLoss),
    target1:          round(target1),
    target2:          round(target2),
    target3:          round(target3),
    riskRewardRatio,
  };
}

// ─── Position Sizing (Kelly Criterion simplified) ─────────────────────────────

export function computePositionSizing(
  priceTargets: PriceTargets,
  totalPortfolioValue: number,
  riskPerTradePct = 0.02
): PositionSizing {
  const riskPerShare    = priceTargets.buyAt - priceTargets.stopLoss;
  const riskAmount      = totalPortfolioValue * riskPerTradePct;
  const suggestedShares = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const suggestedValue  = round(suggestedShares * priceTargets.buyAt);

  return {
    suggestedShares,
    suggestedValue,
    riskPerShare: round(riskPerShare),
  };
}
