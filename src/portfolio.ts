import { ENV, DEFAULT_PORTFOLIO, PortfolioEntry } from "./config";
import * as db from "./db";

const COLLECTION = "portfolio";
const PORTFOLIO_TYPE = ENV.PORTFOLIO_TYPE;

export interface PositionInfo {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
}

export type PortfolioMap = Record<string, PositionInfo>;

// ─────────────────────────────────────────────────────────────
//  LOAD (or seed) portfolio from MongoDB
// ─────────────────────────────────────────────────────────────

export async function loadPortfolio(): Promise<PortfolioEntry[]> {
  const count = await db.countDocs(COLLECTION, { type: PORTFOLIO_TYPE });

  if (count === 0) {
    console.log(
      `  ℹ  Portfolio empty (type=${PORTFOLIO_TYPE}) — seeding defaults...`
    );
    const docs = DEFAULT_PORTFOLIO.map((p) => ({
      ...p,
      type: PORTFOLIO_TYPE,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertMany(COLLECTION, docs);
    console.log(`  ✓  Seeded ${docs.length} positions`);
  }

  const positions = await db.findMany<PortfolioEntry>(COLLECTION, {
    active: { $ne: false },
    type: PORTFOLIO_TYPE,
  });
  console.log(
    `  ✓  ${positions.length} positions loaded (type=${PORTFOLIO_TYPE})`
  );
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
