import axios, { AxiosInstance, AxiosError } from "axios";
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
//  PSXTerminal client  (primary)
// ─────────────────────────────────────────────────────────────

const psxClient: AxiosInstance = axios.create({
  baseURL: ENV.PSX_BASE_URL,  // https://psxterminal.com
  timeout: 20_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept":     "application/json, text/plain, */*",
    "Referer":    "https://psxterminal.com/",
    "Origin":     "https://psxterminal.com",
  },
});

// DPS PSX client  (secondary — official PSX portal)
const dpsClient: AxiosInstance = axios.create({
  baseURL: "https://dps.psx.com.pk",
  timeout: 20_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept":     "application/json, text/plain, */*",
    "Referer":    "https://dps.psx.com.pk/",
    "X-Requested-With": "XMLHttpRequest",
  },
});

// ─────────────────────────────────────────────────────────────
//  GENERIC API GETTER  (handles both {success,data} and raw array)
// ─────────────────────────────────────────────────────────────

async function psxGet<T = unknown>(path: string, client = psxClient): Promise<T> {
  const res = await client.get(path);
  await sleep(1500); // respect 100 req/min limit
  const body = res.data;
  // PSXTerminal wraps in {success, data} — handle both formats
  if (body && typeof body === "object" && "data" in body) {
    if (body.success === false) throw new Error(`API error: ${JSON.stringify(body.error ?? body.message)}`);
    return body.data as T;
  }
  // DPS PSX and fallback paths return raw data
  return body as T;
}

// ─────────────────────────────────────────────────────────────
//  CHANGE PERCENT NORMALISATION
//  PSXTerminal sometimes returns 0.0193 (fraction) or 1.93 (pct).
//  Heuristic: if abs value < 15, assume it's already a percentage.
//  If abs value < 0.15, assume fraction and multiply by 100.
// ─────────────────────────────────────────────────────────────

function normalizeChangePct(raw: number | null | undefined): number {
  if (raw == null || isNaN(raw)) return 0;
  // Fraction form: 0.0193 → absolute value always < 0.20 for realistic moves
  if (Math.abs(raw) < 0.20) return round2(raw * 100) ?? 0;
  // Already percentage form: 1.93
  return round2(raw) ?? 0;
}

// ─────────────────────────────────────────────────────────────
//  PSX LIVE TICK  (tries PSXTerminal first, falls back to DPS)
// ─────────────────────────────────────────────────────────────

async function fetchLiveTick(symbol: string): Promise<LiveTick | null> {
  // ── PSXTerminal attempt
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await psxGet<any>(`/api/ticks/REG/${symbol}`);
    // Field mapping — PSXTerminal has changed field names across versions
    const price = round2(d.price ?? d.ldcp ?? d.close ?? d.ltp ?? 0)!;
    if (!price) throw new Error("No price field in tick response");
    return {
      price,
      change:    round2(d.change ?? d.priceChange ?? 0)!,
      changePct: normalizeChangePct(d.changePercent ?? d.changePct ?? d.pctChange ?? 0),
      volume:    Number(d.volume ?? d.vol ?? 0),
      trades:    Number(d.trades ?? d.noOfTrades ?? 0),
      high:      round2(d.high  ?? price)!,
      low:       round2(d.low   ?? price)!,
      bid:       round2(d.bid   ?? d.bidPrice ?? 0)!,
      ask:       round2(d.ask   ?? d.askPrice ?? 0)!,
      value:     round2(d.value ?? d.totalValue ?? 0)!,
    };
  } catch (e1) {
    // ── DPS PSX fallback for live price
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await psxGet<any>(`/timeseries/int/${symbol}`, dpsClient);
      // DPS returns array of intraday data; use last entry
      const rows = Array.isArray(d) ? d : (d?.data ?? []);
      const last = rows.at(-1);
      if (!last) throw new Error("Empty DPS tick data");
      const price = round2(Number(last.c ?? last.close ?? last.price ?? 0))!;
      const prevClose = round2(Number(last.pc ?? last.prevClose ?? rows.at(-2)?.c ?? price))!;
      const change = round2(price - prevClose)!;
      return {
        price,
        change,
        changePct: prevClose > 0 ? round2((change / prevClose) * 100)! : 0,
        volume:    Number(last.v ?? last.volume ?? 0),
        trades:    Number(last.t ?? last.trades ?? 0),
        high:      round2(Number(last.h ?? last.high ?? price))!,
        low:       round2(Number(last.l ?? last.low  ?? price))!,
        bid:       0, ask: 0, value: 0,
      };
    } catch (e2) {
      console.warn(`    ⚠ Live tick ${symbol}: PSX(${(e1 as Error).message?.slice(0,40)}) DPS(${(e2 as Error).message?.slice(0,40)})`);
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  PSX KLINES  (daily OHLCV history)
//  Tries PSXTerminal /api/klines, falls back to DPS /timeseries/eod
// ─────────────────────────────────────────────────────────────

async function fetchPsxKlines(symbol: string): Promise<OhlcvBar[]> {
  // ── PSXTerminal attempt
  try {
    const startMs = Date.now() - 29 * 24 * 60 * 60 * 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await psxGet<any>(`/api/klines/${symbol}/1d?start=${startMs}&limit=200`);
    const rows  = Array.isArray(data) ? data : (data?.data ?? data?.klines ?? []);
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Empty kline response");

    const bars: OhlcvBar[] = rows.map((bar: Record<string, unknown>) => ({
      date:   bar.timestamp ? new Date(Number(bar.timestamp)).toISOString().slice(0, 10)
              : bar.date    ? String(bar.date)
              : "",
      open:   Number(bar.open  ?? bar.o ?? 0),
      high:   Number(bar.high  ?? bar.h ?? 0),
      low:    Number(bar.low   ?? bar.l ?? 0),
      close:  Number(bar.close ?? bar.c ?? 0),
      volume: Number(bar.volume ?? bar.v ?? 0),
    })).filter(b => b.close > 0 && b.high > 0 && b.low > 0 && b.date);

    if (bars.length < 20) throw new Error(`Only ${bars.length} bars from PSXTerminal klines`);
    return bars;
  } catch (e1) {
    // ── DPS PSX EOD fallback
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await psxGet<any>(`/timeseries/eod/${symbol}`, dpsClient);
      const rows  = Array.isArray(data) ? data : (data?.data ?? []);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Empty DPS EOD");

      const bars: OhlcvBar[] = rows.map((bar: Record<string, unknown>) => ({
        date:   String(bar.date ?? bar.dt ?? bar.time ?? ""),
        open:   Number(bar.open  ?? bar.o ?? bar.OPEN  ?? 0),
        high:   Number(bar.high  ?? bar.h ?? bar.HIGH  ?? 0),
        low:    Number(bar.low   ?? bar.l ?? bar.LOW   ?? 0),
        close:  Number(bar.close ?? bar.c ?? bar.CLOSE ?? 0),
        volume: Number(bar.volume ?? bar.v ?? bar.VOLUME ?? 0),
      })).filter(b => b.close > 0 && b.date);

      if (bars.length < 20) throw new Error(`Only ${bars.length} DPS bars`);
      return bars;
    } catch (e2) {
      throw new Error(`Klines failed — PSX:${(e1 as Error).message?.slice(0,50)} DPS:${(e2 as Error).message?.slice(0,50)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  FUNDAMENTALS
// ─────────────────────────────────────────────────────────────

async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await psxGet<any>(`/api/fundamentals/${symbol}`);
    const obj = d?.data ?? d ?? {};
    const pe  = obj.peRatio  ?? obj.pe  ?? obj.PE  ?? null;
    const bv  = obj.bookValue ?? obj.bv ?? null;
    const dy  = obj.dividendYield ?? obj.divYield ?? obj.div_yield ?? null;
    return {
      peRatio:       round2(pe    != null ? Number(pe)  : null),
      dividendYield: round2(dy    != null ? Number(dy)  : null),
      marketCap:     obj.marketCap ?? obj.market_cap ?? null,
      yearChange:    round2(obj.yearChange ?? obj.year_change ?? null),
      volume30Avg:   round2(obj.volume30Avg ?? obj.avg_volume_30 ?? null),
      eps:           round2(obj.eps ?? null),
      bookValue:     round2(bv    != null ? Number(bv)  : null),
      pbRatio:       pe != null && bv != null && Number(bv) > 0 ? round2(Number(pe) / Number(bv)) : null,
    };
  } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────
//  DIVIDENDS
// ─────────────────────────────────────────────────────────────

async function fetchDividends(symbol: string): Promise<DividendRecord[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await psxGet<any>(`/api/dividends/${symbol}`);
    const rows  = Array.isArray(data) ? data : (data?.data ?? []);
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 5).map(d => ({
      exDate: String(d.ex_date ?? d.exDate ?? d.date ?? ""),
      amount: Number(d.amount ?? d.dividend ?? 0),
      year:   Number(d.year   ?? d.Year    ?? 0),
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
//  YAHOO FINANCE fallback (when PORTFOLIO_TYPE=yahoo)
// ─────────────────────────────────────────────────────────────

async function fetchYahooKlines(symbol: string): Promise<OhlcvBar[]> {
  const yf      = new YahooFinance();
  const period2 = new Date();
  const period1 = new Date(); period1.setMonth(period1.getMonth() - 8);
  const res  = await yf.chart(symbol + ".KA", { period1, period2, interval: "1d" });
  const hist = (res.quotes || [])
    .filter((q: Record<string, unknown>) => q.close != null && q.open != null)
    .map((q: Record<string, unknown>) => ({
      date:   q.date ? new Date(q.date as string).toISOString().slice(0, 10) : "",
      open:   q.open as number, high: q.high as number,
      low:    q.low  as number, close: q.close as number,
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
  const price    = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today    = hist.at(-1)!;
  const todayBar: OhlcvBar = {
    ...today,
    close:  price,
    high:   Math.max(liveTick?.high ?? today.high, price),
    low:    Math.min(liveTick?.low  ?? today.low,  price),
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
    price, open: round2(todayBar.open)!, high: round2(todayBar.high)!,
    low: round2(todayBar.low)!, volume: todayBar.volume,
    change: liveTick?.change ?? null, changePct: liveTick?.changePct ?? null,
    bid: liveTick?.bid ?? null, ask: liveTick?.ask ?? null, trades: liveTick?.trades ?? null,
    ma5, ma10, ma20, ma50, ma200, ema9, ema21,
    rsi14, rsi9, macd, bb, stoch, willR, cci, roc, mfi,
    atr, adx, ichi, superTrend, trend, marketRegime,
    vol, obv, vwap, vwapDevPct, pivots, patterns, divergence, sparkline,
    ...perfStats, costBasis, marketValue, unrealizedPnl, unrealizedPct,
  };
}

// ─────────────────────────────────────────────────────────────
//  FETCH ONE TICKER
// ─────────────────────────────────────────────────────────────

async function fetchTicker(symbol: string, info: PositionInfo): Promise<StockData> {
  const isPsx = ENV.PORTFOLIO_TYPE === "psx";
  let hist:     OhlcvBar[];
  let liveTick: LiveTick | null = null;
  let src = "unknown";

  if (isPsx) {
    liveTick = await fetchLiveTick(symbol);
    try {
      hist = await fetchPsxKlines(symbol);
      src  = liveTick ? "PSXTerminal(live+hist)" : "PSXTerminal(hist)";
    } catch {
      // Final fallback: Yahoo Finance for history
      hist = await fetchYahooKlines(symbol);
      src  = liveTick ? "PSXTerminal(live)+Yahoo(hist)" : "Yahoo(hist)";
    }
  } else {
    hist = await fetchYahooKlines(symbol);
    src  = "Yahoo";
  }

  if (hist.length < 10) throw new Error(`Only ${hist.length} bars`);

  const computed = computeIndicators(hist, info, liveTick);
  let fundamentals: Fundamentals = {}, dividends: DividendRecord[] = [];
  if (isPsx) {
    [fundamentals, dividends] = await Promise.all([fetchFundamentals(symbol), fetchDividends(symbol)]);
  }

  return { ...computed, fundamentals, dividends, dataSource: src, historyBars: hist.length, historicalTrend: null };
}

// ─────────────────────────────────────────────────────────────
//  KSE-100 INDEX
// ─────────────────────────────────────────────────────────────

async function fetchKse100(): Promise<MarketContext["kse100"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet("/api/ticks/IDX/KSE100");
    return {
      level:     round2(d.price ?? d.ldcp ?? d.close ?? 0)!,
      change:    round2(d.change ?? d.priceChange ?? 0)!,
      changePct: normalizeChangePct(d.changePercent ?? d.changePct ?? 0),
      volume:    Number(d.volume ?? 0),
    };
  } catch {
    try {
      // DPS fallback for KSE-100
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await psxGet("/timeseries/int/KSE100", dpsClient);
      const rows   = Array.isArray(d) ? d : (d?.data ?? []);
      const last   = rows.at(-1);
      if (!last) return null;
      const price = round2(Number(last.c ?? last.close ?? 0))!;
      const prev  = round2(Number(rows.at(-2)?.c ?? price))!;
      return { level: price, change: round2(price - prev)!, changePct: prev > 0 ? round2(((price - prev) / prev) * 100)! : 0, volume: Number(last.v ?? 0) };
    } catch { return null; }
  }
}

// ─────────────────────────────────────────────────────────────
//  MARKET BREADTH
// ─────────────────────────────────────────────────────────────

async function fetchMarketBreadth(): Promise<MarketContext["breadth"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet("/api/stats/breadth");
    const obj    = d?.data ?? d ?? {};
    return {
      advances:   Number(obj.advances  ?? obj.advancers   ?? 0),
      declines:   Number(obj.declines  ?? obj.decliners   ?? 0),
      unchanged:  Number(obj.unchanged ?? obj.unchanged   ?? 0),
      adRatio:    round2(obj.advanceDeclineRatio ?? obj.adRatio ?? 0)!,
      upVolume:   Number(obj.upVolume   ?? 0),
      downVolume: Number(obj.downVolume ?? 0),
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  MARKET-WIDE TOP MOVERS
// ─────────────────────────────────────────────────────────────

async function fetchTopMovers(): Promise<{ gainers: KseTopMover[]; losers: KseTopMover[]; volume: KseTopMover[] }> {
  const empty = { gainers: [], losers: [], volume: [] };
  if (ENV.PORTFOLIO_TYPE !== "psx") return empty;
  try {
    // Try multiple possible endpoint names
    let rows: Record<string, unknown>[] = [];
    for (const path of ["/api/market-watch", "/api/stats/REG", "/api/symbols"]) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = await psxGet(path);
        const arr    = Array.isArray(d) ? d : (d?.data ?? d?.stocks ?? d?.symbols ?? []);
        if (Array.isArray(arr) && arr.length > 0) { rows = arr; break; }
      } catch { /* try next */ }
    }
    if (!rows.length) return empty;

    const parsed: KseTopMover[] = rows
      .filter(d => (d.symbol ?? d.code) && (d.close ?? d.ldcp ?? d.price ?? d.ltp))
      .map(d => ({
        symbol:    String(d.symbol ?? d.code ?? ""),
        name:      String(d.name ?? d.company ?? d.symbol ?? ""),
        price:     round2(Number(d.close ?? d.ldcp ?? d.price ?? d.ltp ?? 0))!,
        changePct: normalizeChangePct(Number(d.changePercent ?? d.changePct ?? d.change_pct ?? 0)),
        volume:    Number(d.volume ?? d.vol ?? 0),
        sector:    String(d.sector ?? d.sectorName ?? ""),
      }))
      .filter(m => m.price > 0 && m.symbol);

    return {
      gainers: [...parsed].sort((a, b) => b.changePct - a.changePct).slice(0, 5),
      losers:  [...parsed].sort((a, b) => a.changePct - b.changePct).slice(0, 5),
      volume:  [...parsed].sort((a, b) => b.volume    - a.volume).slice(0, 5),
    };
  } catch { return empty; }
}

// ─────────────────────────────────────────────────────────────
//  MARKET OVERVIEW
// ─────────────────────────────────────────────────────────────

export async function fetchMarketOverview(): Promise<MarketOverview | null> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const [kse100, breadth, movers] = await Promise.all([fetchKse100(), fetchMarketBreadth(), fetchTopMovers()]);
    const sectorSummary: Record<string, { avg: number; count: number }> = {};
    for (const m of [...movers.gainers, ...movers.losers]) {
      if (!m.sector) continue;
      if (!sectorSummary[m.sector]) sectorSummary[m.sector] = { avg: 0, count: 0 };
      sectorSummary[m.sector].avg   += m.changePct;
      sectorSummary[m.sector].count += 1;
    }
    for (const s of Object.keys(sectorSummary))
      sectorSummary[s].avg = round2(sectorSummary[s].avg / sectorSummary[s].count)!;
    return { kse100, breadth, topGainers: movers.gainers, topLosers: movers.losers, topVolume: movers.volume, sectorSummary };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  FETCH ALL PORTFOLIO STOCKS
// ─────────────────────────────────────────────────────────────

export async function fetchAllStocks(
  portfolioMap:     Record<string, PositionInfo>,
  historicalTrends: HistoricalTrend[] = [],
): Promise<StockDataMap> {
  const [kse100, breadth] = await Promise.all([fetchKse100(), fetchMarketBreadth()]);
  const stockData: StockDataMap = {};
  const trendMap  = Object.fromEntries(historicalTrends.map(t => [t.symbol, t]));

  for (const [symbol, info] of Object.entries(portfolioMap)) {
    try {
      const data  = await fetchTicker(symbol, info);
      const trend = trendMap[symbol] ?? null;
      (stockData as Record<string, StockResult>)[symbol] = { ...data, historicalTrend: trend };

      const chg = data.changePct != null
        ? (data.changePct >= 0 ? `+${data.changePct}%` : `${data.changePct}%`) : "n/a";
      const st  = data.superTrend ? `ST:${data.superTrend.signal}` : "      ";
      const ht  = trend?.priceChange7d != null
        ? `[7d:${trend.priceChange7d >= 0 ? "+" : ""}${trend.priceChange7d}%]` : "";
      console.log(`    ✓ ${symbol.padEnd(7)} PKR ${String(data.price).padStart(8)}  ${chg.padEnd(9)} RSI:${String(data.rsi14??"—").padEnd(5)} MFI:${String(data.mfi??"—").padEnd(5)} ${st.padEnd(9)} ${data.trend.padEnd(13)} src:${data.dataSource} ${ht}`);
    } catch (err) {
      (stockData as Record<string, StockResult>)[symbol] = {
        symbol: info.symbol, name: info.name, sector: info.sector,
        shares: info.shares, avgCost: info.avgCost,
        error: (err as Error).message, price: null,
      };
      console.log(`    ✗ ${symbol.padEnd(7)} ${(err as Error).message}`);
    }
  }
  stockData.__market__ = { kse100, breadth };
  return stockData;
}