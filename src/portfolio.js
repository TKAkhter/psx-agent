"use strict";
const { DEFAULT_PORTFOLIO } = require("./config");
const db = require("./db");

const COLLECTION = "portfolio";

/**
 * Load portfolio from MongoDB.
 * Seeds DEFAULT_PORTFOLIO on first run if collection is empty.
 * Returns array of position documents.
 */
async function loadPortfolio() {
    const count = await db.countDocs(COLLECTION);

    if (count === 0) {
        console.log("  ℹ  Portfolio empty — seeding defaults...");
        const docs = DEFAULT_PORTFOLIO.map(p => ({
            ...p,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));
        const database = await db.getDB();
        await database.collection(COLLECTION).insertMany(docs);
        console.log(`  ✓  Seeded ${docs.length} positions`);
    }

    const positions = await db.findMany(COLLECTION, { active: { $ne: false } });
    console.log(`  ✓  ${positions.length} positions loaded`);
    return positions;
}

/**
 * Convert positions array → keyed map { "MEBL.KA": { symbol, name, sector, shares, avgCost } }
 */
function buildPortfolioMap(positions) {
    const map = {};
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

module.exports = { loadPortfolio, buildPortfolioMap };