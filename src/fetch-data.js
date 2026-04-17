"use strict";
const YahooFinance = require("yahoo-finance2").default;

const {
    round2, calcPct, sma,
    calcEMA, calcSMA,
    calcRSI, calcMACD, calcBollinger, calcStochastic,
    calcATR, calcADX, calcWilliamsR, calcCCI,
    calcOBV, calcVWAP, calcIchimoku, calcPivots,
    detectDivergence, detectPatterns, calcVolumeMetrics, calcPerfStats,
    classifyTrend, buildSparkline,
} = require("./indicators");

const yf = new YahooFinance();

// ─────────────────────────────────────────────────────────────
//  Fetch + compute all indicators for one ticker
// ─────────────────────────────────────────────────────────────

async function fetchTicker(ticker, info) {
    const period2 = new Date();
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - 8); // 8 months for MA200 buffer

    const res = await yf.chart(ticker, { period1, period2, interval: "1d" });
    const hist = (res.quotes || [])
        .filter(q => q.close != null && q.open != null && q.high != null && q.low != null)
        .map(q => ({
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume || 0,
        }));

    if (hist.length < 60) throw new Error(`Only ${hist.length} bars — need ≥60`);

    const close = hist.map(b => b.close);
    const volume = hist.map(b => b.volume);
    const today = hist.at(-1);

    // ── Moving Averages
    const ma5 = calcSMA(close, 5);
    const ma10 = calcSMA(close, 10);
    const ma20 = calcSMA(close, 20);
    const ma50 = close.length >= 50 ? calcSMA(close, 50) : null;
    const ma200 = close.length >= 200 ? calcSMA(close, 200) : null;
    const ema9 = calcEMA(close, 9).at(-1);
    const ema21 = calcEMA(close, 21).at(-1);

    // ── Oscillators
    const rsi14 = calcRSI(close, 14);
    const rsi9 = calcRSI(close, 9);
    const macd = calcMACD(close);
    const bb = calcBollinger(close);
    const stoch = calcStochastic(hist);
    const willR = calcWilliamsR(hist);
    const cci = calcCCI(hist);

    // ── Trend / Strength
    const atr = calcATR(hist);
    const adx = calcADX(hist);
    const ichi = calcIchimoku(hist);

    // ── Volume / Flow
    const volMetrics = calcVolumeMetrics(hist);
    const obv = calcOBV(hist);
    const vwap = calcVWAP(hist);

    // ── Price Levels
    const pivots = calcPivots(hist);

    // ── Patterns & Divergence
    const patterns = detectPatterns(hist);
    // Build a full RSI series for divergence (last 30 bars)
    const rsiSeries = close.map((_, i) => i >= 14 ? calcRSI(close.slice(0, i + 1), 14) : null);
    const divergence = detectDivergence(close, rsiSeries.filter(v => v != null));

    // ── Stats
    const perfStats = calcPerfStats(hist, close);

    // ── Sparkline (last 20 closes)
    const sparkline = buildSparkline(close, 20);

    // ── Trend
    const price = round2(today.close);
    const trend = classifyTrend(price, ma5, ma20, ma50, macd, adx);

    // ── P&L
    const costBasis = round2(info.shares * info.avgCost);
    const marketValue = round2(info.shares * price);
    const unrealizedPnl = round2(marketValue - costBasis);
    const unrealizedPct = calcPct(price, info.avgCost);

    return {
        // Identity
        symbol: info.symbol,
        name: info.name,
        sector: info.sector,
        shares: info.shares,
        avgCost: info.avgCost,

        // OHLCV (today)
        price,
        open: round2(today.open),
        high: round2(today.high),
        low: round2(today.low),
        volume: today.volume,

        // Moving averages
        ma5, ma10, ma20, ma50, ma200,
        ema9: round2(ema9),
        ema21: round2(ema21),

        // Oscillators
        rsi14, rsi9, macd, bb, stoch, willR, cci,

        // Trend & Strength
        atr, adx, ichi, trend,

        // Volume & Flow
        vol: volMetrics,
        obv, vwap,

        // Price levels
        pivots,

        // Patterns
        patterns,
        divergence,

        // Sparkline
        sparkline,

        // Performance stats
        ...perfStats,

        // P&L
        costBasis, marketValue, unrealizedPnl, unrealizedPct,
    };
}

// ─────────────────────────────────────────────────────────────
//  Fetch all portfolio positions concurrently
// ─────────────────────────────────────────────────────────────

async function fetchAllStocks(portfolioMap) {
    const results = await Promise.allSettled(
        Object.entries(portfolioMap).map(async ([ticker, info]) => {
            const data = await fetchTicker(ticker, info);
            return [ticker, data];
        })
    );

    const stockData = {};
    for (let i = 0; i < results.length; i++) {
        const ticker = Object.keys(portfolioMap)[i];
        const result = results[i];
        if (result.status === "fulfilled") {
            const [t, data] = result.value;
            stockData[t] = data;
            process.stdout.write(`    ✓ ${ticker.padEnd(12)} PKR ${data.price}  RSI:${data.rsi14}  ${data.trend}\n`);
        } else {
            const info = portfolioMap[ticker];
            stockData[ticker] = { error: result.reason?.message || "Unknown error", ...info, price: null };
            process.stdout.write(`    ✗ ${ticker.padEnd(12)} ${result.reason?.message}\n`);
        }
    }
    return stockData;
}

module.exports = { fetchAllStocks };