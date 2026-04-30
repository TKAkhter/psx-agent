export const round  = (v: number, d = 2) => Math.round(v * 10**d) / 10**d;
export const clamp  = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const safePct = (a: number, b: number) => b === 0 ? 0 : (a / b) * 100;
export const safeDiv = (a: number, b: number) => b === 0 ? 0 : a / b;

export function normalise(v: number, inMin: number, inMax: number, outMin = 0, outMax = 100): number {
  return outMin + (clamp(v, inMin, inMax) - inMin) / (inMax - inMin) * (outMax - outMin);
}

export function recencyDecay(publishedAt: Date): number {
  return Math.exp(-(Date.now() - publishedAt.getTime()) / (24 * 3_600_000));
}

export function weightedAvg(values: number[], weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  return total === 0 ? 0 : values.reduce((s, v, i) => s + v * weights[i], 0) / total;
}

export function formatPkr(v: number): string {
  return `PKR ${v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(v: number, decimals = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

export function scoreGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export function signalLabel(signal: string, score: number): string {
  const conf = score >= 75 ? 'High Conviction' : score >= 55 ? 'Moderate' : 'Low Conviction';
  return `${signal.replace('_', ' ')} — ${conf}`;
}

export function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
