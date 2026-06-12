import axios, { AxiosInstance } from "axios";
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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── PSXTerminal client ───────────────────────────────────────
const psxClient: AxiosInstance = axios.create({
  baseURL: ENV.PSX_BASE_URL,
  timeout: 15_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://psxterminal.com/",
    "Origin": "https://psxterminal.com",
  },
});

// ─── DPS PSX client (official PSX portal) ────────────────────
const dpsClient: AxiosInstance = axios.create({
  baseURL: "https://dps.psx.com.pk",
  timeout: 15_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://dps.psx.com.pk/",
    "X-Requested-With": "XMLHttpRequest",
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function psxGet<T = any>(path: string, client = psxClient): Promise<T> {
  const res  = await client.get(path);
  await sleep(1200);
  const body = res.data;
  if (body && typeof body === "object" && "data" in body) {
    if (body.success === false) throw new Error(`API ${path}: ${JSON.stringify(body.error ?? body.message)}`);
    return body.data as T;
  }
  return body as T;
}

// ─── changePct fix: PSXTerminal returns decimal (0.0193 = 1.93%) ─
function normPct(raw: number | null | undefined): number {
  if (raw == null || isNaN(raw)) return 0;
  if (Math.abs(raw) < 0.20) return round2(raw * 100) ?? 0;
  return round2(raw) ?? 0;
}

// ─── PSX Live Tick ────────────────────────────────────────────
async function fetchLiveTick(symbol: string): Promise<LiveTick | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet(`/api/ticks/REG/${symbol}`);
    const price  = round2(d.price ?? d.ldcp ?? d.close ?? d.ltp ?? 0)!;
    if (!price) throw new Error("price=0 in tick");
    return {
      price,
      change:    round2(d.change ?? d.priceChange ?? 0)!,
      changePct: normPct(d.changePercent ?? d.changePct ?? d.pctChange ?? 0),
      volume:    Number(d.volume ?? d.vol ?? 0),
      trades:    Number(d.trades ?? d.noOfTrades ?? 0),
      high:      round2(d.high  ?? price)!,
      low:       round2(d.low   ?? price)!,
      bid:       round2(d.bid   ?? d.bidPrice ?? 0)!,
      ask:       round2(d.ask   ?? d.askPrice ?? 0)!,
      value:     round2(d.value ?? d.totalValue ?? 0)!,
    };
  } catch (e1) {
    try {
      // DPS PSX fallback for live price
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await psxGet(`/timeseries/int/${symbol}`, dpsClient);
      const rows   = Array.isArray(d) ? d : (d?.data ?? []);
      const last   = rows.at(-1);
      if (!last) throw new Error("empty DPS tick");
      const price    = round2(Number(last.c ?? last.close ?? last.price ?? 0))!;
      const prevClose = round2(Number(rows.at(-2)?.c ?? price))!;
      const change    = round2(price - prevClose)!;
      return {
        price, change,
        changePct: prevClose > 0 ? round2((change / prevClose) * 100)! : 0,
        volume: Number(last.v ?? last.volume ?? 0),
        trades: Number(last.t ?? last.trades ?? 0),
        high: round2(Number(last.h ?? last.high ?? price))!,
        low:  round2(Number(last.l ?? last.low  ?? price))!,
        bid: 0, ask: 0, value: 0,
      };
    } catch {
      console.warn(`    ⚠ Live tick ${symbol}: ${(e1 as Error).message?.slice(0, 60)}`);
      return null;
    }
  }
}

// ─── PSX Klines (daily OHLCV) ─────────────────────────────────
// IMPORTANT: PSXTerminal klines are failing for you — DPS PSX is now the primary
async function fetchPsxKlines(symbol: string): Promise<OhlcvBar[]> {
  // ── Try DPS PSX first (more reliable EOD data)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet(`/timeseries/eod/${symbol}`, dpsClient);
    const rows   = Array.isArray(d) ? d : (d?.data ?? d?.ohlcv ?? []);
    if (!Array.isArray(rows) || rows.length < 10) throw new Error(`DPS: only ${rows.length} bars`);
    const bars: OhlcvBar[] = rows.map((bar: Record<string, unknown>) => ({
      date:   String(bar.date ?? bar.dt ?? bar.time ?? bar.Date ?? ""),
      open:   Number(bar.open   ?? bar.o ?? bar.Open   ?? 0),
      high:   Number(bar.high   ?? bar.h ?? bar.High   ?? 0),
      low:    Number(bar.low    ?? bar.l ?? bar.Low    ?? 0),
      close:  Number(bar.close  ?? bar.c ?? bar.Close  ?? 0),
      volume: Number(bar.volume ?? bar.v ?? bar.Volume ?? 0),
    })).filter(b => b.close > 0 && b.date);
    if (bars.length < 10) throw new Error(`DPS filtered: ${bars.length} bars`);
    // Keep last 200 bars
    return bars.slice(-200);
  } catch (eDps) {
    // ── PSXTerminal fallback
    try {
      const startMs = Date.now() - 29 * 24 * 60 * 60 * 1000;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any   = await psxGet(`/api/klines/${symbol}/1d?start=${startMs}&limit=200`);
      const rows     = Array.isArray(d) ? d : (d?.data ?? d?.klines ?? []);
      if (!Array.isArray(rows) || rows.length < 20) throw new Error(`PSX: ${rows.length} bars`);
      const bars: OhlcvBar[] = rows.map((bar: Record<string, unknown>) => ({
        date:   bar.timestamp ? new Date(Number(bar.timestamp)).toISOString().slice(0, 10) : String(bar.date ?? ""),
        open:   Number(bar.open  ?? bar.o ?? 0),
        high:   Number(bar.high  ?? bar.h ?? 0),
        low:    Number(bar.low   ?? bar.l ?? 0),
        close:  Number(bar.close ?? bar.c ?? 0),
        volume: Number(bar.volume ?? bar.v ?? 0),
      })).filter(b => b.close > 0 && b.date);
      if (bars.length < 10) throw new Error(`PSX filtered: ${bars.length} bars`);
      return bars.slice(-200);
    } catch (ePsx) {
      throw new Error(`Klines fail — DPS:${(eDps as Error).message?.slice(0,40)} PSX:${(ePsx as Error).message?.slice(0,40)}`);
    }
  }
}

// ─── Fundamentals ─────────────────────────────────────────────
async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet(`/api/fundamentals/${symbol}`);
    const obj    = d?.data ?? d ?? {};
    const pe     = obj.peRatio   ?? obj.pe  ?? obj.PE  ?? null;
    const bv     = obj.bookValue ?? obj.bv  ?? null;
    const dy     = obj.dividendYield ?? obj.divYield ?? obj.div_yield ?? null;
    return {
      peRatio:       pe  != null ? round2(Number(pe))  : null,
      dividendYield: dy  != null ? round2(Number(dy))  : null,
      marketCap:     obj.marketCap ?? obj.market_cap   ?? null,
      yearChange:    obj.yearChange != null ? round2(Number(obj.yearChange)) : null,
      volume30Avg:   obj.volume30Avg != null ? round2(Number(obj.volume30Avg)) : null,
      eps:           obj.eps != null ? round2(Number(obj.eps)) : null,
      bookValue:     bv  != null ? round2(Number(bv))  : null,
      pbRatio:       pe != null && bv != null && Number(bv) > 0 ? round2(Number(pe) / Number(bv)) : null,
    };
  } catch { return {}; }
}

// ─── Dividends ────────────────────────────────────────────────
async function fetchDividends(symbol: string): Promise<DividendRecord[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet(`/api/dividends/${symbol}`);
    const rows   = Array.isArray(d) ? d : (d?.data ?? []);
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 5).map(r => ({
      exDate: String(r.ex_date ?? r.exDate ?? r.date ?? ""),
      amount: Number(r.amount ?? r.dividend ?? 0),
      year:   Number(r.year   ?? r.Year    ?? 0),
    }));
  } catch { return []; }
}

// ─── Compute All Indicators ───────────────────────────────────
function computeIndicators(
  hist: OhlcvBar[], info: PositionInfo, liveTick: LiveTick | null,
): Omit<StockData, "fundamentals" | "dividends" | "dataSource" | "historyBars" | "historicalTrend"> {
  const price    = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today    = hist.at(-1)!;
  const todayBar: OhlcvBar = {
    ...today,
    close:  price,
    high:   Math.max(liveTick?.high ?? today.high,  price),
    low:    Math.min(liveTick?.low  ?? today.low,   price),
    volume: liveTick?.volume ?? today.volume,
  };
  const histLive  = [...hist.slice(0, -1), todayBar];
  const closeLive = histLive.map(b => b.close);

  const ma5  = calcSMA(closeLive, 5),  ma10 = calcSMA(closeLive, 10);
  const ma20 = calcSMA(closeLive, 20), ma50 = closeLive.length >= 50  ? calcSMA(closeLive, 50)  : null;
  const ma200 = closeLive.length >= 200 ? calcSMA(closeLive, 200) : null;
  const ema9  = round2(calcEMA(closeLive, 9).at(-1)  as number);
  const ema21 = round2(calcEMA(closeLive, 21).at(-1) as number);

  const rsi14 = calcRSI(closeLive, 14), rsi9 = calcRSI(closeLive, 9);
  const macd  = calcMACD(closeLive), bb = calcBollinger(closeLive);
  const stoch = calcStochastic(histLive), willR = calcWilliamsR(histLive);
  const cci   = calcCCI(histLive), roc = calcROC(closeLive, 12), mfi = calcMFI(histLive, 14);
  const atr   = calcATR(histLive), adx = calcADX(histLive);
  const ichi  = calcIchimoku(histLive), superTrend = calcSuperTrend(histLive);
  const vol   = calcVolumeMetrics(histLive), obv = calcOBV(histLive);
  const vwap  = calcVWAP(histLive), vwapDevPct = calcVwapDevPct(price, vwap);
  const pivots = calcPivots(histLive), patterns = detectPatterns(histLive);
  const rsiSeries = closeLive.map((_, i) => i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null).filter((v): v is number => v != null);
  const divergence = detectDivergence(closeLive, rsiSeries);
  const sparkline = buildSparkline(closeLive, 20);
  const trend = classifyTrend(price, ma5, ma20, ma50, macd, adx);
  const marketRegime = classifyMarketRegime(adx, bb, macd);
  const perfStats = calcPerfStats(histLive, closeLive);
  const costBasis = round2(info.shares * info.avgCost)!;
  const marketValue = round2(info.shares * price)!;
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
    ...perfStats, costBasis, marketValue, unrealizedPnl, unrealizedPct,
  };
}

// ─── Fetch One Ticker ─────────────────────────────────────────
async function fetchTicker(symbol: string, info: PositionInfo): Promise<StockData> {
  let hist:     OhlcvBar[];
  let liveTick: LiveTick | null = null;
  let src = "unknown";

  // Live tick from PSXTerminal (best real-time price)
  liveTick = await fetchLiveTick(symbol);

  // Historical OHLCV: DPS PSX primary, PSXTerminal fallback
  hist = await fetchPsxKlines(symbol);
  src  = liveTick ? "PSXTerminal(live)+DPS(hist)" : "DPS(hist)";

  // If live tick has good price, patch the last bar so indicators use real-time close
  if (liveTick && liveTick.price > 0 && hist.length > 0) {
    const last = hist.at(-1)!;
    hist[hist.length - 1] = {
      ...last,
      close:  liveTick.price,
      high:   Math.max(last.high, liveTick.high ?? liveTick.price),
      low:    Math.min(last.low,  liveTick.low  ?? liveTick.price),
      volume: liveTick.volume > 0 ? liveTick.volume : last.volume,
    };
  }

  if (hist.length < 10) throw new Error(`Only ${hist.length} bars`);
  const computed = computeIndicators(hist, info, liveTick);
  const [fundamentals, dividends] = await Promise.all([fetchFundamentals(symbol), fetchDividends(symbol)]);
  return { ...computed, fundamentals, dividends, dataSource: src, historyBars: hist.length, historicalTrend: null };
}

// ─── KSE-100 ──────────────────────────────────────────────────
async function fetchKse100(): Promise<MarketContext["kse100"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet("/api/ticks/IDX/KSE100");
    const price  = round2(d.price ?? d.ldcp ?? d.close ?? 0)!;
    return { level: price, change: round2(d.change ?? 0)!, changePct: normPct(d.changePercent ?? d.changePct ?? 0), volume: Number(d.volume ?? 0) };
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await psxGet("/timeseries/int/KSE100", dpsClient);
      const rows   = Array.isArray(d) ? d : (d?.data ?? []);
      const last   = rows.at(-1);
      if (!last) return null;
      const price  = round2(Number(last.c ?? last.close ?? 0))!;
      const prev   = round2(Number(rows.at(-2)?.c ?? price))!;
      return { level: price, change: round2(price - prev)!, changePct: prev > 0 ? round2(((price - prev) / prev) * 100)! : 0, volume: Number(last.v ?? 0) };
    } catch { return null; }
  }
}

// ─── Market Breadth ───────────────────────────────────────────
async function fetchMarketBreadth(): Promise<MarketContext["breadth"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await psxGet("/api/stats/breadth");
    const obj    = d?.data ?? d ?? {};
    return {
      advances:   Number(obj.advances  ?? obj.advancers  ?? 0),
      declines:   Number(obj.declines  ?? obj.decliners  ?? 0),
      unchanged:  Number(obj.unchanged ?? 0),
      adRatio:    round2(obj.advanceDeclineRatio ?? obj.adRatio ?? 0)!,
      upVolume:   Number(obj.upVolume   ?? 0),
      downVolume: Number(obj.downVolume ?? 0),
    };
  } catch { return null; }
}

// ─── Top Movers ───────────────────────────────────────────────
async function fetchTopMovers(): Promise<{ gainers: KseTopMover[]; losers: KseTopMover[]; volume: KseTopMover[] }> {
  const empty = { gainers: [], losers: [], volume: [] };
  if (ENV.PORTFOLIO_TYPE !== "psx") return empty;
  try {
    let rows: Record<string, unknown>[] = [];
    for (const path of ["/api/market-watch", "/api/stats/REG", "/api/symbols"]) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = await psxGet(path);
        const arr    = Array.isArray(d) ? d : (d?.data ?? d?.stocks ?? d?.symbols ?? []);
        if (Array.isArray(arr) && arr.length > 10) { rows = arr; break; }
      } catch { /* try next */ }
    }
    if (!rows.length) return empty;
    const parsed: KseTopMover[] = rows
      .filter(d => (d.symbol ?? d.code) && Number(d.close ?? d.ldcp ?? d.price ?? d.ltp ?? 0) > 0)
      .map(d => ({
        symbol:    String(d.symbol ?? d.code ?? ""),
        name:      String(d.name   ?? d.company ?? d.symbol ?? ""),
        price:     round2(Number(d.close ?? d.ldcp ?? d.price ?? d.ltp ?? 0))!,
        changePct: normPct(Number(d.changePercent ?? d.changePct ?? d.change_pct ?? 0)),
        volume:    Number(d.volume ?? d.vol ?? 0),
        sector:    String(d.sector ?? d.sectorName ?? ""),
      })).filter(m => m.price > 0 && m.symbol);
    return {
      gainers: [...parsed].sort((a, b) => b.changePct - a.changePct).slice(0, 5),
      losers:  [...parsed].sort((a, b) => a.changePct - b.changePct).slice(0, 5),
      volume:  [...parsed].sort((a, b) => b.volume    - a.volume).slice(0, 5),
    };
  } catch { return empty; }
}

// ─── Market Overview ──────────────────────────────────────────
export async function fetchMarketOverview(): Promise<MarketOverview | null> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const [kse100, breadth, movers] = await Promise.all([fetchKse100(), fetchMarketBreadth(), fetchTopMovers()]);
    const sectorSummary: Record<string, { avg: number; count: number }> = {};
    for (const m of [...movers.gainers, ...movers.losers]) {
      if (!m.sector) continue;
      if (!sectorSummary[m.sector]) sectorSummary[m.sector] = { avg: 0, count: 0 };
      sectorSummary[m.sector].avg += m.changePct;
      sectorSummary[m.sector].count += 1;
    }
    for (const s of Object.keys(sectorSummary))
      sectorSummary[s].avg = round2(sectorSummary[s].avg / sectorSummary[s].count)!;
    return { kse100, breadth, topGainers: movers.gainers, topLosers: movers.losers, topVolume: movers.volume, sectorSummary };
  } catch { return null; }
}

// ─── Fetch All Portfolio Stocks ───────────────────────────────
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

      const chg = data.changePct != null ? (data.changePct >= 0 ? `+${data.changePct}%` : `${data.changePct}%`) : "n/a";
      const st  = data.superTrend ? `ST:${data.superTrend.signal}` : "      ";
      const ht  = trend?.priceChange7d != null ? `[7d:${trend.priceChange7d >= 0 ? "+" : ""}${trend.priceChange7d}%]` : "";
      console.log(`    ✓ ${symbol.padEnd(7)} PKR ${String(data.price).padStart(8)}  ${chg.padEnd(9)} RSI:${String(data.rsi14 ?? "—").padEnd(5)} MFI:${String(data.mfi ?? "—").padEnd(5)} ${st.padEnd(9)} ${data.trend.padEnd(13)} ${data.dataSource} ${ht}`);
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