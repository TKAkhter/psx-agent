import { CONFIG } from '../config';
import type { StockRecommendation, Alert, EnrichedHolding } from '../types';

export function evaluateAlerts(recommendations: StockRecommendation[]): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();

  for (const rec of recommendations) {
    const { ticker, currentPrice, priceTargets, technicals, signal, holding } = rec;

    // Stop-loss breach
    if (CONFIG.ALERT_STOP_LOSS_BREACH && holding && currentPrice <= priceTargets.stopLoss) {
      alerts.push({
        ticker, severity: 'CRITICAL', timestamp: now,
        type: 'STOP_LOSS_BREACH',
        detail: `Price PKR ${currentPrice} has breached stop-loss PKR ${priceTargets.stopLoss}`,
      });
    }

    // RSI oversold
    if (technicals.rsi14 < CONFIG.ALERT_RSI_OVERSOLD) {
      alerts.push({
        ticker, severity: 'WARNING', timestamp: now,
        type: 'RSI_OVERSOLD',
        detail: `RSI ${technicals.rsi14.toFixed(1)} below oversold threshold ${CONFIG.ALERT_RSI_OVERSOLD}`,
      });
    }

    // RSI overbought
    if (technicals.rsi14 > CONFIG.ALERT_RSI_OVERBOUGHT) {
      alerts.push({
        ticker, severity: 'WARNING', timestamp: now,
        type: 'RSI_OVERBOUGHT',
        detail: `RSI ${technicals.rsi14.toFixed(1)} above overbought threshold ${CONFIG.ALERT_RSI_OVERBOUGHT}`,
      });
    }

    // Large intraday drop (requires holding to calculate from avgCost)
    if (holding) {
      const dropPct = ((currentPrice - holding.avgCost) / holding.avgCost) * 100;
      if (dropPct < -CONFIG.ALERT_PRICE_DROP_PCT) {
        alerts.push({
          ticker, severity: 'WARNING', timestamp: now,
          type: 'PRICE_DROP_FROM_COST',
          detail: `Position down ${dropPct.toFixed(1)}% from avg cost PKR ${holding.avgCost}`,
        });
      }
    }

    // AI high-confidence sell (applied after AI review, checked again here as well)
    if (CONFIG.ALERT_AI_HIGH_CONFIDENCE_SELL &&
        (signal === 'STRONG_SELL' || signal === 'SELL') &&
        rec.compositeScore.composite < 35) {
      alerts.push({
        ticker, severity: 'CRITICAL', timestamp: now,
        type: 'STRONG_SELL_SIGNAL',
        detail: `Composite score ${rec.compositeScore.composite}/100 with ${signal} signal`,
      });
    }

    // Upcoming dividend
    if (rec.fundamentals.upcomingDividendDate) {
      const daysUntil = Math.ceil(
        (new Date(rec.fundamentals.upcomingDividendDate).getTime() - now.getTime()) / 86_400_000
      );
      if (daysUntil <= 7 && daysUntil >= 0) {
        alerts.push({
          ticker, severity: 'INFO', timestamp: now,
          type: 'DIVIDEND_UPCOMING',
          detail: `Dividend ex-date in ${daysUntil} day(s) on ${rec.fundamentals.upcomingDividendDate}`,
        });
      }
    }

    // Upcoming earnings
    if (rec.fundamentals.upcomingEarningsDate) {
      const daysUntil = Math.ceil(
        (new Date(rec.fundamentals.upcomingEarningsDate).getTime() - now.getTime()) / 86_400_000
      );
      if (daysUntil <= 14 && daysUntil >= 0) {
        alerts.push({
          ticker, severity: 'INFO', timestamp: now,
          type: 'EARNINGS_UPCOMING',
          detail: `Earnings announcement in ${daysUntil} day(s) on ${rec.fundamentals.upcomingEarningsDate}`,
        });
      }
    }
  }

  // Sort: CRITICAL first, then WARNING, then INFO
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function computeSectorConcentration(
  recommendations: StockRecommendation[],
  totalPortfolioValue: number
): Record<string, number> {
  const sectorValues: Record<string, number> = {};

  for (const rec of recommendations) {
    if (!rec.holding) continue;
    const value = rec.currentPrice * rec.holding.shares;
    sectorValues[rec.sector] = (sectorValues[rec.sector] ?? 0) + value;
  }

  return Object.fromEntries(
    Object.entries(sectorValues).map(([sector, value]) => [
      sector,
      totalPortfolioValue > 0 ? parseFloat(((value / totalPortfolioValue) * 100).toFixed(1)) : 0,
    ])
  );
}

export function isCircuitBreakerActive(kse100ChangePct: number): boolean {
  return kse100ChangePct < -CONFIG.CIRCUIT_BREAKER_INDEX_DROP_PCT;
}
