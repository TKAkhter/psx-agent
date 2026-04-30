import { logger } from '../utils/logger';
import type { TickerMarketData } from '../types';

const MIN_CANDLES   = 60;
const MIN_VOLUME    = 50_000;
const MIN_PRICE_PKR = 5;
const MAX_GAP_PCT   = 0.12;

export interface QualityReport { valid: boolean; flags: string[]; warnings: string[] }

export function assessQuality(d: TickerMarketData): QualityReport {
  const flags: string[] = []; const warnings: string[] = [];
  if (d.candles.length < MIN_CANDLES) flags.push('INSUFFICIENT_HISTORY');
  if (d.currentPrice < MIN_PRICE_PKR) flags.push('PENNY_STOCK');
  if (d.avgVolume30d < MIN_VOLUME) { flags.push('ILLIQUID'); warnings.push(`Avg vol ${Math.round(d.avgVolume30d).toLocaleString()} — low liquidity`); }
  const gapPct = Math.max(0, 1 - d.candles.length / (d.candles.length * 1.15));
  if (gapPct > MAX_GAP_PCT) warnings.push(`${(gapPct*100).toFixed(1)}% candle gaps — forward-filled`);
  return { valid: !flags.includes('INSUFFICIENT_HISTORY'), flags, warnings };
}

export function forwardFill(d: TickerMarketData): TickerMarketData {
  const filled = [...d.candles];
  for (let i = 1; i < filled.length; i++) {
    if (!filled[i].close || isNaN(filled[i].close)) {
      filled[i] = { ...filled[i-1], date: filled[i].date, volume: 0 };
    }
  }
  return { ...d, candles: filled };
}
