import { round2 } from "./indicators";
import type {
  TradeSignalMap, PortfolioSummary, PerformanceResult,
  BreakdownEntry, StockDataMap, StockData, HistoricalTrend,
} from "./types";
import * as db from "./db";

export type { PerformanceResult };

// ─────────────────────────────────────────────────────────────
//  SAVED SESSION SHAPE  (in MongoDB "signals" collection)
// ─────────────────────────────────────────────────────────────

interface SavedSession {
  createdAt:    Date;
  signals:      Record<string, { action: string; score?: number }>;
  snapshot:     Record<string, { price: number; unrealizedPct: number | null }>;
  geminiStance: string | null;
}

// ─────────────────────────────────────────────────────────────
//  EVALUATE PERFORMANCE  (compare today vs last session)
// ─────────────────────────────────────────────────────────────

export async function evaluatePerformance(currentData: StockDataMap): Promise<PerformanceResult | null> {
  try {
    const docs = await db.findMany<SavedSession>(
      "signals", {}, { sort: { createdAt: -1 }, limit: 1 } as Parameters<typeof db.findMany>[2],
    );
    if (!docs.length) return null;
    const prev = docs[0];
    let correct = 0, total = 0;
    const breakdown: BreakdownEntry[] = [];

    for (const [ticker, entry] of Object.entries(currentData)) {
      if (ticker === "__market__") continue;
      if ("error" in entry || !(entry as StockData).price) continue;
      const curr     = entry as StockData;
      const sym      = ticker.replace(".KA", "");
      const prevSig  = prev.signals?.[sym];
      const prevSnap = prev.snapshot?.[sym];
      if (!prevSig || !prevSnap?.price) continue;
      total++;
      const delta  = round2((curr.price - prevSnap.price) / prevSnap.price * 100)!;
      const isBuy  = prevSig.action === "BUY"  || prevSig.action === "STRONG_BUY";
      const isSell = prevSig.action === "SELL" || prevSig.action === "STRONG_SELL";
      const ok     = isBuy ? curr.price >= prevSnap.price
                   : isSell ? curr.price <= prevSnap.price
                   : Math.abs(delta) < 2;
      if (ok) correct++;
      breakdown.push({ symbol: sym, action: prevSig.action, prevPrice: prevSnap.price, currPrice: curr.price, delta, correct: ok });
    }
    if (!total) return null;
    return { accuracy: round2((correct / total) * 100)!, correct, total, breakdown, sessionDate: prev.createdAt };
  } catch (err) {
    console.warn(`  ⚠ Performance eval: ${(err as Error).message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  LOAD HISTORICAL TRENDS  (last N sessions from DB)
//  Used by Gemini to give trend context: "this stock has been
//  getting BUY signals for 5 sessions, price up 3.2%"
// ─────────────────────────────────────────────────────────────

export async function loadHistoricalTrends(symbols: string[]): Promise<HistoricalTrend[]> {
  try {
    // Load last 7 sessions
    const sessions = await db.findMany<SavedSession>(
      "signals", {}, { sort: { createdAt: -1 }, limit: 7 } as Parameters<typeof db.findMany>[2],
    );
    if (sessions.length < 2) return [];

    const trends: HistoricalTrend[] = [];
    for (const sym of symbols) {
      const prices: number[]  = [];
      const actions: string[] = [];
      const scores: number[]  = [];

      for (const session of sessions) {
        const snap = session.snapshot?.[sym];
        const sig  = session.signals?.[sym];
        if (snap?.price) prices.push(snap.price);
        if (sig?.action) actions.push(sig.action);
        if (sig?.score != null) scores.push(sig.score);
      }

      if (prices.length < 2) continue;

      const prevPrice     = prices[0];  // most recent saved session
      const oldestPrice   = prices[prices.length - 1];
      const priceChange7d = round2(((prevPrice - oldestPrice) / oldestPrice) * 100);
      const avgScore7d    = scores.length ? round2(scores.reduce((s, v) => s + v, 0) / scores.length) : null;

      trends.push({
        symbol:        sym,
        prevPrice,
        priceChange7d,
        avgScore7d,
        prevAction:    actions[0] ?? "UNKNOWN",
        sessions:      prices.length,
      });
    }
    return trends;
  } catch (err) {
    console.warn(`  ⚠ Historical trends: ${(err as Error).message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  SAVE SESSION
// ─────────────────────────────────────────────────────────────

export async function saveSession(
  signals:      TradeSignalMap,
  summary:      PortfolioSummary,
  stockData:    StockDataMap,
  geminiStance: string | null,
): Promise<void> {
  const snapshot: Record<string, { price: number; unrealizedPct: number | null }> = {};
  for (const [ticker, entry] of Object.entries(stockData)) {
    if (ticker === "__market__") continue;
    if ("error" in entry || !(entry as StockData).price) continue;
    const sd = entry as StockData;
    snapshot[ticker.replace(".KA", "")] = { price: sd.price, unrealizedPct: sd.unrealizedPct };
  }
  const signalMap: Record<string, { action: string; score: number }> = {};
  for (const [sym, s] of Object.entries(signals)) {
    signalMap[sym] = { action: s.action, score: s.score };
  }
  await db.insertOne("signals", {
    createdAt:    new Date(),
    signals:      signalMap,
    summary:      { totalCost: summary.totalCost, totalValue: summary.totalValue, totalPnl: summary.totalPnl, totalPnlPct: summary.totalPnlPct },
    geminiStance: geminiStance ?? null,
    snapshot,
  });
}
