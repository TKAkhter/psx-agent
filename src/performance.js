"use strict";
const { round2 } = require("./indicators");
const db = require("./db");

async function evaluatePerformance(currentData) {
    try {
        const docs = await db.findMany("signals", {}, { sort: { createdAt: -1 }, limit: 1 });
        if (!docs.length) return null;

        const prev = docs[0];
        let correct = 0, total = 0;
        const breakdown = [];

        for (const [ticker, curr] of Object.entries(currentData)) {
            if (!curr.price || curr.error) continue;
            const sym = ticker.replace(".KA", "");
            const prevSig = prev.signals?.[sym];
            const prevSnap = prev.snapshot?.[sym];
            if (!prevSig || !prevSnap?.price) continue;

            total++;
            const delta = (curr.price - prevSnap.price) / prevSnap.price * 100;
            const isBuy = prevSig.action === "BUY" || prevSig.action === "STRONG_BUY";
            const isSell = prevSig.action === "SELL" || prevSig.action === "STRONG_SELL";
            const ok = isBuy ? curr.price >= prevSnap.price
                : isSell ? curr.price <= prevSnap.price
                    : Math.abs(delta) < 2;

            if (ok) correct++;
            breakdown.push({ symbol: sym, action: prevSig.action, prevPrice: prevSnap.price, currPrice: curr.price, delta: round2(delta), correct: ok });
        }

        if (!total) return null;
        return { accuracy: round2((correct / total) * 100), correct, total, breakdown, sessionDate: prev.createdAt };
    } catch (err) {
        console.warn("  ⚠ Performance eval:", err.message);
        return null;
    }
}

async function saveSession(signals, summary, stockData, geminiStance) {
    const snapshot = {};
    for (const [ticker, d] of Object.entries(stockData)) {
        if (!d.price || d.error) continue;
        snapshot[ticker.replace(".KA", "")] = { price: d.price, unrealizedPct: d.unrealizedPct };
    }
    return db.insertOne("signals", {
        createdAt: new Date(),
        signals,
        summary,
        geminiStance: geminiStance || null,
        snapshot,
    });
}

module.exports = { evaluatePerformance, saveSession };