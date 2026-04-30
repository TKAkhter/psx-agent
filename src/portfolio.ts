import { ENV, DEFAULT_PORTFOLIO } from "./config";
import type { PortfolioEntry, PositionInfo, PortfolioMap } from "./types";
import * as db from "./db";

export type { PortfolioEntry, PositionInfo, PortfolioMap };

const COLLECTION = "portfolio";
const PORTFOLIO_TYPE = ENV.PORTFOLIO_TYPE;

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
