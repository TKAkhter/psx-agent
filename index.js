"use strict";
const moment = require("moment-timezone");

const db = require("./src/db");
const { loadPortfolio, buildPortfolioMap } = require("./src/portfolio");
const { fetchAllStocks } = require("./src/fetch-data");
const { getSignals, calcPortfolioSummary } = require("./src/signals");
const { getGeminiInsight } = require("./src/gemini");
const { evaluatePerformance, saveSession } = require("./src/performance");
const { buildHtmlEmail } = require("./src/templates/email-template");
const { buildWhatsAppMessage } = require("./src/templates/whatsapp-template");
const { sendEmail } = require("./src/notify/email");
const { sendWhatsApp } = require("./src/notify/whatsapp");
const { ENV } = require("./src/config");

// ─────────────────────────────────────────────────────────────
//  TIME
// ─────────────────────────────────────────────────────────────
const PKT_ZONE = "Asia/Karachi";
const stampPKT = () => moment().tz(PKT_ZONE).format("DD MMM YYYY, HH:mm [PKT]");
const isWeekend = () => { const d = moment().tz(PKT_ZONE).day(); return d === 0 || d === 6; };

// ─────────────────────────────────────────────────────────────
//  CONSOLE HELPERS
// ─────────────────────────────────────────────────────────────
const LINE = "═".repeat(56);
const DASH = "─".repeat(56);
const step = (n, label) => console.log(`\n${DASH}\n  ${n}/7 — ${label}`);
const head = (label) => console.log(`\n${LINE}\n  ${label}\n${LINE}`);

// ─────────────────────────────────────────────────────────────
//  CONSOLE SIGNAL SUMMARY
// ─────────────────────────────────────────────────────────────
function printSummary(signals, summary, gemini) {
    const { expandAnalysis, expandMarket } = require("./src/gemini");
    const a = expandAnalysis(gemini?.analysis);
    const m = expandMarket(gemini?.market);

    head("SIGNAL SUMMARY");
    const ICONS = { STRONG_BUY: "🟢🟢", BUY: "🟢  ", HOLD: "⏸   ", SELL: "🔴  ", STRONG_SELL: "🔴🔴", SKIP: "⚫  " };

    for (const [sym, s] of Object.entries(signals)) {
        if (s.action === "SKIP") continue;
        const icon = ICONS[s.action] || "•  ";
        const chg = s.changePct != null ? ` (${s.changePct >= 0 ? "+" : ""}${s.changePct}%)` : "";
        console.log(`\n${icon} ${sym.padEnd(8)} PKR ${String(s.price).padStart(8)}${chg}  [${s.action}] ${s.confidence}`);
        console.log(`         ${s.instruction}`);
        if (s.action !== "HOLD") {
            console.log(`         Target: ${s.targetPrice}  Stop: ${s.stopLoss}  R/R 1:${s.rrRatio}`);
            console.log(`         RSI ${s.rsi14}  ${s.trend}  ADX ${s.adx?.adx}(${s.adx?.strength})`);
        }
    }

    console.log(`\n${DASH}`);
    const sign = (summary.totalPnlPct || 0) >= 0 ? "+" : "";
    console.log(`  Portfolio  P&L : ${sign}${summary.totalPnlPct}%  (PKR ${(summary.totalPnl || 0).toLocaleString()})`);
    console.log(`  Market Value   : PKR ${(summary.totalValue || 0).toLocaleString()}`);
    if (a?.overall_stance) console.log(`  Gemini Stance  : ${a.overall_stance}`);
    if (a?.top_trade_today) console.log(`  Top Trade      : ${a.top_trade_today}`);
    if (m?.global?.oil_brent_usd) console.log(`  Oil / PKR-USD  : $${m.global.oil_brent_usd}  /  ${m.global.usd_pkr}`);
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
    const startMs = Date.now();
    head(`PSX Trading Agent  ·  ${stampPKT()}  ·  Theme: ${ENV.EMAIL_THEME}`);

    if (isWeekend()) {
        console.log("\n  🏖  Market closed (weekend)\n");
        process.exit(0);
    }

    // ── 1. MongoDB ────────────────────────────────────────────
    step(1, "Database");
    try {
        await db.connectDB();
    } catch (err) {
        console.error(`  ✗ MongoDB: ${err.message}`);
        process.exit(1);
    }

    // ── 2. Portfolio ──────────────────────────────────────────
    step(2, "Portfolio");
    const positions = await loadPortfolio();
    const portfolioMap = buildPortfolioMap(positions);

    // ── 3. Market Data ────────────────────────────────────────
    step(3, "Market data  (PSXTerminal.com + Yahoo fallback)");
    const stockData = await fetchAllStocks(portfolioMap);
    const market = stockData.__market__;

    const loaded = Object.keys(stockData).filter(k => k !== "__market__" && !stockData[k].error && stockData[k].price).length;
    const total = Object.keys(portfolioMap).length;
    console.log(`\n  ✓ ${loaded}/${total} stocks loaded`);
    if (market?.kse100) console.log(`  KSE-100: ${market.kse100.level}  (${market.kse100.changePct >= 0 ? "+" : ""}${market.kse100.changePct}%)`);
    if (market?.breadth) console.log(`  Breadth: Adv ${market.breadth.advances}  Dec ${market.breadth.declines}  A/D ${market.breadth.adRatio}`);

    if (loaded === 0) { console.error("  ✗ No stocks loaded"); await db.closeDB(); process.exit(1); }

    // ── 4. Signals ────────────────────────────────────────────
    step(4, "Computing signals");
    const signals = getSignals(stockData);
    const summary = calcPortfolioSummary(stockData);

    const counts = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
    for (const s of Object.values(signals)) if (counts[s.action] !== undefined) counts[s.action]++;
    console.log(`  STRONG_BUY:${counts.STRONG_BUY}  BUY:${counts.BUY}  HOLD:${counts.HOLD}  SELL:${counts.SELL}  STRONG_SELL:${counts.STRONG_SELL}`);
    console.log(`  P&L: ${(summary.totalPnlPct || 0) >= 0 ? "+" : ""}${summary.totalPnlPct}%  (PKR ${(summary.totalPnl || 0).toLocaleString()})`);

    // ── 5. Performance ────────────────────────────────────────
    step(5, "Performance evaluation");
    const performance = await evaluatePerformance(stockData);
    if (performance) {
        console.log(`  Accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total})`);
        for (const b of (performance.breakdown || [])) {
            console.log(`    ${b.correct ? "✓" : "✗"} ${b.symbol}: ${b.action} ${b.prevPrice}→${b.currPrice} (${b.delta >= 0 ? "+" : ""}${b.delta}%)`);
        }
    } else {
        console.log("  ℹ  No previous session");
    }

    // ── 6. Gemini ─────────────────────────────────────────────
    step(6, "Gemini AI (2-phase: Search-grounded intel + validation)");
    const timeStamp = stampPKT();
    const gemini = await getGeminiInsight(stockData, signals, summary, performance, timeStamp);
    console.log(gemini?.market ? "  ✓ Phase 1 complete" : "  ⚠ Phase 1 failed");
    console.log(gemini?.analysis ? "  ✓ Phase 2 complete" : "  ⚠ Phase 2 failed");

    // ── 7. Send ───────────────────────────────────────────────
    step(7, "Building & sending");
    const htmlEmail = buildHtmlEmail(stockData, signals, summary, performance, gemini, timeStamp);
    const waMsg = buildWhatsAppMessage(stockData, signals, summary, gemini, performance, timeStamp);

    const totalBuys = counts.STRONG_BUY + counts.BUY;
    const totalSells = counts.SELL + counts.STRONG_SELL;
    const pnlSign = (summary.totalPnlPct || 0) >= 0 ? "+" : "";
    const subject = `PSX ${timeStamp} · ${totalBuys}B/${totalSells}S · P&L ${pnlSign}${summary.totalPnlPct}% · ${ENV.EMAIL_THEME} theme`;

    const [emailRes, waRes] = await Promise.allSettled([
        sendEmail(subject, htmlEmail, waMsg),
        sendWhatsApp(waMsg),
    ]);
    if (emailRes.status === "rejected") console.error(`  ✗ Email: ${emailRes.reason?.message}`);
    if (waRes.status === "rejected") console.error(`  ✗ WhatsApp: ${waRes.reason?.message}`);

    // Save session
    try {
        await saveSession(signals, summary, stockData, gemini?.analysis?.stance || gemini?.analysis?.overall_stance);
        console.log("  ✓ Session saved");
    } catch (err) {
        console.warn(`  ⚠ Save: ${err.message}`);
    }

    printSummary(signals, summary, gemini);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`\n  ✓ Done in ${elapsed}s  ·  ${stampPKT()}`);
    console.log(`${LINE}\n`);

    await db.closeDB();
    process.exit(0);
}

main().catch(async (err) => {
    console.error("\n💥 Fatal:", err.message, "\n", err.stack);
    await db.closeDB().catch(() => { });
    process.exit(1);
});