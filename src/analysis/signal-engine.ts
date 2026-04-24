import { CONFIG } from '../config';
import type { TechnicalIndicators, TechnicalSignal, SignalResult, Signal } from '../types';

const BULLISH_PATTERNS = new Set([
  'hammer', 'bullish_engulfing', 'morning_star', 'inverted_hammer',
]);
const BEARISH_PATTERNS = new Set([
  'shooting_star', 'bearish_engulfing', 'evening_star', 'doji',
]);

export function generateSignals(
  ti: TechnicalIndicators,
  circuitBreakerActive: boolean
): SignalResult {
  const buySignals:  TechnicalSignal[] = [];
  const sellSignals: TechnicalSignal[] = [];

  // ── RSI ───────────────────────────────────────────────────────────────────────
  if (ti.rsi14 < CONFIG.ALERT_RSI_OVERSOLD) {
    buySignals.push({ name: 'RSI_OVERSOLD', type: 'BUY', weight: 1.0 });
  }
  if (ti.rsi14 > CONFIG.ALERT_RSI_OVERBOUGHT) {
    sellSignals.push({ name: 'RSI_OVERBOUGHT', type: 'SELL', weight: 1.0 });
  }

  // ── MACD ──────────────────────────────────────────────────────────────────────
  if (ti.macdSignal === 'bullish') {
    buySignals.push({ name: 'MACD_CROSS_UP', type: 'BUY', weight: 1.5 });
  }
  if (ti.macdSignal === 'bearish') {
    sellSignals.push({ name: 'MACD_CROSS_DOWN', type: 'SELL', weight: 1.5 });
  }

  // ── Stochastic ────────────────────────────────────────────────────────────────
  if (ti.stochasticK < 20) {
    buySignals.push({ name: 'STOCH_OVERSOLD', type: 'BUY', weight: 0.5 });
  }
  if (ti.stochasticK > 80) {
    sellSignals.push({ name: 'STOCH_OVERBOUGHT', type: 'SELL', weight: 0.5 });
  }

  // ── Trend + Volume ────────────────────────────────────────────────────────────
  if (ti.trendMid === 'up' && ti.volumeSignal === 'spike_up') {
    buySignals.push({ name: 'TREND_BREAKOUT', type: 'BUY', weight: 1.5 });
  }
  if (ti.trendMid === 'down' && ti.volumeSignal === 'spike_down') {
    sellSignals.push({ name: 'TREND_BREAKDOWN', type: 'SELL', weight: 1.5 });
  }

  // ── Golden / Death Cross ──────────────────────────────────────────────────────
  if (ti.trendLong === 'up' && ti.sma50 > ti.sma200) {
    buySignals.push({ name: 'GOLDEN_CROSS', type: 'BUY', weight: 2.0 });
  }
  if (ti.trendLong === 'down' && ti.sma50 < ti.sma200) {
    sellSignals.push({ name: 'DEATH_CROSS', type: 'SELL', weight: 2.0 });
  }

  // ── Bollinger Bands ───────────────────────────────────────────────────────────
  if (ti.bbPosition === 'below_lower') {
    buySignals.push({ name: 'BB_LOWER_TOUCH', type: 'BUY', weight: 0.8 });
  }
  if (ti.bbPosition === 'above_upper') {
    sellSignals.push({ name: 'BB_UPPER_TOUCH', type: 'SELL', weight: 0.8 });
  }

  // ── OBV ───────────────────────────────────────────────────────────────────────
  if (ti.obvTrend === 'accumulation') {
    buySignals.push({ name: 'OBV_ACCUMULATION', type: 'BUY', weight: 1.0 });
  }
  if (ti.obvTrend === 'distribution') {
    sellSignals.push({ name: 'OBV_DISTRIBUTION', type: 'SELL', weight: 1.0 });
  }

  // ── Candlestick ───────────────────────────────────────────────────────────────
  if (BULLISH_PATTERNS.has(ti.candlestickPattern)) {
    buySignals.push({ name: `CANDLE_${ti.candlestickPattern.toUpperCase()}`, type: 'BUY', weight: 0.5 });
  }
  if (BEARISH_PATTERNS.has(ti.candlestickPattern)) {
    sellSignals.push({ name: `CANDLE_${ti.candlestickPattern.toUpperCase()}`, type: 'SELL', weight: 0.5 });
  }

  const convictionScore =
    buySignals.reduce((s, x) => s + x.weight, 0) -
    sellSignals.reduce((s, x) => s + x.weight, 0);

  let overallSignal: Signal;
  if (convictionScore >= 4.0)       overallSignal = 'STRONG_BUY';
  else if (convictionScore >= 2.0)  overallSignal = 'BUY';
  else if (convictionScore <= -4.0) overallSignal = 'STRONG_SELL';
  else if (convictionScore <= -2.0) overallSignal = 'SELL';
  else                              overallSignal = 'HOLD';

  // Suppress BUY signals when circuit breaker is active
  if (circuitBreakerActive && (overallSignal === 'BUY' || overallSignal === 'STRONG_BUY')) {
    overallSignal = 'HOLD';
  }

  return { buySignals, sellSignals, convictionScore, overallSignal };
}
