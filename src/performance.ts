import { round2 } from "./indicators";
import { TradeSignalMap } from "./signals";
import { StockDataMap, StockData } from "./fetch-data";
import { PortfolioSummary } from "./signals";
import * as db from "./db";

export interface BreakdownEntry {
  symbol: string;
  action: string;
  prevPrice: number;
  currPrice: number;
  delta: number;
  correct: boolean;
}

export interface PerformanceResult {
  accuracy: number;
  correct: number;
  total: number;
  breakdown: BreakdownEntry[];
  sessionDate: Date;
}

interface SavedSession {
  createdAt: Date;
  signals: Record<string, { action: string }>;
  snapshot: Record<string, { price: number; unrealizedPct: number | null }>;
  geminiStance: string | null;
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
    let correct = 0,
      total = 0;
    const breakdown: BreakdownEntry[] = [];

    for (const [ticker, entry] of Object.entries(currentData)) {
      if (ticker === "__market__") continue;
      if ("error" in entry || !(entry as StockData).price) continue;
      const curr = entry as StockData;
      const sym = ticker.replace(".KA", "");
      const prevSig = prev.signals?.[sym];
      const prevSnap = prev.snapshot?.[sym];
      if (!prevSig || !prevSnap?.price) continue;

      total++;
      const delta = round2(
        ((curr.price - prevSnap.price) / prevSnap.price) * 100
      )!;
      const isBuy = prevSig.action === "BUY" || prevSig.action === "STRONG_BUY";
      const isSell =
        prevSig.action === "SELL" || prevSig.action === "STRONG_SELL";
      const ok = isBuy
        ? curr.price >= prevSnap.price
        : isSell
        ? curr.price <= prevSnap.price
        : Math.abs(delta) < 2;
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
  const snapshot: Record<
    string,
    { price: number; unrealizedPct: number | null }
  > = {};
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
