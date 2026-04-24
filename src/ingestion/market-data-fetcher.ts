import { logger } from '../utils/logger';
import type { OHLCVCandle, TickerMarketData, MacroSnapshot, FundamentalData } from '../types';

// ─── Mock Candle Generator ────────────────────────────────────────────────────
// Replace with live PSX data feed (psx.com.pk API, TREC feed, or
// a third-party such as Investing.com / Macrotrends with Pakistan equities).

function generateMockCandles(ticker: string, days = 220): OHLCVCandle[] {
  const seed   = ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  let price    = 100 + (seed % 600);
  const result: OHLCVCandle[] = [];

  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends

    const drift  = (Math.random() - 0.485) * 0.02;
    price        = Math.max(5, price * (1 + drift));
    const open   = price * (1 + (Math.random() - 0.5) * 0.008);
    const high   = Math.max(open, price) * (1 + Math.random() * 0.008);
    const low    = Math.min(open, price) * (1 - Math.random() * 0.008);
    const volume = Math.floor(80_000 + Math.random() * 1_200_000);

    result.push({
      date:   d.toISOString().split('T')[0],
      open:   parseFloat(open.toFixed(2)),
      high:   parseFloat(high.toFixed(2)),
      low:    parseFloat(low.toFixed(2)),
      close:  parseFloat(price.toFixed(2)),
      volume,
    });
  }
  return result;
}

function randomFutureDate(maxDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(1 + Math.random() * maxDays));
  return d.toISOString().split('T')[0];
}

// ─── Market Data ──────────────────────────────────────────────────────────────

export async function fetchTickerData(ticker: string): Promise<TickerMarketData> {
  logger.debug({ ticker }, 'fetchTickerData');

  // TODO: replace mock with live endpoint, e.g.:
  // const { data } = await httpClient.get(
  //   `https://dps.psx.com.pk/timeseries/adjustedprice/${ticker}?from=2yrs`
  // );

  const candles      = generateMockCandles(ticker);
  const closes       = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  return {
    ticker,
    candles,
    currentPrice,
    high52w:               Math.max(...closes.slice(-252)),
    low52w:                Math.min(...closes.slice(-252)),
    marketCap:             currentPrice * (30_000_000 + Math.random() * 500_000_000),
    freeFloatPct:          25 + Math.random() * 50,
    upcomingDividendDate:  Math.random() > 0.55 ? randomFutureDate(90)  : undefined,
    upcomingEarningsDate:  Math.random() > 0.50 ? randomFutureDate(60)  : undefined,
  };
}

// ─── Macro Snapshot ───────────────────────────────────────────────────────────

export async function fetchMacroSnapshot(): Promise<MacroSnapshot> {
  logger.info('fetchMacroSnapshot');

  // TODO: Integrate SBP open data API — https://www.sbp.org.pk/ecodata/
  //       PKR market rate: https://www.forex.com.pk/
  //       FPI flows:       PSX weekly bulletin

  return {
    pkrUsdOfficial:   278.50,
    pkrUsdOpen:       280.20,
    sbpPolicyRate:    22.00,
    kibor1m:          22.80,
    pakistanCpi:      26.90,
    brentCrude:       82.50,
    fpiWeeklyMillion: -1_200,
    fpiDirection:     'outflow',
    kse100Level:      67_850,
    kse100ChangePct:  -0.40,
    imfStatus:        'Programme on track — Q3 review pending disbursement',
  };
}

// ─── Fundamentals ─────────────────────────────────────────────────────────────

// Real-data stubs per your actual holdings
const FUNDAMENTAL_STUBS: Record<string, Partial<FundamentalData>> = {
  MEBL:   { peRatio: 8.2,  sectorAvgPe: 7.5,  epsTtm: 52.4, dividendYieldPct: 6.1, roe: 18.5, roa: 2.1, debtToEquity: 0.12, currentRatio: 1.4, revenueGrowthYoy: 22.0, netProfitMargin: 28.0, interestCoverageRatio: 8.2  },
  OGDC:   { peRatio: 5.1,  sectorAvgPe: 5.8,  epsTtm: 52.0, dividendYieldPct: 8.5, roe: 20.0, roa: 8.5, debtToEquity: 0.05, currentRatio: 2.1, revenueGrowthYoy: 12.0, netProfitMargin: 45.0, interestCoverageRatio: 22.0 },
  HUBC:   { peRatio: 7.3,  sectorAvgPe: 8.1,  epsTtm: 26.3, dividendYieldPct: 9.2, roe: 22.0, roa: 7.0, debtToEquity: 0.82, currentRatio: 1.1, revenueGrowthYoy: 5.0,  netProfitMargin: 18.0, interestCoverageRatio: 3.5  },
  EFERT:  { peRatio: 6.8,  sectorAvgPe: 7.4,  epsTtm: 29.8, dividendYieldPct: 10.5,roe: 35.0, roa: 14.0,debtToEquity: 0.20, currentRatio: 1.8, revenueGrowthYoy: 8.0,  netProfitMargin: 25.0, interestCoverageRatio: 11.0 },
  ENGROH: { peRatio: 10.5, sectorAvgPe: 10.2, epsTtm: 26.6, dividendYieldPct: 4.2, roe: 12.0, roa: 4.0, debtToEquity: 0.45, currentRatio: 1.3, revenueGrowthYoy: 15.0, netProfitMargin: 12.0, interestCoverageRatio: 5.0  },
  FFC:    { peRatio: 7.1,  sectorAvgPe: 7.4,  epsTtm: 71.5, dividendYieldPct: 12.0,roe: 40.0, roa: 16.0,debtToEquity: 0.30, currentRatio: 2.0, revenueGrowthYoy: 6.0,  netProfitMargin: 30.0, interestCoverageRatio: 14.0 },
  LUCK:   { peRatio: 9.2,  sectorAvgPe: 9.2,  epsTtm: 41.2, dividendYieldPct: 3.5, roe: 14.0, roa: 6.0, debtToEquity: 0.15, currentRatio: 1.6, revenueGrowthYoy: 18.0, netProfitMargin: 16.0, interestCoverageRatio: 9.0  },
  MARI:   { peRatio: 4.9,  sectorAvgPe: 5.8,  epsTtm: 129.5,dividendYieldPct: 5.0, roe: 25.0, roa: 10.0,debtToEquity: 0.08, currentRatio: 2.5, revenueGrowthYoy: 10.0, netProfitMargin: 48.0, interestCoverageRatio: 25.0 },
  POL:    { peRatio: 5.5,  sectorAvgPe: 5.8,  epsTtm: 116.2,dividendYieldPct: 7.8, roe: 28.0, roa: 12.0,debtToEquity: 0.02, currentRatio: 3.0, revenueGrowthYoy: 9.0,  netProfitMargin: 50.0, interestCoverageRatio: 30.0 },
  SYS:    { peRatio: 22.0, sectorAvgPe: 14.5, epsTtm: 6.2,  dividendYieldPct: 1.8, roe: 32.0, roa: 15.0,debtToEquity: 0.10, currentRatio: 2.2, revenueGrowthYoy: 35.0, netProfitMargin: 18.0, interestCoverageRatio: 18.0 },
};

export async function fetchFundamentals(ticker: string): Promise<FundamentalData> {
  logger.debug({ ticker }, 'fetchFundamentals');

  // TODO: Integrate PSX financial data / SECP filings / Bloomberg Pakistan

  const stub   = FUNDAMENTAL_STUBS[ticker];
  const jitter = (base: number) => parseFloat((base * (0.92 + Math.random() * 0.16)).toFixed(2));
  const seed   = ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0);

  const base: FundamentalData = stub
    ? {
        ticker,
        peRatio:               jitter(stub.peRatio!),
        sectorAvgPe:           stub.sectorAvgPe!,
        epsTtm:                jitter(stub.epsTtm!),
        dividendYieldPct:      jitter(stub.dividendYieldPct!),
        roe:                   jitter(stub.roe!),
        roa:                   jitter(stub.roa!),
        debtToEquity:          jitter(stub.debtToEquity!),
        currentRatio:          jitter(stub.currentRatio!),
        revenueGrowthYoy:      stub.revenueGrowthYoy! + (Math.random() - 0.5) * 5,
        netProfitMargin:       jitter(stub.netProfitMargin!),
        interestCoverageRatio: jitter(stub.interestCoverageRatio!),
      }
    : {
        ticker,
        peRatio:               8 + (seed % 12),
        sectorAvgPe:           9,
        epsTtm:                20 + (seed % 80),
        dividendYieldPct:      3 + Math.random() * 8,
        roe:                   12 + Math.random() * 20,
        roa:                   4  + Math.random() * 10,
        debtToEquity:          0.1 + Math.random() * 0.8,
        currentRatio:          1   + Math.random() * 2,
        revenueGrowthYoy:      -5  + Math.random() * 30,
        netProfitMargin:       8   + Math.random() * 25,
        interestCoverageRatio: 2   + Math.random() * 15,
      };

  return {
    ...base,
    upcomingDividendDate: Math.random() > 0.6 ? randomFutureDate(90) : undefined,
    upcomingEarningsDate: Math.random() > 0.5 ? randomFutureDate(60) : undefined,
  };
}
