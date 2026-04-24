import { logger } from '../utils/logger';
import type { TickerMarketData } from '../types';

export interface DataQualityReport {
  ticker: string;
  valid: boolean;
  flags: string[];
  warnings: string[];
}

const MIN_HISTORY_DAYS = 50;
const MIN_DAILY_VOLUME = 50_000;
const MAX_MISSING_CANDLE_PCT = 0.10;
const MIN_PRICE_PKR = 5;

export function assessDataQuality(data: TickerMarketData): DataQualityReport {
  const flags: string[] = [];
  const warnings: string[] = [];

  if (data.candles.length < MIN_HISTORY_DAYS) {
    flags.push('INSUFFICIENT_DATA');
  }

  const recentVolumes = data.candles.slice(-20).map((c) => c.volume);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  if (avgVolume < MIN_DAILY_VOLUME) {
    flags.push('ILLIQUID');
    warnings.push(`Avg volume ${Math.round(avgVolume).toLocaleString()} below threshold`);
  }

  if (data.currentPrice < MIN_PRICE_PKR) {
    flags.push('PENNY_STOCK');
    warnings.push(`Price PKR ${data.currentPrice} below minimum`);
  }

  // Check for missing candles (gaps in trading days)
  const expectedDays = Math.round(data.candles.length * 1.1); // ~10% weekends
  const missingPct = Math.max(0, (expectedDays - data.candles.length) / expectedDays);
  if (missingPct > MAX_MISSING_CANDLE_PCT) {
    warnings.push(`${(missingPct * 100).toFixed(1)}% missing candles — forward filled`);
  }

  const valid = !flags.includes('INSUFFICIENT_DATA');

  if (flags.length > 0 || warnings.length > 0) {
    logger.debug({ ticker: data.ticker, flags, warnings }, 'Data quality assessment');
  }

  return { ticker: data.ticker, valid, flags, warnings };
}

export function forwardFillCandles(data: TickerMarketData): TickerMarketData {
  if (data.candles.length === 0) return data;

  const filled = [...data.candles];
  for (let i = 1; i < filled.length; i++) {
    const prev = filled[i - 1];
    const curr = filled[i];
    if (curr.open === 0 || isNaN(curr.close)) {
      filled[i] = { ...prev, date: curr.date, volume: 0 };
    }
  }
  return { ...data, candles: filled };
}
