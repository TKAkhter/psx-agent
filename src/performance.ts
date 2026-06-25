import { round2 } from "./indicators";
import type { TradeSignalMap, PortfolioSummary, StockDataMap, StockData, BreakdownEntry, PerformanceResult } from "./types";
import * as db from "./db";

export type { BreakdownEntry, PerformanceResult } from "./types";

interface SavedSession {
  createdAt: Date;
  signals: Record<string, { action: string }>;
  snapshot: Record<string, { price: number; unrealizedPct: number | null }>;
  geminiStance: string | null;
}

// ─────────────────────────────────────────────────────────────
//  ACCURACY EVALUATION
//
//  IMPROVED: action-specific correctness thresholds instead of a
//  single arbitrary "< 2%" band for everything:
//   - BUY/STRONG_BUY: correct if price did not fall (>= prev price)
//   - SELL/STRONG_SELL: correct if price did not rise (<= prev price)
//   - HOLD: correct if price stayed within a tighter +/-1.5% band
//     (HOLD is a "no major move expected" call — 2% was too loose
//     and let genuinely wrong HOLD calls count as correct)
//   - STRONG_BUY/STRONG_SELL require a slightly larger move in the
//     right direction (>= 0.3%) to count as correct — a flat price
//     shouldn't validate a "STRONG" conviction call.
// ─────────────────────────────────────────────────────────────

function isCorrect(action: string, prevPrice: number, currPrice: number, delta: number): boolean {
  switch (action) {
    case "STRONG_BUY":
      return delta >= 0.3; // must show some real upward move
    case "BUY":
      return currPrice >= prevPrice;
    case "STRONG_SELL":
      return delta <= -0.3;
    case "SELL":
      return currPrice <= prevPrice;
    case "HOLD":
      return Math.abs(delta) < 1.5; // tighter band than before
    default:
      return Math.abs(delta) < 1.5;
  }
}

export async function evaluatePerformance(
  currentData: StockDataMap
): Promise<PerformanceResult | null> {
  try {
    const docs = await db.findMany<SavedSession>("signals", {}, {
      sort: { createdAt: -1 },
      limit: 1,
    } as Parameters<typeof db.findMany>[2]);
    if (!docs.length) return null;
    const prev = docs[0];
    let correct = 0, total = 0;
    const breakdown: BreakdownEntry[] = [];

    for (const [ticker, entry] of Object.entries(currentData)) {
      if (ticker === "__market__") continue;
      if ("error" in entry || !(entry as StockData).price) continue;
      const curr = entry as StockData;
      const sym = ticker.replace(".KA", "");
      const prevSig  = prev.signals?.[sym];
      const prevSnap = prev.snapshot?.[sym];
      if (!prevSig || !prevSnap?.price) continue;

      total++;
      const delta = round2(((curr.price - prevSnap.price) / prevSnap.price) * 100)!;
      const ok = isCorrect(prevSig.action, prevSnap.price, curr.price, delta);
      if (ok) correct++;
      breakdown.push({
        symbol: sym,
        action: prevSig.action,
        prevPrice: prevSnap.price,
        currPrice: curr.price,
        delta,
        correct: ok,
      });
    }

    if (!total) return null;
    return {
      accuracy: round2((correct / total) * 100)!,
      correct,
      total,
      breakdown,
      sessionDate: prev.createdAt,
    };
  } catch (err) {
    console.warn("  ⚠ Performance eval:", (err as Error).message);
    return null;
  }
}

export async function saveSession(
  signals: TradeSignalMap,
  summary: PortfolioSummary,
  stockData: StockDataMap,
  geminiStance: string | null
): Promise<void> {
  const snapshot: Record<string, { price: number; unrealizedPct: number | null }> = {};
  for (const [ticker, entry] of Object.entries(stockData)) {
    if (ticker === "__market__") continue;
    if ("error" in entry || !(entry as StockData).price) continue;
    const sd = entry as StockData;
    snapshot[ticker.replace(".KA", "")] = {
      price: sd.price,
      unrealizedPct: sd.unrealizedPct,
    };
  }

  const signalMap: Record<string, { action: string }> = {};
  for (const [sym, s] of Object.entries(signals))
    signalMap[sym] = { action: s.action };

  await db.insertOne("signals", {
    createdAt: new Date(),
    signals: signalMap,
    summary,
    geminiStance: geminiStance ?? null,
    snapshot,
  });
}
