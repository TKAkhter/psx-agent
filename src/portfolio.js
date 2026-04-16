"use strict";
const { DEFAULT_PORTFOLIO } = require("./config");
const db = require("./db");

const COLLECTION = "portfolio";

/**
 * Load portfolio from MongoDB.
 * If the collection is empty, seed it from DEFAULT_PORTFOLIO first.
 * Returns an array of position objects.
 */
async function loadPortfolio() {
    const count = await db.countDocs(COLLECTION);

    if (count === 0) {
        console.log("  ℹ  Portfolio collection empty — seeding defaults...");
        const docs = DEFAULT_PORTFOLIO.map(p => ({
            ...p,
            createdAt: new Date(),
            updatedAt: new Date(),
            active: true,
        }));
        const d = await db.getDb();
        await d.collection(COLLECTION).insertMany(docs);
        console.log(`  ✓  Seeded ${docs.length} positions to MongoDB`);
    }

    const positions = await db.findMany(COLLECTION, { active: { $ne: false } });
    console.log(`  ✓  Loaded ${positions.length} positions from MongoDB`);
    return positions;
}

/**
 * Convert portfolio array to a keyed map { "MEBL.KA": { ... } }
 */
function portfolioToMap(positions) {
    const map = {};
    for (const p of positions) {
        map[p.ticker] = {
            symbol: p.symbol,
            name: p.name,
            sector: p.sector,
            shares: p.shares,
            avg_cost: p.avg_cost,
        };
    }
    return map;
}

module.exports = { loadPortfolio, portfolioToMap };