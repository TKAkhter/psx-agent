"use strict";
const YahooFinance = require("yahoo-finance2").default;
const { ENV } = require("./config");
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
//  PSXTerminal.com  — primary real-time data source
//  Docs: https://github.com/mumtazkahn/psx-terminal/blob/main/API.md
// ─────────────────────────────────────────────────────────────

const PSX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PSX-Agent/4.0)",
    "Accept": "application/json",
    "Referer": "https://psxterminal.com/",
    "Origin": "https://psxterminal.com",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function psxFetch(path) {
    const url = `${ENV.PSX_BASE_URL}${path}`;
    const res = await fetch(url, { headers: PSX_HEADERS });
    await sleep(2000);
    if (!res.ok) throw new Error(`PSX ${path}: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(`PSX ${path}: ${JSON.stringify(json.error || json)}`);
    return json.data;
}

/**
 * Fetch live tick (real-time price, volume, change) from PSXTerminal.
 * Returns { price, change, changePct, volume, trades, high, low, bid, ask }
 */
async function fetchLiveTick(symbol) {
    const data = await psxFetch(`/api/ticks/REG/${symbol}`);
    return {
        price: round2(data.price),
        change: round2(data.change),
        changePct: round2(data.changePercent * 100),  // API gives 0.01928 for 1.928%
        volume: data.volume,
        trades: data.trades,
        high: round2(data.high),
        low: round2(data.low),
        bid: round2(data.bid),
        ask: round2(data.ask),
        value: round2(data.value),
    };
}

/**
 * Fetch daily klines from PSXTerminal (1d timeframe).
 * Returns array of { timestamp, open, high, low, close, volume }
 * PSXTerminal kline limit is 100 — for 6 months we need ~126 bars, so we fetch
 * with a start timestamp from 7 months ago to maximize coverage.
 */
async function fetchPsxKlines(symbol) {
    // 7 months ago in milliseconds
    const startMs = Date.now() - 1 * 29 * 24 * 60 * 60 * 1000;
    const data = await psxFetch(`/api/klines/${symbol}/1d?start=${startMs}`);

    if (!Array.isArray(data) || data.length === 0) throw new Error("No kline data");

    return data.map(bar => ({
        date: new Date(bar.timestamp).toISOString().slice(0, 10),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0,
    })).filter(b => b.close && b.high && b.low && b.open);
}

/**
 * Fetch fundamentals from PSXTerminal.
 * Returns { peRatio, dividendYield, marketCap, yearChange, volume30Avg }
 */
async function fetchFundamentals(symbol) {
    try {
        const data = await psxFetch(`/api/fundamentals/${symbol}`);
        return {
            peRatio: round2(data.peRatio),
            dividendYield: round2(data.dividendYield),
            marketCap: data.marketCap,
            yearChange: round2(data.yearChange),
            volume30Avg: round2(data.volume30Avg),
        };
    } catch {
        return {}; // fundamentals are optional enrichment
    }
}

/**
 * Fetch recent dividends from PSXTerminal.
 * Returns array of { exDate, amount, year }
 */
async function fetchDividends(symbol) {
    try {
        const data = await psxFetch(`/api/dividends/${symbol}`);
        if (!Array.isArray(data)) return [];
        return data.slice(0, 3).map(d => ({
            exDate: d.ex_date,
            amount: d.amount,
            year: d.year,
        }));
    } catch {
        return [];
    }
}

// ─────────────────────────────────────────────────────────────
//  Yahoo Finance fallback — for extended history (>100 bars)
// ─────────────────────────────────────────────────────────────

async function fetchYahooKlines(symbol) {
    const ticker = symbol + ".KA";
    const period2 = new Date();
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - 8);

    const res = await yf.chart(ticker, { period1, period2, interval: "1d" });
    const hist = (res.quotes || [])
        .filter(q => q.close != null && q.open != null && q.high != null && q.low != null)
        .map(q => ({
            date: q.date ? new Date(q.date).toISOString().slice(0, 10) : "",
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume || 0,
        }));

    if (hist.length < 30) throw new Error(`Yahoo: only ${hist.length} bars`);
    return hist;
}

// ─────────────────────────────────────────────────────────────
//  COMPUTE ALL INDICATORS  from OHLCV history
// ─────────────────────────────────────────────────────────────

function computeIndicators(hist, info, liveTick) {
    const close = hist.map(b => b.close);
    const volume = hist.map(b => b.volume);

    // Use live price if available (real-time), else last close
    const price = liveTick?.price ?? round2(hist.at(-1).close);
    const today = hist.at(-1);

    // Build a "today" bar with live tick data merged in (for accuracy)
    const todayBar = {
        ...today,
        close: price,
        high: liveTick?.high ?? today.high,
        low: liveTick?.low ?? today.low,
        volume: liveTick?.volume ?? today.volume,
    };

    // Replace last bar with live data
    const histWithLive = [...hist.slice(0, -1), todayBar];
    const closeLive = histWithLive.map(b => b.close);

    // ── Moving averages
    const ma5 = calcSMA(closeLive, 5);
    const ma10 = calcSMA(closeLive, 10);
    const ma20 = calcSMA(closeLive, 20);
    const ma50 = closeLive.length >= 50 ? calcSMA(closeLive, 50) : null;
    const ma200 = closeLive.length >= 200 ? calcSMA(closeLive, 200) : null;
    const ema9 = round2(calcEMA(closeLive, 9).at(-1));
    const ema21 = round2(calcEMA(closeLive, 21).at(-1));

    // ── Oscillators
    const rsi14 = calcRSI(closeLive, 14);
    const rsi9 = calcRSI(closeLive, 9);
    const macd = calcMACD(closeLive);
    const bb = calcBollinger(closeLive);
    const stoch = calcStochastic(histWithLive);
    const willR = calcWilliamsR(histWithLive);
    const cci = calcCCI(histWithLive);

    // ── Trend strength
    const atr = calcATR(histWithLive);
    const adx = calcADX(histWithLive);
    const ichi = calcIchimoku(histWithLive);

    // ── Volume & flow
    const volMetrics = calcVolumeMetrics(histWithLive);
    const obv = calcOBV(histWithLive);
    const vwap = calcVWAP(histWithLive);

    // ── Price levels
    const pivots = calcPivots(histWithLive);

    // ── Patterns & divergence
    const patterns = detectPatterns(histWithLive);
    const rsiSeries = closeLive.map((_, i) => i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null).filter(v => v != null);
    const divergence = detectDivergence(closeLive, rsiSeries);

    // ── Stats & sparkline
    const perfStats = calcPerfStats(histWithLive, closeLive);
    const sparkline = buildSparkline(closeLive, 20);

    // ── Trend classification
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

        // OHLCV (live-enriched today bar)
        price,
        open: round2(todayBar.open),
        high: round2(todayBar.high),
        low: round2(todayBar.low),
        volume: todayBar.volume,

        // Live tick extras (null if no live data)
        change: liveTick?.change ?? null,
        changePct: liveTick?.changePct ?? null,
        bid: liveTick?.bid ?? null,
        ask: liveTick?.ask ?? null,
        trades: liveTick?.trades ?? null,

        // Moving averages
        ma5, ma10, ma20, ma50, ma200,
        ema9, ema21,

        // Oscillators
        rsi14, rsi9, macd, bb, stoch, willR, cci,

        // Trend & strength
        atr, adx, ichi, trend,

        // Volume & flow
        vol: volMetrics, obv, vwap,

        // Levels
        pivots,

        // Patterns
        patterns, divergence,

        // Visual
        sparkline,

        // Performance stats (spread from calcPerfStats)
        ...perfStats,

        // P&L
        costBasis, marketValue, unrealizedPnl, unrealizedPct,
    };
}

// ─────────────────────────────────────────────────────────────
//  FETCH ONE TICKER  (PSX primary + Yahoo fallback)
// ─────────────────────────────────────────────────────────────

async function fetchTicker(symbol, info) {
    let hist = null;
    let liveTick = null;
    let dataSource = "unknown";

    // 1. Try live tick from PSX (real-time price, volume, etc.)
    try {
        liveTick = await fetchLiveTick(symbol);
        dataSource = "PSXTerminal";
    } catch (err) {
        // Live tick failure is non-fatal — we'll use last close from history
        process.stdout.write(`    ⚠ Live tick failed for ${symbol}: ${err.message}\n`);
    }

    // 2. Try historical klines from PSX
    try {
        hist = await fetchPsxKlines(symbol);
        dataSource = liveTick ? "PSXTerminal (live+history)" : "PSXTerminal (history)";
    } catch (psxErr) {
        // 3. Fallback to Yahoo Finance for history
        if (ENV.YAHOO_FALLBACK) {
            try {
                hist = await fetchYahooKlines(symbol);
                dataSource = liveTick ? "PSXTerminal (live) + Yahoo (history)" : "Yahoo Finance";
            } catch (yahooErr) {
                throw new Error(`PSX: ${psxErr.message} | Yahoo: ${yahooErr.message}`);
            }
        } else {
            throw new Error(`PSX history failed: ${psxErr.message}`);
        }
    }

    if (!hist || hist.length < 10) throw new Error(`Only ${hist?.length ?? 0} historical bars`);

    // 4. Compute all indicators
    const computed = computeIndicators(hist, info, liveTick);

    // 5. Enrich with fundamentals + dividends (optional, parallel)
    const [fundamentals, dividends] = await Promise.allSettled([
        fetchFundamentals(symbol),
        fetchDividends(symbol),
    ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : {}));

    return {
        ...computed,
        fundamentals: fundamentals || {},
        dividends: Array.isArray(dividends) ? dividends : [],
        dataSource,
        historyBars: hist.length,
    };
}

// ─────────────────────────────────────────────────────────────
//  FETCH KSE-100 INDEX  (for macro context)
// ─────────────────────────────────────────────────────────────

async function fetchKse100() {
    try {
        const data = await psxFetch("/api/ticks/IDX/KSE100");
        return {
            level: round2(data.price),
            change: round2(data.change),
            changePct: round2(data.changePercent * 100),
            volume: data.volume,
        };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
//  FETCH MARKET BREADTH  (advances / declines)
// ─────────────────────────────────────────────────────────────

async function fetchMarketBreadth() {
    try {
        const data = await psxFetch("/api/stats/breadth");
        return {
            advances: data.advances,
            declines: data.declines,
            unchanged: data.unchanged,
            adRatio: round2(data.advanceDeclineRatio),
            upVolume: data.upVolume,
            downVolume: data.downVolume,
        };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
//  FETCH ALL PORTFOLIO STOCKS  (concurrent)
// ─────────────────────────────────────────────────────────────

async function fetchAllStocks(portfolioMap) {
    // Fetch KSE-100 and market breadth alongside stocks
    const [kse100, breadth, ...stockResults] = await Promise.allSettled([
        fetchKse100(),
        fetchMarketBreadth(),
        ...Object.entries(portfolioMap).map(async ([symbol, info]) => {
            const data = await fetchTicker(symbol, info);
            return [symbol, data];
        }),
    ]);

    const stockData = {};
    const symbols = Object.keys(portfolioMap);

    for (let i = 0; i < stockResults.length; i++) {
        const symbol = symbols[i];
        const result = stockResults[i];
        if (result.status === "fulfilled") {
            const [sym, data] = result.value;
            stockData[sym] = data;
            process.stdout.write(
                `    ✓ ${symbol.padEnd(8)} PKR ${String(data.price).padStart(8)}` +
                `  ${data.changePct != null ? (data.changePct >= 0 ? "+" : "") + data.changePct + "%" : ""}` +
                `  RSI:${data.rsi14}  ${data.trend}  [${data.dataSource}]\n`
            );
        } else {
            const info = portfolioMap[symbol];
            stockData[symbol] = { error: result.reason?.message || "Unknown", ...info, price: null };
            process.stdout.write(`    ✗ ${symbol.padEnd(8)} ${result.reason?.message}\n`);
        }
    }

    // Attach market context to result
    stockData.__market__ = {
        kse100: kse100.status === "fulfilled" ? kse100.value : null,
        breadth: breadth.status === "fulfilled" ? breadth.value : null,
    };

    return stockData;
}

module.exports = { fetchAllStocks, fetchKse100, fetchMarketBreadth };