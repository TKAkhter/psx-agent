import {
  RSI, MACD, BollingerBands, SMA, EMA, ATR, Stochastic,
} from 'technicalindicators';
import type { OHLCVCandle, TechnicalIndicators, BBPosition, MacdSignal, OBVTrend, VolumeSignal, TrendDirection } from '../types';

// ─── On-Balance Volume ────────────────────────────────────────────────────────

function computeOBV(candles: OHLCVCandle[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    const vol  = candles[i].volume;
    obv.push(obv[i - 1] + (curr > prev ? vol : curr < prev ? -vol : 0));
  }
  return obv;
}

function detectOBVTrend(obvSeries: number[], lookback = 5): OBVTrend {
  if (obvSeries.length < lookback) return 'neutral';
  const recent = obvSeries.slice(-lookback);
  const rising  = recent.every((v, i) => i === 0 || v >= recent[i - 1]);
  const falling = recent.every((v, i) => i === 0 || v <= recent[i - 1]);
  return rising ? 'accumulation' : falling ? 'distribution' : 'neutral';
}

// ─── Candlestick Patterns ─────────────────────────────────────────────────────

function detectCandlestickPattern(candles: OHLCVCandle[]): string {
  if (candles.length < 3) return 'none';
  const [c2, c1, c0] = candles.slice(-3);

  const body0 = Math.abs(c0.close - c0.open);
  const range0 = c0.high - c0.low;
  const isBullish0 = c0.close > c0.open;
  const isBearish0 = c0.close < c0.open;
  const isBullish1 = c1.close > c1.open;
  const isBearish1 = c1.close < c1.open;

  // Doji
  if (body0 / range0 < 0.1) return 'doji';

  // Hammer (bullish reversal after downtrend)
  const lowerWick0 = (isBullish0 ? c0.open : c0.close) - c0.low;
  if (lowerWick0 > body0 * 2 && isBullish0) return 'hammer';

  // Shooting star (bearish reversal)
  const upperWick0 = c0.high - (isBullish0 ? c0.close : c0.open);
  if (upperWick0 > body0 * 2 && isBearish0) return 'shooting_star';

  // Bullish engulfing
  if (isBearish1 && isBullish0 && c0.open < c1.close && c0.close > c1.open) {
    return 'bullish_engulfing';
  }

  // Bearish engulfing
  if (isBullish1 && isBearish0 && c0.open > c1.close && c0.close < c1.open) {
    return 'bearish_engulfing';
  }

  // Morning star (3-candle bullish reversal)
  if (isBearish1 && isBullish0 && Math.abs(c1.close - c1.open) / (c1.high - c1.low) < 0.3) {
    return 'morning_star';
  }

  // Evening star (3-candle bearish reversal)
  if (isBullish1 && isBearish0 && Math.abs(c1.close - c1.open) / (c1.high - c1.low) < 0.3) {
    return 'evening_star';
  }

  return 'none';
}

// ─── Main Indicator Computation ───────────────────────────────────────────────

export function computeTechnicalIndicators(candles: OHLCVCandle[]): TechnicalIndicators {
  const closes  = candles.map((c) => c.close);
  const highs   = candles.map((c) => c.high);
  const lows    = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const n = closes.length;
  const last = (arr: number[] | undefined) => arr?.[arr.length - 1] ?? 0;

  // ── Moving Averages ──────────────────────────────────────────────────────────
  const sma20Values  = SMA.calculate({ period: 20,  values: closes });
  const sma50Values  = SMA.calculate({ period: 50,  values: closes });
  const sma200Values = SMA.calculate({ period: 200, values: closes });
  const ema9Values   = EMA.calculate({ period: 9,   values: closes });
  const ema12Values  = EMA.calculate({ period: 12,  values: closes });
  const ema26Values  = EMA.calculate({ period: 26,  values: closes });

  const sma20  = last(sma20Values);
  const sma50  = last(sma50Values);
  const sma200 = last(sma200Values);
  const ema9   = last(ema9Values);
  const ema12  = last(ema12Values);
  const ema26  = last(ema26Values);

  // ── RSI ──────────────────────────────────────────────────────────────────────
  const rsiValues = RSI.calculate({ period: 14, values: closes });
  const rsi14 = last(rsiValues);

  // ── MACD ─────────────────────────────────────────────────────────────────────
  const macdValues = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const macdLast      = macdValues[macdValues.length - 1];
  const macdPrev      = macdValues[macdValues.length - 2];
  const macdLine      = macdLast?.MACD ?? 0;
  const macdSignalLine = macdLast?.signal ?? 0;
  const macdHistogram  = macdLast?.histogram ?? 0;
  const prevHistogram  = macdPrev?.histogram ?? 0;

  let macdSignal: MacdSignal = 'none';
  if (macdHistogram > 0 && prevHistogram <= 0) macdSignal = 'bullish';
  else if (macdHistogram < 0 && prevHistogram >= 0) macdSignal = 'bearish';

  // ── Stochastic ────────────────────────────────────────────────────────────────
  const stochValues = Stochastic.calculate({
    high: highs, low: lows, close: closes, period: 14, signalPeriod: 3,
  });
  const stochLast = stochValues[stochValues.length - 1];
  const stochasticK = stochLast?.k ?? 50;
  const stochasticD = stochLast?.d ?? 50;

  // ── ATR ───────────────────────────────────────────────────────────────────────
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr14 = last(atrValues);

  // ── Bollinger Bands ───────────────────────────────────────────────────────────
  const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const bbLast   = bbValues[bbValues.length - 1];
  const bbUpper  = bbLast?.upper ?? 0;
  const bbMid    = bbLast?.middle ?? 0;
  const bbLower  = bbLast?.lower ?? 0;
  const bbWidth  = bbMid > 0 ? (bbUpper - bbLower) / bbMid : 0;

  const currentClose = closes[n - 1];
  let bbPosition: BBPosition = 'inside';
  if (currentClose > bbUpper) bbPosition = 'above_upper';
  else if (currentClose < bbLower) bbPosition = 'below_lower';

  // ── OBV ───────────────────────────────────────────────────────────────────────
  const obvSeries = computeOBV(candles);
  const obv       = last(obvSeries);
  const obvTrend  = detectOBVTrend(obvSeries);

  // ── Volume ────────────────────────────────────────────────────────────────────
  const avgVol20   = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = avgVol20 > 0 ? volumes[n - 1] / avgVol20 : 1;
  let volumeSignal: VolumeSignal = 'normal';
  if (volumeRatio > 2.0) {
    volumeSignal = currentClose > candles[n - 1].open ? 'spike_up' : 'spike_down';
  }

  // ── Support & Resistance ──────────────────────────────────────────────────────
  const support1    = Math.min(...lows.slice(-20));
  const support2    = Math.min(...lows.slice(-50));
  const resistance1 = Math.max(...highs.slice(-20));
  const resistance2 = Math.max(...highs.slice(-50));
  const pivot       = (highs[n - 1] + lows[n - 1] + closes[n - 1]) / 3;

  // ── Trend ─────────────────────────────────────────────────────────────────────
  const trendShort: TrendDirection = currentClose > sma20  ? 'up' : 'down';
  const trendMid:   TrendDirection = sma20 > sma50         ? 'up' : 'down';
  const trendLong:  TrendDirection = currentClose > sma200 ? 'up' : 'down';

  // ── Candlestick ───────────────────────────────────────────────────────────────
  const candlestickPattern = detectCandlestickPattern(candles);

  return {
    sma20, sma50, sma200, ema9, ema12, ema26,
    rsi14, macdLine, macdSignalLine, macdHistogram, macdSignal,
    stochasticK, stochasticD,
    atr14, bbUpper, bbMid, bbLower, bbWidth, bbPosition,
    obv, obvTrend, volumeRatio, volumeSignal,
    candlestickPattern,
    support1, support2, resistance1, resistance2, pivot,
    trendShort, trendMid, trendLong,
  };
}
