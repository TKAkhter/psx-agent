import moment from "moment-timezone";
import * as db from "./db";
import { loadPortfolio, buildPortfolioMap } from "./portfolio";
import { fetchAllStocks } from "./fetch-data";
import { getSignals, calcPortfolioSummary, TradeSignalMap, TradeSignal } from "./signals";
import { getGeminiInsight } from "./gemini";
import { evaluatePerformance, saveSession } from "./performance";
import { generateReportPdf } from "./pdf-generator";
import { sendEmail } from "./notify/email";
import { sendWhatsAppPdf, sendWhatsAppText } from "./notify/whatsapp";
import { ENV } from "./config";

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
//  BRIEF SUMMARY TEXT  (email body / WhatsApp caption — the full
//  report lives in the attached PDF, this is just a short preview)
// ─────────────────────────────────────────────────────────────

function buildBriefSummary(
  signals: TradeSignalMap,
  summary: ReturnType<typeof calcPortfolioSummary>,
  timeStamp: string
): string {
  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const sign = pnlUp ? "+" : "";
  let txt = `PSX Trading Report — ${timeStamp}\n\n`;
  txt += `Portfolio Value: PKR ${(summary.totalValue ?? 0).toLocaleString()}\n`;
  txt += `P&L: ${sign}PKR ${(summary.totalPnl ?? 0).toLocaleString()} (${sign}${summary.totalPnlPct}%)\n\n`;

  const actionable = Object.entries(signals).filter(
    ([, s]) => s.action !== "SKIP" && s.action !== "HOLD"
  ) as [string, TradeSignal][];

  if (actionable.length) {
    txt += "Today's Signals:\n";
    for (const [sym, s] of actionable) {
      txt += `  ${s.action.replace("_", " ")} ${sym} @ PKR ${s.limitPrice} (target ${s.targetPrice}, stop ${s.stopLoss})\n`;
    }
  } else {
    txt += "No BUY/SELL signals today — all positions HOLD.\n";
  }
  txt += "\nFull analysis, AI insights, and charts in the attached PDF.";
  return txt;
}

// ─────────────────────────────────────────────────────────────
//  CONSOLE SIGNAL SUMMARY
// ─────────────────────────────────────────────────────────────

function printSummary(
  signals: TradeSignalMap,
  summary: ReturnType<typeof calcPortfolioSummary>,
  gemini: Awaited<ReturnType<typeof getGeminiInsight>>
): void {
  const a = gemini?.analysis;
  const m = gemini?.market;
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
    const icon = ICONS[s.action] ?? "•  ";
    const chg =
      s.changePct != null
        ? ` (${s.changePct >= 0 ? "+" : ""}${s.changePct}%)`
        : "";
    const st = s.superTrend
      ? ` ST:${s.superTrend.signal}@${s.superTrend.value}`
      : "";
    console.log(
      `\n${icon} ${sym.padEnd(8)} PKR ${String(s.price).padStart(8)}${chg}  [${
        s.action
      }] ${s.confidence}`
    );
    console.log(`         ${s.instruction}`);
    if (s.action !== "HOLD") {
      console.log(
        `         Target:${s.targetPrice}  Stop:${s.stopLoss}  R/R 1:${s.rrRatio}`
      );
      console.log(
        `         RSI:${s.rsi14}  MFI:${s.mfi}  ROC:${s.roc}%${st}  ${s.trend}  ADX:${s.adx?.adx}(${s.adx?.strength})`
      );
    } else {
      console.log(
        `         RSI:${s.rsi14}  MFI:${s.mfi}  ROC:${s.roc}%${st}  ${s.trend}`
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
  if (a?.overall_stance)
    console.log(`  Gemini Stance : ${a.overall_stance} (${a.emotional_state})`);
  if (a?.top_trade_today) console.log(`  Top Trade     : ${a.top_trade_today}`);
  if (m?.global?.oil_brent_usd)
    console.log(
      `  Oil / PKR-USD : $${m.global.oil_brent_usd}  /  ${m.global.usd_pkr}`
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
    `PSX Agent  ·  ${stampPKT()}  ·  Type:${ENV.PORTFOLIO_TYPE}  ·  Theme:${
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
  for (const s of Object.values(signals)) {
    if (s.action in counts) counts[s.action as keyof typeof counts]++;
  }
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
      ? "  ✓ Phase 1 (market intel + search)"
      : "  ⚠ Phase 1 failed"
  );
  console.log(
    gemini?.analysis
      ? "  ✓ Phase 2 (signal validation + coaching)"
      : "  ⚠ Phase 2 failed"
  );
  if (isFirstSession)
    console.log(
      gemini?.weekly
        ? "  ✓ Phase 3 (weekly strategic review)"
        : "  ⚠ Phase 3 failed"
    );

  // ── 7. Build PDF & Send ────────────────────────────────────
  step(7, "Generating PDF & sending");
  const pdfBuffer = await generateReportPdf(
    stockData,
    signals,
    summary,
    performance,
    gemini,
    timeStamp
  );
  console.log(`  ✓ PDF generated in memory (${(pdfBuffer.length / 1024).toFixed(0)} KB, not written to disk)`);

  const briefSummary = buildBriefSummary(signals, summary, timeStamp);
  const pdfFileName = `PSX-Report-${timeStamp.replace(/[,:\s]+/g, "-")}.pdf`;

  const totalBuys = counts.STRONG_BUY + counts.BUY;
  const totalSells = counts.SELL + counts.STRONG_SELL;
  const pnlSign = (summary.totalPnlPct ?? 0) >= 0 ? "+" : "";
  const subject = `PSX ${timeStamp} · ${totalBuys}B/${totalSells}S · P&L ${pnlSign}${summary.totalPnlPct}%`;

  const [emailRes, waPdfRes] = await Promise.allSettled([
    sendEmail(subject, briefSummary, pdfBuffer, pdfFileName),
    sendWhatsAppPdf(pdfBuffer, pdfFileName, briefSummary.slice(0, 1000)),
  ]);
  if (emailRes.status === "rejected")
    console.error(`  ✗ Email: ${(emailRes.reason as Error).message}`);
  if (waPdfRes.status === "rejected") {
    console.error(`  ✗ WhatsApp PDF: ${(waPdfRes.reason as Error).message}`);
    // Fallback: send brief text so the user isn't left with nothing
    try {
      await sendWhatsAppText(briefSummary);
      console.log("  ✓ WhatsApp fallback text sent (PDF upload failed)");
    } catch (err) {
      console.error(`  ✗ WhatsApp fallback text: ${(err as Error).message}`);
    }
  }

  try {
    await saveSession(
      signals,
      summary,
      stockData,
      gemini?.analysis?.overall_stance ?? null
    );
    console.log("  ✓ Session saved to MongoDB");
  } catch (err) {
    console.warn(`  ⚠ Save failed: ${(err as Error).message}`);
  }

  printSummary(signals, summary, gemini);

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n  ✓ Done in ${elapsed}s  ·  ${stampPKT()}`);
  console.log(`${LINE}\n`);

  await db.closeDB();
  process.exit(0);
}

main().catch(async (err: Error) => {
  console.error("\n💥 Fatal:", err.message, "\n", err.stack);
  await db.closeDB().catch(() => {});
  process.exit(1);
});
