import axios, { AxiosInstance } from "axios";
import YahooFinance from "yahoo-finance2";
import { ENV } from "./config";
import { PositionInfo } from "./portfolio";
import {
  OhlcvBar,
  round2,
  calcPct,
  sma,
  calcEMA,
  calcSMA,
  calcRSI,
  calcMACD,
  calcBollinger,
  calcStochastic,
  calcATR,
  calcADX,
  calcWilliamsR,
  calcCCI,
  calcOBV,
  calcVWAP,
  calcIchimoku,
  calcPivots,
  calcROC,
  calcMFI,
  calcSuperTrend,
  detectDivergence,
  detectPatterns,
  calcVolumeMetrics,
  calcPerfStats,
  classifyTrend,
  buildSparkline,
  MacdResult,
  AdxResult,
  BollingerResult,
  StochasticResult,
  IchimokuResult,
  PivotResult,
  SuperTrendResult,
  ObvResult,
  VolumeMetrics,
  CandlePattern,
  PerfStats,
  TrendLabel,
} from "./indicators";

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────

export interface Fundamentals {
  peRatio?: number | null;
  dividendYield?: number | null;
  marketCap?: string;
  yearChange?: number | null;
  volume30Avg?: number | null;
}

export interface DividendRecord {
  exDate: string;
  amount: number;
  year: number;
}

export interface LiveTick {
  price: number;
  change: number;
  changePct: number;
  volume: number;
  trades: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  value: number;
}

export interface StockData extends PerfStats {
  // Identity
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
  // OHLCV (live-merged)
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  // Live tick extras
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  trades: number | null;
  // Moving averages
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  ema9: number | null;
  ema21: number | null;
  // Oscillators
  rsi14: number | null;
  rsi9: number | null;
  macd: MacdResult;
  bb: BollingerResult | null;
  stoch: StochasticResult;
  willR: number | null;
  cci: number | null;
  roc: number | null;
  mfi: number | null;
  // Trend & strength
  atr: number | null;
  adx: AdxResult;
  ichi: IchimokuResult | null;
  superTrend: SuperTrendResult | null;
  trend: TrendLabel;
  // Flow
  vol: VolumeMetrics;
  obv: ObvResult;
  vwap: number | null;
  // Levels & patterns
  pivots: PivotResult | null;
  patterns: CandlePattern[];
  divergence: "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | null;
  // Visual
  sparkline: string;
  // P&L
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number | null;
  // Enrichment
  fundamentals: Fundamentals;
  dividends: DividendRecord[];
  dataSource: string;
  historyBars: number;
  error?: never;
}

export interface StockError {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
  error: string;
  price: null;
}

export type StockResult = StockData | StockError;

export interface MarketContext {
  kse100: {
    level: number;
    change: number;
    changePct: number;
    volume: number;
  } | null;
  breadth: {
    advances: number;
    declines: number;
    unchanged: number;
    adRatio: number;
    upVolume: number;
    downVolume: number;
  } | null;
}

export interface StockDataMap {
  [symbol: string]: StockResult;
  __market__?: any;
}

// ─────────────────────────────────────────────────────────────
//  RATE LIMITER
// ─────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
//  PSXTerminal  AXIOS CLIENT
// ─────────────────────────────────────────────────────────────

const psxClient: AxiosInstance = axios.create({
  baseURL: ENV.PSX_BASE_URL,
  timeout: 15_000,
  headers: {
    "User-Agent": "PSX-Agent/6.0",
    Accept: "application/json",
    Referer: "https://psxterminal.com/",
    Origin: "https://psxterminal.com",
  },
});

async function psxGet<T = unknown>(path: string): Promise<T> {
  const { data } = await psxClient.get<{
    success: boolean;
    data: T;
    error?: unknown;
  }>(path);
  await sleep(2000); // PSXTerminal: 100 req/min — stay well under
  if (!data.success)
    throw new Error(`PSX ${path}: ${JSON.stringify(data.error)}`);
  return data.data;
}

// ─────────────────────────────────────────────────────────────
//  PSX DATA FETCHERS
// ─────────────────────────────────────────────────────────────

interface PsxTick {
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  trades: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  value: number;
}

async function fetchLiveTick(symbol: string): Promise<LiveTick> {
  const d = await psxGet<PsxTick>(`/api/ticks/REG/${symbol}`);
  // changePercent is raw decimal (0.01928 = 1.928%) or whole number — normalise
  const rawPct = d.changePercent ?? 0;
  const changePct =
    Math.abs(rawPct) < 2 ? round2(rawPct * 100)! : round2(rawPct)!;
  return {
    price: round2(d.price)!,
    change: round2(d.change)!,
    changePct,
    volume: d.volume,
    trades: d.trades,
    high: round2(d.high)!,
    low: round2(d.low)!,
    bid: round2(d.bid)!,
    ask: round2(d.ask)!,
    value: round2(d.value)!,
  };
}

interface PsxKlineBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchPsxKlines(symbol: string): Promise<OhlcvBar[]> {
  const startMs = Date.now() - 1 * 29 * 24 * 60 * 60 * 1000;
  const data = await psxGet<PsxKlineBar[]>(
    `/api/klines/${symbol}/1d?start=${startMs}&limit=100`
  );
  if (!Array.isArray(data) || data.length === 0)
    throw new Error("No PSX kline data");
  return data
    .map((b) => ({
      date: new Date(b.timestamp).toISOString().slice(0, 10),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume || 0,
    }))
    .filter((b) => b.close && b.high && b.low && b.open);
}

interface PsxFundamentals {
  peRatio: number;
  dividendYield: number;
  marketCap: string;
  yearChange: number;
  volume30Avg: number;
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  try {
    const d = await psxGet<PsxFundamentals>(`/api/fundamentals/${symbol}`);
    return {
      peRatio: round2(d.peRatio),
      dividendYield: round2(d.dividendYield),
      marketCap: d.marketCap,
      yearChange: round2(d.yearChange),
      volume30Avg: round2(d.volume30Avg),
    };
  } catch {
    return {};
  }
}

interface PsxDividend {
  ex_date: string;
  amount: number;
  year: number;
}

async function fetchDividends(symbol: string): Promise<DividendRecord[]> {
  try {
    const data = await psxGet<PsxDividend[]>(`/api/dividends/${symbol}`);
    if (!Array.isArray(data)) return [];
    return data
      .slice(0, 3)
      .map((d) => ({ exDate: d.ex_date, amount: d.amount, year: d.year }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  YAHOO FINANCE KLINES  (when PORTFOLIO_TYPE = "yahoo")
// ─────────────────────────────────────────────────────────────

const yf = new (YahooFinance as unknown as new () => {
  chart: (...args: unknown[]) => Promise<{ quotes?: unknown[] }>;
})();

async function fetchYahooKlines(symbol: string): Promise<OhlcvBar[]> {
  const ticker = `${symbol}.KA`;
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
          open: number | null;
          high: number | null;
          low: number | null;
          close: number | null;
          volume: number | null;
          date?: Date;
        }>;
      }>;
    }
  ).chart(ticker, { period1, period2, interval: "1d" });
  const hist = (res.quotes ?? [])
    .filter(
      (
        q
      ): q is {
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        date?: Date;
      } => q.close != null && q.open != null && q.high != null && q.low != null
    )
    .map((q) => ({
      date: q.date ? new Date(q.date).toISOString().slice(0, 10) : "",
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    }));
  if (hist.length < 30) throw new Error(`Yahoo: only ${hist.length} bars`);
  return hist;
}

// ─────────────────────────────────────────────────────────────
//  COMPUTE ALL INDICATORS
// ─────────────────────────────────────────────────────────────

function computeIndicators(
  hist: OhlcvBar[],
  info: PositionInfo,
  liveTick: LiveTick | null
): Omit<
  StockData,
  "fundamentals" | "dividends" | "dataSource" | "historyBars"
> {
  const price = liveTick?.price ?? round2(hist.at(-1)!.close)!;
  const today = hist.at(-1)!;
  const todayBar: OhlcvBar = {
    ...today,
    close: price,
    high: liveTick?.high ?? today.high,
    low: liveTick?.low ?? today.low,
    volume: liveTick?.volume ?? today.volume,
  };
  const histLive = [...hist.slice(0, -1), todayBar];
  const closeLive = histLive.map((b) => b.close);

  const ma5 = calcSMA(closeLive, 5);
  const ma10 = calcSMA(closeLive, 10);
  const ma20 = calcSMA(closeLive, 20);
  const ma50 = closeLive.length >= 50 ? calcSMA(closeLive, 50) : null;
  const ma200 = closeLive.length >= 200 ? calcSMA(closeLive, 200) : null;
  const ema9 = round2(
    calcEMA(closeLive, 9).at(-1) as number | null | undefined
  );
  const ema21 = round2(
    calcEMA(closeLive, 21).at(-1) as number | null | undefined
  );

  const rsi14 = calcRSI(closeLive, 14);
  const rsi9 = calcRSI(closeLive, 9);
  const macd = calcMACD(closeLive);
  const bb = calcBollinger(closeLive);
  const stoch = calcStochastic(histLive);
  const willR = calcWilliamsR(histLive);
  const cci = calcCCI(histLive);
  const roc = calcROC(closeLive, 12);
  const mfi = calcMFI(histLive, 14);
  const superTrend = calcSuperTrend(histLive, 10, 3);

  const atr = calcATR(histLive);
  const adx = calcADX(histLive);
  const ichi = calcIchimoku(histLive);

  const vol = calcVolumeMetrics(histLive);
  const obv = calcOBV(histLive);
  const vwap = calcVWAP(histLive);
  const pivots = calcPivots(histLive);
  const patterns = detectPatterns(histLive);

  // RSI divergence series (expensive — compute once)
  const rsiSeries = closeLive
    .map((_, i) => (i >= 14 ? calcRSI(closeLive.slice(0, i + 1), 14) : null))
    .filter((v): v is number => v != null);
  const divergence = detectDivergence(closeLive, rsiSeries);

  const perfStats = calcPerfStats(histLive, closeLive);
  const sparkline = buildSparkline(closeLive, 20);
  const trend = classifyTrend(price, ma5, ma20, ma50, macd, adx);

  const costBasis = round2(info.shares * info.avgCost)!;
  const marketValue = round2(info.shares * price)!;
  const unrealizedPnl = round2(marketValue - costBasis)!;
  const unrealizedPct = calcPct(price, info.avgCost);

  return {
    symbol: info.symbol,
    name: info.name,
    sector: info.sector,
    shares: info.shares,
    avgCost: info.avgCost,
    price,
    open: round2(todayBar.open)!,
    high: round2(todayBar.high)!,
    low: round2(todayBar.low)!,
    volume: todayBar.volume,
    change: liveTick?.change ?? null,
    changePct: liveTick?.changePct ?? null,
    bid: liveTick?.bid ?? null,
    ask: liveTick?.ask ?? null,
    trades: liveTick?.trades ?? null,
    ma5,
    ma10,
    ma20,
    ma50,
    ma200,
    ema9,
    ema21,
    rsi14,
    rsi9,
    macd,
    bb,
    stoch,
    willR,
    cci,
    roc,
    mfi,
    atr,
    adx,
    ichi,
    superTrend,
    trend,
    vol,
    obv,
    vwap,
    pivots,
    patterns,
    divergence,
    sparkline,
    ...perfStats,
    costBasis,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
  };
}

// ─────────────────────────────────────────────────────────────
//  FETCH ONE TICKER
// ─────────────────────────────────────────────────────────────

async function fetchTicker(
  symbol: string,
  info: PositionInfo
): Promise<StockData> {
  const isPsx = ENV.PORTFOLIO_TYPE === "psx";
  let hist: OhlcvBar[];
  let liveTick: LiveTick | null = null;
  let dataSource: string;

  if (isPsx) {
    try {
      liveTick = await fetchLiveTick(symbol);
    } catch (err) {
      process.stdout.write(
        `    ⚠ Live tick (${symbol}): ${(err as Error).message}\n`
      );
    }
    hist = await fetchPsxKlines(symbol);
    dataSource = liveTick ? "PSX live+history" : "PSX history";
  } else {
    hist = await fetchYahooKlines(symbol);
    dataSource = "Yahoo Finance";
  }

  if (hist.length < 10) throw new Error(`Only ${hist.length} bars`);

  const computed = computeIndicators(hist, info, liveTick);

  let fundamentals: Fundamentals = {};
  let dividends: DividendRecord[] = [];
  if (isPsx) {
    const [fRes, dRes] = await Promise.allSettled([
      fetchFundamentals(symbol),
      fetchDividends(symbol),
    ]);
    fundamentals = fRes.status === "fulfilled" ? fRes.value : {};
    dividends = dRes.status === "fulfilled" ? dRes.value : [];
  }

  return {
    ...computed,
    fundamentals,
    dividends,
    dataSource,
    historyBars: hist.length,
  };
}

// ─────────────────────────────────────────────────────────────
//  KSE-100  &  MARKET BREADTH
// ─────────────────────────────────────────────────────────────

async function fetchKse100(): Promise<MarketContext["kse100"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const d = await psxGet<PsxTick>("/api/ticks/IDX/KSE100");
    const rawPct = d.changePercent ?? 0;
    const changePct =
      Math.abs(rawPct) < 2 ? round2(rawPct * 100)! : round2(rawPct)!;
    return {
      level: round2(d.price)!,
      change: round2(d.change)!,
      changePct,
      volume: d.volume,
    };
  } catch {
    return null;
  }
}

async function fetchMarketBreadth(): Promise<MarketContext["breadth"]> {
  if (ENV.PORTFOLIO_TYPE !== "psx") return null;
  try {
    const d = await psxGet<{
      advances: number;
      declines: number;
      unchanged: number;
      advanceDeclineRatio: number;
      upVolume: number;
      downVolume: number;
    }>("/api/stats/breadth");
    return {
      advances: d.advances,
      declines: d.declines,
      unchanged: d.unchanged,
      adRatio: round2(d.advanceDeclineRatio)!,
      upVolume: d.upVolume,
      downVolume: d.downVolume,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  FETCH ALL STOCKS  (sequential — respects PSX rate limit)
// ─────────────────────────────────────────────────────────────

export async function fetchAllStocks(
  portfolioMap: Record<string, PositionInfo>
): Promise<StockDataMap> {
  // Fetch market context concurrently with first stock
  const [kse100Res, breadthRes] = await Promise.allSettled([
    fetchKse100(),
    fetchMarketBreadth(),
  ]);

  const stockData: StockDataMap = {};

  for (const [symbol, info] of Object.entries(portfolioMap)) {
    try {
      const data = await fetchTicker(symbol, info);
      stockData[symbol] = data;
      const chgStr =
        data.changePct != null
          ? ` (${data.changePct >= 0 ? "+" : ""}${data.changePct}%)`
          : "";
      const stStr = data.superTrend
        ? ` ST:${data.superTrend.signal}@${data.superTrend.value}`
        : "";
      process.stdout.write(
        `    ✓ ${symbol.padEnd(8)} PKR ${String(data.price).padStart(
          8
        )}${chgStr}` +
          `  RSI:${data.rsi14}  MFI:${data.mfi}  ROC:${data.roc}${stStr}  ${data.trend}\n`
      );
    } catch (err) {
      stockData[symbol] = {
        error: (err as Error).message,
        ...info,
        price: null,
      } as unknown as StockError;
      process.stdout.write(
        `    ✗ ${symbol.padEnd(8)} ${(err as Error).message}\n`
      );
    }
  }

  stockData.__market__ = {
    kse100: kse100Res.status === "fulfilled" ? kse100Res.value : null,
    breadth: breadthRes.status === "fulfilled" ? breadthRes.value : null,
  };

  return stockData;
}
