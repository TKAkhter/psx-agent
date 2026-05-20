import moment from "moment-timezone";
import * as db from "./db";
import { loadPortfolio, buildPortfolioMap }              from "./portfolio";
import { fetchAllStocks, fetchMarketOverview }           from "./fetch-data";
import { getSignals, calcPortfolioSummary }              from "./signals";
import { getGeminiInsight }                              from "./gemini";
import { evaluatePerformance, saveSession,
         loadHistoricalTrends }                          from "./performance";
import { generatePdfReport, getPdfPath }                 from "./pdf-generator";
import { sendEmail }                                     from "./notify/email";
import { sendWhatsAppPdf, sendWhatsAppText }             from "./notify/whatsapp";
import { ENV }                                           from "./config";
import type { TradeSignal, ReportData,
              TradeSignalMap, PortfolioSummary }          from "./types";

// ─────────────────────────────────────────────────────────────
//  TIME
// ─────────────────────────────────────────────────────────────

const PKT_ZONE  = "Asia/Karachi";
const nowPKT    = () => moment().tz(PKT_ZONE);
// "07 May 2026, 09:01 PKT"  — matches requested subject format
const stampPKT  = () => nowPKT().format("DD MMM YYYY, HH:mm [PKT]");
const isWeekend = () => { const d = nowPKT().day(); return d === 0 || d === 6; };

// ─────────────────────────────────────────────────────────────
//  LOGGING HELPERS  (colour-coded, timed)
// ─────────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BLUE   = "\x1b[34m";
const PURPLE = "\x1b[35m";

const LINE   = "═".repeat(60);
const DASH   = "─".repeat(60);

function log(icon: string, color: string, text: string): void {
  console.log(`${color}${icon}  ${text}${RESET}`);
}
function logOk  (text: string) { log("✓", GREEN,  text); }
function logErr (text: string) { log("✗", RED,    text); }
function logWarn(text: string) { log("⚠", YELLOW, text); }
function logInfo(text: string) { log("·", CYAN,   text); }
function logStep(n: number, total: number, label: string, startMs?: number): void {
  const elapsed = startMs ? `  ${DIM}(${((Date.now() - startMs) / 1000).toFixed(1)}s)${RESET}` : "";
  console.log(`\n${DASH}\n${BOLD}${BLUE}  STEP ${n}/${total} — ${label}${RESET}${elapsed}`);
}
function logHead(label: string): void {
  console.log(`\n${BOLD}${LINE}\n  ${label}\n${LINE}${RESET}`);
}

// ─────────────────────────────────────────────────────────────
//  NOTIFICATION SUBJECT  (exact requested format)
//  "PSX 07 May 2026, 09:01 PKT · 2B/1S · P&L +11.1%"
// ─────────────────────────────────────────────────────────────

function buildSubject(
  timeStamp: string,
  counts:    Record<string, number>,
  summary:   PortfolioSummary,
): string {
  const buys  = counts.STRONG_BUY + counts.BUY;
  const sells = counts.SELL + counts.STRONG_SELL;
  const sign  = (summary.totalPnlPct ?? 0) >= 0 ? "+" : "";
  return `PSX ${timeStamp} · ${buys}B/${sells}S · P&L ${sign}${summary.totalPnlPct}%`;
}

// ─────────────────────────────────────────────────────────────
//  WHATSAPP SUMMARY  (brief text precedes PDF)
// ─────────────────────────────────────────────────────────────

function buildWhatsAppSummary(
  signals:   TradeSignalMap,
  summary:   PortfolioSummary,
  timeStamp: string,
): string {
  const sgn   = (n: number | null | undefined) => (n == null ? "" : n >= 0 ? "+" : "");
  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const counts: Record<string, number> = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
  for (const s of Object.values(signals)) if (s.action in counts) counts[s.action]++;

  let msg = `🇵🇰 *PSX TRADING REPORT*\n📅 ${timeStamp}\n${"━".repeat(34)}\n\n`;
  msg    += `${pnlUp ? "📈" : "📉"} *PORTFOLIO*\n`;
  msg    += `  Value:  PKR ${(summary.totalValue ?? 0).toLocaleString()}\n`;
  msg    += `  P&L:    ${pnlUp ? "+" : ""}PKR ${(summary.totalPnl ?? 0).toLocaleString()} (${sgn(summary.totalPnlPct)}${summary.totalPnlPct ?? 0}%)\n\n`;

  msg += `📊 *SIGNALS* — ${counts.STRONG_BUY + counts.BUY}B / ${counts.HOLD}H / ${counts.SELL + counts.STRONG_SELL}S\n`;
  for (const [sym, s] of Object.entries(signals)) {
    if (s.action === "SKIP" || s.action === "HOLD") continue;
    const ts = s as TradeSignal;
    const icon = s.action.includes("BUY") ? "📗" : "📕";
    msg += `${icon} *${sym}* ${ts.action.replace("_", " ")} @ PKR ${ts.limitPrice ?? ts.price}\n`;
    msg += `   Target: ${ts.targetPrice}  Stop: ${ts.stopLoss}  R/R 1:${ts.rrRatio}\n`;
  }

  msg += `\n📎 *Full analysis attached as PDF.*\n`;
  msg += `${"━".repeat(34)}\n_Algo signals + AI — not financial advice_`;
  return msg;
}

// ─────────────────────────────────────────────────────────────
//  CONSOLE SIGNAL SUMMARY  (printed at end)
// ─────────────────────────────────────────────────────────────

function printSignalSummary(signals: TradeSignalMap, summary: PortfolioSummary): void {
  logHead("SIGNAL SUMMARY");

  const ICONS: Record<string, string> = {
    STRONG_BUY: `${GREEN}🟢🟢${RESET}`, BUY:  `${GREEN}🟢  ${RESET}`,
    HOLD:       `${YELLOW}⏸   ${RESET}`,
    SELL:       `${RED}🔴  ${RESET}`,   STRONG_SELL: `${RED}🔴🔴${RESET}`,
    SKIP:       `${DIM}⚫  ${RESET}`,
  };

  for (const [sym, s] of Object.entries(signals)) {
    if (s.action === "SKIP") continue;
    const ts   = s as TradeSignal;
    const icon = ICONS[ts.action] ?? "•  ";
    const chg  = ts.changePct != null ? ` ${ts.changePct >= 0 ? GREEN : RED}(${ts.changePct >= 0 ? "+" : ""}${ts.changePct}%)${RESET}` : "";
    const st   = ts.superTrend ? ` ${ts.superTrend.isBull ? GREEN : RED}ST:${ts.superTrend.signal}${RESET}` : "";
    const ht   = ts.historicalTrend?.priceChange7d != null
      ? ` ${DIM}[7d:${ts.historicalTrend.priceChange7d >= 0 ? "+" : ""}${ts.historicalTrend.priceChange7d}%]${RESET}` : "";

    console.log(`\n${icon} ${BOLD}${sym.padEnd(8)}${RESET} PKR ${BOLD}${String(ts.price).padStart(8)}${RESET}${chg}  [${ts.action}] ${ts.confidence}${ht}`);
    console.log(`         ${ts.instruction}`);
    if (ts.action !== "HOLD") {
      console.log(`         ${GREEN}Target: ${ts.targetPrice}${RESET}  ${RED}Stop: ${ts.stopLoss}${RESET}  ${PURPLE}R/R 1:${ts.rrRatio}${RESET}`);
      console.log(`         RSI:${ts.rsi14}  MFI:${ts.mfi}  ROC:${ts.roc}%${st}  ${ts.trend}  Regime:${ts.marketRegime}`);
    } else {
      console.log(`         RSI:${ts.rsi14}  MFI:${ts.mfi}${st}  ${ts.trend}`);
    }
  }

  console.log(`\n${DASH}`);
  const pnlSign = (summary.totalPnlPct ?? 0) >= 0 ? GREEN + "+" : RED;
  console.log(`  ${BOLD}Portfolio P&L${RESET} : ${pnlSign}${summary.totalPnlPct}%${RESET}  (PKR ${(summary.totalPnl ?? 0).toLocaleString()})`);
  console.log(`  ${BOLD}Market Value${RESET}  : PKR ${(summary.totalValue ?? 0).toLocaleString()}`);
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runStart    = Date.now();
  const pktNow      = nowPKT();
  const sessionHour = pktNow.hour() + pktNow.minute() / 60;
  const timeStamp   = stampPKT();

  logHead(`PSX Agent v7  ·  ${timeStamp}  ·  ${ENV.PORTFOLIO_TYPE.toUpperCase()}  ·  Theme:${ENV.EMAIL_THEME}`);

  if (isWeekend()) {
    logWarn("Market closed (weekend) — nothing to do.");
    process.exit(0);
  }

  // ── STEP 1: Database ───────────────────────────────────────
  const t1 = Date.now();
  logStep(1, 7, "Database connection");
  try {
    await db.connectDB();
    logOk(`Connected to ${ENV.MONGODB_DB}`);
  } catch (err) {
    logErr(`MongoDB failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── STEP 2: Portfolio ──────────────────────────────────────
  logStep(2, 7, "Loading portfolio", t1);
  const positions    = await loadPortfolio();
  const portfolioMap = buildPortfolioMap(positions);
  logOk(`${positions.length} positions loaded  (type: ${ENV.PORTFOLIO_TYPE})`);

  // ── STEP 3: Historical trends from DB ─────────────────────
  logStep(3, 7, "Loading historical trends from DB", Date.now());
  const symbols          = Object.values(portfolioMap).map(p => p.symbol);
  const historicalTrends = await loadHistoricalTrends(symbols);
  if (historicalTrends.length > 0) {
    logOk(`${historicalTrends.length} symbols have historical trend data (last 7 sessions)`);
    for (const t of historicalTrends) {
      const dir = (t.priceChange7d ?? 0) >= 0 ? GREEN : RED;
      logInfo(`  ${t.symbol.padEnd(7)} prev: PKR ${t.prevPrice}  7d: ${dir}${t.priceChange7d ?? "?"}%${RESET}  avgScore7d: ${t.avgScore7d ?? "?"}  lastAction: ${t.prevAction}`);
    }
  } else {
    logInfo("No historical data yet (first run or DB empty)");
  }

  // ── STEP 4: Market data ────────────────────────────────────
  const t4 = Date.now();
  logStep(4, 7, `Fetching market data  (${ENV.PORTFOLIO_TYPE === "psx" ? "PSXTerminal.com" : "Yahoo Finance"})`, Date.now());

  // Fetch market overview (top movers, breadth) in parallel
  const [stockData, marketOverview] = await Promise.all([
    fetchAllStocks(portfolioMap, historicalTrends),
    fetchMarketOverview(),
  ]);

  const market = stockData.__market__;
  const loaded = Object.keys(stockData).filter(k => k !== "__market__" && !("error" in stockData[k])).length;
  const total  = Object.keys(portfolioMap).length;
  logOk(`${loaded}/${total} stocks loaded  (${((Date.now() - t4) / 1000).toFixed(1)}s)`);

  if (market?.kse100) {
    const chgColor = market.kse100.changePct >= 0 ? GREEN : RED;
    logInfo(`KSE-100: ${BOLD}${market.kse100.level}${RESET}  ${chgColor}${market.kse100.changePct >= 0 ? "+" : ""}${market.kse100.changePct}%${RESET}`);
  }
  if (market?.breadth) {
    const adColor = market.breadth.adRatio >= 1 ? GREEN : RED;
    logInfo(`Breadth: ${GREEN}▲ Adv ${market.breadth.advances}${RESET}  ${RED}▼ Dec ${market.breadth.declines}${RESET}  A/D ${adColor}${market.breadth.adRatio}${RESET}`);
  }
  if (marketOverview?.topGainers?.length) {
    logInfo(`Top Gainers: ${marketOverview.topGainers.slice(0, 3).map(m => `${GREEN}${m.symbol}(+${m.changePct}%)${RESET}`).join("  ")}`);
    logInfo(`Top Losers:  ${marketOverview.topLosers.slice(0, 3).map(m => `${RED}${m.symbol}(${m.changePct}%)${RESET}`).join("  ")}`);
  }

  if (loaded === 0) {
    logErr("No stocks loaded — aborting.");
    await db.closeDB();
    process.exit(1);
  }

  // ── STEP 5: Signals ────────────────────────────────────────
  logStep(5, 7, "Computing signals", Date.now());
  const signals = getSignals(stockData);
  const summary = calcPortfolioSummary(stockData);

  const counts: Record<string, number> = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
  for (const s of Object.values(signals)) if (s.action in counts) counts[s.action as keyof typeof counts]++;

  console.log(`\n  Counts:  ${GREEN}STRONG_BUY:${counts.STRONG_BUY}  BUY:${counts.BUY}${RESET}  ${YELLOW}HOLD:${counts.HOLD}${RESET}  ${RED}SELL:${counts.SELL}  STRONG_SELL:${counts.STRONG_SELL}${RESET}`);
  const pnlColor = (summary.totalPnlPct ?? 0) >= 0 ? GREEN : RED;
  console.log(`  P&L:     ${pnlColor}${(summary.totalPnlPct ?? 0) >= 0 ? "+" : ""}${summary.totalPnlPct}%${RESET}  (PKR ${(summary.totalPnl ?? 0).toLocaleString()})`);
  console.log(`  Value:   PKR ${(summary.totalValue ?? 0).toLocaleString()}`);

  // ── STEP 6: Performance + Gemini ──────────────────────────
  logStep(6, 7, "Performance evaluation", Date.now());
  const performance = await evaluatePerformance(stockData);
  if (performance) {
    logOk(`Signal accuracy: ${performance.accuracy}%  (${performance.correct}/${performance.total} correct  ·  last session: ${new Date(performance.sessionDate).toLocaleDateString("en-PK")})`);
    for (const b of performance.breakdown) {
      const icon  = b.correct ? `${GREEN}✓` : `${RED}✗`;
      const delta = b.delta >= 0 ? `${GREEN}+${b.delta}%` : `${RED}${b.delta}%`;
      console.log(`    ${icon}${RESET} ${b.symbol.padEnd(7)} ${b.action.padEnd(11)}  ${b.prevPrice} → ${b.currPrice}  (${delta}${RESET})`);
    }
  } else {
    logInfo("No previous session data");
  }

  const isFirstSession = sessionHour < 11;
  logStep(6, 7, `Gemini AI  (Phase 1+2${isFirstSession ? "+3" : ""}  ·  DB history ${historicalTrends.length > 0 ? "✓" : "✗"})`, Date.now());
  const gemini = await getGeminiInsight(
    stockData, signals, summary, performance,
    marketOverview, timeStamp, sessionHour,
  );
  if (gemini?.market && !gemini.market.raw)
    logOk(`Phase 1 — KSE: ${gemini.market.pakistan.kse100_level}  Oil: $${gemini.market.global.oil_brent_usd}  PKR: ${gemini.market.global.usd_pkr}  Stance: ${gemini.market.overall_stance}`);
  else logWarn("Phase 1 unavailable");
  if (gemini?.analysis && !gemini.analysis.raw)
    logOk(`Phase 2 — ${gemini.analysis.overall_stance}  |  Top: ${gemini.analysis.top_trade_today?.split("—")[0]?.trim()}  |  ${gemini.analysis.emotional_state}`);
  else logWarn("Phase 2 unavailable");
  if (isFirstSession)
    gemini?.weekly ? logOk(`Phase 3 — Grade: ${gemini.weekly.portfolioGrade?.split("—")[0]?.trim()}`) : logWarn("Phase 3 unavailable");

  // ── STEP 7: Generate PDF & Send ────────────────────────────
  logStep(7, 7, "Generating PDF & sending notifications", Date.now());

  const reportData: ReportData = {
    stockData, signals, summary, performance, gemini,
    timeStamp, sessionHour, marketOverview, historicalTrends,
  };

  const pdfPath = getPdfPath(timeStamp);
  let   pdfOk   = false;
  try {
    await generatePdfReport(reportData, pdfPath);
    const sizeKb = Math.round(require("fs").statSync(pdfPath).size / 1024);
    logOk(`PDF generated → ${pdfPath}  (${sizeKb} KB)`);
    pdfOk = true;
  } catch (err) {
    logErr(`PDF failed: ${(err as Error).message}`);
  }

  const subject = buildSubject(timeStamp, counts, summary);
  logInfo(`Subject: ${subject}`);

  const waText = buildWhatsAppSummary(signals, summary, timeStamp);
  const [emailRes, waTextRes, waPdfRes] = await Promise.allSettled([
    sendEmail(subject, waText, pdfOk ? pdfPath : undefined),
    sendWhatsAppText(waText),
    pdfOk ? sendWhatsAppPdf(pdfPath, `PSX Report ${timeStamp}`) : Promise.resolve(),
  ]);

  if (emailRes.status  === "rejected") logErr(`Email:      ${(emailRes.reason  as Error).message}`);
  if (waTextRes.status === "rejected") logErr(`WA text:    ${(waTextRes.reason as Error).message}`);
  if (waPdfRes.status  === "rejected") logErr(`WA PDF:     ${(waPdfRes.reason  as Error).message}`);

  try {
    await saveSession(signals, summary, stockData, gemini?.analysis?.overall_stance ?? null);
    logOk("Session saved to MongoDB");
  } catch (err) {
    logWarn(`Session save failed: ${(err as Error).message}`);
  }

  // ── Final summary ──────────────────────────────────────────
  printSignalSummary(signals, summary);

  const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
  console.log(`\n${GREEN}${BOLD}  ✓ Completed in ${elapsed}s  ·  ${timeStamp}${RESET}`);
  if (pdfOk) console.log(`${DIM}  Report: ${pdfPath}${RESET}`);
  console.log(`${LINE}\n`);

  await db.closeDB();
  process.exit(0);
}

main().catch(async (err: Error) => {
  console.error(`\n${RED}${BOLD}💥 FATAL ERROR${RESET}: ${err.message}\n${err.stack}`);
  await db.closeDB().catch(() => {});
  process.exit(1);
});
