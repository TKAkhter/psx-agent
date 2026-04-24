/**
 * Normalise a value from [inMin, inMax] to [outMin, outMax]
 */
export function normalise(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Safe division - returns 0 if denominator is 0
 */
export function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Round to N decimal places
 */
export function round(value: number, decimals = 2): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

/**
 * Parse boolean from string env var
 */
export function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Chunk an array into batches
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format PKR value
 */
export function formatPkr(value: number): string {
  return `PKR ${value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format percentage
 */
export function formatPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Exponential decay for recency weighting
 * hoursAgo=0 => weight=1, hoursAgo=24 => weight≈0.37
 */
export function recencyDecay(publishedAt: Date): number {
  const hoursAgo = (Date.now() - publishedAt.getTime()) / 3_600_000;
  return Math.exp(-hoursAgo / 24);
}

/**
 * Weighted average
 */
export function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}
