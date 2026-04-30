import moment from "moment-timezone";
import * as db from "./db";
import { loadPortfolio, buildPortfolioMap } from "./portfolio";
import { fetchAllStocks } from "./fetch-data";
import { getSignals, calcPortfolioSummary, TradeSignalMap } from "./signals";
import { getGeminiInsight } from "./gemini";
import { evaluatePerformance, saveSession } from "./performance";
import { generatePdfReport, getPdfPath } from "./pdf-generator";
import { sendEmail } from "./notify/email";
import { sendWhatsAppPdf, sendWhatsAppText } from "./notify/whatsapp";
import { ENV } from "./config";
import type { TradeSignal, ReportData } from "./types";

// ─────────────────────────────────────────────────────────────
//  TIME
// ─────────────────────────────────────────────────────────────

const PKT_ZONE = "Asia/Karachi";
const nowPKT = () => moment().tz(PKT_ZONE);
const stampPKT = () => nowPKT().format("DD MMM YYYY, HH:mm [PKT]");
const isWeekend = () => {
  const d = nowPKT().day();
  return d === 0 || d === 6;
};

// ─────────────────────────────────────────────────────────────
//  CONSOLE HELPERS
// ─────────────────────────────────────────────────────────────

const LINE = "═".repeat(58);
const DASH = "─".repeat(58);
const step = (n: number, label: string) =>
  console.log(`\n${DASH}\n  ${n}/7 — ${label}`);
const head = (label: string) => console.log(`\n${LINE}\n  ${label}\n${LINE}`);

// ─────────────────────────────────────────────────────────────
//  WHATSAPP SUMMARY  (brief text sent before PDF)
// ─────────────────────────────────────────────────────────────

function buildWhatsAppSummary(
  signals: TradeSignalMap,
  summary: ReturnType<typeof calcPortfolioSummary>,
  timeStamp: string
): string {
  const sgn = (n: number | null | undefined) =>
    n == null ? "" : n >= 0 ? "+" : "";
  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const counts: Record<string, number> = {
    STRONG_BUY: 0,
    BUY: 0,
    HOLD: 0,
    SELL: 0,
    STRONG_SELL: 0,
  };
  for (const s of Object.values(signals))
    if (s.action in counts) counts[s.action]++;

  let msg = `🇵🇰 *PSX TRADING REPORT*\n📅 ${timeStamp}\n${"━".repeat(34)}\n\n`;
  msg += `${pnlUp ? "📈" : "📉"} *PORTFOLIO*\n`;
  msg += `  Value:    PKR ${(summary.totalValue ?? 0).toLocaleString()}\n`;
  msg += `  P&L:      ${pnlUp ? "+" : ""}PKR ${(
    summary.totalPnl ?? 0
  ).toLocaleString()} (${sgn(summary.totalPnlPct)}${
    summary.totalPnlPct ?? 0
  }%)\n\n`;
  msg += `📊 *SIGNALS*\n`;
  if (counts.STRONG_BUY) msg += `  📗📗 STRONG BUY: ${counts.STRONG_BUY}\n`;
  if (counts.BUY) msg += `  📗  BUY:         ${counts.BUY}\n`;
  if (counts.HOLD) msg += `  ⏸   HOLD:        ${counts.HOLD}\n`;
  if (counts.SELL) msg += `  📕  SELL:         ${counts.SELL}\n`;
  if (counts.STRONG_SELL) msg += `  📕📕 STRONG SELL: ${counts.STRONG_SELL}\n`;
  msg += `\n`;

  // Brief per-signal one-liners
  for (const [sym, s] of Object.entries(signals)) {
    if (s.action === "SKIP" || s.action === "HOLD") continue;
    const ts = s as TradeSignal;
    msg += `  • *${sym}* ${ts.action.replace("_", " ")} — ${ts.instruction}\n`;
    msg += `    Target: PKR ${ts.targetPrice}  Stop: PKR ${ts.stopLoss}  R/R 1:${ts.rrRatio}\n`;
    msg += `    RSI:${ts.rsi14}  MFI:${ts.mfi}  ST:${
      ts.superTrend?.signal ?? "—"
    }  ${ts.trend}\n\n`;
  }

  msg += `📎 *Full report attached as PDF.*\n`;
  msg += `${"━".repeat(34)}\n_Algo signals + AI — not financial advice_`;
  return msg;
}

// ─────────────────────────────────────────────────────────────
//  CONSOLE SIGNAL SUMMARY
// ─────────────────────────────────────────────────────────────

function printSummary(
  signals: TradeSignalMap,
  summary: ReturnType<typeof calcPortfolioSummary>
): void {
  head("SIGNAL SUMMARY");
  const ICONS: Record<string, string> = {
    STRONG_BUY: "🟢🟢",
    BUY: "🟢  ",
    HOLD: "⏸   ",
    SELL: "🔴  ",
    STRONG_SELL: "🔴🔴",
    SKIP: "⚫  ",
  };
  for (const [sym, s] of Object.entries(signals)) {
    if (s.action === "SKIP") continue;
    const ts = s as TradeSignal;
    const icon = ICONS[ts.action] ?? "•  ";
    const chg =
      ts.changePct != null
        ? ` (${ts.changePct >= 0 ? "+" : ""}${ts.changePct}%)`
        : "";
    const st = ts.superTrend ? ` ST:${ts.superTrend.signal}` : "";
    console.log(
      `\n${icon} ${sym.padEnd(8)} PKR ${String(ts.price).padStart(8)}${chg}  [${
        ts.action
      }] ${ts.confidence}`
    );
    console.log(`         ${ts.instruction}`);
    if (ts.action !== "HOLD") {
      console.log(
        `         Target:${ts.targetPrice}  Stop:${ts.stopLoss}  R/R 1:${ts.rrRatio}`
      );
      console.log(
        `         RSI:${ts.rsi14}  MFI:${ts.mfi}  ROC:${ts.roc}%${st}  Regime:${ts.marketRegime}`
      );
    }
  }
  console.log(`\n${DASH}`);
  const sign = (summary.totalPnlPct ?? 0) >= 0 ? "+" : "";
  console.log(
    `  Portfolio P&L : ${sign}${summary.totalPnlPct}%  (PKR ${(
      summary.totalPnl ?? 0
    ).toLocaleString()})`
  );
  console.log(
    `  Market Value  : PKR ${(summary.totalValue ?? 0).toLocaleString()}`
  );
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startMs = Date.now();
  const pktNow = nowPKT();
  const sessionHour = pktNow.hour() + pktNow.minute() / 60;

  head(
    `PSX Agent v5  ·  ${stampPKT()}  ·  Type:${ENV.PORTFOLIO_TYPE}  ·  Theme:${
      ENV.EMAIL_THEME
    }`
  );
  if (isWeekend()) {
    console.log("\n  🏖  Market closed (weekend)\n");
    process.exit(0);
  }

  // ── 1. Database ───────────────────────────────────────────
  step(1, "Database");
  try {
    await db.connectDB();
  } catch (err) {
    console.error(`  ✗ MongoDB: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── 2. Portfolio ──────────────────────────────────────────
  step(2, "Portfolio");
  const positions = await loadPortfolio();
  const portfolioMap = buildPortfolioMap(positions);

  // ── 3. Market Data ────────────────────────────────────────
  step(
    3,
    `Market data  (${
      ENV.PORTFOLIO_TYPE === "psx" ? "PSXTerminal.com" : "Yahoo Finance"
    })`
  );
  const stockData = await fetchAllStocks(portfolioMap);
  const market = stockData.__market__;
  const loaded = Object.keys(stockData).filter(
    (k) => k !== "__market__" && !("error" in stockData[k])
  ).length;
  console.log(
    `\n  ✓ ${loaded}/${Object.keys(portfolioMap).length} stocks loaded`
  );
  if (market?.kse100)
    console.log(
      `  KSE-100: ${market.kse100.level}  (${
        market.kse100.changePct >= 0 ? "+" : ""
      }${market.kse100.changePct}%)`
    );
  if (market?.breadth)
    console.log(
      `  Breadth: Adv ${market.breadth.advances}  Dec ${market.breadth.declines}  A/D ${market.breadth.adRatio}`
    );
  if (loaded === 0) {
    console.error("  ✗ No stocks loaded");
    await db.closeDB();
    process.exit(1);
  }

  // ── 4. Signals ────────────────────────────────────────────
  step(4, "Computing signals");
  const signals = getSignals(stockData);
  const summary = calcPortfolioSummary(stockData);
  const counts = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
  for (const s of Object.values(signals))
    if (s.action in counts) counts[s.action as keyof typeof counts]++;
  console.log(
    `  STRONG_BUY:${counts.STRONG_BUY}  BUY:${counts.BUY}  HOLD:${counts.HOLD}  SELL:${counts.SELL}  STRONG_SELL:${counts.STRONG_SELL}`
  );
  console.log(
    `  P&L: ${(summary.totalPnlPct ?? 0) >= 0 ? "+" : ""}${
      summary.totalPnlPct
    }%  (PKR ${(summary.totalPnl ?? 0).toLocaleString()})`
  );

  // ── 5. Performance ────────────────────────────────────────
  step(5, "Performance evaluation");
  const performance = await evaluatePerformance(stockData);
  if (performance) {
    console.log(
      `  Accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total})`
    );
    for (const b of performance.breakdown) {
      console.log(
        `    ${b.correct ? "✓" : "✗"} ${b.symbol}: ${b.action} ${b.prevPrice}→${
          b.currPrice
        } (${b.delta >= 0 ? "+" : ""}${b.delta}%)`
      );
    }
  } else {
    console.log("  ℹ  No previous session");
  }

  // ── 6. Gemini ─────────────────────────────────────────────
  const isFirstSession = sessionHour < 11;
  step(6, `Gemini AI (Phase 1+2${isFirstSession ? "+3 weekly" : ""})`);
  const timeStamp = stampPKT();
  const gemini = await getGeminiInsight(
    stockData,
    signals,
    summary,
    performance,
    timeStamp,
    sessionHour
  );
  console.log(
    gemini?.market
      ? "  ✓ Phase 1 (market intel + Search)"
      : "  ⚠ Phase 1 failed"
  );
  console.log(
    gemini?.analysis
      ? "  ✓ Phase 2 (validation + coaching)"
      : "  ⚠ Phase 2 failed"
  );
  if (isFirstSession)
    console.log(
      gemini?.weekly ? "  ✓ Phase 3 (weekly review)" : "  ⚠ Phase 3 failed"
    );

  // ── 7. Generate PDF & Send ────────────────────────────────
  step(7, "Generating PDF & sending notifications");
  const reportData: ReportData = {
    stockData,
    signals,
    summary,
    performance,
    gemini,
    timeStamp,
    sessionHour,
  };
  const pdfPath = getPdfPath(timeStamp);

  try {
    console.log(`  Generating PDF → ${pdfPath}`);
    await generatePdfReport(reportData, pdfPath);
    console.log(
      `  ✓ PDF generated (${Math.round(
        require("fs").statSync(pdfPath).size / 1024
      )}KB)`
    );
  } catch (err) {
    console.error(`  ✗ PDF generation failed: ${(err as Error).message}`);
  }

  // Build WhatsApp text summary (sent before PDF)
  const waText = buildWhatsAppSummary(signals, summary, timeStamp);
  const totalBuys = counts.STRONG_BUY + counts.BUY;
  const totalSells = counts.SELL + counts.STRONG_SELL;
  const pnlSign = (summary.totalPnlPct ?? 0) >= 0 ? "+" : "";
  const subject = `PSX ${timeStamp} · ${totalBuys}B/${totalSells}S · P&L ${pnlSign}${summary.totalPnlPct}%`;

  // Send email (PDF attached) + WhatsApp (text summary then PDF)
  const [emailRes, waTextRes, waPdfRes] = await Promise.allSettled([
    sendEmail(subject, waText, pdfPath),
    sendWhatsAppText(waText),
    sendWhatsAppPdf(pdfPath, `PSX Report ${timeStamp}`),
  ]);
  if (emailRes.status === "rejected")
    console.error(`  ✗ Email:      ${(emailRes.reason as Error).message}`);
  if (waTextRes.status === "rejected")
    console.error(`  ✗ WA text:   ${(waTextRes.reason as Error).message}`);
  if (waPdfRes.status === "rejected")
    console.error(`  ✗ WA PDF:    ${(waPdfRes.reason as Error).message}`);

  // Save session
  try {
    await saveSession(
      signals,
      summary,
      stockData,
      gemini?.analysis?.overall_stance ?? null
    );
    console.log("  ✓ Session saved to MongoDB");
  } catch (err) {
    console.warn(`  ⚠ Save: ${(err as Error).message}`);
  }

  printSummary(signals, summary);
  console.log(
    `\n  ✓ Done in ${((Date.now() - startMs) / 1000).toFixed(
      1
    )}s  ·  ${stampPKT()}`
  );
  console.log(`  📄 Report: ${pdfPath}`);
  console.log(`${LINE}\n`);

  await db.closeDB();
  process.exit(0);
}

main().catch(async (err: Error) => {
  console.error("\n💥 Fatal:", err.message, "\n", err.stack);
  await db.closeDB().catch(() => {});
  process.exit(1);
});
