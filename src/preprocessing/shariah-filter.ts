import { CONFIG } from '../config';
import type { ShariahMode } from '../types';

export const isShariahCompliant = (ticker: string): boolean =>
  (CONFIG.SHARIAH_COMPLIANT as ReadonlySet<string>).has(ticker);

export const passesFilter = (ticker: string, mode: ShariahMode): boolean => {
  if (mode === 'both') return true;
  return mode === 'compliant' ? isShariahCompliant(ticker) : !isShariahCompliant(ticker);
};
