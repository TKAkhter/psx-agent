import { CONFIG } from '../config';
import type { StockRecommendation, Alert, PortfolioPosition } from '../types';

export function evaluateAlerts(recs: StockRecommendation[]): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();

  for (const rec of recs) {
    const { ticker, name, currentPrice, priceTargets, technicals, signal, fundamentals, position } = rec;

    // ── 1. Stop-loss breach ──────────────────────────────────────────────────
    if (position && currentPrice <= priceTargets.stopLoss) {
      alerts.push({
        ticker, name, timestamp: now, severity: 'CRITICAL',
        type: 'STOP_LOSS_BREACH',
        detail: `Price PKR ${currentPrice} breached stop-loss PKR ${priceTargets.stopLoss}`,
        action: `EXIT NOW — Stop-loss triggered. Limit further loss.`,
      });
    }

    // ── 2. Hard stop breach ──────────────────────────────────────────────────
    if (position && currentPrice <= priceTargets.hardStopLoss) {
      alerts.push({
        ticker, name, timestamp: now, severity: 'CRITICAL',
        type: 'HARD_STOP_BREACH',
        detail: `Price PKR ${currentPrice} is >8% below avg cost PKR ${position.avgCost}`,
        action: `Emergency exit — hard stop triggered. Capital preservation critical.`,
      });
    }

    // ── 3. RSI extremes ──────────────────────────────────────────────────────
    if (technicals.rsi14 < CONFIG.ALERT_RSI_OVERSOLD) {
      alerts.push({
        ticker, name, timestamp: now, severity: 'WARNING',
        type: 'RSI_OVERSOLD',
        detail: `RSI-14 is ${technicals.rsi14.toFixed(1)} — oversold`,
        action: position ? 'Potential buy-more opportunity at support' : 'Monitor for entry',
      });
    }
    if (technicals.rsi14 > CONFIG.ALERT_RSI_OVERBOUGHT) {
      alerts.push({
        ticker, name, timestamp: now, severity: 'WARNING',
        type: 'RSI_OVERBOUGHT',
        detail: `RSI-14 is ${technicals.rsi14.toFixed(1)} — overbought`,
        action: position ? 'Consider partial profit-taking' : 'Avoid new entry here',
      });
    }

    // ── 4. MACD crossover ────────────────────────────────────────────────────
    if (technicals.macdSignal === 'bullish_cross') {
      alerts.push({
        ticker, name, timestamp: now, severity: 'INFO',
        type: 'MACD_BULLISH_CROSS',
        detail: 'MACD bullish crossover just occurred',
        action: 'Watch for volume confirmation. Potential entry signal.',
      });
    }
    if (technicals.macdSignal === 'bearish_cross') {
      alerts.push({
        ticker, name, timestamp: now, severity: position ? 'WARNING' : 'INFO',
        type: 'MACD_BEARISH_CROSS',
        detail: 'MACD bearish crossover just occurred',
        action: position ? 'Consider reducing position or tightening stop-loss' : 'Avoid entry',
      });
    }

    // ── 5. Price drop from avg cost ──────────────────────────────────────────
    if (position) {
      const dropPct = ((currentPrice - position.avgCost) / position.avgCost) * 100;
      if (dropPct < -CONFIG.ALERT_PRICE_DROP_PCT) {
        alerts.push({
          ticker, name, timestamp: now, severity: 'WARNING',
          type: 'POSITION_LOSS',
          detail: `Position is ${dropPct.toFixed(1)}% below avg cost PKR ${position.avgCost}`,
          action: `Review — ${Math.abs(dropPct).toFixed(1)}% unrealised loss. Stop-loss at PKR ${priceTargets.stopLoss}`,
        });
      }
    }

    // ── 6. Approaching target ────────────────────────────────────────────────
    if (position) {
      const gapToT1 = ((priceTargets.target1 - currentPrice) / currentPrice) * 100;
      if (gapToT1 <= 3 && gapToT1 >= 0) {
        alerts.push({
          ticker, name, timestamp: now, severity: 'INFO',
          type: 'NEAR_TARGET_1',
          detail: `Price ${gapToT1.toFixed(1)}% away from Target 1 (PKR ${priceTargets.target1})`,
          action: 'Consider partial profit-taking. Trail stop-loss up.',
        });
      }
    }

    // ── 7. Upcoming dividend ─────────────────────────────────────────────────
    if (fundamentals.upcomingDividendDate) {
      const daysUntil = Math.ceil(
        (new Date(fundamentals.upcomingDividendDate).getTime() - now.getTime()) / 86_400_000,
      );
      if (daysUntil >= 0 && daysUntil <= 10) {
        alerts.push({
          ticker, name, timestamp: now, severity: 'INFO',
          type: 'DIVIDEND_EX_DATE',
          detail: `Dividend ex-date in ${daysUntil} day(s) on ${fundamentals.upcomingDividendDate}`,
          action: daysUntil <= 3
            ? 'Must hold by market open on ex-date to receive dividend'
            : 'Dividend approaching — be aware of potential post-ex-date price drop',
        });
      }
    }

    // ── 8. Upcoming earnings ─────────────────────────────────────────────────
    if (fundamentals.upcomingEarningsDate) {
      const daysUntil = Math.ceil(
        (new Date(fundamentals.upcomingEarningsDate).getTime() - now.getTime()) / 86_400_000,
      );
      if (daysUntil >= 0 && daysUntil <= 10) {
        alerts.push({
          ticker, name, timestamp: now, severity: 'INFO',
          type: 'EARNINGS_IMMINENT',
          detail: `Earnings announcement in ${daysUntil} day(s)`,
          action: 'Heightened volatility expected. Consider reducing position size if risk-averse.',
        });
      }
    }

    // ── 9. RSI divergence ────────────────────────────────────────────────────
    if (technicals.rsiDivergence === 'bullish') {
      alerts.push({
        ticker, name, timestamp: now, severity: 'INFO',
        type: 'RSI_BULLISH_DIVERGENCE',
        detail: 'Bullish RSI divergence detected — price making lower lows but RSI making higher lows',
        action: 'Potential reversal signal. Watch for confirmation.',
      });
    }

    // ── 10. BB squeeze breakout ──────────────────────────────────────────────
    if (technicals.bbSqueeze) {
      alerts.push({
        ticker, name, timestamp: now, severity: 'INFO',
        type: 'BB_SQUEEZE',
        detail: 'Bollinger Band squeeze — volatility at 3-month low',
        action: 'Big move imminent. Direction determined by first strong close outside bands.',
      });
    }
  }

  // Sort: CRITICAL → WARNING → INFO
  const order: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function computeSectorConcentration(
  recs: StockRecommendation[],
  totalValue: number,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of recs) {
    if (!r.position) continue;
    map[r.sector] = (map[r.sector] ?? 0) + r.currentPrice * r.position.shares;
  }
  return Object.fromEntries(
    Object.entries(map).map(([s, v]) => [s, totalValue > 0 ? +((v/totalValue)*100).toFixed(1) : 0])
  );
}

export const isCircuitBreakerActive = (changePct: number) =>
  changePct < -CONFIG.CIRCUIT_BREAKER_DROP_PCT;

// Find best replacement stock to buy when selling one
export function suggestReplacement(
  sellTicker: string,
  portfolioRecs: StockRecommendation[],
  discoveryPicks: StockRecommendation[],
): string | undefined {
  // Prefer portfolio holdings already owned (double down on best performers)
  const betterPortfolio = portfolioRecs
    .filter(r => r.ticker !== sellTicker && (r.signal === 'BUY' || r.signal === 'STRONG_BUY'))
    .sort((a, b) => b.compositeScore.composite - a.compositeScore.composite)[0];
  if (betterPortfolio) return betterPortfolio.ticker;

  // Fall back to discovery picks
  const bestDiscovery = discoveryPicks
    .sort((a, b) => b.compositeScore.composite - a.compositeScore.composite)[0];
  return bestDiscovery?.ticker;
}
