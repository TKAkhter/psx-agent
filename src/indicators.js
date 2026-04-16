"use strict";

// ─── Utilities ───────────────────────────────────────────────
const f2 = (n) => (n == null || isNaN(n)) ? null : Math.round(n * 100) / 100;
const pct = (a, b) => (b && b !== 0) ? f2(((a - b) / b) * 100) : null;
const avgN = (arr, n) => { const sl = arr.slice(-n); return sl.reduce((a, b) => a + b, 0) / sl.length; };
const std = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };

// ─── EMA ──────────────────────────────────────────────────────
function calcEMA(arr, n) {
    if (!arr || arr.length === 0) return [];
    const k = 2 / (n + 1);
    const out = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
        out.push(arr[i] * k + out[i - 1] * (1 - k));
    }
    return out;
}

// ─── RSI (Wilder Smoothing) ────────────────────────────────────
function calcRSI(close, period = 14) {
    if (!close || close.length < period + 1) return null;
    let ag = 0, al = 0;
    for (let i = 1; i <= period; i++) {
        const d = close[i] - close[i - 1];
        if (d >= 0) ag += d; else al -= d;
    }
    ag /= period; al /= period;
    for (let i = period + 1; i < close.length; i++) {
        const d = close[i] - close[i - 1];
        ag = (ag * (period - 1) + Math.max(d, 0)) / period;
        al = (al * (period - 1) + Math.max(-d, 0)) / period;
    }
    return al === 0 ? 100 : f2(100 - 100 / (1 + ag / al));
}

// ─── MACD ──────────────────────────────────────────────────────
function calcMACD(close) {
    if (!close || close.length < 26) return { macd: null, signal: null, histogram: null, crossover: null };
    const e12 = calcEMA(close, 12);
    const e26 = calcEMA(close, 26);
    const line = e12.map((v, i) => v - e26[i]);
    const sig = calcEMA(line, 9);
    const hist = line.map((v, i) => v - sig[i]);
    const crossover = (line.at(-1) > sig.at(-1) && line.at(-2) <= sig.at(-2)) ? "BULLISH_CROSS"
        : (line.at(-1) < sig.at(-1) && line.at(-2) >= sig.at(-2)) ? "BEARISH_CROSS"
            : null;
    return {
        macd: f2(line.at(-1)),
        signal: f2(sig.at(-1)),
        histogram: f2(hist.at(-1)),
        prevHistogram: f2(hist.at(-2)),
        crossover,
        histTrend: hist.at(-1) > hist.at(-2) ? "EXPANDING" : "CONTRACTING",
    };
}

// ─── Bollinger Bands ──────────────────────────────────────────
function calcBollinger(close, period = 20, multiplier = 2) {
    if (!close || close.length < period) return null;
    const sl = close.slice(-period);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const stdDev = std(sl);
    const upper = mean + multiplier * stdDev;
    const lower = mean - multiplier * stdDev;
    const last = close.at(-1);
    return {
        upper: f2(upper),
        lower: f2(lower),
        mid: f2(mean),
        bandwidth: f2((upper - lower) / mean * 100),
        pctB: f2((last - lower) / (upper - lower) * 100), // 0=at lower, 100=at upper
        stdDev: f2(stdDev),
    };
}

// ─── Stochastic Oscillator ────────────────────────────────────
function calcStochastic(hist, kPeriod = 14, smooth = 3) {
    if (!hist || hist.length < kPeriod) return { k: null, d: null, zone: null };
    const raws = [];
    for (let i = kPeriod - 1; i < hist.length; i++) {
        const sl = hist.slice(i - kPeriod + 1, i + 1);
        const lo = Math.min(...sl.map(d => d.low));
        const hi = Math.max(...sl.map(d => d.high));
        raws.push(hi === lo ? 50 : (hist[i].close - lo) / (hi - lo) * 100);
    }
    const k = f2(avgN(raws, smooth));
    const d = raws.length >= smooth * 2 ? f2(avgN(raws.slice(-smooth * 2), smooth)) : k;
    const zone = k < 20 ? "OVERSOLD" : k > 80 ? "OVERBOUGHT" : "NEUTRAL";
    return { k, d, zone };
}

// ─── ATR (Average True Range) ─────────────────────────────────
function calcATR(hist, period = 14) {
    if (!hist || hist.length < 2) return null;
    const trs = [];
    for (let i = 1; i < hist.length; i++) {
        const h = hist[i].high, l = hist[i].low, pc = hist[i - 1].close;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    return f2(trs.slice(-period).reduce((a, b) => a + b, 0) / period);
}

// ─── ADX (Average Directional Index) ─────────────────────────
function calcADX(hist, period = 14) {
    if (!hist || hist.length < period + 1) return { adx: null, diPlus: null, diMinus: null, trend: null };
    const trs = [], pdms = [], ndms = [];
    for (let i = 1; i < hist.length; i++) {
        const h = hist[i].high, l = hist[i].low, ph = hist[i - 1].high, pl = hist[i - 1].low, pc = hist[i - 1].close;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        pdms.push(Math.max(h - ph, 0) > Math.max(pl - l, 0) ? Math.max(h - ph, 0) : 0);
        ndms.push(Math.max(pl - l, 0) > Math.max(h - ph, 0) ? Math.max(pl - l, 0) : 0);
    }
    const smooth = (arr) => {
        let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
        const out = [s];
        for (let i = period; i < arr.length; i++) {
            s = s - s / period + arr[i];
            out.push(s);
        }
        return out;
    };
    const sTR = smooth(trs), sPDM = smooth(pdms), sNDM = smooth(ndms);
    const diPlus = sTR.map((v, i) => v ? (sPDM[i] / v) * 100 : 0);
    const diMinus = sTR.map((v, i) => v ? (sNDM[i] / v) * 100 : 0);
    const dx = diPlus.map((v, i) => (v + diMinus[i]) ? Math.abs(v - diMinus[i]) / (v + diMinus[i]) * 100 : 0);
    const adx = f2(avgN(dx, period));
    const lastDiP = f2(diPlus.at(-1));
    const lastDiM = f2(diMinus.at(-1));
    const trend = adx > 25 ? (lastDiP > lastDiM ? "STRONG_BULL" : "STRONG_BEAR")
        : adx > 15 ? "WEAK_TREND" : "RANGING";
    return { adx, diPlus: lastDiP, diMinus: lastDiM, trend };
}

// ─── Williams %R ──────────────────────────────────────────────
function calcWilliamsR(hist, period = 14) {
    if (!hist || hist.length < period) return null;
    const sl = hist.slice(-period);
    const hi = Math.max(...sl.map(d => d.high));
    const lo = Math.min(...sl.map(d => d.low));
    const last = hist.at(-1).close;
    const wr = hi === lo ? -50 : ((hi - last) / (hi - lo)) * -100;
    return f2(wr); // -100 to 0; below -80 = oversold, above -20 = overbought
}

// ─── CCI (Commodity Channel Index) ───────────────────────────
function calcCCI(hist, period = 20) {
    if (!hist || hist.length < period) return null;
    const sl = hist.slice(-period);
    const tps = sl.map(d => (d.high + d.low + d.close) / 3);
    const mean = tps.reduce((a, b) => a + b, 0) / period;
    const md = tps.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    return md ? f2((tps.at(-1) - mean) / (0.015 * md)) : null;
}

// ─── OBV (On-Balance Volume) ──────────────────────────────────
function calcOBV(hist) {
    if (!hist || hist.length < 2) return { obv: 0, trend: null };
    let obv = 0;
    const series = [0];
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].close > hist[i - 1].close) obv += (hist[i].volume || 0);
        else if (hist[i].close < hist[i - 1].close) obv -= (hist[i].volume || 0);
        series.push(obv);
    }
    const recent5 = series.slice(-5);
    const prev5 = series.slice(-10, -5);
    const avgR = recent5.reduce((a, b) => a + b, 0) / 5;
    const avgP = prev5.reduce((a, b) => a + b, 0) / 5;
    const trend = avgR > avgP * 1.02 ? "ACCUMULATION" : avgR < avgP * 0.98 ? "DISTRIBUTION" : "NEUTRAL";
    return { obv: series.at(-1), trend };
}

// ─── VWAP (20-day rolling) ─────────────────────────────────────
function calcVWAP(hist) {
    if (!hist || hist.length === 0) return null;
    const sl = hist.slice(-20);
    const num = sl.reduce((s, d) => s + ((d.high + d.low + d.close) / 3) * (d.volume || 1), 0);
    const den = sl.reduce((s, d) => s + (d.volume || 1), 0);
    return f2(num / den);
}

// ─── Ichimoku Cloud ───────────────────────────────────────────
function calcIchimoku(hist) {
    if (!hist || hist.length < 52) return null;
    const highLow = (arr) => ({ hi: Math.max(...arr.map(d => d.high)), lo: Math.min(...arr.map(d => d.low)) });
    const hl9 = highLow(hist.slice(-9));
    const hl26 = highLow(hist.slice(-26));
    const hl52 = highLow(hist.slice(-52));
    const tenkan = f2((hl9.hi + hl9.lo) / 2);  // Conversion line
    const kijun = f2((hl26.hi + hl26.lo) / 2);  // Base line
    const senkouA = f2((tenkan + kijun) / 2);  // Span A (leading)
    const senkouB = f2((hl52.hi + hl52.lo) / 2);  // Span B (leading)
    const price = hist.at(-1).close;
    const aboveCloud = price > Math.max(senkouA, senkouB);
    const belowCloud = price < Math.min(senkouA, senkouB);
    const inCloud = !aboveCloud && !belowCloud;
    return {
        tenkan, kijun, senkouA, senkouB,
        position: aboveCloud ? "ABOVE_CLOUD" : belowCloud ? "BELOW_CLOUD" : "IN_CLOUD",
        bullishTK: tenkan > kijun,  // TK cross signal
        cloudColor: senkouA >= senkouB ? "GREEN" : "RED",
    };
}

// ─── Pivot Points (Standard) ──────────────────────────────────
function calcPivots(hist) {
    if (!hist || hist.length < 20) return null;
    const sl = hist.slice(-20);
    const hi = Math.max(...sl.map(d => d.high));
    const lo = Math.min(...sl.map(d => d.low));
    const cl = sl.at(-1).close;
    const p = (hi + lo + cl) / 3;
    return {
        r3: f2(hi + 2 * (p - lo)),
        r2: f2(p + (hi - lo)),
        r1: f2(2 * p - lo),
        pivot: f2(p),
        s1: f2(2 * p - hi),
        s2: f2(p - (hi - lo)),
        s3: f2(lo - 2 * (hi - p)),
    };
}

// ─── Price Action Patterns ─────────────────────────────────────
function detectPatterns(hist) {
    if (!hist || hist.length < 3) return [];
    const patterns = [];
    const last = hist.at(-1);
    const prev = hist.at(-2);
    const prev2 = hist.at(-3);
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    const bodyPct = range > 0 ? body / range : 0;
    const upperWick = last.high - Math.max(last.close, last.open);
    const lowerWick = Math.min(last.close, last.open) - last.low;

    // Doji
    if (bodyPct < 0.1 && range > 0) patterns.push({ name: "Doji", bias: "NEUTRAL", desc: "Indecision candle — trend may reverse" });

    // Hammer (bullish reversal)
    if (lowerWick > body * 2 && upperWick < body * 0.5 && last.close > last.open)
        patterns.push({ name: "Hammer", bias: "BULLISH", desc: "Strong lower wick — buyers defending price" });

    // Shooting Star (bearish reversal)
    if (upperWick > body * 2 && lowerWick < body * 0.5 && last.close < last.open)
        patterns.push({ name: "Shooting Star", bias: "BEARISH", desc: "Strong upper wick — sellers pushing down" });

    // Bullish Engulfing
    if (prev.close < prev.open && last.close > last.open && last.open < prev.close && last.close > prev.open)
        patterns.push({ name: "Bullish Engulfing", bias: "BULLISH", desc: "Bullish candle engulfs previous red — momentum shift" });

    // Bearish Engulfing
    if (prev.close > prev.open && last.close < last.open && last.open > prev.close && last.close < prev.open)
        patterns.push({ name: "Bearish Engulfing", bias: "BEARISH", desc: "Bearish candle engulfs previous green — momentum shift" });

    // Three White Soldiers
    if (hist.length >= 3 && prev2.close > prev2.open && prev.close > prev.open && last.close > last.open
        && last.close > prev.close && prev.close > prev2.close)
        patterns.push({ name: "Three White Soldiers", bias: "BULLISH", desc: "Three consecutive bullish closes — strong uptrend" });

    // Three Black Crows
    if (hist.length >= 3 && prev2.close < prev2.open && prev.close < prev.open && last.close < last.open
        && last.close < prev.close && prev.close < prev2.close)
        patterns.push({ name: "Three Black Crows", bias: "BEARISH", desc: "Three consecutive bearish closes — strong downtrend" });

    return patterns;
}

// ─── 6-Month & Performance Stats ──────────────────────────────
function calc6mStats(hist, close) {
    if (!hist || !close || hist.length === 0) return {};
    const high6m = f2(Math.max(...hist.map(d => d.high)));
    const low6m = f2(Math.min(...hist.map(d => d.low)));
    let peak = close[0], maxDD = 0;
    for (const c of close) {
        if (c > peak) peak = c;
        const dd = (peak - c) / peak * 100;
        if (dd > maxDD) maxDD = dd;
    }
    // Volume trend (is volume increasing or decreasing over 20 days?)
    const vols = hist.slice(-20).map(d => d.volume || 0);
    const volMA10 = avgN(vols, 10);
    const volMA5 = avgN(vols.slice(-5), 5);
    return {
        high6m,
        low6m,
        pctFrom6mHigh: pct(close.at(-1), high6m),
        pctFrom6mLow: pct(close.at(-1), low6m),
        perf6m: pct(close.at(-1), close[0]),
        perf1m: pct(close.at(-1), close.at(-22) || close[0]),
        perf1w: pct(close.at(-1), close.at(-5) || close[0]),
        perf1d: pct(close.at(-1), close.at(-2) || close[0]),
        maxDrawdown: f2(maxDD),
        volTrend: volMA5 > volMA10 * 1.1 ? "INCREASING" : volMA5 < volMA10 * 0.9 ? "DECREASING" : "STABLE",
    };
}

// ─── Trend Classification (composite) ─────────────────────────
function classifyTrend(price, ma5, ma10, ma20, ma50, macd, adx) {
    let bullScore = 0;
    if (price > ma20) bullScore++;
    if (price > ma50) bullScore++;
    if (ma5 > ma20) bullScore++;
    if (ma20 && ma50 && ma20 > ma50) bullScore++;
    if (macd.macd > macd.signal) bullScore++;
    if (adx?.diPlus > adx?.diMinus) bullScore++;

    if (bullScore >= 5) return "STRONG_BULL";
    else if (bullScore >= 3) return "BULL";
    else if (bullScore <= 1) return "STRONG_BEAR";
    else if (bullScore <= 2) return "BEAR";
    else return "SIDEWAYS";
}

module.exports = {
    f2, pct, avgN,
    calcEMA, calcRSI, calcMACD, calcBollinger,
    calcStochastic, calcATR, calcADX, calcWilliamsR, calcCCI,
    calcOBV, calcVWAP, calcIchimoku, calcPivots,
    detectPatterns, calc6mStats, classifyTrend,
};