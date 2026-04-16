"use strict";
const YahooFinance = require("yahoo-finance2").default;
const { f2, pct, avgN, calcRSI, calcMACD, calcBollinger, calcStochastic, calcATR, calcADX,
    calcWilliamsR, calcCCI, calcOBV, calcVWAP, calcIchimoku, calcPivots,
    detectPatterns, calc6mStats, classifyTrend } = require("./indicators");

const yf = new YahooFinance();

/**
 * Fetch 6 months of daily OHLCV for one ticker and compute all indicators.
 */
async function fetchTicker(ticker, info) {
    const period2 = new Date();
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - 7); // extra buffer

    const res = await yf.chart(ticker, { period1, period2, interval: "1d" });
    const hist = (res.quotes || []).filter(d => d.close && d.open && d.high && d.low);

    if (hist.length < 30) throw new Error("Insufficient historical data");

    const close = hist.map(d => d.close);
    const volume = hist.map(d => d.volume || 0);
    const price = f2(close.at(-1));

    // Moving Averages
    const ma5 = f2(avgN(close, 5));
    const ma10 = f2(avgN(close, 10));
    const ma20 = f2(avgN(close, 20));
    const ma50 = close.length >= 50 ? f2(avgN(close, 50)) : null;
    const ma200 = close.length >= 200 ? f2(avgN(close, 200)) : null;

    // Indicators
    const rsi14 = calcRSI(close, 14);
    const rsi9 = calcRSI(close, 9);   // faster RSI
    const macd = calcMACD(close);
    const bb = calcBollinger(close);
    const stoch = calcStochastic(hist);
    const atr = calcATR(hist);
    const adx = calcADX(hist);
    const willR = calcWilliamsR(hist);
    const cci = calcCCI(hist);
    const obv = calcOBV(hist);
    const vwap = calcVWAP(hist);
    const ichi = calcIchimoku(hist);
    const pivots = calcPivots(hist);
    const patterns = detectPatterns(hist);
    const stats6m = calc6mStats(hist, close);

    // Volume analysis
    const vol10 = f2(avgN(volume, 10));
    const vol30 = f2(avgN(volume, 30));
    const volNow = volume.at(-1);
    const volRatio = f2(volNow / vol10);
    const volSpike = volRatio > 1.5;

    // Trend
    const trend = classifyTrend(price, ma5, ma10, ma20, ma50, macd, adx);

    // P&L
    const costBasis = f2(info.shares * info.avg_cost);
    const marketValue = f2(info.shares * price);
    const unrealized = f2(marketValue - costBasis);
    const unrealizedPct = pct(price, info.avg_cost);

    return {
        // Identity
        symbol: info.symbol, name: info.name, sector: info.sector,
        shares: info.shares, avg_cost: info.avg_cost,
        // Price
        price, open: f2(hist.at(-1).open), high: f2(hist.at(-1).high), low: f2(hist.at(-1).low),
        // MAs
        ma5, ma10, ma20, ma50, ma200,
        // Indicators
        rsi14, rsi9, macd, bb, stoch, atr, adx, willR, cci, obv, vwap, ichi, pivots,
        patterns,
        // Volume
        volume: volNow, vol10, vol30, volRatio, volSpike,
        // Trend
        trend,
        // P&L
        costBasis, marketValue, unrealized, unrealizedPct,
        // 6M Stats
        ...stats6m,
    };
}

/**
 * Fetch all positions in the portfolio map concurrently.
 * Returns { "MEBL.KA": { ...data }, ... }
 */
async function fetchAllStocks(portfolioMap) {
    const entries = await Promise.all(
        Object.entries(portfolioMap).map(async ([ticker, info]) => {
            try {
                const data = await fetchTicker(ticker, info);
                process.stdout.write(`    ✓ ${ticker.padEnd(12)} PKR ${data.price}\n`);
                return [ticker, data];
            } catch (err) {
                process.stdout.write(`    ✗ ${ticker.padEnd(12)} ${err.message}\n`);
                return [ticker, { error: err.message, ...info, price: null }];
            }
        })
    );
    return Object.fromEntries(entries);
}

module.exports = { fetchAllStocks };