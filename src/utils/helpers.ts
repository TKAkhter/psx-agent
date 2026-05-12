export const round    = (v: number, d = 2) => Math.round(v * 10**d) / 10**d;
export const clamp    = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const safePct  = (a: number, b: number) => b === 0 ? 0 : (a / b) * 100;
export const safeDiv  = (a: number, b: number) => b === 0 ? 0 : a / b;

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

export function formatPkrCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return `PKR ${(v / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(v) >= 1_000_000)     return `PKR ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)         return `PKR ${(v / 1_000).toFixed(0)}K`;
  return formatPkr(v);
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

/**
 * Build notification subject line in the format:
 *   "PSX 07 May 2026, 09:01 PKT · 3B/1S · P&L +11.1%"
 *
 * B = BUY + STRONG_BUY count
 * S = SELL + STRONG_SELL count
 */
export function buildNotificationSubject(
  runAt:           Date,
  buyCount:        number,
  sellCount:       number,
  unrealisedPlPct: number,
): string {
  // Format date as "07 May 2026, 09:01 PKT"
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = runAt;
  const day   = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year  = d.getFullYear();
  const hh    = String(d.getHours()).padStart(2, '0');
  const mm    = String(d.getMinutes()).padStart(2, '0');
  const dateStr = `${day} ${month} ${year}, ${hh}:${mm} PKT`;

  const plSign = unrealisedPlPct >= 0 ? '+' : '';
  const plStr  = `${plSign}${unrealisedPlPct.toFixed(1)}%`;

  return `PSX ${dateStr} · ${buyCount}B/${sellCount}S · P&L ${plStr}`;
}

/**
 * Emoji for signal — used in logs and WhatsApp
 */
export function signalEmoji(signal: string): string {
  return { STRONG_BUY:'🟢🟢', BUY:'🟢', HOLD:'🟡', SELL:'🔴', STRONG_SELL:'🔴🔴' }[signal] ?? '⚪';
}

/**
 * Format a duration in ms as human-readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60_000)}m ${Math.floor((ms%60_000)/1000)}s`;
}

export function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
