import axios, { AxiosInstance } from "axios";
import YahooFinance from "yahoo-finance2";
import { ENV } from "./config";
import { PositionInfo } from "./portfolio";
import type {
  OhlcvBar, StockData, StockError, StockResult, StockDataMap,
  MarketContext, Fundamentals, DividendRecord, LiveTick,
} from "./types";
import {
  round2, calcPct, calcEMA, calcSMA,
  calcRSI, calcMACD, calcBollinger, calcStochastic,
  calcATR, calcADX, calcWilliamsR, calcCCI,
  calcOBV, calcVWAP, calcIchimoku, calcPivots,
  calcROC, calcMFI, calcSuperTrend,
  detectDivergence, detectPatterns,
  calcVolumeMetrics, calcPerfStats,
  classifyTrend, buildSparkline,
} from "./indicators";

export type {
  StockData, StockError, StockResult, StockDataMap,
  MarketContext, Fundamentals, DividendRecord, LiveTick,
};

// ─────────────────────────────────────────────────────────────
//  DATA MODE
//
//  Controlled by DATA_MODE env var (set in .env):
//
//  A  — PSX tick only (no OHLCV history)
//       Each stock fetches /symbol/{SYMBOL}/__data.json?market=REG
//       Gets live price, change, volume, high, low, bid, ask.
//       All history-based indicators (RSI, MACD, BB, SuperTrend,
//       Ichimoku, ATR, ADX…) will be null. Fast but limited signals.
//
//  B  — Yahoo Finance OHLCV + PSX live tick override  [default]
//       Fetches 8 months of daily bars from Yahoo (.KA suffix),
//       then overrides the last bar with the live PSX price/volume.
//       All 16+ indicators compute fully. Best signal quality.
//
//  DATA_MODE=A or DATA_MODE=B in your .env
// ─────────────────────────────────────────────────────────────

export type DataMode = "A" | "B";
export const DATA_MODE: DataMode =
  (process.env.DATA_MODE?.toUpperCase() === "A" ? "A" : "B") as DataMode;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
//  PSX CLIENT
//
//  Working endpoints:
//    GET /symbol/{SYMBOL}/__data.json?market=REG
//        Each symbol has its own URL. Returns a SvelteKit node
//        graph containing:
//          marketData.instruments.REG.{SYMBOL}  → live tick
//          layoutData.kse100                    → KSE-100 live
//          statsData.marketStats.REG            → breadth
//          dividendsData                        → dividend history
//    GET /api/klines/KSE100/1d?limit=7
//        KSE-100 daily bars (fallback if layoutData.kse100 absent)
// ─────────────────────────────────────────────────────────────

const psxClient: AxiosInstance = axios.create({
  baseURL: ENV.PSX_BASE_URL,
  timeout: 20_000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://psxterminal.com/",
    Origin: "https://psxterminal.com",
  },
});

async function psxFetch<T = unknown>(url: string): Promise<T> {
  const { data } = await psxClient.get<T>(url);
  return data;
}

// ─────────────────────────────────────────────────────────────
//  SVELTEKIT NODE-GRAPH DESERIALIZER
//
//  __data.json stores page data as a flat array. Every object
//  field value is an integer index into that same array.
//  resolveGraph() walks it with memoisation and returns a plain
//  JS object tree ready to use.
// ─────────────────────────────────────────────────────────────

type GraphNode = number | string | boolean | null | object;

function resolveGraph(raw: GraphNode[]): unknown {
  const memo = new Map<number, unknown>();

  function resolve(idx: number): unknown {
    if (memo.has(idx)) return memo.get(idx);
    const val = raw[idx];
    if (val === null || typeof val !== "object") {
      memo.set(idx, val);
      return val;
    }
    if (Array.isArray(val)) {
      const arr: unknown[] = [];
      memo.set(idx, arr);
      for (const el of val as number[])
        arr.push(typeof el === "number" ? resolve(el) : el);
      return arr;
    }
    const obj: Record<string, unknown> = {};
    memo.set(idx, obj);
    for (const [k, v] of Object.entries(val as Record<string, unknown>))
      obj[k] = typeof v === "number" ? resolve(v) : v;
    return obj;
  }

  return resolve(0);
}

// ─────────────────────────────────────────────────────────────
//  PSX DATA SHAPES
// ─────────────────────────────────────────────────────────────

interface PsxTick {
  symbol:        string;
  market:        string;
  st:            string;        // "OPN" | "CLS" | …
  price:         number;
  change:        number;
  changePercent: number;        // fraction: 0.00654 = 0.654%
  volume:        number;
  trades:        number;
  value:         number;
  high:          number;
  low:           number;
  bid?:          number;
  ask?:          number;
}

interface PsxDividendRecord {
  symbol:       string;
  ex_date:      string;
  payment_date: string;
  record_date:  string;
  amount:       number;
  year:         number;
}

// Resolved shape of a single symbol's __data.json payload
interface PsxSymbolResolved {
  marketData?: {
    instruments?: { REG?: Record<string, PsxTick> };
  };
  layoutData?: { kse100?: PsxTick };
  statsData?: {
    marketStats?: {
      REG?: {
        gainers: number; losers: number; unchanged: number;
        totalVolume: number; totalValue: number; totalTrades: number;
      };
    };
  };
  dividendsData?: PsxDividendRecord[];
}

// ─────────────────────────────────────────────────────────────
//  normPct  — PSX changePercent is a fraction (0.00654 = 0.654%)
//  Multiply by 100, round to 2dp, clamp to ±50.
// ─────────────────────────────────────────────────────────────

function normPct(raw: number | null | undefined): number {
  if (raw == null || isNaN(raw) || !isFinite(raw)) return 0;
  const pct = round2(raw * 100) ?? 0;
  return Math.abs(pct) > 50 ? 0 : pct;
}

// ─────────────────────────────────────────────────────────────
//  FETCH ONE SYMBOL'S __data.json
//  Returns the fully resolved payload for that symbol.
// ─────────────────────────────────────────────────────────────

async function fetchPsxSymbolPayload(symbol: string): Promise<PsxSymbolResolved> {
  const raw = await psxFetch<{
    type: string;
    nodes: Array<{ type: string; data?: GraphNode[] }>;
  }>(`/symbol/${symbol}/__data.json?market=REG`);

  const dataNode = raw.nodes?.find(
    (n) => n.type === "data" && Array.isArray(n.data)
  );
  if (!dataNode?.data)
    throw new Error(`${symbol}: no data node in __data.json`);

  return resolveGraph(dataNode.data) as PsxSymbolResolved;
}

// ─────────────────────────────────────────────────────────────
//  EXTRACT LIVE TICK FROM A SYMBOL PAYLOAD
// ─────────────────────────────────────────────────────────────

function extractLiveTick(
  resolved: PsxSymbolResolved,
  symbol: string
): LiveTick | null {
  const instruments = resolved.marketData?.instruments?.REG;
  if (!instruments) return null;

  const raw = instruments[symbol] ?? null;
  if (!raw || !raw.price) return null;

  return {
    price:     round2(raw.price)!,
    change:    round2(raw.change)   ?? 0,
    changePct: normPct(raw.changePercent),
    volume:    raw.volume  ?? 0,
    trades:    raw.trades  ?? 0,
    high:      round2(raw.high ?? raw.price)!,
    low:       round2(raw.low  ?? raw.price)!,
    bid:       round2(raw.bid  ?? 0)!,
    ask:       round2(raw.ask  ?? 0)!,
    value:     raw.value   ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
//  EXTRACT DIVIDENDS FROM A SYMBOL PAYLOAD
// ─────────────────────────────────────────────────────────────

function extractDividends(resolved: PsxSymbolResolved): DividendRecord[] {
  return (resolved.dividendsData ?? [])
    .slice(0, 5)
    .map((d) => ({ exDate: d.ex_date, amount: d.amount, year: d.year }));
}

// ─────────────────────────────────────────────────────────────
//  KSE-100 — from layoutData (present in every symbol response)
//  Fallback: /api/klines/KSE100/1d?limit=7
// ─────────────────────────────────────────────────────────────

async function fetchKse100(
  firstResolved: PsxSymbolResolved | null
): Promise<MarketContext["kse100"]> {
  // Primary: layoutData.kse100 from the already-fetched payload
  const k = firstResolved?.layoutData?.kse100;
  if (k && k.price > 0) {
    return {
      level:     round2(k.price)!,
      change:    round2(k.change) ?? 0,
      changePct: normPct(k.changePercent),
      volume:    k.volume ?? 0,
    };
  }

  // Fallback: confirmed working klines endpoint for KSE100 index
  try {
    interface KlineBar { close: number; volume?: number }
    const bars = await psxFetch<KlineBar[]>("/api/klines/KSE100/1d?limit=7");
    if (Array.isArray(bars) && bars.length >= 2) {
      const last = bars.at(-1)!;
      const prev = bars.at(-2)!;
      const level     = round2(last.close)!;
      const change    = round2(level - prev.close)!;
      const changePct = prev.close > 0
        ? round2((change / prev.close) * 100)! : 0;
      return { level, change, changePct, volume: last.volume ?? 0 };
    }
  } catch { /* ignore */ }

  return null;
}

// ─────────────────────────────────────────────────────────────
//  MARKET BREADTH — from statsData (present in every symbol response)
// ─────────────────────────────────────────────────────────────

function extractBreadth(
  resolved: PsxSymbolResolved | null
): MarketContext["breadth"] {
  const s = resolved?.statsData?.marketStats?.REG;
  if (!s) return null;
  const adRatio = s.losers > 0
    ? round2(s.gainers / s.losers)!
    : (s.gainers > 0 ? 99 : 1);
  return {
    advances:   s.gainers   ?? 0,
    declines:   s.losers    ?? 0,
    unchanged:  s.unchanged ?? 0,
    adRatio,
    upVolume:   0,
    downVolume: 0,
  };
}

// ─────────────────────────────────────────────────────────────
//  YAHOO FINANCE — OHLCV history (Mode B)
//  PSX stocks use .KA suffix on Yahoo (e.g. MEBL.KA)
// ─────────────────────────────────────────────────────────────

async function fetchYahooKlines(symbol: string): Promise<OhlcvBar[]> {
  const ticker = `${symbol}.KA`;
  const yf = new YahooFinance();
  const period2 = new Date();
  const period1 = new Date();
  period1.setMonth(period1.getMonth() - 8);

  const res = await (
    yf as unknown as {
      chart: (
        t: string,
        o: object
      ) => Promise<{
        quotes?: Array<{
          open: number | null; high: number | null;
          low:  number | null; close: number | null;
          volume: number | null; date?: Date;
        }>;
      }>;
    }
  ).chart(ticker, { period1, period2, interval: "1d" });

  const bars = (res.quotes ?? [])
    .filter(
      (q): q is {
        open: number; high: number; low: number;
        close: number; volume: number; date?: Date;
      } =>
        q.close != null && q.open != null &&
        q.high  != null && q.low  != null
    )
    .map((q) => ({
      date:   q.date ? new Date(q.date).toISOString().slice(0, 10) : "",
      open:   q.open,
      high:   q.high,
      low:    q.low,
      close:  q.close,
      volume: q.volume ?? 0,
    }))
    .filter((b) => b.date);

  if (bars.length < 30)
    throw new Error(`Yahoo ${ticker}: only ${bars.length} bars`);
  return bars;
}

// ─────────────────────────────────────────────────────────────
//  COMPUTE ALL INDICATORS  (shared by Mode A and Mode B)
// ─────────────────────────────────────────────────────────────

function computeIndicators(
  hist: OhlcvBar[],
  info: PositionInfo,
  liveTick: LiveTick | null
): Omit<StockData, "fundamentals" | "dividends" | "dataSource" | "historyBars"> {
  const price   = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today   = hist.at(-1)!;
  const todayBar: OhlcvBar = {
    ...today,
    close:  price,
    high:   liveTick
      ? Math.max(today.high, liveTick.high, price)
      : Math.max(today.high, price),
    low:    liveTick
      ? Math.min(today.low, liveTick.low, price)
      : Math.min(today.low, price),
    volume: liveTick?.volume ?? today.volume,
  };
  const histLive  = [...hist.slice(0, -1), todayBar];
  const closeLive = histLive.map((b) => b.close);

  const ma5   = calcSMA(closeLive, 5);
  const ma10  = calcSMA(closeLive, 10);
  const ma20  = calcSMA(closeLive, 20);
  const ma50  = closeLive.length >= 50  ? calcSMA(closeLive, 50)  : null;
  const ma200 = closeLive.length >= 200 ? calcSMA(closeLive, 200) : null;
  const ema9  = round2(calcEMA(closeLive,  9).at(-1) as number | null | undefined);
  const ema21 = round2(calcEMA(closeLive, 21).at(-1) as number | null | undefined);

  const rsi14 = calcRSI(closeLive, 14);
  const rsi9  = calcRSI(closeLive, 9);
  const macd  = calcMACD(closeLive);
  const bb    = calcBollinger(closeLive);
  const stoch = calcStochastic(histLive);
  const willR = calcWilliamsR(histLive);
  const cci   = calcCCI(histLive);
  const roc   = calcROC(closeLive, 12);
  const mfi   = calcMFI(histLive, 14);
  const superTrend = calcSuperTrend(histLive, 10, 3);
  const atr   = calcATR(histLive);
  const adx   = calcADX(histLive);
  const ichi  = calcIchimoku(histLive);
  const vol   = calcVolumeMetrics(histLive);
  const obv   = calcOBV(histLive);
  const vwap  = calcVWAP(histLive);
  const pivots   = calcPivots(histLive);
  const patterns = detectPatterns(histLive);

  const rsiSeries = closeLive
    .map((_, i) => (i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null))
    .filter((v): v is number => v != null);
  const divergence = detectDivergence(closeLive, rsiSeries);

  const perfStats  = calcPerfStats(histLive, closeLive);
  const sparkline  = buildSparkline(closeLive, 20);
  const trend      = classifyTrend(price, ma5, ma20, ma50, macd, adx);

  const costBasis     = round2(info.shares * info.avgCost)!;
  const marketValue   = round2(info.shares * price)!;
  const unrealizedPnl = round2(marketValue - costBasis)!;
  const unrealizedPct = calcPct(price, info.avgCost);

  const prevClose         = hist.length >= 2 ? hist.at(-2)!.close : price;
  const fallbackChange    = round2(price - prevClose)!;
  const fallbackChangePct = prevClose > 0
    ? round2(((price - prevClose) / prevClose) * 100)! : 0;

  return {
    symbol: info.symbol, name: info.name, sector: info.sector,
    shares: info.shares, avgCost: info.avgCost,
    price,
    open:   round2(todayBar.open)!,
    high:   round2(todayBar.high)!,
    low:    round2(todayBar.low)!,
    volume: todayBar.volume,
    change:    liveTick?.change    ?? fallbackChange,
    changePct: liveTick?.changePct ?? fallbackChangePct,
    bid:    liveTick?.bid    ?? null,
    ask:    liveTick?.ask    ?? null,
    trades: liveTick?.trades ?? null,
    ma5, ma10, ma20, ma50, ma200, ema9, ema21,
    rsi14, rsi9, macd, bb, stoch, willR, cci, roc, mfi,
    atr, adx, ichi, superTrend, trend,
    vol, obv, vwap, pivots, patterns, divergence,
    sparkline,
    ...perfStats,
    costBasis, marketValue, unrealizedPnl, unrealizedPct,
  };
}

// ─────────────────────────────────────────────────────────────
//  MODE A — PSX tick only, one __data.json per symbol
//
//  Fetches /symbol/{SYMBOL}/__data.json?market=REG.
//  Builds a single synthetic OHLCV bar from today's tick so
//  computeIndicators() runs without crashing — all multi-bar
//  indicators return null naturally (insufficient data).
// ─────────────────────────────────────────────────────────────

async function fetchTickerModeA(
  symbol: string,
  info: PositionInfo
): Promise<{ data: StockData; resolved: PsxSymbolResolved }> {
  const resolved = await fetchPsxSymbolPayload(symbol);
  const liveTick = extractLiveTick(resolved, symbol);
  if (!liveTick)
    throw new Error(`${symbol}: symbol not found in PSX market data`);

  const syntheticBar: OhlcvBar = {
    date:   new Date().toISOString().slice(0, 10),
    open:   liveTick.price,
    high:   liveTick.high,
    low:    liveTick.low,
    close:  liveTick.price,
    volume: liveTick.volume,
  };

  const computed = computeIndicators([syntheticBar], info, liveTick);
  return {
    resolved,
    data: {
      ...computed,
      fundamentals: {},
      dividends:    extractDividends(resolved),
      dataSource:   "PSX __data.json tick only (Mode A — no history)",
      historyBars:  1,
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  MODE B — Yahoo OHLCV + PSX live tick override per symbol
//
//  Fetches /symbol/{SYMBOL}/__data.json?market=REG for the live
//  tick and dividends, plus Yahoo Finance for 8m of OHLCV bars.
//  The PSX live price overrides the last Yahoo bar so all
//  indicators compute on today's actual price.
// ─────────────────────────────────────────────────────────────

async function fetchTickerModeB(
  symbol: string,
  info: PositionInfo
): Promise<{ data: StockData; resolved: PsxSymbolResolved }> {
  // Fetch PSX payload and Yahoo history concurrently
  const [psxRes, yahooRes] = await Promise.allSettled([
    fetchPsxSymbolPayload(symbol),
    fetchYahooKlines(symbol),
  ]);

  if (yahooRes.status === "rejected")
    throw new Error(`${symbol} Yahoo: ${(yahooRes.reason as Error).message}`);

  const hist     = yahooRes.value;
  const resolved = psxRes.status === "fulfilled" ? psxRes.value : {} as PsxSymbolResolved;
  const liveTick = extractLiveTick(resolved, symbol); // null outside market hours

  const computed   = computeIndicators(hist, info, liveTick);
  const dataSource = liveTick
    ? "Yahoo Finance (history) + PSX live tick override (Mode B)"
    : "Yahoo Finance only — PSX tick unavailable (Mode B)";

  return {
    resolved,
    data: {
      ...computed,
      fundamentals: {},
      dividends:    extractDividends(resolved),
      dataSource,
      historyBars:  hist.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  FETCH ALL STOCKS
// ─────────────────────────────────────────────────────────────

export async function fetchAllStocks(
  portfolioMap: Record<string, PositionInfo>
): Promise<StockDataMap> {
  const isPsx = ENV.PORTFOLIO_TYPE === "psx";
  const stockData: StockDataMap = {};

  // For KSE-100 and breadth we reuse the resolved payload from the
  // first successful symbol fetch — both layoutData.kse100 and
  // statsData.marketStats.REG are present in every symbol's response.
  let firstResolved: PsxSymbolResolved | null = null;

  for (const [symbol, info] of Object.entries(portfolioMap)) {
    try {
      let data: StockData;
      let resolved: PsxSymbolResolved = {};

      if (!isPsx) {
        // PORTFOLIO_TYPE=yahoo — pure Yahoo, no PSX calls
        const hist     = await fetchYahooKlines(symbol);
        const computed = computeIndicators(hist, info, null);
        data = {
          ...computed,
          fundamentals: {}, dividends: [],
          dataSource: "Yahoo Finance", historyBars: hist.length,
        };
      } else if (DATA_MODE === "A") {
        ({ data, resolved } = await fetchTickerModeA(symbol, info));
        await sleep(1_000); // be polite between PSX requests
      } else {
        ({ data, resolved } = await fetchTickerModeB(symbol, info));
        await sleep(500);   // brief gap between Yahoo requests
      }

      // Capture first resolved payload for KSE-100 / breadth
      if (isPsx && firstResolved === null && Object.keys(resolved).length > 0)
        firstResolved = resolved;

      stockData[symbol] = data;

      const chgStr = data.changePct != null
        ? ` (${data.changePct >= 0 ? "+" : ""}${data.changePct}%)` : "";
      const stStr  = data.superTrend
        ? ` ST:${data.superTrend.signal}@${data.superTrend.value}` : "";
      process.stdout.write(
        `    ✓ ${symbol.padEnd(8)} PKR ${String(data.price).padStart(8)}${chgStr}` +
        `  RSI:${data.rsi14}  MFI:${data.mfi}  ROC:${data.roc}${stStr}` +
        `  ${data.trend}  [${data.dataSource}]\n`
      );
    } catch (err) {
      stockData[symbol] = {
        error: (err as Error).message,
        ...info, price: null,
      } as unknown as StockError;
      process.stdout.write(
        `    ✗ ${symbol.padEnd(8)} ${(err as Error).message}\n`
      );
    }
  }

  // KSE-100 and breadth from the first symbol's cached payload
  const kse100  = isPsx ? await fetchKse100(firstResolved)  : null;
  const breadth = isPsx ? extractBreadth(firstResolved)     : null;

  stockData.__market__ = { kse100, breadth };
  return stockData;
}