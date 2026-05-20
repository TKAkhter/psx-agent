import axios, { AxiosInstance } from "axios";
// @ts-ignore
import YahooFinance from "yahoo-finance2";
import { ENV } from "./config";
import { PositionInfo } from "./portfolio";
import type {
  OhlcvBar, StockData, StockError, StockResult, StockDataMap,
  MarketContext, MarketOverview, KseTopMover, Fundamentals,
  DividendRecord, LiveTick, HistoricalTrend,
} from "./types";
import {
  round2, calcPct, calcEMA, calcSMA,
  calcRSI, calcMACD, calcBollinger, calcStochastic,
  calcATR, calcADX, calcWilliamsR, calcCCI,
  calcOBV, calcVWAP, calcVwapDevPct, calcIchimoku, calcPivots,
  calcROC, calcMFI, calcSuperTrend, calcVolumeMetrics,
  calcPerfStats, detectDivergence, detectPatterns,
  classifyTrend, classifyMarketRegime, buildSparkline,
} from "./indicators";

export type { StockData, StockError, StockResult, StockDataMap, MarketContext, MarketOverview, LiveTick };

// ─────────────────────────────────────────────────────────────
//  RATE LIMITER
// ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
//  PSXTerminal axios client
// ─────────────────────────────────────────────────────────────

const psxClient: AxiosInstance = axios.create({
  baseURL: ENV.PSX_BASE_URL,
  timeout: 20_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; PSX-Agent/7.0)",
    "Accept":     "application/json",
    "Referer":    "https://psxterminal.com/",
    "Origin":     "https://psxterminal.com",
  },
});

async function psxGet<T = unknown>(path: string): Promise<T> {
  const res = await psxClient.get<{ success: boolean; data: T; error?: unknown }>(path);
  await sleep(2000);
  if (!res.data.success) throw new Error(`PSX ${path}: ${JSON.stringify(res.data.error)}`);
  return res.data.data;
}

// ─────────────────────────────────────────────────────────────
//  PRICE FIX: PSXTerminal returns changePercent as a fraction
//  e.g. changePercent=0.01928 means +1.928%.
//  We ALWAYS multiply by 100 — the "< 2" heuristic was wrong
//  and caused e.g. 1.5% to become 150%.
// ─────────────────────────────────────────────────────────────

function normalizeChangePct(raw: number): number {
  // PSXTerminal always returns decimal fraction (0.0193 = 1.93%)
  return round2(raw * 100) ?? 0;
}

// ─────────────────────────────────────────────────────────────
//  PSX API CALLS
// ─────────────────────────────────────────────────────────────

async function fetchLiveTick(symbol: string): Promise<LiveTick | null> {
  try {
    const d = await psxGet<Record<string, number>>(`/api/ticks/REG/${symbol}`);
    return {
      price:     round2(d.price)!,
      change:    round2(d.change)!,
      changePct: normalizeChangePct(d.changePercent ?? 0),
      volume:    d.volume,
      trades:    d.trades,
      high:      round2(d.high)!,
      low:       round2(d.low)!,
      bid:       round2(d.bid)!,
      ask:       round2(d.ask)!,
      value:     round2(d.value)!,
    };
  } catch (e) {
    console.warn(`    ⚠ Live tick ${symbol}: ${(e as Error).message}`);
    return null;
  }
}

async function fetchPsxKlines(symbol: string): Promise<OhlcvBar[]> {
  const startMs = Date.now() - 29 * 24 * 60 * 60 * 1000;
  const data    = await psxGet<Array<Record<string, number>>>(`/api/klines/${symbol}/1d?start=${startMs}&limit=100`);
  if (!Array.isArray(data) || data.length === 0) throw new Error("No PSX kline data");
  return data
    .map(bar => ({
      date:   new Date(bar.timestamp).toISOString().slice(0, 10),
      open:   bar.open, high: bar.high, low: bar.low, close: bar.close,
      volume: bar.volume || 0,
    }))
    .filter(b => b.close && b.high && b.low && b.open);
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  try {
    const d  = await psxGet<Record<string, number | string>>(`/api/fundamentals/${symbol}`);
    const pe = typeof d.peRatio === "number" ? d.peRatio : null;
    const bv = typeof d.bookValue === "number" ? d.bookValue : null;
    return {
      peRatio:       round2(pe),
      dividendYield: round2(d.dividendYield as number),
      marketCap:     d.marketCap as string ?? null,
      yearChange:    round2(d.yearChange as number),
      volume30Avg:   round2(d.volume30Avg as number),
      eps:           round2(d.eps as number),
      bookValue:     round2(bv),
      pbRatio:       pe != null && bv != null && bv > 0 ? round2(pe / bv) : null,
    };
  } catch { return {}; }
}

async function fetchDividends(symbol: string): Promise<DividendRecord[]> {
  try {
    const data = await psxGet<Array<Record<string, unknown>>>(`/api/dividends/${symbol}`);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5).map(d => ({
      exDate: String(d.ex_date ?? ""),
      amount: Number(d.amount ?? 0),
      year:   Number(d.year   ?? 0),
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
//  YAHOO FINANCE fallback
// ─────────────────────────────────────────────────────────────

async function fetchYahooKlines(symbol: string): Promise<OhlcvBar[]> {
  const yf      = new YahooFinance();
  const period2 = new Date();
  const period1 = new Date(); period1.setMonth(period1.getMonth() - 8);
  const res  = await yf.chart(symbol + ".KA", { period1, period2, interval: "1d" });
  const hist = (res.quotes || [])
    .filter((q: Record<string, unknown>) => q.close != null && q.open != null)
    .map((q: Record<string, unknown>) => ({
      date: q.date ? new Date(q.date as string).toISOString().slice(0, 10) : "",
      open: q.open as number, high: q.high as number,
      low:  q.low  as number, close: q.close as number,
      volume: (q.volume as number) || 0,
    }));
  if (hist.length < 10) throw new Error(`Yahoo: only ${hist.length} bars`);
  return hist;
}

// ─────────────────────────────────────────────────────────────
//  COMPUTE ALL INDICATORS
// ─────────────────────────────────────────────────────────────

function computeIndicators(
  hist:     OhlcvBar[],
  info:     PositionInfo,
  liveTick: LiveTick | null,
): Omit<StockData, "fundamentals" | "dividends" | "dataSource" | "historyBars" | "historicalTrend"> {
  // Use live price if available; fall back to last close
  const price    = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today    = hist.at(-1)!;
  // Merge live OHLV into last bar so indicators use real-time data
  const todayBar: OhlcvBar = {
    ...today,
    close:  price,
    high:   Math.max(liveTick?.high   ?? today.high,   price),  // extend high if live > bar high
    low:    Math.min(liveTick?.low    ?? today.low,    price),  // extend low if live < bar low
    volume: liveTick?.volume ?? today.volume,
  };
  const histLive  = [...hist.slice(0, -1), todayBar];
  const closeLive = histLive.map(b => b.close);

  const ma5   = calcSMA(closeLive, 5);
  const ma10  = calcSMA(closeLive, 10);
  const ma20  = calcSMA(closeLive, 20);
  const ma50  = closeLive.length >= 50  ? calcSMA(closeLive, 50)  : null;
  const ma200 = closeLive.length >= 200 ? calcSMA(closeLive, 200) : null;
  const ema9  = round2(calcEMA(closeLive, 9).at(-1)  as number);
  const ema21 = round2(calcEMA(closeLive, 21).at(-1) as number);

  const rsi14 = calcRSI(closeLive, 14);
  const rsi9  = calcRSI(closeLive, 9);
  const macd  = calcMACD(closeLive);
  const bb    = calcBollinger(closeLive);
  const stoch = calcStochastic(histLive);
  const willR = calcWilliamsR(histLive);
  const cci   = calcCCI(histLive);
  const roc   = calcROC(closeLive, 12);
  const mfi   = calcMFI(histLive, 14);

  const atr        = calcATR(histLive);
  const adx        = calcADX(histLive);
  const ichi       = calcIchimoku(histLive);
  const superTrend = calcSuperTrend(histLive);

  const vol        = calcVolumeMetrics(histLive);
  const obv        = calcOBV(histLive);
  const vwap       = calcVWAP(histLive);
  const vwapDevPct = calcVwapDevPct(price, vwap);

  const pivots     = calcPivots(histLive);
  const patterns   = detectPatterns(histLive);

  // Build RSI series for divergence (expensive but important)
  const rsiSeries  = closeLive
    .map((_, i) => i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null)
    .filter((v): v is number => v != null);
  const divergence = detectDivergence(closeLive, rsiSeries);

  const sparkline    = buildSparkline(closeLive, 20);
  const trend        = classifyTrend(price, ma5, ma20, ma50, macd, adx);
  const marketRegime = classifyMarketRegime(adx, bb, macd);
  const perfStats    = calcPerfStats(histLive, closeLive);

  const costBasis     = round2(info.shares * info.avgCost)!;
  const marketValue   = round2(info.shares * price)!;
  const unrealizedPnl = round2(marketValue - costBasis)!;
  const unrealizedPct = calcPct(price, info.avgCost);

  return {
    symbol: info.symbol, name: info.name, sector: info.sector,
    shares: info.shares, avgCost: info.avgCost,
    price,
    open:   round2(todayBar.open)!,
    high:   round2(todayBar.high)!,
    low:    round2(todayBar.low)!,
    volume: todayBar.volume,
    change:    liveTick?.change    ?? null,
    changePct: liveTick?.changePct ?? null,
    bid:       liveTick?.bid       ?? null,
    ask:       liveTick?.ask       ?? null,
    trades:    liveTick?.trades    ?? null,
    ma5, ma10, ma20, ma50, ma200, ema9, ema21,
    rsi14, rsi9, macd, bb, stoch, willR, cci, roc, mfi,
    atr, adx, ichi, superTrend, trend, marketRegime,
    vol, obv, vwap, vwapDevPct, pivots, patterns, divergence, sparkline,
    ...perfStats,
    costBasis, marketValue, unrealizedPnl, unrealizedPct,
  };
}

// ─────────────────────────────────────────────────────────────
//  FETCH ONE TICKER
// ─────────────────────────────────────────────────────────────

async function fetchTicker(symbol: string, info: PositionInfo): Promise<StockData> {
  const isPsx = ENV.PORTFOLIO_TYPE === "psx";
  let hist:     OhlcvBar[];
  let liveTick: LiveTick | null = null;

  if (isPsx) {
    liveTick = await fetchLiveTick(symbol);
    hist     = await fetchPsxKlines(symbol);
  } else {
    hist = await fetchYahooKlines(symbol);
  }

  if (hist.length < 10) throw new Error(`Only ${hist.length} bars`);

  const computed = computeIndicators(hist, info, liveTick);

  let fundamentals: Fundamentals = {}, dividends: DividendRecord[] = [];
  if (isPsx) {
    [fundamentals, dividends] = await Promise.all([
      fetchFundamentals(symbol),
      fetchDividends(symbol),
    ]);
  }

  return {
    ...computed,
    fundamentals,
    dividends,
    dataSource: isPsx ? "PSXTerminal" : "Yahoo",
    historyBars: hist.length,
    historicalTrend: null, // injected later by index.ts
  };
}

// ─────────────────────────────────────────────────────────────
//  KSE-100 INDEX
// ─────────────────────────────────────────────────────────────

async function fetchKse100(): Promise<MarketContext["kse100"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const d = await psxGet<Record<string, number>>("/api/ticks/IDX/KSE100");
    return {
      level:     round2(d.price)!,
      change:    round2(d.change)!,
      changePct: normalizeChangePct(d.changePercent ?? 0),
      volume:    d.volume,
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  MARKET BREADTH
// ─────────────────────────────────────────────────────────────

async function fetchMarketBreadth(): Promise<MarketContext["breadth"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const d = await psxGet<Record<string, number>>("/api/stats/breadth");
    return {
      advances:   d.advances,
      declines:   d.declines,
      unchanged:  d.unchanged,
      adRatio:    round2(d.advanceDeclineRatio)!,
      upVolume:   d.upVolume,
      downVolume: d.downVolume,
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  MARKET-WIDE TOP MOVERS  (beyond portfolio stocks)
//  Fetches top gainers, losers, volume from PSXTerminal
// ─────────────────────────────────────────────────────────────

async function fetchTopMovers(): Promise<{ gainers: KseTopMover[]; losers: KseTopMover[]; volume: KseTopMover[] }> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return { gainers: [], losers: [], volume: [] };
  try {
    // PSXTerminal market-watch endpoint returns all stocks with change data
    const data = await psxGet<Array<Record<string, unknown>>>("/api/market-watch");
    if (!Array.isArray(data)) return { gainers: [], losers: [], volume: [] };

    const parsed: KseTopMover[] = data
      .filter(d => d.symbol && d.close && d.changePercent != null)
      .map(d => ({
        symbol:    String(d.symbol),
        name:      String(d.name ?? d.symbol),
        price:     round2(Number(d.close))!,
        changePct: normalizeChangePct(Number(d.changePercent)),
        volume:    Number(d.volume ?? 0),
        sector:    String(d.sector ?? ""),
      }));

    const gainers = [...parsed].sort((a, b) => b.changePct - a.changePct).slice(0, 5);
    const losers  = [...parsed].sort((a, b) => a.changePct - b.changePct).slice(0, 5);
    const volume  = [...parsed].sort((a, b) => b.volume - a.volume).slice(0, 5);

    return { gainers, losers, volume };
  } catch { return { gainers: [], losers: [], volume: [] }; }
}

// ─────────────────────────────────────────────────────────────
//  BUILD MARKET OVERVIEW  (for analyst-level context)
// ─────────────────────────────────────────────────────────────

export async function fetchMarketOverview(): Promise<MarketOverview | null> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const [kse100, breadth, movers] = await Promise.all([
      fetchKse100(),
      fetchMarketBreadth(),
      fetchTopMovers(),
    ]);

    // Build sector summary from top movers
    const sectorSummary: Record<string, { avg: number; count: number }> = {};
    for (const m of [...movers.gainers, ...movers.losers]) {
      if (!m.sector) continue;
      if (!sectorSummary[m.sector]) sectorSummary[m.sector] = { avg: 0, count: 0 };
      sectorSummary[m.sector].avg   += m.changePct;
      sectorSummary[m.sector].count += 1;
    }
    for (const sec of Object.keys(sectorSummary)) {
      sectorSummary[sec].avg = round2(sectorSummary[sec].avg / sectorSummary[sec].count)!;
    }

    return {
      kse100,
      breadth,
      topGainers:    movers.gainers,
      topLosers:     movers.losers,
      topVolume:     movers.volume,
      sectorSummary,
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  FETCH ALL PORTFOLIO STOCKS  (sequential for rate limit)
// ─────────────────────────────────────────────────────────────

export async function fetchAllStocks(
  portfolioMap:     Record<string, PositionInfo>,
  historicalTrends: import("./types").HistoricalTrend[] = [],
): Promise<StockDataMap> {
  // Fetch KSE-100 + breadth alongside stocks
  const [kse100, breadth] = await Promise.all([fetchKse100(), fetchMarketBreadth()]);

  const stockData: StockDataMap = {};
  const trendMap  = Object.fromEntries(historicalTrends.map(t => [t.symbol, t]));

  for (const [symbol, info] of Object.entries(portfolioMap)) {
    try {
      const data    = await fetchTicker(symbol, info);
      const trend   = trendMap[symbol] ?? null;
      // Inject historical trend into stock data
      (stockData as Record<string, StockResult>)[symbol] = { ...data, historicalTrend: trend };

      // Compact, readable log line
      const chg  = data.changePct != null ? (data.changePct >= 0 ? `+${data.changePct}%` : `${data.changePct}%`) : "n/a";
      const st   = data.superTrend ? `ST:${data.superTrend.signal}` : "";
      const hist = trend ? `7d:${trend.priceChange7d}%` : "";
      console.log(`    ✓ ${symbol.padEnd(7)} PKR ${String(data.price).padStart(8)}  ${chg.padEnd(8)}  RSI:${String(data.rsi14??'').padEnd(5)} MFI:${String(data.mfi??'').padEnd(5)} ${st.padEnd(8)} ${data.trend.padEnd(12)} ${hist}`);
    } catch (err) {
      (stockData as Record<string, StockResult>)[symbol] = {
        symbol: info.symbol, name: info.name, sector: info.sector,
        shares: info.shares, avgCost: info.avgCost,
        error: (err as Error).message, price: null,
      };
      console.log(`    ✗ ${symbol.padEnd(7)} ERROR: ${(err as Error).message}`);
    }
  }

  stockData.__market__ = { kse100, breadth };
  return stockData;
}