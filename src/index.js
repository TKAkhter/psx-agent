"use strict";
const moment = require("moment-timezone");

const db = require("./db");
const { loadPortfolio, buildPortfolioMap } = require("./portfolio");
const { fetchAllStocks } = require("./fetch-data");
const { getSignals, calcPortfolioSummary } = require("./signals");
const { getGeminiInsight } = require("./gemini");
const { evaluatePerformance, saveSession } = require("./performance");
const { buildHtmlEmail } = require("./templates/email-template");
const { buildWhatsAppMessage } = require("./templates/whatsapp-template");
const { sendEmail } = require("./notify/email");
const { sendWhatsApp } = require("./notify/whatsapp");
const { ENV } = require("./config");

// ─────────────────────────────────────────────────────────────
//  TIME UTILITIES
// ─────────────────────────────────────────────────────────────
const PKT_ZONE = "Asia/Karachi";
const stampPKT = () => moment().tz(PKT_ZONE).format("DD MMM YYYY, HH:mm [PKT]");
const isWeekend = () => { const d = moment().tz(PKT_ZONE).day(); return d === 0 || d === 6; };

// ─────────────────────────────────────────────────────────────
//  CONSOLE HELPERS
// ─────────────────────────────────────────────────────────────
const LINE = "═".repeat(54);
const DASH = "─".repeat(54);
const step = (n, label) => console.log(`\n${DASH}\n  Step ${n}/7 — ${label}`);
const head = (label) => console.log(`\n${LINE}\n  ${label}\n${LINE}`);

// ─────────────────────────────────────────────────────────────
//  SIGNAL SUMMARY  (console output)
// ─────────────────────────────────────────────────────────────
function printSummary(signals, summary, gemini) {
    head("SIGNAL SUMMARY");

    const ACTION_ICONS = {
        STRONG_BUY: "🟢🟢",
        BUY: "🟢  ",
        HOLD: "⏸   ",
        SELL: "🔴  ",
        STRONG_SELL: "🔴🔴",
        SKIP: "⚫  ",
    };

    for (const [sym, s] of Object.entries(signals)) {
        if (s.action === "SKIP") continue;
        const icon = ACTION_ICONS[s.action] || "•   ";
        console.log(`\n${icon} ${sym.padEnd(8)} PKR ${String(s.price).padStart(8)}  [${s.action}] ${s.confidence}`);
        console.log(`         ${s.instruction}`);
        if (s.action !== "HOLD") {
            console.log(`         Target: ${s.targetPrice}  Stop: ${s.stopLoss}  R/R 1:${s.rrRatio}`);
            console.log(`         RSI ${s.rsi14}  Stoch ${s.stoch?.k}/${s.stoch?.d}  ADX ${s.adx?.adx}(${s.adx?.strength})  ${s.trend}`);
            if (s.bullReasons?.length) console.log(`         ✓ ${s.bullReasons[0]}`);
            if (s.bearReasons?.length) console.log(`         ✗ ${s.bearReasons[0]}`);
        } else {
            console.log(`         RSI ${s.rsi14}  ${s.trend}  Support: ${s.stopLoss}  Resistance: ${s.targetPrice}`);
        }
    }

    console.log(`\n${DASH}`);
    const pnlSign = (summary.totalPnlPct || 0) >= 0 ? "+" : "";
    console.log(`  Portfolio P&L : ${pnlSign}${summary.totalPnlPct}%  (PKR ${(summary.totalPnl || 0).toLocaleString()})`);
    console.log(`  Market Value  : PKR ${(summary.totalValue || 0).toLocaleString()}`);

    if (gemini?.analysis?.overall_stance) console.log(`  Gemini Stance : ${gemini.analysis.overall_stance}`);
    if (gemini?.analysis?.top_trade_today) console.log(`  Top Trade     : ${gemini.analysis.top_trade_today}`);
    if (gemini?.market?.global?.oil_brent_usd) {
        console.log(`  Oil Brent     : $${gemini.market.global.oil_brent_usd}  PKR/USD: ${gemini.market.global.usd_pkr}`);
    }
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
    const startMs = Date.now();
    head(`PSX Trading Agent  ·  ${stampPKT()}`);

    // Weekend guard
    if (isWeekend()) {
        console.log("\n  🏖  Market closed (weekend) — nothing to do.\n");
        process.exit(0);
    }

    // ── Step 1: Connect MongoDB ──────────────────────────────
    step(1, "Database");
    try {
        await db.connectDB();
    } catch (err) {
        console.error(`  ✗ MongoDB failed: ${err.message}`);
        process.exit(1);
    }

    // ── Step 2: Load Portfolio ───────────────────────────────
    step(2, "Portfolio");
    const positions = await loadPortfolio();
    const portfolioMap = buildPortfolioMap(positions);

    // ── Step 3: Fetch Market Data ────────────────────────────
    step(3, "Fetching stock data (Yahoo Finance)");
    const stockData = await fetchAllStocks(portfolioMap);
    const loadedCount = Object.values(stockData).filter(d => !d.error && d.price).length;
    console.log(`\n  ✓ ${loadedCount} / ${Object.keys(stockData).length} stocks loaded`);

    if (loadedCount === 0) {
        console.error("  ✗ No stocks loaded — aborting.");
        await db.closeDB();
        process.exit(1);
    }

    // ── Step 4: Compute Signals ──────────────────────────────
    step(4, "Computing signals");
    const signals = getSignals(stockData);
    const summary = calcPortfolioSummary(stockData);

    const nStrongBuy = Object.values(signals).filter(s => s.action === "STRONG_BUY").length;
    const nBuy = Object.values(signals).filter(s => s.action === "BUY").length;
    const nHold = Object.values(signals).filter(s => s.action === "HOLD").length;
    const nSell = Object.values(signals).filter(s => s.action === "SELL").length;
    const nStrongSell = Object.values(signals).filter(s => s.action === "STRONG_SELL").length;

    console.log(`  ✓ STRONG_BUY:${nStrongBuy}  BUY:${nBuy}  HOLD:${nHold}  SELL:${nSell}  STRONG_SELL:${nStrongSell}`);
    console.log(`  ✓ P&L: ${(summary.totalPnlPct || 0) >= 0 ? "+" : ""}${summary.totalPnlPct}%  (PKR ${(summary.totalPnl || 0).toLocaleString()})`);

    // ── Step 5: Performance Evaluation ──────────────────────
    step(5, "Performance evaluation");
    const performance = await evaluatePerformance(stockData);
    if (performance) {
        console.log(`  ✓ Last session accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total})`);
        if (performance.breakdown?.length) {
            for (const b of performance.breakdown) {
                const icon = b.correct ? "✓" : "✗";
                console.log(`    ${icon} ${b.symbol}: ${b.action} @ ${b.prevPrice} → ${b.currPrice} (${b.delta >= 0 ? "+" : ""}${b.delta}%)`);
            }
        }
    } else {
        console.log("  ℹ  No previous session to compare");
    }

    // ── Step 6: Gemini AI ────────────────────────────────────
    step(6, "Gemini AI (2-phase with Google Search grounding)");
    const timeStamp = stampPKT();
    const gemini = await getGeminiInsight(stockData, signals, summary, performance, timeStamp);
    if (gemini) {
        console.log(gemini.market ? "  ✓ Phase 1 complete (market intelligence)" : "  ⚠ Phase 1 unavailable");
        console.log(gemini.analysis ? "  ✓ Phase 2 complete (validation + coaching)" : "  ⚠ Phase 2 unavailable");
    }

    // ── Step 7: Build & Send ─────────────────────────────────
    step(7, "Building reports & sending notifications");

    const htmlEmail = buildHtmlEmail(stockData, signals, summary, performance, gemini, timeStamp);
    const waMessage = buildWhatsAppMessage(stockData, signals, summary, gemini, performance, timeStamp);

    const totalBuys = nStrongBuy + nBuy;
    const totalSells = nSell + nStrongSell;
    const pnlSign = (summary.totalPnlPct || 0) >= 0 ? "+" : "";
    const subject = `PSX ${timeStamp} · ${totalBuys}B/${totalSells}S · P&L ${pnlSign}${summary.totalPnlPct}%`;

    // Send notifications concurrently
    const [emailResult, waResult] = await Promise.allSettled([
        sendEmail(subject, htmlEmail, waMessage),
        sendWhatsApp(waMessage),
    ]);
    if (emailResult.status === "rejected") console.error(`  ✗ Email failed: ${emailResult.reason?.message}`);
    if (waResult.status === "rejected") console.error(`  ✗ WhatsApp failed: ${waResult.reason?.message}`);

    // Save session to MongoDB
    try {
        await saveSession(signals, summary, stockData, gemini?.analysis?.overall_stance);
        console.log("  ✓ Session saved to MongoDB");
    } catch (err) {
        console.warn(`  ⚠ Save failed: ${err.message}`);
    }

    // ── Print summary ────────────────────────────────────────
    printSummary(signals, summary, gemini);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`\n  ✓ Completed in ${elapsed}s  ·  ${stampPKT()}`);
    console.log(`${LINE}\n`);

    await db.closeDB();
    process.exit(0);
}

main().catch(async (err) => {
    console.error("\n💥 Fatal error:", err.message);
    console.error(err.stack);
    await db.closeDB().catch(() => { });
    process.exit(1);
});