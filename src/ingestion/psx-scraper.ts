/**
 * PSX Data Scraper
 *
 * Fetches live market data directly from PSX public endpoints.
 * No API key required.
 *
 * Sources:
 *  - https://dps.psx.com.pk/timeseries/eod/{ticker}  — historical OHLCV
 *  - https://dps.psx.com.pk/timeseries/int/{ticker}   — intraday quotes
 *  - https://dps.psx.com.pk/snapshot                  — all tickers snapshot
 *  - https://www.psx.com.pk/market-summary             — market summary
 *  - https://dps.psx.com.pk/company/{ticker}           — company info
 *  - https://dps.psx.com.pk/financial/{ticker}         — financials
 *
 * All functions return null on failure so callers fall back to stubs.
 */
import { httpClient } from '../utils/http-client';
import { logger } from '../utils/logger';
import type { OHLCVCandle, TickerMarketData, FundamentalData } from '../types';

// ─── PSX DPS (Data Portal Service) ───────────────────────────────────────────

const DPS_BASE = 'https://dps.psx.com.pk';

// PSX returns dates as "DD-Mon-YYYY" e.g. "07-May-2026"
function parsePsxDate(d: string): string {
  try {
    return new Date(d).toISOString().split('T')[0];
  } catch {
    return d;
  }
}

// ─── Historical OHLCV from DPS ────────────────────────────────────────────────
// Endpoint: GET /timeseries/eod/{TICKER}
// Returns JSON array: [{ DATE, OPEN, HIGH, LOW, CLOSE, VOLUME }, ...]

interface DpsEodRow {
  DATE:   string;
  OPEN:   number | string;
  HIGH:   number | string;
  LOW:    number | string;
  CLOSE:  number | string;
  VOLUME: number | string;
}

export async function scrapePsxEodData(ticker: string): Promise<OHLCVCandle[] | null> {
  try {
    const url  = `${DPS_BASE}/timeseries/eod/${ticker.toUpperCase()}`;
    const { data } = await httpClient.get<DpsEodRow[]>(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.psx.com.pk/',
        'Origin':  'https://www.psx.com.pk',
      },
      timeout: 15_000,
    });

    if (!Array.isArray(data) || data.length === 0) return null;

    const candles: OHLCVCandle[] = data
      .filter(row => row.CLOSE && Number(row.CLOSE) > 0)
      .map(row => ({
        date:   parsePsxDate(String(row.DATE)),
        open:   parseFloat(String(row.OPEN))   || 0,
        high:   parseFloat(String(row.HIGH))   || 0,
        low:    parseFloat(String(row.LOW))     || 0,
        close:  parseFloat(String(row.CLOSE))  || 0,
        volume: parseFloat(String(row.VOLUME)) || 0,
      }))
      .filter(c => c.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    logger.info({ ticker, candles: candles.length, source: 'dps.psx.com.pk' }, 'EOD data scraped');
    return candles;
  } catch (err) {
    logger.debug({ ticker, err: (err as Error).message }, 'DPS EOD scrape failed');
    return null;
  }
}

// ─── Intraday / Current Quote from DPS ───────────────────────────────────────
// Endpoint: GET /timeseries/int/{TICKER}
// Returns current price + today's OHLV

interface DpsIntRow {
  TIME:    string;
  OPEN:    number | string;
  HIGH:    number | string;
  LOW:     number | string;
  CLOSE:   number | string;
  VOLUME?: number | string;
}

export async function scrapePsxCurrentPrice(ticker: string): Promise<{
  currentPrice: number;
  open: number;
  high: number;
  low: number;
  volume: number;
} | null> {
  try {
    const url = `${DPS_BASE}/timeseries/int/${ticker.toUpperCase()}`;
    const { data } = await httpClient.get<DpsIntRow[]>(url, {
      headers: {
        'Accept':  'application/json, text/plain, */*',
        'Referer': 'https://www.psx.com.pk/',
        'Origin':  'https://www.psx.com.pk',
      },
      timeout: 10_000,
    });

    if (!Array.isArray(data) || data.length === 0) return null;

    // Last entry is current price
    const latest = data[data.length - 1];
    const current = parseFloat(String(latest.CLOSE || latest.OPEN));
    if (!current || current <= 0) return null;

    // Daily aggregates
    const allLows  = data.map(r => parseFloat(String(r.LOW  || r.CLOSE))).filter(v => v > 0);
    const allHighs = data.map(r => parseFloat(String(r.HIGH || r.CLOSE))).filter(v => v > 0);
    const allVols  = data.map(r => parseFloat(String(r.VOLUME ?? 0)));

    logger.debug({ ticker, currentPrice: current, source: 'dps.psx.com.pk/int' }, 'Live price scraped');
    return {
      currentPrice: current,
      open:   parseFloat(String(data[0].OPEN))  || current,
      high:   allHighs.length > 0 ? Math.max(...allHighs) : current,
      low:    allLows.length  > 0 ? Math.min(...allLows)  : current,
      volume: allVols.reduce((a, b) => a + b, 0),
    };
  } catch (err) {
    logger.debug({ ticker, err: (err as Error).message }, 'DPS intraday scrape failed');
    return null;
  }
}

// ─── All-Tickers Snapshot from DPS ───────────────────────────────────────────
// Endpoint: GET /snapshot
// Returns all listed stocks with last close, change%, volume

interface DpsSnapshotRow {
  SYMBOL:         string;
  COMPANY:        string;
  CURRENT:        number | string;
  CHANGE:         number | string;
  CHANGE_P:       number | string;
  VOLUME:         number | string;
  HIGH:           number | string;
  LOW:            number | string;
  OPEN:           number | string;
  PREVIOUS_CLOSE: number | string;
  SECTOR?:        string;
  MARKET_CAP?:    number | string;
  LISTED_SHARES?: number | string;
  LDCP?:          number | string;  // last day closing price (some PSX endpoints use this)
  [key: string]:  unknown;          // allow any additional PSX fields
}

let snapshotCache: Map<string, DpsSnapshotRow> | null = null;
let snapshotFetchedAt = 0;
const SNAPSHOT_TTL_MS = 10 * 60 * 1000; // 10 min cache

export async function fetchPsxSnapshot(): Promise<Map<string, DpsSnapshotRow> | null> {
  // Return cached if fresh
  if (snapshotCache && Date.now() - snapshotFetchedAt < SNAPSHOT_TTL_MS) {
    return snapshotCache;
  }

  try {
    const { data } = await httpClient.get<DpsSnapshotRow[]>(`${DPS_BASE}/snapshot`, {
      headers: {
        'Accept':  'application/json, text/plain, */*',
        'Referer': 'https://www.psx.com.pk/',
        'Origin':  'https://www.psx.com.pk',
      },
      timeout: 20_000,
    });

    if (!Array.isArray(data) || data.length === 0) return null;

    snapshotCache = new Map(data.map(row => [row.SYMBOL.toUpperCase(), row]));
    snapshotFetchedAt = Date.now();
    logger.info({ count: snapshotCache.size, source: 'dps.psx.com.pk/snapshot' }, 'PSX snapshot fetched');
    return snapshotCache;
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'PSX snapshot fetch failed');
    return null;
  }
}

// ─── Company Financials from DPS ─────────────────────────────────────────────
// Endpoint: GET /financial/{TICKER}

interface DpsFinancialData {
  EPS?:              number | string;
  DPS?:              number | string;  // dividend per share
  PE?:               number | string;
  P_B?:              number | string;  // price to book
  BOOK_VALUE?:       number | string;
  REVENUE?:          number | string;
  NET_PROFIT?:       number | string;
  TOTAL_ASSETS?:     number | string;
  TOTAL_EQUITY?:     number | string;
  TOTAL_DEBT?:       number | string;
  MARKET_CAP?:       number | string;
  SHARES?:           number | string;
  [key: string]:     unknown;
}

export async function scrapePsxFinancials(ticker: string): Promise<DpsFinancialData | null> {
  try {
    const url = `${DPS_BASE}/financial/${ticker.toUpperCase()}`;
    const { data } = await httpClient.get<DpsFinancialData>(url, {
      headers: {
        'Accept':  'application/json, text/plain, */*',
        'Referer': 'https://www.psx.com.pk/',
        'Origin':  'https://www.psx.com.pk',
      },
      timeout: 12_000,
    });

    if (!data || typeof data !== 'object') return null;
    logger.debug({ ticker, source: 'dps.psx.com.pk/financial' }, 'Financials scraped');
    return data;
  } catch (err) {
    logger.debug({ ticker, err: (err as Error).message }, 'DPS financials scrape failed');
    return null;
  }
}

// ─── Build TickerMarketData from DPS data ─────────────────────────────────────

export async function buildMarketDataFromPsx(ticker: string): Promise<TickerMarketData | null> {
  const [snapshot, eodData, intraday] = await Promise.all([
    fetchPsxSnapshot(),
    scrapePsxEodData(ticker),
    scrapePsxCurrentPrice(ticker),
  ]);

  const snap = snapshot?.get(ticker.toUpperCase());

  // Need at least EOD data or snapshot to proceed
  if (!eodData && !snap) return null;

  const candles = eodData ?? [];

  // Current price: intraday > snapshot CURRENT > last EOD close
  let currentPrice = 0;
  if (intraday?.currentPrice && intraday.currentPrice > 0) {
    currentPrice = intraday.currentPrice;
  } else if (snap?.CURRENT) {
    currentPrice = parseFloat(String(snap.CURRENT));
  } else if (candles.length > 0) {
    currentPrice = candles[candles.length - 1].close;
  }

  if (currentPrice <= 0) return null;

  const previousClose = snap?.PREVIOUS_CLOSE
    ? parseFloat(String(snap.PREVIOUS_CLOSE))
    : candles.length >= 2 ? candles[candles.length - 2].close : currentPrice;

  const dayChangePct = previousClose > 0
    ? ((currentPrice - previousClose) / previousClose) * 100
    : 0;

  // If we have candles, update the last candle's close to live price
  if (candles.length > 0) {
    candles[candles.length - 1] = {
      ...candles[candles.length - 1],
      close: currentPrice,
      high:  intraday?.high  ?? Math.max(candles[candles.length - 1].high, currentPrice),
      low:   intraday?.low   ?? Math.min(candles[candles.length - 1].low, currentPrice),
      volume: intraday?.volume ?? candles[candles.length - 1].volume,
    };
  }

  const closes     = candles.map(c => c.close).filter(v => v > 0);
  const vols       = candles.slice(-30).map(c => c.volume);
  const high52w    = closes.length > 0 ? Math.max(...closes.slice(-252)) : currentPrice;
  const low52w     = closes.length > 0 ? Math.min(...closes.slice(-252)) : currentPrice;
  const avgVol30d  = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

  return {
    ticker:          ticker.toUpperCase(),
    name:            snap?.COMPANY ?? ticker,
    sector:          snap?.SECTOR  ?? 'General',
    candles,
    currentPrice:    parseFloat(currentPrice.toFixed(2)),
    previousClose:   parseFloat(previousClose.toFixed(2)),
    dayChangePct:    parseFloat(dayChangePct.toFixed(2)),
    high52w:         parseFloat(high52w.toFixed(2)),
    low52w:          parseFloat(low52w.toFixed(2)),
    avgVolume30d:    Math.round(avgVol30d),
    marketCap:       snap?.MARKET_CAP ? parseFloat(String(snap.MARKET_CAP)) : currentPrice * 200_000_000,
    freeFloatPct:    30,
    listedShares:    200_000_000,
  };
}
