import axios, { AxiosInstance } from "axios";
import YahooFinance from "yahoo-finance2";
import { log, timed } from "./logger";
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
//  DATA_MODE=A  — PSX tick only (no OHLCV history)
//    Live price from dps.psx.com.pk/timeseries/int/{SYMBOL}
//    All history-based indicators null. Fast, always works.
//
//  DATA_MODE=B  — Full indicators  [default]
//    OHLCV history:  psxterminal /api/klines/{SYMBOL}/1d?limit=100
//                    fallback → Yahoo Finance {SYMBOL}.KA
//    Live tick:      dps.psx.com.pk/timeseries/int/{SYMBOL}
//                    fallback → psxterminal __data.json
//    Dividends:      dps.psx.com.pk/company/payouts (POST)
//                    fallback → __data.json dividendsData
// ─────────────────────────────────────────────────────────────

export type DataMode = "A" | "B";
export const DATA_MODE: DataMode =
  (process.env.DATA_MODE?.toUpperCase() === "A" ? "A" : "B") as DataMode;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
//  HTTP CLIENTS
// ─────────────────────────────────────────────────────────────

const psxTerminalClient: AxiosInstance = axios.create({
  baseURL: ENV.PSX_BASE_URL, // https://psxterminal.com
  timeout: 20_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://psxterminal.com/",
    Origin: "https://psxterminal.com",
  },
});

const dpsClient: AxiosInstance = axios.create({
  baseURL: "https://dps.psx.com.pk",
  timeout: 20_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    Accept: "application/json, text/html, */*; q=0.01",
    Referer: "https://dps.psx.com.pk/",
    Origin: "https://dps.psx.com.pk",
    "X-Requested-With": "XMLHttpRequest",
  },
});

// ─────────────────────────────────────────────────────────────
//  SVELTEKIT NODE-GRAPH DESERIALIZER
//
//  psxterminal __data.json encodes page data as a flat array
//  where every object field value is an integer index into that
//  same array. resolveGraph() materialises it into a plain tree.
// ─────────────────────────────────────────────────────────────

type GraphNode = number | string | boolean | null | object;

function resolveGraph(raw: GraphNode[]): unknown {
  const memo = new Map<number, unknown>();
  function resolve(idx: number): unknown {
    if (memo.has(idx)) return memo.get(idx);
    const val = raw[idx];
    if (val === null || typeof val !== "object") { memo.set(idx, val); return val; }
    if (Array.isArray(val)) {
      const arr: unknown[] = []; memo.set(idx, arr);
      for (const el of val as number[])
        arr.push(typeof el === "number" ? resolve(el) : el);
      return arr;
    }
    const obj: Record<string, unknown> = {}; memo.set(idx, obj);
    for (const [k, v] of Object.entries(val as Record<string, unknown>))
      obj[k] = typeof v === "number" ? resolve(v) : v;
    return obj;
  }
  return resolve(0);
}

// ─────────────────────────────────────────────────────────────
//  DATA SHAPES
// ─────────────────────────────────────────────────────────────

interface PsxTick {
  symbol: string; market: string; st: string;
  price: number; change: number; changePercent: number;
  volume: number; trades: number; value: number;
  high: number; low: number; bid?: number; ask?: number;
}

interface PsxDividendRecord {
  symbol: string; ex_date: string; payment_date: string;
  record_date: string; amount: number; year: number;
}

interface PsxSymbolResolved {
  marketData?:  { instruments?: { REG?: Record<string, PsxTick> } };
  layoutData?:  { kse100?: PsxTick };
  statsData?:   { marketStats?: { REG?: { gainers: number; losers: number; unchanged: number } } };
  dividendsData?: PsxDividendRecord[];
}

// PSXTerminal klines bar shape
interface PsxKlineBar {
  timestamp?: number | string;
  date?: string;
  open: number; high: number; low: number; close: number; volume: number;
}

// DPS timeseries response
interface DpsTimeseriesResponse {
  status: number;
  message: string;
  data: [number, number, number][]; // [unix_ts, price, volume]
}

// ─────────────────────────────────────────────────────────────
//  normPct  — psxterminal changePercent is a fraction
//  e.g. 0.00654 = 0.654%.  Multiply by 100, clamp to ±50.
// ─────────────────────────────────────────────────────────────

function normPct(raw: number | null | undefined): number {
  if (raw == null || isNaN(raw) || !isFinite(raw)) return 0;
  const pct = round2(raw * 100) ?? 0;
  return Math.abs(pct) > 50 ? 0 : pct;
}

// ─────────────────────────────────────────────────────────────
//  1. PSXTerminal __data.json  (company meta + tick fallback)
//
//  GET /symbol/{SYMBOL}/__data.json?market=REG
//  Each symbol has its own URL. Returns SvelteKit node graph
//  containing marketData, layoutData, statsData, dividendsData.
// ─────────────────────────────────────────────────────────────

async function fetchPsxSymbolPayload(symbol: string): Promise<PsxSymbolResolved> {
  const url = `/symbol/${symbol}/__data.json?market=REG`;
  const { data: raw } = await timed(
    `psxterminal __data.json [${symbol}]`, url,
    () => psxTerminalClient.get<{ type: string; nodes: Array<{ type: string; data?: GraphNode[] }> }>(url)
  ).then(r => r);
  const dataNode = raw.nodes?.find(n => n.type === "data" && Array.isArray(n.data));
  if (!dataNode?.data) throw new Error(`${symbol}: __data.json returned no data node (nodes=${raw.nodes?.length ?? 0})`);
  const resolved = resolveGraph(dataNode.data) as PsxSymbolResolved;
  const tickFound = !!resolved.marketData?.instruments?.REG?.[symbol];
  log.debug(`psxterminal __data.json [${symbol}] resolved`, {
    hasMarketData: !!resolved.marketData,
    tickFound,
    hasLayoutData: !!resolved.layoutData,
    hasDividends: (resolved.dividendsData?.length ?? 0) > 0,
  });
  return resolved;
}

function extractLiveTick(resolved: PsxSymbolResolved, symbol: string): LiveTick | null {
  const raw = resolved.marketData?.instruments?.REG?.[symbol] ?? null;
  if (!raw?.price) return null;
  return {
    price:     round2(raw.price)!,
    change:    round2(raw.change) ?? 0,
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

function extractDividendsFromPayload(resolved: PsxSymbolResolved): DividendRecord[] {
  return (resolved.dividendsData ?? []).slice(0, 5)
    .map(d => ({ exDate: d.ex_date, amount: d.amount, year: d.year }));
}

// ─────────────────────────────────────────────────────────────
//  2. PSXTerminal klines  (OHLCV history — primary for Mode B)
//
//  GET /api/klines/{SYMBOL}/1d?limit=100
//  Confirmed working for KSE100. For stock symbols, may return
//  Cloudflare access-denied server-side (browser cookie needed).
//  Falls back to Yahoo Finance if access denied.
// ─────────────────────────────────────────────────────────────

function parsePsxKlines(raw: unknown): OhlcvBar[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return (raw as PsxKlineBar[])
    .map(b => {
      let date = "";
      if (b.date) {
        date = b.date.slice(0, 10);
      } else if (b.timestamp != null) {
        const ms = typeof b.timestamp === "string" ? parseInt(b.timestamp, 10) : b.timestamp;
        date = new Date(ms > 1e10 ? ms : ms * 1000).toISOString().slice(0, 10);
      }
      return { date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 };
    })
    .filter(b => b.date && b.close > 0 && b.open > 0 && b.high > 0 && b.low > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function fetchPsxKlines(symbol: string): Promise<OhlcvBar[]> {
  const url = `/api/klines/${symbol}/1d?limit=100`;
  const { data } = await timed(
    `psxterminal klines [${symbol}]`, url,
    () => psxTerminalClient.get(url)
  );
  if (typeof data === "string") {
    if (data.includes("Access Denied") || data.includes("403") || data.includes("Forbidden"))
      throw new Error(`${symbol}: psxterminal klines blocked by Cloudflare (HTTP 403) -- Yahoo fallback will be used`);
    if (data.trim().startsWith("<"))
      throw new Error(`${symbol}: psxterminal klines returned HTML instead of JSON -- endpoint may have changed`);
  }
  if (data?.error)
    throw new Error(`${symbol}: psxterminal klines error: ${JSON.stringify(data.error)}`);
  if (data?.message?.toLowerCase().includes("denied"))
    throw new Error(`${symbol}: psxterminal klines access denied: ${data.message}`);
  const bars = parsePsxKlines(data);
  if (bars.length < 10)
    throw new Error(`${symbol}: psxterminal klines returned only ${bars.length} bars (need ≥10) -- data may be incomplete`);
  log.debug(`psxterminal klines [${symbol}]`, { bars: bars.length, first: bars[0]?.date, last: bars.at(-1)?.date });
  return bars;
}

// ─────────────────────────────────────────────────────────────
//  3. DPS timeseries  (live intraday tick — primary live price)
//
//  GET https://dps.psx.com.pk/timeseries/int/{SYMBOL}
//  Returns { status, data: [[unix_ts, price, volume], ...] }
//  data[0] is the most recent tick. Derive high/low from series.
// ─────────────────────────────────────────────────────────────

async function fetchDpsLiveTick(symbol: string): Promise<LiveTick | null> {
  const url = `/timeseries/int/${symbol}`;
  const t0 = Date.now();
  try {
    log.apiStart(`DPS timeseries [${symbol}]`, url);
    const { data } = await dpsClient.get<DpsTimeseriesResponse>(url);
    const ms = Date.now() - t0;
    if (data.status !== 1) {
      log.warn(`DPS timeseries [${symbol}]: status=${data.status} msg="${data.message}"`, { url, ms });
      return null;
    }
    if (!data.data?.length) {
      log.warn(`DPS timeseries [${symbol}]: empty data array (market may be closed)`, { url, ms });
      return null;
    }
    const latest  = data.data[0];
    const price   = round2(latest[1])!;
    if (!price) {
      log.warn(`DPS timeseries [${symbol}]: latest tick has zero/null price`, { url, ms });
      return null;
    }
    const prices  = data.data.map(t => t[1]);
    const high    = round2(Math.max(...prices))!;
    const low     = round2(Math.min(...prices))!;
    const volumes = data.data.map(t => t[2]);
    const volume  = volumes.reduce((s, v) => s + v, 0);
    const oldest    = data.data[data.data.length - 1][1];
    const change    = round2(price - oldest) ?? 0;
    const changePct = oldest > 0 ? round2(((price - oldest) / oldest) * 100) ?? 0 : 0;
    log.apiOk(`DPS timeseries [${symbol}]`, url, ms,
      `price=${price} chg=${changePct}% ticks=${data.data.length} H=${high} L=${low}`);
    return { price, change, changePct, volume, trades: data.data.length, high, low, bid: 0, ask: 0, value: 0 };
  } catch (err) {
    log.apiError(`DPS timeseries [${symbol}]`, url, Date.now() - t0, err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  4. DPS payouts  (dividend history — primary for dividends)
//
//  POST https://dps.psx.com.pk/company/payouts
//  Body: symbol=MEBL  (application/x-www-form-urlencoded)
//  Returns HTML table. Parse cash dividends (D) only.
//  Amount "75%(i) (D)" → 75% of PKR 10 par = PKR 7.5/share
// ─────────────────────────────────────────────────────────────

async function fetchDpsPayouts(symbol: string): Promise<DividendRecord[]> {
  const url = "/company/payouts";
  const t0 = Date.now();
  try {
    log.apiStart(`DPS payouts [${symbol}]`, url);
    const { data: html } = await dpsClient.post<string>(
      url,
      `symbol=${encodeURIComponent(symbol)}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } }
    );
    if (typeof html !== "string" || !html.includes("<tr")) {
      log.warn(`DPS payouts [${symbol}]: no table rows in response`, { url, ms: Date.now() - t0, type: typeof html });
      return [];
    }

    const records: DividendRecord[] = [];
    // Match each <tr> body row
    const trRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRx.exec(html)) !== null) {
      const cells: string[] = [];
      const tdRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRx.exec(trMatch[1])) !== null)
        cells.push(tdMatch[1].replace(/<[^>]+>/g, "").trim());

      if (cells.length < 3) continue;
      // cells[0] = announcement date e.g. "April 23, 2026 3:51 PM"
      // cells[1] = period e.g. "31/03/2026(IQ)"
      // cells[2] = details e.g. "75%(i) (D) "
      const detailStr = cells[2] ?? "";
      if (!detailStr.includes("(D)")) continue; // skip bonus/rights

      const amtMatch = detailStr.match(/([\d.]+)%/);
      if (!amtMatch) continue;
      const amount = round2(parseFloat(amtMatch[1]) / 10) ?? 0; // % of PKR 10 par

      const periodStr = cells[1] ?? "";
      const yearMatch = periodStr.match(/(\d{4})/);
      if (!yearMatch) continue;
      const year = parseInt(yearMatch[1], 10);

      // Derive ex_date from book closure (cells[3]) or announcement date (cells[0])
      const bcStr = cells[3] ?? "";
      const bcDate = bcStr.match(/(\d{2}\/\d{2}\/\d{4})/);
      let exDate = new Date().toISOString().slice(0, 10);
      if (bcDate) {
        const [d, m, y] = bcDate[1].split("/");
        exDate = `${y}-${m}-${d}`;
      } else {
        try { exDate = new Date(cells[0]).toISOString().slice(0, 10); } catch { /* ignore */ }
      }

      records.push({ exDate, amount, year });
      if (records.length >= 5) break;
    }
    log.apiOk(`DPS payouts [${symbol}]`, url, Date.now() - t0, `${records.length} cash dividend records`);
    return records;
  } catch (err) {
    log.apiError(`DPS payouts [${symbol}]`, url, Date.now() - t0, err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  5. Yahoo Finance  (OHLCV history fallback for Mode B)
//
//  Uses {SYMBOL}.KA suffix for PSX stocks.
//  Only called when psxterminal klines returns access denied.
// ─────────────────────────────────────────────────────────────

// Override map for symbols where Yahoo ticker differs from {SYMBOL}.KA
// Verify each entry at finance.yahoo.com before adding.
const YAHOO_TICKER_OVERRIDES: Record<string, string> = {};

async function fetchYahooKlines(symbol: string): Promise<OhlcvBar[]> {
  const ticker = YAHOO_TICKER_OVERRIDES[symbol] ?? `${symbol}.KA`;
  const url = `yahoo-finance2://chart/${ticker}`;
  const t0 = Date.now();
  log.apiStart(`Yahoo Finance [${ticker}]`, url);
  const yf = new YahooFinance();
  const period2 = new Date();
  const period1 = new Date();
  period1.setMonth(period1.getMonth() - 8);

  const res = await (yf as unknown as {
    chart: (t: string, o: object) => Promise<{
      quotes?: Array<{
        open: number | null; high: number | null; low: number | null;
        close: number | null; volume: number | null; date?: Date;
      }>;
    }>;
  }).chart(ticker, { period1, period2, interval: "1d" });

  const bars = (res.quotes ?? [])
    .filter((q): q is { open: number; high: number; low: number; close: number; volume: number; date?: Date } =>
      q.close != null && q.open != null && q.high != null && q.low != null)
    .map(q => ({
      date:   q.date ? new Date(q.date).toISOString().slice(0, 10) : "",
      open:   q.open, high: q.high, low: q.low, close: q.close, volume: q.volume ?? 0,
    }))
    .filter(b => b.date);

  if (bars.length < 30) throw new Error(`Yahoo ${ticker}: only ${bars.length} bars returned (need ≥30) -- symbol may not be listed on Yahoo Finance`);
  log.apiOk(`Yahoo Finance [${ticker}]`, url, Date.now() - t0, `${bars.length} bars  ${bars[0]?.date} → ${bars.at(-1)?.date}`);
  return bars;
}

// ─────────────────────────────────────────────────────────────
//  6. KSE-100  (from __data.json layoutData, fallback klines)
// ─────────────────────────────────────────────────────────────

async function fetchKse100(firstResolved: PsxSymbolResolved | null): Promise<MarketContext["kse100"]> {
  // Primary: layoutData.kse100 present in every symbol's __data.json response
  const k = firstResolved?.layoutData?.kse100;
  if (k && k.price > 0) {
    return {
      level:     round2(k.price)!,
      change:    round2(k.change) ?? 0,
      changePct: normPct(k.changePercent),
      volume:    k.volume ?? 0,
    };
  }
  // Fallback: confirmed working klines endpoint for KSE100 index only
  try {
    const { data } = await psxTerminalClient.get<PsxKlineBar[]>("/api/klines/KSE100/1d?limit=7");
    if (Array.isArray(data) && data.length >= 2) {
      const bars = parsePsxKlines(data);
      if (bars.length >= 2) {
        const last = bars.at(-1)!;
        const prev = bars.at(-2)!;
        const level     = round2(last.close)!;
        const change    = round2(level - prev.close)!;
        const changePct = prev.close > 0 ? round2((change / prev.close) * 100)! : 0;
        return { level, change, changePct, volume: last.volume ?? 0 };
      }
    }
  } catch (err) {
    log.warn("KSE100 klines fallback also failed", { error: (err as Error).message });
  }
  log.warn("KSE100: all sources failed -- returning null");
  return null;
}

// ─────────────────────────────────────────────────────────────
//  7. Market breadth  (from __data.json statsData)
// ─────────────────────────────────────────────────────────────

function extractBreadth(resolved: PsxSymbolResolved | null): MarketContext["breadth"] {
  const s = resolved?.statsData?.marketStats?.REG;
  if (!s) return null;
  const adRatio = s.losers > 0 ? round2(s.gainers / s.losers)! : (s.gainers > 0 ? 99 : 1);
  return { advances: s.gainers ?? 0, declines: s.losers ?? 0, unchanged: s.unchanged ?? 0,
           adRatio, upVolume: 0, downVolume: 0 };
}

// ─────────────────────────────────────────────────────────────
//  COMPUTE ALL INDICATORS
// ─────────────────────────────────────────────────────────────

function computeIndicators(
  hist: OhlcvBar[],
  info: PositionInfo,
  liveTick: LiveTick | null
): Omit<StockData, "fundamentals" | "dividends" | "dataSource" | "historyBars"> {
  const price  = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today  = hist.at(-1)!;
  const todayBar: OhlcvBar = {
    ...today,
    close:  price,
    high:   liveTick ? Math.max(today.high, liveTick.high, price) : Math.max(today.high, price),
    low:    liveTick ? Math.min(today.low,  liveTick.low,  price) : Math.min(today.low,  price),
    volume: liveTick?.volume ?? today.volume,
  };
  const histLive  = [...hist.slice(0, -1), todayBar];
  const closeLive = histLive.map(b => b.close);

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
    .map((_, i) => i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null)
    .filter((v): v is number => v != null);
  const divergence = detectDivergence(closeLive, rsiSeries);

  const perfStats = calcPerfStats(histLive, closeLive);
  const sparkline = buildSparkline(closeLive, 20);
  const trend     = classifyTrend(price, ma5, ma20, ma50, macd, adx);

  const costBasis     = round2(info.shares * info.avgCost)!;
  const marketValue   = round2(info.shares * price)!;
  const unrealizedPnl = round2(marketValue - costBasis)!;
  const unrealizedPct = calcPct(price, info.avgCost);

  const prevClose         = hist.length >= 2 ? hist.at(-2)!.close : price;
  const fallbackChange    = round2(price - prevClose)!;
  const fallbackChangePct = prevClose > 0 ? round2(((price - prevClose) / prevClose) * 100)! : 0;

  return {
    symbol: info.symbol, name: info.name, sector: info.sector,
    shares: info.shares, avgCost: info.avgCost,
    price, open: round2(todayBar.open)!, high: round2(todayBar.high)!, low: round2(todayBar.low)!,
    volume: todayBar.volume,
    change:    liveTick?.change    ?? fallbackChange,
    changePct: liveTick?.changePct ?? fallbackChangePct,
    bid: liveTick?.bid ?? null, ask: liveTick?.ask ?? null, trades: liveTick?.trades ?? null,
    ma5, ma10, ma20, ma50, ma200, ema9, ema21,
    rsi14, rsi9, macd, bb, stoch, willR, cci, roc, mfi,
    atr, adx, ichi, superTrend, trend,
    vol, obv, vwap, pivots, patterns, divergence, sparkline,
    ...perfStats,
    costBasis, marketValue, unrealizedPnl, unrealizedPct,
  };
}

// ─────────────────────────────────────────────────────────────
//  MODE A — PSX tick only, no OHLCV history
//
//  Data flow per symbol:
//    dps timeseries (primary tick) + psxterminal __data.json
//    (meta + tick fallback) + dps payouts (dividends) — all parallel
// ─────────────────────────────────────────────────────────────

async function fetchTickerModeA(
  symbol: string,
  info: PositionInfo
): Promise<{ data: StockData; resolved: PsxSymbolResolved }> {
  const [resolvedRes, dpsTickRes, dpsDivsRes] = await Promise.allSettled([
    fetchPsxSymbolPayload(symbol),
    fetchDpsLiveTick(symbol),
    fetchDpsPayouts(symbol),
  ]);

  const resolved  = resolvedRes.status === "fulfilled" ? resolvedRes.value : {} as PsxSymbolResolved;
  const dpsTick   = dpsTickRes.status  === "fulfilled" ? dpsTickRes.value  : null;
  const dpsDivs   = dpsDivsRes.status  === "fulfilled" ? dpsDivsRes.value  : [];

  // Live tick: DPS timeseries > psxterminal __data.json
  const liveTick  = dpsTick ?? extractLiveTick(resolved, symbol);
  if (!liveTick) throw new Error(`${symbol}: no live tick from DPS or psxterminal`);

  const dividends = dpsDivs.length > 0 ? dpsDivs : extractDividendsFromPayload(resolved);

  const syntheticBar: OhlcvBar = {
    date:   new Date().toISOString().slice(0, 10),
    open:   liveTick.price, high: liveTick.high,
    low:    liveTick.low,   close: liveTick.price,
    volume: liveTick.volume,
  };

  const computed = computeIndicators([syntheticBar], info, liveTick);
  const src = dpsTick ? "DPS timeseries" : "psxterminal __data.json";
  return {
    resolved,
    data: {
      ...computed, fundamentals: {}, dividends,
      dataSource:  `${src} tick only (Mode A -- no history)`,
      historyBars: 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  MODE B — Full indicators
//
//  OHLCV priority:  psxterminal klines → Yahoo Finance
//  Live tick:       DPS timeseries → psxterminal __data.json
//  Dividends:       DPS payouts → __data.json dividendsData
//  All sources fetched concurrently per symbol.
// ─────────────────────────────────────────────────────────────

async function fetchTickerModeB(
  symbol: string,
  info: PositionInfo
): Promise<{ data: StockData; resolved: PsxSymbolResolved }> {
  // Attempt psxterminal klines first, Yahoo as fallback
  let hist: OhlcvBar[] | null = null;
  let ohlcvSource = "";

  try {
    hist = await fetchPsxKlines(symbol);
    ohlcvSource = "psxterminal klines";
  } catch (psxErr) {
    console.warn(`  ~ ${symbol}: psxterminal klines failed (${(psxErr as Error).message}) -- trying Yahoo`);
    try {
      hist = await fetchYahooKlines(symbol);
      ohlcvSource = "Yahoo Finance";
    } catch (yahooErr) {
      console.warn(`  ~ ${symbol}: Yahoo also failed (${(yahooErr as Error).message})`);
    }
  }

  // Fetch meta + tick + dividends concurrently while klines were loading
  const [resolvedRes, dpsTickRes, dpsDivsRes] = await Promise.allSettled([
    fetchPsxSymbolPayload(symbol),
    fetchDpsLiveTick(symbol),
    fetchDpsPayouts(symbol),
  ]);

  const resolved  = resolvedRes.status === "fulfilled" ? resolvedRes.value : {} as PsxSymbolResolved;
  const dpsTick   = dpsTickRes.status  === "fulfilled" ? dpsTickRes.value  : null;
  const dpsDivs   = dpsDivsRes.status  === "fulfilled" ? dpsDivsRes.value  : [];

  const liveTick  = dpsTick ?? extractLiveTick(resolved, symbol);
  const dividends = dpsDivs.length > 0 ? dpsDivs : extractDividendsFromPayload(resolved);

  // If both klines sources failed, fall back to tick-only (never drop the stock)
  if (!hist) {
    if (!liveTick) throw new Error(`${symbol}: no OHLCV and no live tick`);
    console.warn(`  ~ ${symbol}: no OHLCV history -- using tick only`);
    const syntheticBar: OhlcvBar = {
      date:   new Date().toISOString().slice(0, 10),
      open:   liveTick.price, high: liveTick.high,
      low:    liveTick.low,   close: liveTick.price,
      volume: liveTick.volume,
    };
    const computed = computeIndicators([syntheticBar], info, liveTick);
    return {
      resolved,
      data: {
        ...computed, fundamentals: {}, dividends,
        dataSource:  "tick only (psxterminal klines + Yahoo both failed)",
        historyBars: 1,
      },
    };
  }

  const computed = computeIndicators(hist, info, liveTick);
  const tickSrc  = dpsTick ? "DPS tick" : liveTick ? "psxterminal tick" : "no live tick";
  return {
    resolved,
    data: {
      ...computed, fundamentals: {}, dividends,
      dataSource:  `${ohlcvSource} + ${tickSrc} (Mode B)`,
      historyBars: hist.length,
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
  let firstResolved: PsxSymbolResolved | null = null;

  for (const [symbol, info] of Object.entries(portfolioMap)) {
    const t0sym = Date.now();

    try {
      let data: StockData;
      let resolved: PsxSymbolResolved = {};

      if (!isPsx) {
        // PORTFOLIO_TYPE=yahoo: pure Yahoo, no PSX calls
        const hist     = await fetchYahooKlines(symbol);
        const computed = computeIndicators(hist, info, null);
        data = { ...computed, fundamentals: {}, dividends: [],
                 dataSource: "Yahoo Finance", historyBars: hist.length };
      } else if (DATA_MODE === "A") {
        ({ data, resolved } = await fetchTickerModeA(symbol, info));
        await sleep(800);
      } else {
        ({ data, resolved } = await fetchTickerModeB(symbol, info));
        await sleep(500);
      }
      const symMs = Date.now() - t0sym;

      if (isPsx && firstResolved === null && Object.keys(resolved).length > 0)
        firstResolved = resolved;

      stockData[symbol] = data;

      const chg = data.changePct != null ? ` (${data.changePct >= 0 ? "+" : ""}${data.changePct}%)` : "";
      const st  = data.superTrend ? ` ST:${data.superTrend.signal}@${data.superTrend.value}` : "";
      log.stock(symbol, true,
        `PKR ${String(data.price).padStart(8)}${chg}  RSI:${data.rsi14}  MFI:${data.mfi}  ROC:${data.roc}${st}  ${data.trend}`,
        { bars: data.historyBars, src: data.dataSource, ms: symMs });
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; code?: string; message?: string };
      const errDetail = [
        e?.response?.status ? `HTTP ${e.response.status}` : "",
        e?.code ? `code=${e.code}` : "",
        e?.message ?? String(err),
      ].filter(Boolean).join(" | ");
      stockData[symbol] = { error: errDetail, ...info, price: null } as unknown as StockError;
      log.stock(symbol, false, errDetail, { ms: Date.now() - t0sym });
    }
  }

  const kse100  = isPsx ? await fetchKse100(firstResolved)  : null;
  const breadth = isPsx ? extractBreadth(firstResolved)     : null;
  stockData.__market__ = { kse100, breadth };
  return stockData;
}
