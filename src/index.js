"use strict";
const moment = require("moment-timezone");
const db = require("./db");
const { loadPortfolio, portfolioToMap } = require("./portfolio");
const { fetchAllStocks } = require("./fetch-data");
const { getSignals, portfolioSummary } = require("./signals");
const { getGeminiInsight } = require("./gemini");
const { evaluatePerformance, saveSignals } = require("./performance");
const { buildHtmlEmail } = require("./templates/email");
const { buildWhatsApp } = require("./templates/whatsapp");
const { sendEmail } = require("./notify/email");
const { sendWhatsApp } = require("./notify/whatsapp");

const PKT = "Asia/Karachi";
const stampPKT = () => moment().tz(PKT).format("DD MMM YYYY, HH:mm [PKT]");
const isWeekend = () => { const d = moment().tz(PKT).day(); return d === 0 || d === 6; };

// ─── Divider helpers ──────────────────────────────────────────
const div = (label = "") => console.log(`\n${"─".repeat(50)}${label ? `  ${label}` : ""}`);
const head = (label) => { console.log(`\n${"═".repeat(52)}`); console.log(`  ${label}`); console.log(`${"═".repeat(52)}`); };

// ─── Main ─────────────────────────────────────────────────────
async function main() {
    const startTime = Date.now();
    head(`PSX Agent  ·  ${stampPKT()}`);

    // Weekend guard
    if (isWeekend()) {
        console.log("\n  🏖  Market closed (weekend) — no action.\n");
        process.exit(0);
    }

    // ── 1. Connect to MongoDB ────────────────────────────────
    div("1/7  Database");
    try {
        await db.connect();
    } catch (err) {
        console.error("  ✗ MongoDB connection failed:", err.message);
        console.error("  Fatal — cannot continue without database.");
        process.exit(1);
    }

    // ── 2. Load Portfolio ────────────────────────────────────
    div("2/7  Portfolio");
    const positions = await loadPortfolio();
    const portfolioMap = portfolioToMap(positions);

    // ── 3. Fetch Market Data ─────────────────────────────────
    div("3/7  Fetching stock data (Yahoo Finance)");
    const stockData = await fetchAllStocks(portfolioMap);
    const loaded = Object.values(stockData).filter(d => !d.error && d.price).length;
    console.log(`  ✓ ${loaded}/${Object.keys(stockData).length} stocks loaded successfully`);

    // ── 4. Compute Signals ───────────────────────────────────
    div("4/7  Computing signals");
    const signals = getSignals(stockData);
    const summary = portfolioSummary(stockData);

    const nSBuy = Object.values(signals).filter(s => s.action === "STRONG_BUY").length;
    const nBuy = Object.values(signals).filter(s => s.action === "BUY").length;
    const nHold = Object.values(signals).filter(s => s.action === "HOLD").length;
    const nSell = Object.values(signals).filter(s => s.action === "SELL").length;
    const nSSell = Object.values(signals).filter(s => s.action === "STRONG_SELL").length;
    console.log(`  ✓ Signals → STRONG_BUY:${nSBuy}  BUY:${nBuy}  HOLD:${nHold}  SELL:${nSell}  STRONG_SELL:${nSSell}`);
    console.log(`  ✓ Portfolio P&L: ${summary.totalPnlPct >= 0 ? "+" : ""}${summary.totalPnlPct}%  (PKR ${(summary.totalPnl || 0).toLocaleString()})`);

    // ── 5. Performance Evaluation ────────────────────────────
    div("5/7  Performance evaluation");
    const performance = await evaluatePerformance(stockData);
    if (performance) {
        console.log(`  ✓ Last session accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total} correct)`);
    } else {
        console.log("  ℹ  No previous session to compare");
    }

    // ── 6. Gemini AI ─────────────────────────────────────────
    div("6/7  Gemini AI (3-phase)");
    const gemini = await getGeminiInsight(stockData, signals, summary, performance, stampPKT());
    if (gemini) {
        const stance = gemini.analysis?.overall_stance;
        const tip = gemini.coaching?.daily_coaching_tip;
        if (stance) console.log(`  ✓ Stance: ${stance}`);
        if (tip) console.log(`  ✓ Coaching tip: ${tip.slice(0, 80)}...`);
    }

    // ── 7. Notify ────────────────────────────────────────────
    div("7/7  Sending notifications");
    const time = stampPKT();
    const htmlEmail = buildHtmlEmail(stockData, signals, summary, performance, gemini, time);
    const waMessage = buildWhatsApp(stockData, signals, summary, gemini, performance, time);

    const totalBuys = nSBuy + nBuy;
    const totalSells = nSell + nSSell;
    const subject = `PSX ${time} · ${totalBuys}B/${totalSells}S · P&L ${summary.totalPnlPct >= 0 ? "+" : ""}${summary.totalPnlPct}%`;

    const [emailResult, waResult] = await Promise.allSettled([
        sendEmail(subject, htmlEmail, waMessage),
        sendWhatsApp(waMessage),
    ]);
    if (emailResult.status === "rejected") console.error("  ✗ Email failed:", emailResult.reason?.message);
    if (waResult.status === "rejected") console.error("  ✗ WhatsApp failed:", waResult.reason?.message);

    // ── Save to MongoDB ───────────────────────────────────────
    try {
        await saveSignals(signals, summary, stockData, gemini?.analysis?.overall_stance);
        console.log("  ✓ Signals saved to MongoDB");
    } catch (err) {
        console.warn("  ⚠ Save failed:", err.message);
    }

    // ── Console Summary ───────────────────────────────────────
    head("SIGNAL SUMMARY");
    for (const [sym, s] of Object.entries(signals)) {
        if (s.action === "SKIP") continue;
        const icon = { STRONG_BUY: "🟢🟢", BUY: "🟢", HOLD: "⏸ ", SELL: "🔴", STRONG_SELL: "🔴🔴" }[s.action] || "•";
        console.log(`${icon} ${s.instruction}`);
        if (s.action !== "HOLD") {
            console.log(`    Target: ${s.targetPrice}  Stop: ${s.stopLoss}  R/R 1:${s.rrRatio}  [${s.confidence}]`);
        }
    }
    console.log(`\nP&L: ${summary.totalPnlPct >= 0 ? "+" : ""}${summary.totalPnlPct}%  ·  PKR ${(summary.totalPnl || 0).toLocaleString()}`);
    if (gemini?.analysis?.overall_stance) console.log(`Gemini: ${gemini.analysis.overall_stance} on PSX`);
    if (gemini?.analysis?.top_conviction_trade) console.log(`Top trade: ${gemini.analysis.top_conviction_trade}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${"═".repeat(52)}`);
    console.log(`  ✓ Done in ${elapsed}s  ·  ${stampPKT()}`);
    console.log(`${"═".repeat(52)}\n`);

    await db.close();
    process.exit(0);
}

main().catch(async (err) => {
    console.error("\n💥 Fatal error:", err);
    await db.close().catch(() => { });
    process.exit(1);
});