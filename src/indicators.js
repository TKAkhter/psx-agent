"use strict";

// ─────────────────────────────────────────────────────────────
//  MATH UTILITIES
// ─────────────────────────────────────────────────────────────

/** Round to 2 decimal places; returns null for invalid values */
const round2 = (n) => (n == null || isNaN(n) || !isFinite(n)) ? null : Math.round(n * 100) / 100;

/** Percentage change from b to a */
const calcPct = (a, b) => (b && b !== 0) ? round2(((a - b) / b) * 100) : null;

/** Simple moving average of last n values */
const sma = (arr, n) => {
    const slice = arr.slice(-n);
    return slice.length === n ? slice.reduce((s, v) => s + v, 0) / n : null;
};

/** Population std deviation */
const stdDev = (arr) => {
    if (!arr.length) return 0;
    const m = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

/** Clamp a value between lo and hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));


// ─────────────────────────────────────────────────────────────
//  MOVING AVERAGES
// ─────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * Returns full array of EMA values (same length as input).
 */
function calcEMA(arr, period) {
    if (!arr || arr.length < period) return [];
    const k = 2 / (period + 1);
    // Seed with SMA of first `period` bars
    const seed = arr.slice(0, period).reduce((s, v) => s + v, 0) / period;
    const out = new Array(period - 1).fill(null);
    out.push(seed);
    for (let i = period; i < arr.length; i++) {
        out.push(arr[i] * k + out[i - 1] * (1 - k));
    }
    return out;
}

/**
 * Simple Moving Average — returns single value for last n bars.
 */
function calcSMA(arr, period) {
    if (!arr || arr.length < period) return null;
    return round2(sma(arr, period));
}

/**
 * Wilder's Smoothing (used in RSI, ADX).
 * Different from EMA: k = 1/period.
 */
function wilderSmooth(arr, period) {
    if (!arr || arr.length < period) return [];
    const out = new Array(period - 1).fill(null);
    // Seed = simple sum of first period values
    let prev = arr.slice(0, period).reduce((s, v) => s + v, 0);
    out.push(prev);
    for (let i = period; i < arr.length; i++) {
        prev = prev - (prev / period) + arr[i];
        out.push(prev);
    }
    return out;
}


// ─────────────────────────────────────────────────────────────
//  RSI  (Wilder's Smoothed — industry standard)
// ─────────────────────────────────────────────────────────────

/**
 * RSI using Wilder's smoothing.
 * Returns single RSI value for the last bar.
 */
function calcRSI(close, period = 14) {
    if (!close || close.length < period + 1) return null;

    const gains = [], losses = [];
    for (let i = 1; i < close.length; i++) {
        const delta = close[i] - close[i - 1];
        gains.push(delta > 0 ? delta : 0);
        losses.push(delta < 0 ? -delta : 0);
    }

    // Initial averages (simple mean for seed)
    let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;

    // Wilder smoothing for remaining bars
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return round2(100 - 100 / (1 + rs));
}


// ─────────────────────────────────────────────────────────────
//  MACD  (12-26-9 standard)
// ─────────────────────────────────────────────────────────────

function calcMACD(close) {
    const EMPTY = { macd: null, signal: null, histogram: null, prevHistogram: null, crossover: null, histTrend: null };
    if (!close || close.length < 35) return EMPTY;  // need 26 + 9 minimum

    const ema12 = calcEMA(close, 12);
    const ema26 = calcEMA(close, 26);

    // MACD line: only valid where both EMAs are valid (from index 25 onward)
    const macdLine = close.map((_, i) => (ema12[i] != null && ema26[i] != null) ? ema12[i] - ema26[i] : null);
    const validMacd = macdLine.filter(v => v != null);

    if (validMacd.length < 9) return EMPTY;

    // Signal: 9-period EMA of MACD line
    const signalArr = calcEMA(validMacd, 9);
    const lastMacd = validMacd.at(-1);
    const prevMacd = validMacd.at(-2);
    const lastSig = signalArr.at(-1);
    const prevSig = signalArr.at(-2);
    const lastHist = lastMacd - lastSig;
    const prevHist = prevMacd - (prevSig ?? lastSig);

    const crossover = (lastMacd > lastSig && prevMacd <= prevSig) ? "BULLISH_CROSS"
        : (lastMacd < lastSig && prevMacd >= prevSig) ? "BEARISH_CROSS"
            : null;

    return {
        macd: round2(lastMacd),
        signal: round2(lastSig),
        histogram: round2(lastHist),
        prevHistogram: round2(prevHist),
        crossover,
        histTrend: lastHist > prevHist ? "EXPANDING" : "CONTRACTING",
    };
}


// ─────────────────────────────────────────────────────────────
//  BOLLINGER BANDS  (20-period, 2 std)
// ─────────────────────────────────────────────────────────────

function calcBollinger(close, period = 20, mult = 2) {
    if (!close || close.length < period) return null;
    const slice = close.slice(-period);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const sd = stdDev(slice);
    const upper = mean + mult * sd;
    const lower = mean - mult * sd;
    const price = close.at(-1);
    const bw = mean > 0 ? (upper - lower) / mean * 100 : 0;
    // %B: 0 = at lower band, 100 = at upper band
    const pctB = (upper - lower) > 0 ? (price - lower) / (upper - lower) * 100 : 50;

    return {
        upper: round2(upper),
        lower: round2(lower),
        mid: round2(mean),
        bandwidth: round2(bw),
        pctB: round2(pctB),
        squeeze: bw < 4,   // bandwidth < 4% = squeeze
    };
}


// ─────────────────────────────────────────────────────────────
//  STOCHASTIC  (%K smoothed 3, %D = SMA3 of %K)  FIX: correct D calc
// ─────────────────────────────────────────────────────────────

function calcStochastic(hist, kPeriod = 14, smoothK = 3, smoothD = 3) {
    if (!hist || hist.length < kPeriod + smoothK + smoothD - 2)
        return { k: null, d: null, zone: null, kCrossD: null };

    // Raw %K for every bar
    const rawK = [];
    for (let i = kPeriod - 1; i < hist.length; i++) {
        const slice = hist.slice(i - kPeriod + 1, i + 1);
        const lo = Math.min(...slice.map(b => b.low));
        const hi = Math.max(...slice.map(b => b.high));
        rawK.push(hi === lo ? 50 : (hist[i].close - lo) / (hi - lo) * 100);
    }

    // Smooth %K with SMA(smoothK)
    const smoothedK = [];
    for (let i = smoothK - 1; i < rawK.length; i++) {
        const sl = rawK.slice(i - smoothK + 1, i + 1);
        smoothedK.push(sl.reduce((s, v) => s + v, 0) / smoothK);
    }

    // %D = SMA(smoothD) of smoothed %K — FIX: was broken in previous version
    const smoothedD = [];
    for (let i = smoothD - 1; i < smoothedK.length; i++) {
        const sl = smoothedK.slice(i - smoothD + 1, i + 1);
        smoothedD.push(sl.reduce((s, v) => s + v, 0) / smoothD);
    }

    if (!smoothedK.length || !smoothedD.length) return { k: null, d: null, zone: null, kCrossD: null };

    const k = round2(smoothedK.at(-1));
    const d = round2(smoothedD.at(-1));
    const prevK = smoothedK.at(-2);
    const prevD = smoothedD.at(-2);

    const zone = k < 20 ? "OVERSOLD" : k > 80 ? "OVERBOUGHT" : "NEUTRAL";
    // %K crossing %D (bullish when K crosses above D from oversold, bearish from overbought)
    const kCrossD = (prevK != null && prevD != null)
        ? (k > d && prevK <= prevD ? "BULLISH" : k < d && prevK >= prevD ? "BEARISH" : null)
        : null;

    return { k, d, zone, kCrossD };
}


// ─────────────────────────────────────────────────────────────
//  ATR  (Wilder's smoothed Average True Range)
// ─────────────────────────────────────────────────────────────

function calcATR(hist, period = 14) {
    if (!hist || hist.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < hist.length; i++) {
        const hi = hist[i].high, lo = hist[i].low, pc = hist[i - 1].close;
        trs.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
    }
    // Wilder smoothing
    let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }
    return round2(atr);
}


// ─────────────────────────────────────────────────────────────
//  ADX  (Wilder's smoothed — FIX: correct Wilder smoothing, not simple sum)
// ─────────────────────────────────────────────────────────────

function calcADX(hist, period = 14) {
    const EMPTY = { adx: null, diPlus: null, diMinus: null, strength: null };
    if (!hist || hist.length < period * 2 + 1) return EMPTY;

    const trArr = [], dmPlusArr = [], dmMinusArr = [];
    for (let i = 1; i < hist.length; i++) {
        const hi = hist[i].high, lo = hist[i].low, pc = hist[i - 1].close;
        const ph = hist[i - 1].high, pl = hist[i - 1].low;
        trArr.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
        const upMove = hi - ph;
        const downMove = pl - lo;
        dmPlusArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
        dmMinusArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Wilder initial seed = first period sum
    let sTR = trArr.slice(0, period).reduce((s, v) => s + v, 0);
    let sDMp = dmPlusArr.slice(0, period).reduce((s, v) => s + v, 0);
    let sDMm = dmMinusArr.slice(0, period).reduce((s, v) => s + v, 0);

    const dxArr = [];
    // First DX after seed
    const di1p = sTR > 0 ? (sDMp / sTR) * 100 : 0;
    const di1m = sTR > 0 ? (sDMm / sTR) * 100 : 0;
    const sum1 = di1p + di1m;
    if (sum1 > 0) dxArr.push(Math.abs(di1p - di1m) / sum1 * 100);

    for (let i = period; i < trArr.length; i++) {
        sTR = sTR - sTR / period + trArr[i];
        sDMp = sDMp - sDMp / period + dmPlusArr[i];
        sDMm = sDMm - sDMm / period + dmMinusArr[i];
        const dip = sTR > 0 ? (sDMp / sTR) * 100 : 0;
        const dim = sTR > 0 ? (sDMm / sTR) * 100 : 0;
        const sdi = dip + dim;
        if (sdi > 0) dxArr.push(Math.abs(dip - dim) / sdi * 100);
    }

    if (dxArr.length < period) return EMPTY;

    // ADX = Wilder smooth of DX
    let adxVal = dxArr.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < dxArr.length; i++) {
        adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
    }

    // Current DI+ and DI- from last smoothed values
    const lastDiP = sTR > 0 ? round2((sDMp / sTR) * 100) : 0;
    const lastDiM = sTR > 0 ? round2((sDMm / sTR) * 100) : 0;
    const adx = round2(adxVal);

    // Strength interpretation
    const strength = adx >= 40 ? "VERY_STRONG"
        : adx >= 25 ? (lastDiP > lastDiM ? "STRONG_BULL" : "STRONG_BEAR")
            : adx >= 15 ? (lastDiP > lastDiM ? "WEAK_BULL" : "WEAK_BEAR")
                : "RANGING";

    return { adx, diPlus: lastDiP, diMinus: lastDiM, strength };
}


// ─────────────────────────────────────────────────────────────
//  WILLIAMS %R
// ─────────────────────────────────────────────────────────────

function calcWilliamsR(hist, period = 14) {
    if (!hist || hist.length < period) return null;
    const slice = hist.slice(-period);
    const hi = Math.max(...slice.map(b => b.high));
    const lo = Math.min(...slice.map(b => b.low));
    const close = hist.at(-1).close;
    if (hi === lo) return -50;
    return round2(((hi - close) / (hi - lo)) * -100);
    // Range: -100 (oversold) to 0 (overbought)
    // < -80: oversold, > -20: overbought
}


// ─────────────────────────────────────────────────────────────
//  CCI  (Commodity Channel Index)
// ─────────────────────────────────────────────────────────────

function calcCCI(hist, period = 20) {
    if (!hist || hist.length < period) return null;
    const slice = hist.slice(-period);
    const tps = slice.map(b => (b.high + b.low + b.close) / 3);
    const mean = tps.reduce((s, v) => s + v, 0) / period;
    const md = tps.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    return md > 0 ? round2((tps.at(-1) - mean) / (0.015 * md)) : null;
    // > +100: overbought, < -100: oversold
}


// ─────────────────────────────────────────────────────────────
//  OBV  (On-Balance Volume)
// ─────────────────────────────────────────────────────────────

function calcOBV(hist) {
    if (!hist || hist.length < 10) return { value: 0, trend: "NEUTRAL", slopeScore: 0 };
    let obv = 0;
    const series = [];
    for (let i = 0; i < hist.length; i++) {
        if (i === 0) { series.push(0); continue; }
        if (hist[i].close > hist[i - 1].close) obv += (hist[i].volume || 0);
        else if (hist[i].close < hist[i - 1].close) obv -= (hist[i].volume || 0);
        series.push(obv);
    }
    // Compare last 5 bars vs prior 5 bars
    const recent = series.slice(-5);
    const prior = series.slice(-10, -5);
    const avgRecent = recent.reduce((s, v) => s + v, 0) / 5;
    const avgPrior = prior.reduce((s, v) => s + v, 0) / 5;

    // Slope score: percentage change in OBV
    const slopeScore = avgPrior !== 0 ? round2((avgRecent - avgPrior) / Math.abs(avgPrior) * 100) : 0;
    const trend = avgRecent > avgPrior * 1.02 ? "ACCUMULATION"
        : avgRecent < avgPrior * 0.98 ? "DISTRIBUTION"
            : "NEUTRAL";

    return { value: series.at(-1), trend, slopeScore };
}


// ─────────────────────────────────────────────────────────────
//  VWAP  (Volume-Weighted Average Price — 20-day rolling)
// ─────────────────────────────────────────────────────────────

function calcVWAP(hist) {
    if (!hist || hist.length < 5) return null;
    const slice = hist.slice(-20);
    let numSum = 0, denSum = 0;
    for (const bar of slice) {
        const typicalPrice = (bar.high + bar.low + bar.close) / 3;
        const vol = bar.volume || 1;
        numSum += typicalPrice * vol;
        denSum += vol;
    }
    return denSum > 0 ? round2(numSum / denSum) : null;
}


// ─────────────────────────────────────────────────────────────
//  ICHIMOKU CLOUD
// ─────────────────────────────────────────────────────────────

function calcIchimoku(hist) {
    if (!hist || hist.length < 52) return null;

    const midpoint = (bars) => {
        const hi = Math.max(...bars.map(b => b.high));
        const lo = Math.min(...bars.map(b => b.low));
        return (hi + lo) / 2;
    };

    const tenkan = round2(midpoint(hist.slice(-9)));   // Conversion: 9-period
    const kijun = round2(midpoint(hist.slice(-26)));  // Base: 26-period
    const senkouA = round2((tenkan + kijun) / 2);       // Span A
    const senkouB = round2(midpoint(hist.slice(-52)));  // Span B: 52-period

    const price = hist.at(-1).close;
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);

    const position = price > cloudTop ? "ABOVE_CLOUD"
        : price < cloudBottom ? "BELOW_CLOUD"
            : "IN_CLOUD";

    // Chikou span: current close vs price 26 bars ago
    const chikouBullish = hist.length >= 27
        ? hist.at(-1).close > hist.at(-27).close
        : null;

    return {
        tenkan,
        kijun,
        senkouA,
        senkouB,
        position,
        tkBullish: tenkan > kijun,    // TK cross: bullish when T > K
        cloudColor: senkouA >= senkouB ? "GREEN" : "RED",
        chikouBullish,
        distanceToCloud: round2(price > cloudTop ? price - cloudTop : cloudBottom - price),
    };
}


// ─────────────────────────────────────────────────────────────
//  PIVOT POINTS  (FIX: use PREVIOUS day's H/L/C — standard formula)
// ─────────────────────────────────────────────────────────────

function calcPivots(hist) {
    if (!hist || hist.length < 2) return null;
    // Use the last COMPLETED day (index -2), not today's partial data
    const prev = hist.at(-2);
    const hi = prev.high, lo = prev.low, cl = prev.close;
    const p = (hi + lo + cl) / 3;

    return {
        r3: round2(hi + 2 * (p - lo)),
        r2: round2(p + (hi - lo)),
        r1: round2(2 * p - lo),
        pivot: round2(p),
        s1: round2(2 * p - hi),
        s2: round2(p - (hi - lo)),
        s3: round2(lo - 2 * (hi - p)),
    };
}


// ─────────────────────────────────────────────────────────────
//  RSI DIVERGENCE  (basic: price new low but RSI higher low)
// ─────────────────────────────────────────────────────────────

function detectDivergence(close, rsiSeries) {
    if (!close || close.length < 20 || !rsiSeries || rsiSeries.length < 20) return null;

    const priceRecent = close.at(-1);
    const pricePrev = Math.min(...close.slice(-20, -1));
    const rsiRecent = rsiSeries.at(-1);
    const rsiPrev = rsiSeries[rsiSeries.indexOf(pricePrev) !== -1 ? rsiSeries.length - 20 : rsiSeries.length - 10];

    // Bullish divergence: price made lower low but RSI made higher low
    if (priceRecent < pricePrev && rsiRecent > (rsiPrev || 0)) {
        return "BULLISH_DIVERGENCE";
    }
    // Bearish divergence: price made higher high but RSI made lower high
    const priceHigh = Math.max(...close.slice(-20, -1));
    const rsiHigh = Math.max(...(rsiSeries.slice(-20, -1).filter(v => v != null)));
    if (priceRecent > priceHigh && rsiRecent < rsiHigh) {
        return "BEARISH_DIVERGENCE";
    }
    return null;
}


// ─────────────────────────────────────────────────────────────
//  CANDLESTICK PATTERNS
// ─────────────────────────────────────────────────────────────

function detectPatterns(hist) {
    if (!hist || hist.length < 3) return [];
    const patterns = [];

    const c0 = hist.at(-1);   // today
    const c1 = hist.at(-2);   // yesterday
    const c2 = hist.at(-3);   // day before

    const body0 = Math.abs(c0.close - c0.open);
    const range0 = c0.high - c0.low;
    if (range0 === 0) return patterns;

    const bodyRatio = body0 / range0;
    const upperWick0 = c0.high - Math.max(c0.close, c0.open);
    const lowerWick0 = Math.min(c0.close, c0.open) - c0.low;
    const isBullish0 = c0.close > c0.open;
    const isBullish1 = c1.close > c1.open;

    // ── Doji
    if (bodyRatio < 0.08)
        patterns.push({ name: "Doji", bias: "NEUTRAL", desc: "Indecision — watch next candle for direction" });

    // ── Hammer (bullish reversal — after downtrend)
    if (lowerWick0 > body0 * 2.5 && upperWick0 < body0 * 0.3 && isBullish0)
        patterns.push({ name: "Hammer", bias: "BULLISH", desc: "Buyers rejected lower prices — reversal possible" });

    // ── Inverted Hammer (bullish — after downtrend)
    if (upperWick0 > body0 * 2.5 && lowerWick0 < body0 * 0.3 && isBullish0)
        patterns.push({ name: "Inverted Hammer", bias: "BULLISH", desc: "Buying pressure emerging at lows" });

    // ── Shooting Star (bearish — after uptrend)
    if (upperWick0 > body0 * 2.5 && lowerWick0 < body0 * 0.3 && !isBullish0)
        patterns.push({ name: "Shooting Star", bias: "BEARISH", desc: "Sellers rejected higher prices — reversal possible" });

    // ── Hanging Man (bearish — after uptrend)
    if (lowerWick0 > body0 * 2.5 && upperWick0 < body0 * 0.3 && !isBullish0)
        patterns.push({ name: "Hanging Man", bias: "BEARISH", desc: "Selling pressure emerging at highs" });

    // ── Bullish Engulfing
    if (!isBullish1 && isBullish0 && c0.open <= c1.close && c0.close >= c1.open && body0 > Math.abs(c1.close - c1.open))
        patterns.push({ name: "Bullish Engulfing", bias: "BULLISH", desc: "Bull candle fully engulfs prior red — strong reversal signal" });

    // ── Bearish Engulfing
    if (isBullish1 && !isBullish0 && c0.open >= c1.close && c0.close <= c1.open && body0 > Math.abs(c1.close - c1.open))
        patterns.push({ name: "Bearish Engulfing", bias: "BEARISH", desc: "Bear candle fully engulfs prior green — strong reversal signal" });

    // ── Morning Star (3-candle bullish reversal)
    if (!isBullish1 && isBullish0 && Math.abs(c1.close - c1.open) < Math.abs(c2.close - c2.open) * 0.3)
        patterns.push({ name: "Morning Star", bias: "BULLISH", desc: "3-candle reversal: gap down, indecision, strong bull close" });

    // ── Evening Star (3-candle bearish reversal)
    if (isBullish1 && !isBullish0 && Math.abs(c1.close - c1.open) < Math.abs(c2.close - c2.open) * 0.3)
        patterns.push({ name: "Evening Star", bias: "BEARISH", desc: "3-candle reversal: gap up, indecision, strong bear close" });

    // ── Three White Soldiers
    if (c2.close > c2.open && c1.close > c1.open && c0.close > c0.open
        && c0.close > c1.close && c1.close > c2.close && c0.open > c1.open && c1.open > c2.open)
        patterns.push({ name: "Three White Soldiers", bias: "BULLISH", desc: "3 consecutive strong bull closes — powerful uptrend" });

    // ── Three Black Crows
    if (c2.close < c2.open && c1.close < c1.open && c0.close < c0.open
        && c0.close < c1.close && c1.close < c2.close && c0.open < c1.open && c1.open < c2.open)
        patterns.push({ name: "Three Black Crows", bias: "BEARISH", desc: "3 consecutive strong bear closes — powerful downtrend" });

    return patterns;
}


// ─────────────────────────────────────────────────────────────
//  VOLUME ANALYSIS
// ─────────────────────────────────────────────────────────────

function calcVolumeMetrics(hist) {
    if (!hist || hist.length < 20) return { avgVol: null, volRatio: null, volSpike: false, volTrend: "NEUTRAL" };

    const vols = hist.map(b => b.volume || 0);
    const avgVol = round2(sma(vols, 20));
    const vol5 = round2(sma(vols, 5));
    const volNow = vols.at(-1);
    const volRatio = avgVol > 0 ? round2(volNow / avgVol) : null;

    // Volume trend: is recent volume > 20-day average?
    const volTrend = vol5 > avgVol * 1.2 ? "INCREASING"
        : vol5 < avgVol * 0.8 ? "DECREASING"
            : "STABLE";

    return {
        current: volNow,
        avg20: avgVol,
        avg5: vol5,
        volRatio,
        volSpike: volRatio != null && volRatio > 1.5,
        volTrend,
    };
}


// ─────────────────────────────────────────────────────────────
//  PERFORMANCE STATISTICS  (6m, 1m, 1w, 1d + max drawdown)
// ─────────────────────────────────────────────────────────────

function calcPerfStats(hist, close) {
    if (!hist || !close || hist.length === 0) return {};

    const high6m = round2(Math.max(...hist.map(b => b.high)));
    const low6m = round2(Math.min(...hist.map(b => b.low)));

    let peak = close[0], maxDD = 0;
    for (const c of close) {
        if (c > peak) peak = c;
        const dd = peak > 0 ? (peak - c) / peak * 100 : 0;
        if (dd > maxDD) maxDD = dd;
    }

    const last = close.at(-1);
    return {
        high6m,
        low6m,
        pctFrom6mHigh: calcPct(last, high6m),
        pctFrom6mLow: calcPct(last, low6m),
        perf6m: calcPct(last, close[0]),
        perf1m: calcPct(last, close.length >= 22 ? close.at(-22) : close[0]),
        perf1w: calcPct(last, close.length >= 5 ? close.at(-5) : close[0]),
        perf1d: calcPct(last, close.length >= 2 ? close.at(-2) : close[0]),
        maxDrawdown: round2(maxDD),
    };
}


// ─────────────────────────────────────────────────────────────
//  TREND CLASSIFICATION  (composite score)
// ─────────────────────────────────────────────────────────────

function classifyTrend(price, ma5, ma20, ma50, macd, adx) {
    let bullCount = 0, total = 0;

    if (ma20 != null) { total++; if (price > ma20) bullCount++; }
    if (ma50 != null) { total++; if (price > ma50) bullCount++; }
    if (ma5 != null && ma20 != null) { total++; if (ma5 > ma20) bullCount++; }
    if (ma20 != null && ma50 != null) { total++; if (ma20 > ma50) bullCount++; }
    if (macd?.macd != null && macd?.signal != null) { total++; if (macd.macd > macd.signal) bullCount++; }
    if (adx?.diPlus != null && adx?.diMinus != null) { total++; if (adx.diPlus > adx.diMinus) bullCount++; }

    if (total === 0) return "UNKNOWN";
    const ratio = bullCount / total;
    if (ratio >= 0.85) return "STRONG_BULL";
    else if (ratio >= 0.60) return "BULL";
    else if (ratio <= 0.15) return "STRONG_BEAR";
    else if (ratio <= 0.40) return "BEAR";
    else return "SIDEWAYS";
}


// ─────────────────────────────────────────────────────────────
//  ASCII SPARKLINE  (works in both email <pre> and WhatsApp)
// ─────────────────────────────────────────────────────────────

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function buildSparkline(values, length = 20) {
    if (!values || values.length === 0) return "";
    const slice = values.slice(-length);
    const lo = Math.min(...slice);
    const hi = Math.max(...slice);
    const range = hi - lo;
    if (range === 0) return SPARK_CHARS[3].repeat(slice.length);
    return slice.map(v => {
        const idx = Math.floor(((v - lo) / range) * (SPARK_CHARS.length - 1));
        return SPARK_CHARS[clamp(idx, 0, SPARK_CHARS.length - 1)];
    }).join("");
}


module.exports = {
    // Utilities
    round2, calcPct, sma,
    // Moving averages
    calcEMA, calcSMA,
    // Indicators
    calcRSI, calcMACD, calcBollinger, calcStochastic,
    calcATR, calcADX, calcWilliamsR, calcCCI,
    calcOBV, calcVWAP, calcIchimoku, calcPivots,
    // Analysis
    detectDivergence, detectPatterns, calcVolumeMetrics, calcPerfStats,
    // Trend & visual
    classifyTrend, buildSparkline,
};