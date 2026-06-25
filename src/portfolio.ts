import { ENV, DEFAULT_PORTFOLIO } from "./config";
import type { PortfolioEntry, PositionInfo, PortfolioMap } from "./types";
import * as db from "./db";

export type { PositionInfo, PortfolioMap } from "./types";

const COLLECTION = "portfolio";
const PORTFOLIO_TYPE = ENV.PORTFOLIO_TYPE;

// ─────────────────────────────────────────────────────────────
//  LOAD (or seed) portfolio from MongoDB
//
//  IMPROVED: if the portfolio already exists in MongoDB (count > 0)
//  but the seeded avgCost differs from the current DEFAULT_PORTFOLIO
//  constant (e.g. corrected after a data-entry fix), reconcile the
//  DB record automatically so P&L stays accurate without requiring
//  a manual DB edit. Only avgCost/shares are reconciled — name,
//  sector etc. are left untouched in case the user customised them.
// ─────────────────────────────────────────────────────────────

export async function loadPortfolio(): Promise<PortfolioEntry[]> {
  const count = await db.countDocs(COLLECTION, { type: PORTFOLIO_TYPE });

  if (count === 0) {
    console.log(`  i  Portfolio empty (type=${PORTFOLIO_TYPE}) — seeding defaults...`);
    const docs = DEFAULT_PORTFOLIO.map((p) => ({
      ...p,
      type: PORTFOLIO_TYPE,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertMany(COLLECTION, docs);
    console.log(`  ok  Seeded ${docs.length} positions`);
  } else {
    // Reconcile avgCost/shares for existing records against the
    // current DEFAULT_PORTFOLIO constant — fixes stale P&L without
    // wiping user customisations to name/sector.
    const existing = await db.findMany<PortfolioEntry>(COLLECTION, { type: PORTFOLIO_TYPE });
    const bySymbol = new Map(existing.map((e) => [e.symbol, e]));
    let reconciled = 0;
    for (const def of DEFAULT_PORTFOLIO) {
      const cur = bySymbol.get(def.symbol);
      if (cur && (cur.avgCost !== def.avgCost || cur.shares !== def.shares)) {
        await db.updateOne(
          COLLECTION,
          { symbol: def.symbol, type: PORTFOLIO_TYPE },
          { $set: { avgCost: def.avgCost, shares: def.shares, updatedAt: new Date() } }
        );
        reconciled++;
      }
    }
    if (reconciled > 0) {
      console.log(`  ok  Reconciled ${reconciled} position(s) — avgCost/shares synced from config`);
    }
  }

  const positions = await db.findMany<PortfolioEntry>(COLLECTION, {
    active: { $ne: false },
    type: PORTFOLIO_TYPE,
  });
  console.log(`  ok  ${positions.length} positions loaded (type=${PORTFOLIO_TYPE})`);
  return positions;
}

// ─────────────────────────────────────────────────────────────
//  Build lookup map  { "MEBL": PositionInfo }
// ─────────────────────────────────────────────────────────────

export function buildPortfolioMap(positions: PortfolioEntry[]): PortfolioMap {
  const map: PortfolioMap = {};
  for (const p of positions) {
    map[p.ticker] = {
      symbol: p.symbol,
      name: p.name,
      sector: p.sector,
      shares: p.shares,
      avgCost: p.avgCost,
    };
  }
  return map;
}
