import { CONFIG } from '../config';
import type { ShariahMode } from '../types';

export function isShariahCompliant(ticker: string): boolean {
  return CONFIG.SHARIAH_COMPLIANT_TICKERS.includes(ticker as typeof CONFIG.SHARIAH_COMPLIANT_TICKERS[number]);
}

export function passesShariahFilter(ticker: string, mode: ShariahMode): boolean {
  if (mode === 'both') return true;
  const compliant = isShariahCompliant(ticker);
  return mode === 'compliant' ? compliant : !compliant;
}

export function applyShariahFilter<T extends { ticker: string }>(
  items: T[],
  mode: ShariahMode
): T[] {
  return items.filter((item) => passesShariahFilter(item.ticker, mode));
}
