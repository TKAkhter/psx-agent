/**
 * Technical Indicators Engine — PSX Analyzer v2
 *
 * Computes 40+ indicators across 8 categories:
 *  1. Moving Averages (SMA/EMA/VWAP)
 *  2. Momentum (RSI, MACD, Stochastic, Williams %R, CCI, MFI, ROC)
 *  3. Volatility (ATR, Bollinger Bands with squeeze, Keltner Channel, HV30)
 *  4. Volume (OBV + divergence, Acc/Dist, Chaikin Money Flow)
 *  5. Trend (ADX, Ichimoku, Parabolic SAR, Golden/Death Cross)
 *  6. Support / Resistance (3-level S/R, Pivot, Fibonacci)
 *  7. Candlestick Patterns (8 patterns)
 *  8. PSX Context (price vs 52w, vs VWAP, trend consistency, relative strength)
 */
import {
  RSI, MACD, BollingerBands, SMA, EMA, ATR, Stochastic,
  WilliamsR, CCI, MFI, ROC, ADX,
} from 'technicalindicators';
import type { OHLCVCandle, TechnicalIndicators } from '../types';

// ─── Utilities ────────────────────────────────────────────────────────────────
// Safe last — returns fallback instead of 0 to prevent NaN in calcs
const lastN = (arr: number[] | undefined, fallback = 0): number => {
  const v = arr?.[arr.length - 1];
  return (v !== undefined && !isNaN(v) && isFinite(v)) ? v : fallback;
};
const lastN2 = (arr: number[] | undefined): number => arr?.[arr.length - 2] ?? 0;

// ─── OBV ─────────────────────────────────────────────────────────────────────
function computeOBV(candles: OHLCVCandle[]): number[] {
  const obv = [0];
  for (let i = 1; i < candles.length; i++) {
    const v = candles[i].volume;
    obv.push(obv[i - 1] + (
      candles[i].close > candles[i - 1].close ? v :
      candles[i].close < candles[i - 1].close ? -v : 0
    ));
  }
  return obv;
}

function getOBVTrend(series: number[], n = 7): TechnicalIndicators['obvTrend'] {
  if (series.length < n) return 'neutral';
  const sl = series.slice(-n);
  let up = 0; let dn = 0;
  for (let i = 1; i < sl.length; i++) {
    if (sl[i] > sl[i - 1]) up++; else if (sl[i] < sl[i - 1]) dn++;
  }
  if (up >= n - 2) return 'accumulation';
  if (dn >= n - 2) return 'distribution';
  return 'neutral';
}

function getOBVDivergence(
  closes: number[],
  obvSeries: number[],
  n = 14,
): 'bullish' | 'bearish' | 'none' {
  if (closes.length < n * 2) return 'none';
  const pRecent = closes.slice(-n);    const pPrev = closes.slice(-n * 2, -n);
  const oRecent = obvSeries.slice(-n); const oPrev = obvSeries.slice(-n * 2, -n);
  const pLow  = Math.min(...pRecent) < Math.min(...pPrev);
  const oHigh = Math.min(...oRecent) > Math.min(...oPrev);
  if (pLow && oHigh) return 'bullish';
  const pHigh = Math.max(...pRecent) > Math.max(...pPrev);
  const oLow  = Math.max(...oRecent) < Math.max(...oPrev);
  if (pHigh && oLow) return 'bearish';
  return 'none';
}

// ─── RSI Divergence ───────────────────────────────────────────────────────────
function getRSIDivergence(closes: number[], rsiVals: number[], n = 14): 'bullish' | 'bearish' | 'none' {
  if (closes.length < n * 2 || rsiVals.length < n * 2) return 'none';
  const [pR, pP, rR, rP] = [closes.slice(-n), closes.slice(-n*2,-n), rsiVals.slice(-n), rsiVals.slice(-n*2,-n)];
  if (Math.min(...pR) < Math.min(...pP) && Math.min(...rR) > Math.min(...rP)) return 'bullish';
  if (Math.max(...pR) > Math.max(...pP) && Math.max(...rR) < Math.max(...rP)) return 'bearish';
  return 'none';
}

// ─── Accumulation / Distribution & CMF ───────────────────────────────────────
function computeAD(candles: OHLCVCandle[]): number[] {
  const ad = [0];
  for (let i = 1; i < candles.length; i++) {
    const { high, low, close, volume } = candles[i];
    const mfm = high === low ? 0 : ((close - low) - (high - close)) / (high - low);
    ad.push(ad[i - 1] + mfm * volume);
  }
  return ad;
}

function computeCMF(candles: OHLCVCandle[], period = 20): number {
  const slice = candles.slice(-period);
  let mfvSum = 0; let volSum = 0;
  for (const c of slice) {
    const mfm = c.high === c.low ? 0 : ((c.close - c.low) - (c.high - c.close)) / (c.high - c.low);
    mfvSum += mfm * c.volume;
    volSum += c.volume;
  }
  return volSum === 0 ? 0 : mfvSum / volSum;
}

// ─── VWAP (20-day rolling) ───────────────────────────────────────────────────
function computeVWAP(candles: OHLCVCandle[]): number {
  const slice = candles.slice(-20);
  let pvSum = 0; let vSum = 0;
  for (const c of slice) {
    const tp = (c.high + c.low + c.close) / 3;
    pvSum += tp * c.volume; vSum += c.volume;
  }
  return vSum === 0 ? 0 : pvSum / vSum;
}

// ─── Historical Volatility (annualised) ──────────────────────────────────────
function computeHV(closes: number[], period = 30): number {
  if (closes.length < period + 1) return 0;
  const returns: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

// ─── Ichimoku Cloud (simplified) ────────────────────────────────────────────
function getIchimoku(candles: OHLCVCandle[]): TechnicalIndicators['ichimokuSignal'] {
  if (candles.length < 52) return 'inside_cloud';
  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);
  const n = candles.length;
  const tenkan = (Math.max(...highs.slice(-9))  + Math.min(...lows.slice(-9)))  / 2;
  const kijun  = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = (Math.max(...highs.slice(-52)) + Math.min(...lows.slice(-52))) / 2;
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBot = Math.min(senkouA, senkouB);
  const price = candles[n - 1].close;
  if (price > cloudTop) return 'above_cloud';
  if (price < cloudBot) return 'below_cloud';
  return 'inside_cloud';
}

// ─── Parabolic SAR ────────────────────────────────────────────────────────────
function computeParabolicSAR(
  highs: number[], lows: number[], closes: number[],
  step = 0.02, max = 0.2,
): { signal: 'bullish' | 'bearish'; value: number } {
  if (closes.length < 5) return { signal: 'bullish', value: closes[closes.length - 1] };
  let bull  = closes[0] > closes[1];
  let sar   = bull ? lows[0] : highs[0];
  let ep    = bull ? highs[0] : lows[0];
  let af    = step;

  for (let i = 2; i < closes.length; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (bull) {
      sar = Math.min(sar, lows[i - 1], lows[i - 2]);
      if (lows[i] < sar) { bull = false; sar = ep; ep = lows[i]; af = step; }
      else if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, max); }
    } else {
      sar = Math.max(sar, highs[i - 1], highs[i - 2]);
      if (highs[i] > sar) { bull = true; sar = ep; ep = highs[i]; af = step; }
      else if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, max); }
    }
  }
  return { signal: bull ? 'bullish' : 'bearish', value: parseFloat(sar.toFixed(2)) };
}

// ─── Keltner Channel ──────────────────────────────────────────────────────────
function computeKeltner(
  candles: OHLCVCandle[],
  emaPeriod = 20,
  atrPeriod = 10,
  multiplier = 2,
): { upper: number; mid: number; lower: number; position: TechnicalIndicators['keltnerPosition'] } {
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);

  const emaVals = EMA.calculate({ period: emaPeriod, values: closes });
  const atrVals = ATR.calculate({ period: atrPeriod, high: highs, low: lows, close: closes });
  const mid     = lastN(emaVals);
  const atr     = lastN(atrVals);
  const upper   = mid + multiplier * atr;
  const lower   = mid - multiplier * atr;
  const price   = closes[closes.length - 1];
  const position = price > upper ? 'above' : price < lower ? 'below' : 'inside';
  return {
    upper: parseFloat(upper.toFixed(2)),
    mid:   parseFloat(mid.toFixed(2)),
    lower: parseFloat(lower.toFixed(2)),
    position,
  };
}

// ─── Fibonacci ────────────────────────────────────────────────────────────────
function fibonacci(highs: number[], lows: number[], n = 60) {
  const h = Math.max(...highs.slice(-n));
  const l = Math.min(...lows.slice(-n));
  const diff = h - l;
  return {
    fib382: h - 0.382 * diff,
    fib500: h - 0.500 * diff,
    fib618: h - 0.618 * diff,
  };
}

// ─── Candlestick Patterns ─────────────────────────────────────────────────────
function detectCandle(candles: OHLCVCandle[]): { pattern: string; bullish: boolean } {
  if (candles.length < 3) return { pattern: 'none', bullish: false };
  const [c2, c1, c0] = candles.slice(-3);

  const body0   = Math.abs(c0.close - c0.open);
  const range0  = (c0.high - c0.low) || 0.001;
  const isBull0 = c0.close > c0.open;
  const isBear0 = c0.close < c0.open;
  const isBull1 = c1.close > c1.open;
  const isBear1 = c1.close < c1.open;
  const isBear2 = c2.close < c2.open;
  const isBull2 = c2.close > c2.open;

  const lowerWick  = (isBull0 ? c0.open  : c0.close) - c0.low;
  const upperWick  = c0.high - (isBull0  ? c0.close  : c0.open);
  const smallBody1 = Math.abs(c1.close - c1.open) / ((c1.high - c1.low) || 0.001) < 0.3;

  if (body0 / range0 < 0.08)                                                        return { pattern: 'doji',             bullish: false };
  if (lowerWick > body0 * 2.5 && isBull0 && c0.low < c1.low)                        return { pattern: 'hammer',           bullish: true  };
  if (upperWick > body0 * 2.5 && isBear0 && c0.high > c1.high)                      return { pattern: 'shooting_star',    bullish: false };
  if (isBear1 && isBull0 && c0.open <= c1.close && c0.close >= c1.open)              return { pattern: 'bullish_engulfing',bullish: true  };
  if (isBull1 && isBear0 && c0.open >= c1.close && c0.close <= c1.open)              return { pattern: 'bearish_engulfing',bullish: false };
  if (isBear2 && smallBody1 && isBull0 && c0.close > (c2.open + c2.close) / 2)      return { pattern: 'morning_star',     bullish: true  };
  if (isBull2 && smallBody1 && isBear0 && c0.close < (c2.open + c2.close) / 2)      return { pattern: 'evening_star',     bullish: false };
  if (upperWick > body0 * 2 && isBull0)                                              return { pattern: 'inverted_hammer',  bullish: true  };
  if (lowerWick > body0 && upperWick > body0 && body0 / range0 < 0.35)              return { pattern: 'spinning_top',     bullish: false };
  return { pattern: 'none', bullish: false };
}

// ─── Trend Consistency (0–100) ────────────────────────────────────────────────
// Higher = all timeframes agree (strong trend signal)
function trendConsistency(
  short: TechnicalIndicators['trendShort'],
  mid:   TechnicalIndicators['trendMid'],
  long:  TechnicalIndicators['trendLong'],
): number {
  const score = [short, mid, long].filter(t => t === 'up').length;
  if (score === 3) return 100;
  if (score === 0) return 0;   // all down
  if (score === 2) return 66;
  return 33; // 1 or mixed
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export function computeTechnicalIndicators(candles: OHLCVCandle[]): TechnicalIndicators {
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const n       = closes.length;
  const cur     = closes[n - 1];

  // ── Moving Averages ────────────────────────────────────────────────────────
  // Moving averages — fallback to current price when insufficient history
  const sma10  = lastN(SMA.calculate({ period: Math.min(10,  n), values: closes }), cur);
  const sma20  = lastN(SMA.calculate({ period: Math.min(20,  n), values: closes }), cur);
  const sma50  = lastN(SMA.calculate({ period: Math.min(50,  n), values: closes }), cur);
  const sma100 = lastN(SMA.calculate({ period: Math.min(100, n), values: closes }), cur);
  const sma200 = lastN(SMA.calculate({ period: Math.min(200, n), values: closes }), cur);
  const ema9   = lastN(EMA.calculate({ period: Math.min(9,   n), values: closes }), cur);
  const ema12  = lastN(EMA.calculate({ period: Math.min(12,  n), values: closes }), cur);
  const ema21  = lastN(EMA.calculate({ period: Math.min(21,  n), values: closes }), cur);
  const ema26  = lastN(EMA.calculate({ period: Math.min(26,  n), values: closes }), cur);
  const ema50  = lastN(EMA.calculate({ period: Math.min(50,  n), values: closes }), cur);
  const vwap   = computeVWAP(candles);

  // ── RSI ────────────────────────────────────────────────────────────────────
  const rsiVals14 = RSI.calculate({ period: Math.min(14, n-1), values: closes });
  const rsiVals9  = RSI.calculate({ period: Math.min(9,  n-1), values: closes });
  const rsi14     = lastN(rsiVals14, 50);  // 50 = neutral
  const rsi9      = lastN(rsiVals9,  50);
  const rsiDiv    = getRSIDivergence(closes, rsiVals14);

  // ── MACD ───────────────────────────────────────────────────────────────────
  const macdVals      = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdCur       = macdVals[macdVals.length - 1];
  const macdPrev      = macdVals[macdVals.length - 2];
  const macdLine      = macdCur?.MACD      ?? 0;
  const macdSigLine   = macdCur?.signal    ?? 0;
  const macdHist      = macdCur?.histogram ?? 0;
  const prevHist      = macdPrev?.histogram ?? 0;

  let macdSignal: TechnicalIndicators['macdSignal'] = 'none';
  if      (macdHist > 0 && prevHist <= 0)  macdSignal = 'bullish_cross';
  else if (macdHist < 0 && prevHist >= 0)  macdSignal = 'bearish_cross';
  else if (macdHist > 0 && macdLine > 0)   macdSignal = 'bullish';
  else if (macdHist < 0 && macdLine < 0)   macdSignal = 'bearish';

  // ── Stochastic ─────────────────────────────────────────────────────────────
  const stochVals = Stochastic.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, n-1), signalPeriod: 3 });
  const stochCur  = stochVals[stochVals.length - 1];
  const stochasticK = stochCur?.k ?? 50;
  const stochasticD = stochCur?.d ?? 50;

  // ── Williams %R ────────────────────────────────────────────────────────────
  const williamsR = lastN(WilliamsR.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, n-1) }), -50);

  // ── CCI / MFI / ROC ────────────────────────────────────────────────────────
  const cci20 = lastN(CCI.calculate({ high: highs, low: lows, close: closes, period: Math.min(20, n-1) }), 0);
  const mfi14 = lastN(MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: Math.min(14, n-1) }), 50);
  const roc10 = lastN(ROC.calculate({ values: closes, period: Math.min(10, n-1) }), 0);

  // ── ATR / Bollinger ────────────────────────────────────────────────────────
  const atrVals = ATR.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, n-1) });
  const atr14   = lastN(atrVals, cur * 0.01);  // fallback = 1% of price
  const atrPct  = cur > 0 ? (atr14 / cur) * 100 : 0;

  const bbVals   = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const bbCur    = bbVals[bbVals.length - 1];
  const bbUpper  = bbCur?.upper  ?? cur * 1.02;
  const bbMid    = bbCur?.middle ?? cur;
  const bbLower  = bbCur?.lower  ?? cur * 0.98;
  const bbWidth  = bbMid > 0 ? (bbUpper - bbLower) / bbMid : 0;
  const bbSqueeze = bbWidth < 0.05;

  let bbPosition: TechnicalIndicators['bbPosition'] = 'middle';
  if      (cur > bbUpper)                          bbPosition = 'above_upper';
  else if (cur > bbMid + (bbUpper - bbMid) * 0.5) bbPosition = 'inside_upper';
  else if (cur < bbLower)                          bbPosition = 'below_lower';
  else if (cur < bbMid - (bbMid - bbLower) * 0.5) bbPosition = 'inside_lower';

  // ── ADX ────────────────────────────────────────────────────────────────────
  const adxVals = ADX.calculate({ high: highs, low: lows, close: closes, period: Math.min(14, n-1) });
  const adxCur  = adxVals[adxVals.length - 1];
  const adx14   = (adxCur?.adx && isFinite(adxCur.adx)) ? adxCur.adx : 20;
  const diPlus  = (adxCur?.pdi && isFinite(adxCur.pdi)) ? adxCur.pdi : 20;
  const diMinus = (adxCur?.mdi && isFinite(adxCur.mdi)) ? adxCur.mdi : 20;

  // ── Volume ─────────────────────────────────────────────────────────────────
  const obvSeries   = computeOBV(candles);
  const obv         = lastN(obvSeries);
  const obvTrend    = getOBVTrend(obvSeries);
  const obvDiv      = getOBVDivergence(closes, obvSeries);
  const avgVol20    = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = avgVol20 > 0 ? volumes[n - 1] / avgVol20 : 1;
  const cmf         = computeCMF(candles);
  const adLine      = lastN(computeAD(candles));

  let volumeSignal: TechnicalIndicators['volumeSignal'] = 'normal';
  if (volumeRatio > 2.0) volumeSignal = cur > candles[n - 1].open ? 'spike_up' : 'spike_down';

  // ── Trend ──────────────────────────────────────────────────────────────────
  const trendShort: TechnicalIndicators['trendShort'] = cur > sma20  ? 'up' : cur < sma20 * 0.98  ? 'down' : 'sideways';
  const trendMid:   TechnicalIndicators['trendMid']   = sma20 > sma50 ? 'up' : sma20 < sma50 * 0.98 ? 'down' : 'sideways';
  const trendLong:  TechnicalIndicators['trendLong']  = cur > sma200 ? 'up' : cur < sma200 * 0.98 ? 'down' : 'sideways';
  const ichimoku    = getIchimoku(candles);

  // ── Parabolic SAR ──────────────────────────────────────────────────────────
  const psar = computeParabolicSAR(highs, lows, closes);

  // ── Keltner Channel ────────────────────────────────────────────────────────
  const keltner = computeKeltner(candles);

  // ── Support / Resistance ───────────────────────────────────────────────────
  const safeMin = (arr: number[]) => arr.length > 0 ? Math.min(...arr.filter(v => v > 0 && isFinite(v))) : cur * 0.95;
  const safeMax = (arr: number[]) => arr.length > 0 ? Math.max(...arr.filter(v => v > 0 && isFinite(v))) : cur * 1.05;
  const support1    = safeMin(lows.slice(-15));
  const support2    = safeMin(lows.slice(-30));
  const support3    = safeMin(lows.slice(-60));
  const resistance1 = safeMax(highs.slice(-15));
  const resistance2 = safeMax(highs.slice(-30));
  const resistance3 = safeMax(highs.slice(-60));

  const pivot = (highs[n-1] + lows[n-1] + closes[n-1]) / 3;
  const r1 = 2 * pivot - lows[n-1];
  const r2 = pivot + (highs[n-1] - lows[n-1]);
  const r3 = highs[n-1] + 2 * (pivot - lows[n-1]);
  const s1 = 2 * pivot - highs[n-1];
  const s2 = pivot - (highs[n-1] - lows[n-1]);
  const s3 = lows[n-1] - 2 * (highs[n-1] - pivot);

  const { fib382, fib500, fib618 } = fibonacci(highs, lows);
  const hv30    = computeHV(closes, 30);
  const candle  = detectCandle(candles);

  // ── PSX Context ────────────────────────────────────────────────────────────
  const high52w = Math.max(...closes.slice(-252));
  const low52w  = Math.min(...closes.slice(-252));
  const priceVsVwapPct      = vwap > 0 ? ((cur - vwap) / vwap) * 100 : 0;
  const priceVs52wHighPct   = high52w > 0 ? ((cur - high52w) / high52w) * 100 : 0;
  const priceVs52wLowPct    = low52w  > 0 ? ((cur - low52w)  / low52w)  * 100 : 0;
  const goldenCrossActive   = sma50 > sma200;
  const deathCrossActive    = sma50 < sma200;
  const tc                  = trendConsistency(trendShort, trendMid, trendLong);

  // Relative strength vs index: approximate using price momentum ratio
  // (in production: pass kse100Returns and compute beta-adjusted)
  const roc5  = closes.length >= 6  ? ((cur - closes[closes.length - 6])  / closes[closes.length - 6])  * 100 : 0;
  const relativeStrengthVsIndex = parseFloat((1 + roc5 / 100).toFixed(3)); // placeholder until index feed added

  // ── Sanity: replace any NaN/Infinity with safe fallbacks ────────────────
  const safe = (v: number, fb: number) => (isNaN(v) || !isFinite(v)) ? fb : v;
  const safeP = (v: number) => safe(v, cur);  // price fallback
  const safePct = (v: number) => safe(v, 0);   // percent fallback

  return {
    sma10: safeP(sma10), sma20: safeP(sma20), sma50: safeP(sma50),
    sma100: safeP(sma100), sma200: safeP(sma200),
    ema9: safeP(ema9), ema12: safeP(ema12), ema21: safeP(ema21),
    ema26: safeP(ema26), ema50: safeP(ema50), vwap: safeP(vwap),
    rsi14:  safe(rsi14, 50),  rsi9: safe(rsi9, 50), rsiDivergence: rsiDiv,
    macdLine:      safePct(macdLine),
    macdSignalLine: safePct(macdSigLine),
    macdHistogram:  safePct(macdHist),
    macdSignal,
    stochasticK: safe(stochasticK, 50), stochasticD: safe(stochasticD, 50),
    williamsR:   safe(williamsR, -50),
    cci20:       safePct(cci20),
    mfi14:       safe(mfi14, 50),
    roc10:       safePct(roc10),
    atr14:       safe(atr14, cur * 0.01),
    atrPct:      safe(atrPct, 1),
    bbUpper: safeP(bbUpper), bbMid: safeP(bbMid), bbLower: safeP(bbLower),
    bbWidth: safe(bbWidth, 0.04), bbSqueeze, bbPosition,
    historicalVolatility30d: safe(hv30, 20),
    obv: safePct(obv), obvTrend, obvDivergence: obvDiv,
    volumeRatio: safe(volumeRatio, 1), volumeSignal,
    accDistLine: safePct(adLine), chaikinMoneyFlow: safe(cmf, 0),
    adx14: safe(adx14, 20), diPlus: safe(diPlus, 20), diMinus: safe(diMinus, 20),
    trendShort, trendMid, trendLong, ichimokuSignal: ichimoku,
    parabolicSarSignal: psar.signal,
    parabolicSarValue:  safeP(psar.value),
    keltnerUpper: safeP(keltner.upper),
    keltnerMid:   safeP(keltner.mid),
    keltnerLower: safeP(keltner.lower),
    keltnerPosition: keltner.position,
    support1: safeP(support1), support2: safeP(support2), support3: safeP(support3),
    resistance1: safeP(resistance1), resistance2: safeP(resistance2), resistance3: safeP(resistance3),
    pivot: safeP(pivot), r1: safeP(r1), r2: safeP(r2), r3: safeP(r3),
    s1: safeP(s1), s2: safeP(s2), s3: safeP(s3),
    fibRetracement382: safeP(fib382),
    fibRetracement500: safeP(fib500),
    fibRetracement618: safeP(fib618),
    candlestickPattern: candle.pattern,
    candlestickBullish: candle.bullish,
    priceVsVwapPct:         safePct(priceVsVwapPct),
    priceVs52wHighPct:      safePct(priceVs52wHighPct),
    priceVs52wLowPct:       safePct(priceVs52wLowPct),
    goldenCrossActive,
    deathCrossActive,
    trendConsistency:       tc,
    relativeStrengthVsIndex: safe(relativeStrengthVsIndex, 1),
  };
}
