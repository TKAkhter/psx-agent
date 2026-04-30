import {
  RSI, MACD, BollingerBands, SMA, EMA, ATR, Stochastic,
  WilliamsR, CCI, MFI, ROC, ADX,
} from 'technicalindicators';
import type {
  OHLCVCandle, TechnicalIndicators,
  BBPosition, MacdSignal, OBVTrend, VolumeSignal, TrendDirection,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const last   = <T>(arr: T[] | undefined): T | undefined => arr?.[arr.length - 1];
const lastN  = (arr: number[] | undefined) => arr?.[arr.length - 1] ?? 0;
const min3   = (...v: number[]) => Math.min(...v);
const max3   = (...v: number[]) => Math.max(...v);

// ─── OBV ─────────────────────────────────────────────────────────────────────
function computeOBV(candles: OHLCVCandle[]): number[] {
  const obv = [0];
  for (let i = 1; i < candles.length; i++) {
    const v = candles[i].volume;
    obv.push(obv[i-1] + (candles[i].close > candles[i-1].close ? v : candles[i].close < candles[i-1].close ? -v : 0));
  }
  return obv;
}

function obvTrend(series: number[], n = 7): OBVTrend {
  if (series.length < n) return 'neutral';
  const recent = series.slice(-n);
  let ups = 0; let downs = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i-1]) ups++;
    else if (recent[i] < recent[i-1]) downs++;
  }
  if (ups >= n-2) return 'accumulation';
  if (downs >= n-2) return 'distribution';
  return 'neutral';
}

// ─── Accumulation / Distribution & CMF ───────────────────────────────────────
function computeAD(candles: OHLCVCandle[]): number[] {
  const ad = [0];
  for (let i = 1; i < candles.length; i++) {
    const { high, low, close, volume } = candles[i];
    const mfm = high === low ? 0 : ((close - low) - (high - close)) / (high - low);
    ad.push(ad[i-1] + mfm * volume);
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

// ─── VWAP ─────────────────────────────────────────────────────────────────────
function computeVWAP(candles: OHLCVCandle[]): number {
  const slice = candles.slice(-20);
  let pvSum = 0; let vSum = 0;
  for (const c of slice) {
    const tp = (c.high + c.low + c.close) / 3;
    pvSum += tp * c.volume; vSum += c.volume;
  }
  return vSum === 0 ? 0 : pvSum / vSum;
}

// ─── Historical Volatility ────────────────────────────────────────────────────
function computeHV(closes: number[], period = 30): number {
  if (closes.length < period + 1) return 0;
  const returns = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i-1]));
  }
  const mean = returns.reduce((s,v)=>s+v,0)/returns.length;
  const variance = returns.reduce((s,v)=>s+(v-mean)**2,0)/(returns.length-1);
  return Math.sqrt(variance * 252) * 100; // annualised %
}

// ─── RSI Divergence ───────────────────────────────────────────────────────────
function detectRsiDivergence(closes: number[], rsiVals: number[], n = 14): 'bullish' | 'bearish' | 'none' {
  if (closes.length < n*2 || rsiVals.length < n*2) return 'none';
  const priceRecent = closes.slice(-n);
  const rsiRecent   = rsiVals.slice(-n);
  const pricePrev   = closes.slice(-n*2, -n);
  const rsiPrev     = rsiVals.slice(-n*2, -n);
  const priceLow = Math.min(...priceRecent) < Math.min(...pricePrev);
  const rsiHigh  = Math.min(...rsiRecent)   > Math.min(...rsiPrev);
  if (priceLow && rsiHigh) return 'bullish';   // price lower low but RSI higher low
  const priceHigh = Math.max(...priceRecent) > Math.max(...pricePrev);
  const rsiLow    = Math.max(...rsiRecent)   < Math.max(...rsiPrev);
  if (priceHigh && rsiLow) return 'bearish';   // price higher high but RSI lower high
  return 'none';
}

// ─── Ichimoku (simplified cloud signal) ──────────────────────────────────────
function ichimokuSignal(candles: OHLCVCandle[]): TechnicalIndicators['ichimokuSignal'] {
  if (candles.length < 52) return 'inside_cloud';
  const closes = candles.map(c=>c.close);
  const highs  = candles.map(c=>c.high);
  const lows   = candles.map(c=>c.low);
  const tenkan = (Math.max(...highs.slice(-9))  + Math.min(...lows.slice(-9)))  / 2;
  const kijun  = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = (Math.max(...highs.slice(-52)) + Math.min(...lows.slice(-52))) / 2;
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBot = Math.min(senkouA, senkouB);
  const price = closes[closes.length-1];
  if (price > cloudTop) return 'above_cloud';
  if (price < cloudBot) return 'below_cloud';
  return 'inside_cloud';
}

// ─── Candlestick Patterns ─────────────────────────────────────────────────────
function detectPattern(candles: OHLCVCandle[]): { pattern: string; bullish: boolean } {
  if (candles.length < 3) return { pattern: 'none', bullish: false };
  const [c2, c1, c0] = candles.slice(-3);

  const body0  = Math.abs(c0.close - c0.open);
  const range0 = c0.high - c0.low || 0.001;
  const isBull0 = c0.close > c0.open;
  const isBear0 = c0.close < c0.open;
  const isBull1 = c1.close > c1.open;
  const isBear1 = c1.close < c1.open;

  // Doji — tiny body relative to range
  if (body0 / range0 < 0.08) return { pattern: 'doji', bullish: false };

  // Hammer — long lower wick, small body at top, after downtrend
  const lowerWick = (isBull0 ? c0.open : c0.close) - c0.low;
  if (lowerWick > body0 * 2.5 && isBull0 && c0.low < c1.low)
    return { pattern: 'hammer', bullish: true };

  // Shooting star — long upper wick after uptrend
  const upperWick = c0.high - (isBull0 ? c0.close : c0.open);
  if (upperWick > body0 * 2.5 && isBear0 && c0.high > c1.high)
    return { pattern: 'shooting_star', bullish: false };

  // Bullish engulfing
  if (isBear1 && isBull0 && c0.open <= c1.close && c0.close >= c1.open)
    return { pattern: 'bullish_engulfing', bullish: true };

  // Bearish engulfing
  if (isBull1 && isBear0 && c0.open >= c1.close && c0.close <= c1.open)
    return { pattern: 'bearish_engulfing', bullish: false };

  // Morning star (3-candle reversal)
  const isBear2 = c2.close < c2.open;
  const smallBody1 = Math.abs(c1.close - c1.open) / (c1.high - c1.low || 0.001) < 0.3;
  if (isBear2 && smallBody1 && isBull0 && c0.close > (c2.open + c2.close)/2)
    return { pattern: 'morning_star', bullish: true };

  // Evening star
  const isBull2 = c2.close > c2.open;
  if (isBull2 && smallBody1 && isBear0 && c0.close < (c2.open + c2.close)/2)
    return { pattern: 'evening_star', bullish: false };

  // Inverted hammer (bullish)
  if (upperWick > body0 * 2 && isBull0)
    return { pattern: 'inverted_hammer', bullish: true };

  // Spinning top — almost equal wicks, small body → indecision
  if (lowerWick > body0 && upperWick > body0 && body0 / range0 < 0.35)
    return { pattern: 'spinning_top', bullish: false };

  return { pattern: 'none', bullish: false };
}

// ─── Fibonacci Retracement ────────────────────────────────────────────────────
function fibonacci(highs: number[], lows: number[], n = 50) {
  const sliceH = highs.slice(-n); const sliceL = lows.slice(-n);
  const swingHigh = Math.max(...sliceH);
  const swingLow  = Math.min(...sliceL);
  const diff = swingHigh - swingLow;
  return {
    fib382: swingHigh - 0.382 * diff,
    fib500: swingHigh - 0.500 * diff,
    fib618: swingHigh - 0.618 * diff,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function computeTechnicalIndicators(candles: OHLCVCandle[]): TechnicalIndicators {
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const n       = closes.length;
  const cur     = closes[n-1];

  // ── Moving Averages ──────────────────────────────────────────────────────────
  const sma10  = lastN(SMA.calculate({ period: 10,  values: closes }));
  const sma20  = lastN(SMA.calculate({ period: 20,  values: closes }));
  const sma50  = lastN(SMA.calculate({ period: 50,  values: closes }));
  const sma100 = lastN(SMA.calculate({ period: 100, values: closes }));
  const sma200 = lastN(SMA.calculate({ period: 200, values: closes }));
  const ema9   = lastN(EMA.calculate({ period: 9,   values: closes }));
  const ema12  = lastN(EMA.calculate({ period: 12,  values: closes }));
  const ema21  = lastN(EMA.calculate({ period: 21,  values: closes }));
  const ema26  = lastN(EMA.calculate({ period: 26,  values: closes }));
  const ema50  = lastN(EMA.calculate({ period: 50,  values: closes }));
  const vwap   = computeVWAP(candles);

  // ── RSI ──────────────────────────────────────────────────────────────────────
  const rsiVals14 = RSI.calculate({ period: 14, values: closes });
  const rsiVals9  = RSI.calculate({ period: 9,  values: closes });
  const rsi14     = lastN(rsiVals14);
  const rsi9      = lastN(rsiVals9);
  const rsiDiv    = detectRsiDivergence(closes, rsiVals14);

  // ── MACD ─────────────────────────────────────────────────────────────────────
  const macdVals = MACD.calculate({ values: closes, fastPeriod:12, slowPeriod:26, signalPeriod:9, SimpleMAOscillator:false, SimpleMASignal:false });
  const macdCur  = macdVals[macdVals.length-1];
  const macdPrev = macdVals[macdVals.length-2];
  const macdLine      = macdCur?.MACD    ?? 0;
  const macdSignalLine = macdCur?.signal  ?? 0;
  const macdHistogram  = macdCur?.histogram ?? 0;
  const prevHist       = macdPrev?.histogram ?? 0;

  let macdSignal: MacdSignal = 'none';
  if      (macdHistogram > 0 && prevHist <= 0)   macdSignal = 'bullish_cross';
  else if (macdHistogram < 0 && prevHist >= 0)   macdSignal = 'bearish_cross';
  else if (macdHistogram > 0 && macdLine > 0)    macdSignal = 'bullish';
  else if (macdHistogram < 0 && macdLine < 0)    macdSignal = 'bearish';

  // ── Stochastic ────────────────────────────────────────────────────────────────
  const stochVals = Stochastic.calculate({ high: highs, low: lows, close: closes, period:14, signalPeriod:3 });
  const stochCur  = stochVals[stochVals.length-1];
  const stochasticK = stochCur?.k ?? 50;
  const stochasticD = stochCur?.d ?? 50;

  // ── Williams %R ───────────────────────────────────────────────────────────────
  const wrVals  = WilliamsR.calculate({ high: highs, low: lows, close: closes, period:14 });
  const williamsR = lastN(wrVals);

  // ── CCI ───────────────────────────────────────────────────────────────────────
  const cciVals = CCI.calculate({ high: highs, low: lows, close: closes, period:20 });
  const cci20   = lastN(cciVals);

  // ── MFI ───────────────────────────────────────────────────────────────────────
  const mfiVals = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period:14 });
  const mfi14   = lastN(mfiVals);

  // ── ROC ───────────────────────────────────────────────────────────────────────
  const rocVals = ROC.calculate({ values: closes, period:10 });
  const roc10   = lastN(rocVals);

  // ── ATR ───────────────────────────────────────────────────────────────────────
  const atrVals = ATR.calculate({ high: highs, low: lows, close: closes, period:14 });
  const atr14   = lastN(atrVals);
  const atrPct  = cur > 0 ? atr14 / cur * 100 : 0;

  // ── Bollinger Bands ───────────────────────────────────────────────────────────
  const bbVals  = BollingerBands.calculate({ period:20, values: closes, stdDev:2 });
  const bbCur   = bbVals[bbVals.length-1];
  const bbUpper = bbCur?.upper  ?? cur*1.02;
  const bbMid   = bbCur?.middle ?? cur;
  const bbLower = bbCur?.lower  ?? cur*0.98;
  const bbWidth = bbMid > 0 ? (bbUpper - bbLower) / bbMid : 0;
  const bbSqueeze = bbWidth < 0.05;  // tight band = potential breakout

  let bbPosition: BBPosition = 'middle';
  if      (cur > bbUpper)                   bbPosition = 'above_upper';
  else if (cur > bbMid + (bbUpper-bbMid)*0.5) bbPosition = 'inside_upper';
  else if (cur < bbLower)                   bbPosition = 'below_lower';
  else if (cur < bbMid - (bbMid-bbLower)*0.5) bbPosition = 'inside_lower';

  // ── ADX / DI ──────────────────────────────────────────────────────────────────
  const adxVals = ADX.calculate({ high: highs, low: lows, close: closes, period:14 });
  const adxCur  = adxVals[adxVals.length-1];
  const adx14   = adxCur?.adx  ?? 20;
  const diPlus  = adxCur?.pdi  ?? 20;
  const diMinus = adxCur?.mdi  ?? 20;

  // ── Volume ────────────────────────────────────────────────────────────────────
  const obvSeries   = computeOBV(candles);
  const obv         = lastN(obvSeries);
  const obvTrendVal = obvTrend(obvSeries);
  const avgVol20    = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
  const volumeRatio = avgVol20 > 0 ? volumes[n-1]/avgVol20 : 1;
  const adLine      = lastN(computeAD(candles));
  const cmf         = computeCMF(candles);

  let volumeSignal: VolumeSignal = 'normal';
  if (volumeRatio > 2.0) volumeSignal = cur > candles[n-1].open ? 'spike_up' : 'spike_down';

  // ── Trend ─────────────────────────────────────────────────────────────────────
  const trendShort: TrendDirection = cur > sma20  ? 'up' : cur < sma20*0.98  ? 'down' : 'sideways';
  const trendMid:   TrendDirection = sma20 > sma50 ? 'up' : sma20 < sma50*0.98 ? 'down' : 'sideways';
  const trendLong:  TrendDirection = cur > sma200 ? 'up' : cur < sma200*0.98 ? 'down' : 'sideways';
  const ichimoku    = ichimokuSignal(candles);

  // ── Support / Resistance ──────────────────────────────────────────────────────
  const support1    = Math.min(...lows.slice(-15));
  const support2    = Math.min(...lows.slice(-30));
  const support3    = Math.min(...lows.slice(-60));
  const resistance1 = Math.max(...highs.slice(-15));
  const resistance2 = Math.max(...highs.slice(-30));
  const resistance3 = Math.max(...highs.slice(-60));

  // Pivot points
  const pivot = (highs[n-1] + lows[n-1] + closes[n-1]) / 3;
  const r1 = 2*pivot - lows[n-1];
  const r2 = pivot + (highs[n-1] - lows[n-1]);
  const r3 = highs[n-1] + 2*(pivot - lows[n-1]);
  const s1 = 2*pivot - highs[n-1];
  const s2 = pivot - (highs[n-1] - lows[n-1]);
  const s3 = lows[n-1] - 2*(highs[n-1] - pivot);

  const { fib382, fib500, fib618 } = fibonacci(highs, lows);
  const hv30 = computeHV(closes, 30);
  const candle = detectPattern(candles);

  return {
    sma10, sma20, sma50, sma100, sma200,
    ema9, ema12, ema21, ema26, ema50, vwap,
    rsi14, rsi9, rsiDivergence: rsiDiv,
    macdLine, macdSignalLine, macdHistogram, macdSignal,
    stochasticK, stochasticD,
    williamsR, cci20, mfi14, roc10,
    atr14, atrPct,
    bbUpper, bbMid, bbLower, bbWidth, bbSqueeze, bbPosition,
    historicalVolatility30d: hv30,
    obv, obvTrend: obvTrendVal, volumeRatio, volumeSignal,
    accDistLine: adLine, chaikinMoneyFlow: cmf,
    adx14, diPlus, diMinus,
    trendShort, trendMid, trendLong, ichimokuSignal: ichimoku,
    support1, support2, support3,
    resistance1, resistance2, resistance3,
    pivot, r1, r2, r3, s1, s2, s3,
    fibRetracement382: fib382,
    fibRetracement500: fib500,
    fibRetracement618: fib618,
    candlestickPattern: candle.pattern,
    candlestickBullish: candle.bullish,
  };
}
