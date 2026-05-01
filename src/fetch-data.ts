import axios, { AxiosInstance } from "axios";
// @ts-ignore — yahoo-finance2 has no bundled types in all versions
import YahooFinance from "yahoo-finance2";
import { ENV } from "./config";
import type {
  OhlcvBar, StockData, StockError, StockResult, StockDataMap,
  MarketContext, Fundamentals, DividendRecord, LiveTick, PositionInfo,
} from "./types";
import {
  round2, calcPct, calcEMA, calcSMA, calcRSI, calcMACD, calcBollinger,
  calcStochastic, calcATR, calcADX, calcWilliamsR, calcCCI,
  calcOBV, calcVWAP, calcVwapDevPct, calcIchimoku, calcPivots,
  calcROC, calcMFI, calcSuperTrend, calcVolumeMetrics,
  calcPerfStats, detectDivergence, detectPatterns,
  classifyTrend, classifyMarketRegime, buildSparkline,
} from "./indicators";

// ─── Re-export types so other files can import from here ────
export type { StockData, StockError, StockResult, StockDataMap, MarketContext, LiveTick };

// ─────────────────────────────────────────────────────────────
//  RATE LIMITER
// ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
//  PSXTerminal  axios client
// ─────────────────────────────────────────────────────────────

const psxClient: AxiosInstance = axios.create({
  baseURL:  ENV.PSX_BASE_URL,
  timeout:  20_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; PSX-Agent/6.0)",
    "Accept":     "application/json",
    "Referer":    "https://psxterminal.com/",
    "Origin":     "https://psxterminal.com",
  },
});

async function psxGet<T = unknown>(path: string): Promise<T> {
  const res = await psxClient.get<{ success: boolean; data: T; error?: unknown }>(path);
  await sleep(2000); // respect 100 req/min rate limit
  if (!res.data.success) throw new Error(`PSX ${path}: ${JSON.stringify(res.data.error)}`);
  return res.data.data;
}

// ─────────────────────────────────────────────────────────────
//  PSX API CALLS
// ─────────────────────────────────────────────────────────────

async function fetchLiveTick(symbol: string): Promise<LiveTick | null> {
  try {
    const d = await psxGet<Record<string, number>>(`/api/ticks/REG/${symbol}`);
    const rawPct = d.changePercent ?? 0;
    return {
      price:     round2(d.price)!,
      change:    round2(d.change)!,
      changePct: Math.abs(rawPct) < 2 ? round2(rawPct * 100)! : round2(rawPct)!,
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
  const startMs = Date.now() - 29 * 24 * 60 * 60 * 1000; // 8 months
  const data = await psxGet<Array<Record<string, number>>>(`/api/klines/${symbol}/1d?start=${startMs}&limit=200`);
  if (!Array.isArray(data) || data.length === 0) throw new Error("No PSX kline data");
  return data
    .map(bar => ({ date: new Date(bar.timestamp).toISOString().slice(0, 10), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume || 0 }))
    .filter(b => b.close && b.high && b.low && b.open);
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  try {
    const d = await psxGet<Record<string, number | string>>(`/api/fundamentals/${symbol}`);
    const pe = typeof d.peRatio === "number" ? d.peRatio : null;
    return {
      peRatio:       round2(pe),
      dividendYield: round2(d.dividendYield as number),
      marketCap:     d.marketCap as string ?? null,
      yearChange:    round2(d.yearChange as number),
      volume30Avg:   round2(d.volume30Avg as number),
      eps:           round2(d.eps as number),
      bookValue:     round2(d.bookValue as number),
      pbRatio:       pe != null && typeof d.bookValue === "number" && d.bookValue > 0
                       ? round2(pe / (d.bookValue as number)) : null,
    };
  } catch { return {}; }
}

async function fetchDividends(symbol: string): Promise<DividendRecord[]> {
  try {
    const data = await psxGet<Array<Record<string, unknown>>>(`/api/dividends/${symbol}`);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5).map(d => ({ exDate: String(d.ex_date), amount: Number(d.amount), year: Number(d.year) }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
//  YAHOO FINANCE FALLBACK
// ─────────────────────────────────────────────────────────────

async function fetchYahooKlines(symbol: string): Promise<OhlcvBar[]> {
  const yf = new YahooFinance();
  const period2 = new Date();
  const period1 = new Date(); period1.setMonth(period1.getMonth() - 8);
  const res  = await yf.chart(symbol + ".KA", { period1, period2, interval: "1d" });
  const hist = (res.quotes || [])
    .filter((q: Record<string, unknown>) => q.close != null && q.open != null && q.high != null && q.low != null)
    .map((q: Record<string, unknown>) => ({
      date: q.date ? new Date(q.date as string).toISOString().slice(0, 10) : "",
      open: q.open as number, high: q.high as number,
      low:  q.low  as number, close: q.close as number, volume: (q.volume as number) || 0,
    }));
  if (hist.length < 10) throw new Error(`Yahoo: only ${hist.length} bars`);
  return hist;
}

// ─────────────────────────────────────────────────────────────
//  COMPUTE ALL INDICATORS  (shared by PSX and Yahoo paths)
// ─────────────────────────────────────────────────────────────

function computeIndicators(
  hist:     OhlcvBar[],
  info:     PositionInfo,
  liveTick: LiveTick | null,
): Omit<StockData, "fundamentals" | "dividends" | "dataSource" | "historyBars"> {
  const price    = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today    = hist.at(-1)!;
  const todayBar: OhlcvBar = {
    ...today,
    close:  price,
    high:   liveTick?.high   ?? today.high,
    low:    liveTick?.low    ?? today.low,
    volume: liveTick?.volume ?? today.volume,
  };
  const histLive  = [...hist.slice(0, -1), todayBar];
  const closeLive = histLive.map(b => b.close);

  const ma5   = calcSMA(closeLive, 5);
  const ma10  = calcSMA(closeLive, 10);
  const ma20  = calcSMA(closeLive, 20);
  const ma50  = closeLive.length >= 50  ? calcSMA(closeLive, 50)  : null;
  const ma200 = closeLive.length >= 200 ? calcSMA(closeLive, 200) : null;
  const ema9  = round2(calcEMA(closeLive, 9).at(-1) as number);
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

  const vol  = calcVolumeMetrics(histLive);
  const obv  = calcOBV(histLive);
  const vwap = calcVWAP(histLive);
  const vwapDevPct = calcVwapDevPct(price, vwap);

  const pivots     = calcPivots(histLive);
  const patterns   = detectPatterns(histLive);
  const rsiSeries  = closeLive.map((_, i) => i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null).filter((v): v is number => v != null);
  const divergence = detectDivergence(closeLive, rsiSeries);
  const sparkline  = buildSparkline(closeLive, 20);
  const trend      = classifyTrend(price, ma5, ma20, ma50, macd, adx);
  const marketRegime = classifyMarketRegime(adx, bb, macd);
  const perfStats  = calcPerfStats(histLive, closeLive);

  const costBasis     = round2(info.shares * info.avgCost)!;
  const marketValue   = round2(info.shares * price)!;
  const unrealizedPnl = round2(marketValue - costBasis)!;
  const unrealizedPct = calcPct(price, info.avgCost);

  return {
    symbol: info.symbol, name: info.name, sector: info.sector, shares: info.shares, avgCost: info.avgCost,
    price, open: round2(todayBar.open)!, high: round2(todayBar.high)!, low: round2(todayBar.low)!, volume: todayBar.volume,
    change: liveTick?.change ?? null, changePct: liveTick?.changePct ?? null,
    bid: liveTick?.bid ?? null, ask: liveTick?.ask ?? null, trades: liveTick?.trades ?? null,
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
    [fundamentals, dividends] = await Promise.all([fetchFundamentals(symbol), fetchDividends(symbol)]);
  }

  return { ...computed, fundamentals, dividends, dataSource: isPsx ? "PSXTerminal" : "Yahoo", historyBars: hist.length };
}

// ─────────────────────────────────────────────────────────────
//  KSE-100 + BREADTH
// ─────────────────────────────────────────────────────────────

async function fetchKse100(): Promise<MarketContext["kse100"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const d = await psxGet<Record<string, number>>("/api/ticks/IDX/KSE100");
    const rawPct = d.changePercent ?? 0;
    return { level: round2(d.price)!, change: round2(d.change)!, changePct: Math.abs(rawPct) < 2 ? round2(rawPct * 100)! : round2(rawPct)!, volume: d.volume };
  } catch { return null; }
}

async function fetchMarketBreadth(): Promise<MarketContext["breadth"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const d = await psxGet<Record<string, number>>("/api/stats/breadth");
    return { advances: d.advances, declines: d.declines, unchanged: d.unchanged, adRatio: round2(d.advanceDeclineRatio)!, upVolume: d.upVolume, downVolume: d.downVolume };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  FETCH ALL  (sequential to respect rate limiter)
// ─────────────────────────────────────────────────────────────

export async function fetchAllStocks(portfolioMap: Record<string, PositionInfo>): Promise<StockDataMap> {
  const [kse100, breadth] = await Promise.all([fetchKse100(), fetchMarketBreadth()]);
  const stockData: StockDataMap = {};

  for (const [symbol, info] of Object.entries(portfolioMap)) {
    try {
      const data = await fetchTicker(symbol, info);
      (stockData as Record<string, StockResult>)[symbol] = data;
      const chg = data.changePct != null ? ` (${data.changePct >= 0 ? "+" : ""}${data.changePct}%)` : "";
      const st  = data.superTrend ? ` ST:${data.superTrend.signal}` : "";
      console.log(`    ✓ ${symbol.padEnd(8)} PKR ${String(data.price).padStart(8)}${chg}  RSI:${data.rsi14}  MFI:${data.mfi}  ROC:${data.roc}%${st}  ${data.trend}`);
    } catch (err) {
      (stockData as Record<string, StockResult>)[symbol] = { symbol: info.symbol, name: info.name, sector: info.sector, shares: info.shares, avgCost: info.avgCost, error: (err as Error).message, price: null };
      console.log(`    ✗ ${symbol.padEnd(8)} ${(err as Error).message}`);
    }
  }

  stockData.__market__ = { kse100, breadth };
  return stockData;
}