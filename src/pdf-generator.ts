import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import type {
  ReportData, TradeSignal, StockData, ValidationEntry,
  MarketIntelligence, SignalAnalysis, WeeklyReview,
} from "./types";

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────

const L   = 36;           // left margin
const R   = 559;          // right margin
const W   = R - L;        // usable width  (523px)
const MID = L + W / 2;    // centre        (297px)
const ROW = 14;           // standard row height

const C = {
  green:   "#15803d", greenBg: "#f0fdf4",
  red:     "#dc2626", redBg:   "#fef2f2",
  amber:   "#b45309", amberBg: "#fffbeb",
  blue:    "#1d4ed8", blueBg:  "#eff6ff",
  purple:  "#6d28d9", purpleBg:"#f5f3ff",
  dark:    "#0f172a",
  grey:    "#334155",
  mute:    "#64748b",
  faint:   "#cbd5e1",
  white:   "#ffffff",
  pageBg:  "#f8fafc",
};

// ─────────────────────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────────────────────

const sgn  = (n: number | null | undefined) => (n == null ? "" : n >= 0 ? "+" : "");
const pct  = (n: number | null | undefined) => n == null ? "—" : `${sgn(n)}${n}%`;
const pkr  = (n: number | null | undefined) => n == null ? "—" : `PKR ${n.toLocaleString()}`;
const safe = (v: unknown) => String(v ?? "—").slice(0, 120);

function actionColor(action: string): string {
  if (action === "STRONG_BUY")  return C.green;
  if (action === "BUY")          return C.green;
  if (action === "STRONG_SELL") return C.red;
  if (action === "SELL")         return C.red;
  return C.amber;
}

function actionBg(action: string): string {
  if (action === "STRONG_BUY" || action === "BUY")   return C.greenBg;
  if (action === "STRONG_SELL" || action === "SELL") return C.redBg;
  return C.amberBg;
}

function trendColor(t: string): string {
  if (t === "STRONG_BULL" || t === "BULL")   return C.green;
  if (t === "STRONG_BEAR" || t === "BEAR")   return C.red;
  if (t === "SIDEWAYS")                       return C.amber;
  return C.mute;
}

// ─────────────────────────────────────────────────────────────
//  DOCUMENT DRAWING PRIMITIVES
// ─────────────────────────────────────────────────────────────

interface Doc {
  // PDFKit has a complex API — we type just what we use
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
  y: number;
  page: { height: number; width: number };
}

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > doc.page.height - 50) doc.addPage();
}

/** Thin horizontal rule */
function hr(doc: Doc, color = C.faint): void {
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(color).lineWidth(0.4).stroke();
  doc.y += 5;
}

/** Full-width coloured section banner */
function banner(doc: Doc, title: string, color: string, icon = ""): void {
  ensureSpace(doc, 24);
  doc.rect(L, doc.y, W, 18).fill(color);
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor(C.white)
     .text(`${icon ? icon + "  " : ""}${title}`, L + 6, doc.y + 4, { width: W - 10 });
  doc.y += 22;
  doc.fillColor(C.dark);
}

/** Sub-header (no background, just label text) */
function subHead(doc: Doc, title: string, color = C.mute): void {
  ensureSpace(doc, 16);
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(color).text(title.toUpperCase(), L, doc.y);
  doc.y += 11;
}

/**
 * One label-value row — perfectly aligned using absolute x positions.
 * labelW: width reserved for label column (default 140)
 */
function row(doc: Doc, label: string, value: string, valueColor = C.dark, labelW = 140): void {
  ensureSpace(doc, ROW);
  const y = doc.y;
  doc.fontSize(7.5).font("Helvetica").fillColor(C.mute).text(label, L, y, { width: labelW, lineBreak: false });
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(valueColor).text(value, L + labelW + 4, y, { width: W - labelW - 4, lineBreak: false });
  doc.y = y + ROW;
}

/** Two-column row (for side-by-side key metrics) */
function row2(doc: Doc, l1: string, v1: string, l2: string, v2: string, v1c = C.dark, v2c = C.dark): void {
  ensureSpace(doc, ROW);
  const y = doc.y;
  const half = W / 2 - 4;
  const lw   = 80;
  doc.fontSize(7.5).font("Helvetica").fillColor(C.mute).text(l1, L,         y, { width: lw, lineBreak: false });
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(v1c).text(v1,  L + lw + 2, y, { width: half - lw - 2, lineBreak: false });
  doc.fontSize(7.5).font("Helvetica").fillColor(C.mute).text(l2, MID + 4,   y, { width: lw, lineBreak: false });
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(v2c).text(v2,  MID + lw + 6, y, { width: half - lw - 2, lineBreak: false });
  doc.y = y + ROW;
}

/** Coloured pill/badge inline */
function badge(doc: Doc, text: string, color: string, bgColor: string, x: number, y: number): void {
  const w = Math.min(80, text.length * 5 + 8);
  doc.rect(x, y - 1, w, 11).fill(bgColor);
  doc.fontSize(7).font("Helvetica-Bold").fillColor(color).text(text, x + 4, y + 1, { width: w - 8, lineBreak: false });
}

/** Render a text paragraph with word wrap */
function para(doc: Doc, text: string, color = C.dark, indent = 0): void {
  if (!text) return;
  ensureSpace(doc, 20);
  doc.fontSize(7.5).font("Helvetica").fillColor(color)
     .text(safe(text), L + indent, doc.y, { width: W - indent });
  doc.y += 6;
}

/** Small horizontal progress bar */
function bar(doc: Doc, x: number, y: number, value: number, maxValue: number, width: number, color: string): void {
  doc.rect(x, y, width, 7).fill(C.faint);
  const filled = Math.max(0, Math.min(width, (value / maxValue) * width));
  if (filled > 0) doc.rect(x, y, filled, 7).fill(color);
}

// ─────────────────────────────────────────────────────────────
//  PART 1: COVER + GENERAL MARKET ANALYSIS
// ─────────────────────────────────────────────────────────────

function renderCover(
  doc:         Doc,
  timeStamp:   string,
  summary:     ReportData["summary"],
  performance: ReportData["performance"],
  signals:     ReportData["signals"],
): void {
  // ── Masthead
  doc.rect(L, 36, W, 72).fill(C.dark);
  doc.fontSize(22).font("Helvetica-Bold").fillColor(C.white).text("PSX Trading Report", L + 12, 50);
  doc.fontSize(9).font("Helvetica").fillColor(C.faint).text(timeStamp, L + 12, 76);
  doc.fontSize(7.5).font("Helvetica").fillColor(C.faint).text("Pakistan Stock Exchange  ·  KSE-100 Portfolio Analysis", L + 12, 90);

  // Action summary badges
  const counts: Record<string, number> = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
  for (const s of Object.values(signals)) if (s.action in counts) counts[s.action]++;
  const pills = [["SB", counts.STRONG_BUY, C.green], ["B", counts.BUY, "#22c55e"], ["H", counts.HOLD, C.amber], ["S", counts.SELL, "#f97316"], ["SS", counts.STRONG_SELL, C.red]] as [string, number, string][];
  let bx = R - 10;
  for (const [lbl, cnt, col] of [...pills].reverse()) {
    if (cnt === 0) continue;
    const bw = 28;
    bx -= bw + 4;
    doc.rect(bx, 52, bw, 14).fill(col);
    doc.fontSize(7).font("Helvetica-Bold").fillColor(C.white).text(`${lbl}:${cnt}`, bx + 2, 56, { width: bw - 4, align: "center" });
  }
  doc.y = 120;

  // ── Portfolio snapshot
  banner(doc, "PORTFOLIO SNAPSHOT", C.blue);
  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  row2(doc, "Invested",    pkr(summary.totalCost),           "Market Value",  pkr(summary.totalValue));
  row2(doc, "P&L (PKR)",   `${pnlUp?"+":""}${pkr(summary.totalPnl)}`,
            "P&L (%)",     pct(summary.totalPnlPct), C.dark, pnlUp ? C.green : C.red);
  if (performance) {
    row2(doc, "Signals Accuracy", `${performance.accuracy}% (${performance.correct}/${performance.total})`,
              "Last Session",     performance.sessionDate ? new Date(performance.sessionDate).toLocaleDateString() : "—", C.purple, C.mute);
  }
  row2(doc, "Buys/Holds",  `${counts.STRONG_BUY + counts.BUY} / ${counts.HOLD}`,
            "Sells",        String(counts.SELL + counts.STRONG_SELL),
            (counts.STRONG_BUY + counts.BUY) > 0 ? C.green : C.dark,
            (counts.SELL + counts.STRONG_SELL) > 0 ? C.red : C.dark);
  doc.y += 4;

  // Sector allocation mini bars
  subHead(doc, "Sector Allocation");
  for (const [sec, wt] of Object.entries(summary.sectorWeights).sort(([,a],[,b]) => b - a)) {
    ensureSpace(doc, ROW);
    const y = doc.y;
    doc.fontSize(7.5).font("Helvetica").fillColor(C.grey).text(sec, L, y, { width: 110, lineBreak: false });
    bar(doc, L + 115, y + 1, wt, 100, 200, C.blue);
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.dark).text(`${wt}%`, L + 320, y, { lineBreak: false });
    doc.y = y + ROW;
  }
  doc.y += 4;
}

// ─────────────────────────────────────────────────────────────
//  PART 1B: GENERAL MARKET ANALYSIS  (AI-powered)
// ─────────────────────────────────────────────────────────────

function renderMarketAnalysis(doc: Doc, m: MarketIntelligence, a: SignalAnalysis): void {
  doc.addPage();
  banner(doc, "GENERAL MARKET ANALYSIS", C.purple, "🤖");
  doc.fontSize(7).font("Helvetica").fillColor(C.mute).text("Powered by Gemini AI with Google Search grounding", L, doc.y); doc.y += 10;

  // Headline
  if (m.today_headline) {
    ensureSpace(doc, 28);
    doc.rect(L, doc.y, W, 20).fill(C.purpleBg);
    doc.fontSize(8.5).font("Helvetica-BoldOblique").fillColor(C.purple)
       .text(`"${safe(m.today_headline)}"`, L + 6, doc.y + 5, { width: W - 12 });
    doc.y += 26;
  }

  // General market analysis paragraph
  if (a.general_market_analysis) {
    subHead(doc, "Market Overview");
    para(doc, a.general_market_analysis);
    doc.y += 2;
  }

  // Global + Pakistan in two tight columns
  ensureSpace(doc, 80);
  const colY = doc.y;
  const colW = W / 2 - 8;

  // LEFT: Global
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.blue).text("GLOBAL MARKETS", L, colY); doc.y = colY + 12;
  const globalItems = [
    ["Brent Oil",   m.global.oil_brent_usd ? `$${m.global.oil_brent_usd} (${m.global.oil_trend})` : "—", m.global.oil_trend === "Rising" ? C.green : m.global.oil_trend === "Falling" ? C.red : C.dark],
    ["PKR/USD",     m.global.usd_pkr ?? "—", C.dark],
    ["Fed Stance",  m.global.fed_stance ?? "—", C.dark],
    ["US 10Y",      m.global.us_10y_yield ?? "—", C.dark],
    ["EM Flows",    m.global.em_flows ?? "—", m.global.em_flows === "Inflows" ? C.green : m.global.em_flows === "Outflows" ? C.red : C.dark],
    ["Sentiment",   m.global.sentiment ?? "—", m.global.sentiment === "Risk-On" ? C.green : m.global.sentiment === "Risk-Off" ? C.red : C.amber],
  ] as [string, string, string][];
  for (const [lbl, val, col] of globalItems) {
    ensureSpace(doc, ROW);
    const y = doc.y;
    doc.fontSize(7).font("Helvetica").fillColor(C.mute).text(lbl, L, y, { width: 70, lineBreak: false });
    doc.fontSize(7).font("Helvetica-Bold").fillColor(col).text(val, L + 72, y, { width: colW - 72, lineBreak: false });
    doc.y = y + 12;
  }
  const leftY2 = doc.y;

  // RIGHT: Pakistan
  doc.y = colY;
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.blue).text("PAKISTAN MACRO", MID + 4, colY); doc.y = colY + 12;
  const pkItems = [
    ["KSE-100",  m.pakistan.kse100_level ? `${m.pakistan.kse100_level} (${m.pakistan.kse100_chg}%)` : "—", C.dark],
    ["SBP Rate", m.pakistan.sbp_rate ? `${m.pakistan.sbp_rate} (${m.pakistan.sbp_outlook})` : "—", C.dark],
    ["CPI",      m.pakistan.cpi ? `${m.pakistan.cpi} — ${m.pakistan.cpi_trend}` : "—", C.dark],
    ["IMF",      m.pakistan.imf_program ?? "—", m.pakistan.imf_program === "OnTrack" ? C.green : m.pakistan.imf_program === "AtRisk" ? C.red : C.dark],
    ["FX Res.",  m.pakistan.fx_reserves ? `$${m.pakistan.fx_reserves}bn` : "—", C.dark],
    ["PKR Out.", m.pakistan.pkr_outlook ?? "—", m.pakistan.pkr_outlook === "Stable" ? C.green : C.red],
  ] as [string, string, string][];
  for (const [lbl, val, col] of pkItems) {
    ensureSpace(doc, ROW);
    const y = doc.y;
    doc.fontSize(7).font("Helvetica").fillColor(C.mute).text(lbl, MID + 4, y, { width: 60, lineBreak: false });
    doc.fontSize(7).font("Helvetica-Bold").fillColor(col).text(val, MID + 66, y, { width: colW - 60, lineBreak: false });
    doc.y = y + 12;
  }
  doc.y = Math.max(leftY2, doc.y) + 6;
  hr(doc);

  // Macro risks / tailwinds
  if (m.pakistan.key_risks.length || m.pakistan.key_tailwinds.length) {
    ensureSpace(doc, 30);
    const ry = doc.y;
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.red).text("KEY RISKS", L, ry);
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.green).text("TAILWINDS", MID + 4, ry);
    doc.y = ry + 12;
    const maxLen = Math.max(m.pakistan.key_risks.length, m.pakistan.key_tailwinds.length);
    for (let i = 0; i < maxLen; i++) {
      ensureSpace(doc, ROW);
      const y = doc.y;
      if (m.pakistan.key_risks[i])     doc.fontSize(7).font("Helvetica").fillColor(C.red).text(`⚠ ${safe(m.pakistan.key_risks[i])}`, L, y, { width: colW, lineBreak: false });
      if (m.pakistan.key_tailwinds[i]) doc.fontSize(7).font("Helvetica").fillColor(C.green).text(`✓ ${safe(m.pakistan.key_tailwinds[i])}`, MID + 4, y, { width: colW, lineBreak: false });
      doc.y = y + 12;
    }
    doc.y += 4;
    hr(doc);
  }

  // Global key drivers
  if (m.global.key_drivers.length) {
    subHead(doc, "Key Global Drivers");
    for (const d of m.global.key_drivers) {
      ensureSpace(doc, ROW);
      doc.fontSize(7.5).font("Helvetica").fillColor(C.grey).text(`• ${safe(d)}`, L + 4, doc.y, { width: W - 4 }); doc.y += 11;
    }
    doc.y += 2;
  }

  // Sector outlook — clean table
  if (Object.keys(m.sector_outlook).length) {
    hr(doc);
    subHead(doc, "Sector Outlook");
    for (const [sec, val] of Object.entries(m.sector_outlook)) {
      ensureSpace(doc, 13);
      const y   = doc.y;
      const v   = String(val);
      const dir = v.startsWith("Bull") ? "Bull" : v.startsWith("Bear") ? "Bear" : "Neutral";
      const col = dir === "Bull" ? C.green : dir === "Bear" ? C.red : C.amber;
      const bg  = dir === "Bull" ? C.greenBg : dir === "Bear" ? C.redBg : C.amberBg;

      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.dark).text(sec, L, y, { width: 90, lineBreak: false });
      const bw = 40;
      doc.rect(L + 95, y - 1, bw, 11).fill(bg);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(col).text(dir, L + 97, y + 1, { width: bw - 4, lineBreak: false });
      // Reason after badge
      const reason = v.replace(/^(Bull|Bear|Neutral)\|?/, "").trim();
      if (reason) doc.fontSize(7).font("Helvetica").fillColor(C.mute).text(reason, L + 142, y, { width: W - 142, lineBreak: false });
      doc.y = y + 13;
    }
    doc.y += 2;
  }
}

// ─────────────────────────────────────────────────────────────
//  PART 2: PORTFOLIO ANALYSIS  (AI health + positions table)
// ─────────────────────────────────────────────────────────────

function renderPortfolioAnalysis(
  doc:     Doc,
  a:       SignalAnalysis,
  weekly:  WeeklyReview | null | undefined,
  signals: ReportData["signals"],
): void {
  doc.addPage();
  banner(doc, "PORTFOLIO ANALYSIS", C.blue, "📊");

  // AI Portfolio health
  if (a.portfolio_health) {
    const h = a.portfolio_health;
    subHead(doc, "AI Portfolio Assessment", C.purple);
    if (h.pnl_comment)          para(doc, h.pnl_comment, C.dark);
    if (h.concentration_detail) para(doc, h.concentration_detail, C.grey);
    doc.y += 2;
    if (h.best_positioned)   row(doc, "Best Positioned",  safe(h.best_positioned), C.green, 120);
    if (h.biggest_risk)       row(doc, "Biggest Risk",     safe(h.biggest_risk),    C.red,   120);
    if (a.macro_impact)       { doc.y += 2; subHead(doc, "Macro Impact on Portfolio"); para(doc, a.macro_impact, C.grey); }
    if (a.sector_rotation)    row(doc, "Sector Rotation",  safe(a.sector_rotation), C.blue,  120);
    doc.y += 2;
  }

  // Top trade / Avoid today
  if (a.top_trade_today || a.avoid_today) {
    ensureSpace(doc, 40);
    const y = doc.y;
    if (a.top_trade_today) {
      doc.rect(L, y, W / 2 - 4, 30).fill(C.greenBg);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(C.green).text("⭐ TOP TRADE TODAY", L + 4, y + 3, { width: W / 2 - 12 });
      doc.fontSize(7.5).font("Helvetica").fillColor(C.dark).text(safe(a.top_trade_today), L + 4, y + 14, { width: W / 2 - 12, lineBreak: false });
    }
    if (a.avoid_today) {
      doc.rect(MID + 4, y, W / 2 - 4, 30).fill(C.redBg);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(C.red).text("🚫 AVOID TODAY", MID + 8, y + 3, { width: W / 2 - 12 });
      doc.fontSize(7.5).font("Helvetica").fillColor(C.dark).text(safe(a.avoid_today), MID + 8, y + 14, { width: W / 2 - 12, lineBreak: false });
    }
    doc.y = y + 36;
  }

  // Daily tip
  if (a.daily_tip) {
    ensureSpace(doc, 22);
    doc.rect(L, doc.y, W, 18).fill(C.purpleBg);
    doc.fontSize(7).font("Helvetica-Bold").fillColor(C.purple).text("🎓 AI TIP:", L + 4, doc.y + 3, { continued: true });
    doc.fontSize(7).font("Helvetica").fillColor(C.dark).text("  " + safe(a.daily_tip), { lineBreak: false });
    doc.y += 24;
  }

  hr(doc);

  // Positions summary table
  subHead(doc, "All Positions at a Glance");
  ensureSpace(doc, 16);

  // Table header
  const cols = { sym: L, action: L+50, price: L+110, pnl: L+170, rsi: L+225, mfi: L+260, st: L+295, trend: L+340, score: L+415, target: L+450 };
  const hy = doc.y;
  doc.rect(L, hy, W, 12).fill(C.dark);
  doc.fontSize(6.5).font("Helvetica-Bold").fillColor(C.white);
  doc.text("SYM",    cols.sym,    hy+2, { width: 48,  lineBreak: false });
  doc.text("ACTION", cols.action, hy+2, { width: 55,  lineBreak: false });
  doc.text("PRICE",  cols.price,  hy+2, { width: 55,  lineBreak: false });
  doc.text("P&L%",   cols.pnl,    hy+2, { width: 50,  lineBreak: false });
  doc.text("RSI",    cols.rsi,    hy+2, { width: 32,  lineBreak: false });
  doc.text("MFI",    cols.mfi,    hy+2, { width: 32,  lineBreak: false });
  doc.text("ST",     cols.st,     hy+2, { width: 42,  lineBreak: false });
  doc.text("TREND",  cols.trend,  hy+2, { width: 72,  lineBreak: false });
  doc.text("SCORE",  cols.score,  hy+2, { width: 38,  lineBreak: false });
  doc.text("TARGET", cols.target, hy+2, { width: 70,  lineBreak: false });
  doc.y = hy + 14;

  let rowAlt = false;
  for (const [sym, sig] of Object.entries(signals)) {
    if (sig.action === "SKIP") continue;
    ensureSpace(doc, 13);
    const ts  = sig as TradeSignal;
    const ry  = doc.y;
    const ac  = actionColor(ts.action);
    const pc2 = (ts.unrealizedPct ?? 0) >= 0 ? C.green : C.red;

    if (rowAlt) doc.rect(L, ry, W, 13).fill("#f1f5f9");
    rowAlt = !rowAlt;

    doc.fontSize(7).font("Helvetica-Bold").fillColor(C.dark);
    doc.text(sym,                                  cols.sym,    ry+2, { width: 48,  lineBreak: false });
    doc.fillColor(ac).text(ts.action.replace("_"," "), cols.action, ry+2, { width: 55, lineBreak: false });
    doc.fillColor(C.dark).text(`${ts.price}`,      cols.price,  ry+2, { width: 55,  lineBreak: false });
    doc.fillColor(pc2).text(pct(ts.unrealizedPct), cols.pnl,    ry+2, { width: 50,  lineBreak: false });
    doc.fillColor(C.dark).font("Helvetica");
    doc.text(`${ts.rsi14??'—'}`,                   cols.rsi,    ry+2, { width: 32,  lineBreak: false });
    doc.text(`${ts.mfi??'—'}`,                     cols.mfi,    ry+2, { width: 32,  lineBreak: false });
    const stCol = ts.superTrend?.isBull ? C.green : ts.superTrend ? C.red : C.mute;
    doc.fillColor(stCol).font("Helvetica-Bold").text(ts.superTrend?.signal ?? "—", cols.st, ry+2, { width: 42, lineBreak: false });
    doc.fillColor(trendColor(ts.trend)).text(ts.trend, cols.trend, ry+2, { width: 72, lineBreak: false });
    const scoreCol = ts.score > 0 ? C.green : ts.score < 0 ? C.red : C.mute;
    doc.fillColor(scoreCol).text(`${ts.score>=0?"+":""}${ts.score}`, cols.score, ry+2, { width: 38, lineBreak: false });
    doc.fillColor(C.dark).font("Helvetica").text(ts.targetPrice ? `${ts.targetPrice}` : "—", cols.target, ry+2, { width: 70, lineBreak: false });

    doc.y = ry + 13;
  }
  doc.y += 6;

  // Weekly review (if available)
  if (weekly && !weekly.raw) {
    hr(doc);
    ensureSpace(doc, 20);
    banner(doc, "WEEKLY STRATEGIC REVIEW (AI)", C.purple, "📅");
    if (weekly.portfolioGrade) row(doc, "Portfolio Grade", weekly.portfolioGrade, C.green, 120);
    if (weekly.weeklyOutlook)   para(doc, weekly.weeklyOutlook);
    if (weekly.rebalanceAdvice) row(doc, "Rebalance",  safe(weekly.rebalanceAdvice), C.blue, 120);
    if (weekly.riskWarning)     row(doc, "Risk",       safe(weekly.riskWarning),     C.red,  120);
    if (weekly.weeklyTip)       row(doc, "Weekly Tip", safe(weekly.weeklyTip),       C.purple, 120);
    if (weekly.positionsToWatch?.length) {
      subHead(doc, "Positions to Watch");
      for (const p of weekly.positionsToWatch) {
        ensureSpace(doc, ROW);
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.dark).text(`${p.sym}:`, L, doc.y, { continued: true });
        doc.font("Helvetica").fillColor(C.grey).text(`  ${safe(p.reason)}${p.upcomingCatalyst ? `  📌 ${p.upcomingCatalyst}` : ""}`, { lineBreak: false });
        doc.y += 12;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  PART 3: STOCK SIGNALS  (one stock = ~1/3 of a page max)
// ─────────────────────────────────────────────────────────────

function renderSignalPage(
  doc:     Doc,
  sym:     string,
  ts:      TradeSignal,
  rawData: StockData | undefined,
  gv:      ValidationEntry | undefined,
): void {
  ensureSpace(doc, 160);   // guarantee enough space or add new page

  const ac   = actionColor(ts.action);
  const acBg = actionBg(ts.action);
  const isBuy  = ts.action === "BUY"  || ts.action === "STRONG_BUY";
  const isSell = ts.action === "SELL" || ts.action === "STRONG_SELL";
  const pnlUp  = (ts.unrealizedPct ?? 0) >= 0;

  // ── Stock header strip (compact, 20px tall)
  const hy = doc.y;
  doc.rect(L, hy, W, 20).fill(C.dark);
  // Left: symbol + name
  doc.fontSize(11).font("Helvetica-Bold").fillColor(C.white).text(sym, L + 6, hy + 4, { lineBreak: false });
  doc.fontSize(7).font("Helvetica").fillColor(C.faint).text(`  ${rawData?.name ?? ""}  ·  ${rawData?.sector ?? ""}`, { lineBreak: false });
  // Right: action badge
  const badgeW = 80;
  doc.rect(R - badgeW, hy + 2, badgeW, 16).fill(ac);
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.white)
     .text(ts.action.replace("_", " "), R - badgeW + 2, hy + 6, { width: badgeW - 4, align: "center" });
  doc.y = hy + 24;

  // ── Price row + P&L  (all on one line)
  const pr = doc.y;
  doc.fontSize(13).font("Helvetica-Bold").fillColor(C.dark).text(`PKR ${ts.price}`, L, pr, { lineBreak: false });
  if (ts.changePct != null) {
    doc.fontSize(8).fillColor(ts.changePct >= 0 ? C.green : C.red)
       .text(`  ${sgn(ts.changePct)}${ts.changePct}% today`, { lineBreak: false });
  }
  // Confidence + score on right
  doc.fontSize(7).font("Helvetica").fillColor(C.mute)
     .text(`${ts.confidence} confidence  |  score ${ts.score >= 0 ? "+" : ""}${ts.score}`, R - 160, pr + 2, { width: 160, align: "right", lineBreak: false });
  doc.y = pr + 17;

  // P&L + cost info (compact single row)
  doc.fontSize(7.5).font("Helvetica").fillColor(C.mute)
     .text(`Cost: PKR ${ts.avgCost} × ${ts.shares?.toLocaleString()} shares  |  Value: PKR ${(ts.marketValue ?? 0).toLocaleString()}  |  P&L: `, L, doc.y, { lineBreak: false });
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(pnlUp ? C.green : C.red)
     .text(`${sgn(ts.unrealizedPct)}${ts.unrealizedPct}% (${sgn(ts.unrealizedPnl)}PKR ${(ts.unrealizedPnl ?? 0).toLocaleString()})`, { lineBreak: false });
  doc.y += 11;

  // Fundamentals (if available)
  if (rawData?.fundamentals?.peRatio != null) {
    doc.fontSize(7.5).font("Helvetica").fillColor(C.mute)
       .text(`P/E: ${rawData.fundamentals.peRatio}x  |  P/B: ${rawData.fundamentals.pbRatio ?? "—"}x  |  Div Yield: ${rawData.fundamentals.dividendYield ?? "—"}%  |  EPS: ${rawData.fundamentals.eps ?? "—"}`, L, doc.y);
    doc.y += 11;
  }
  // Performance row
  doc.fontSize(7.5).font("Helvetica").fillColor(C.mute)
     .text(`Perf: 1D ${pct(ts.perf1d)}  1W ${pct(ts.perf1w)}  1M ${pct(ts.perf1m)}  6M ${pct(ts.perf6m)}  |  MaxDD: ${ts.maxDrawdown ?? "—"}%  |  Regime: ${ts.marketRegime}`, L, doc.y);
  doc.y += 13;
  hr(doc, C.faint);

  // ══ SECTION A: ALGO NUMBERS  (two-column indicator grid) ══
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.blue).text("📊 ALGO ANALYSIS", L, doc.y); doc.y += 10;

  // LEFT column: oscillators
  const indY = doc.y;
  const lCol = L, rCol = MID + 4, indLw = 72;

  // Oscillators left
  const leftInds: [string, string, string][] = [
    ["RSI-14",   `${ts.rsi14 ?? "—"}`, (ts.rsi14 ?? 50) < 35 ? C.green : (ts.rsi14 ?? 50) > 65 ? C.red : C.amber],
    ["RSI-9",    `${ts.rsi9 ?? "—"}`,  C.dark],
    ["MFI-14",   `${ts.mfi ?? "—"}`,   (ts.mfi ?? 50) < 30 ? C.green : (ts.mfi ?? 50) > 70 ? C.red : C.amber],
    ["ROC-12",   `${ts.roc != null ? sgn(ts.roc)+ts.roc+"%" : "—"}`, (ts.roc ?? 0) < 0 ? C.green : C.red],
    ["Stoch",    `${ts.stoch?.k ?? "—"}/${ts.stoch?.d ?? "—"} (${ts.stoch?.zone ?? "—"})`, ts.stoch?.zone === "OVERSOLD" ? C.green : ts.stoch?.zone === "OVERBOUGHT" ? C.red : C.dark],
    ["Will %R",  `${ts.willR ?? "—"}`, (ts.willR ?? -50) < -80 ? C.green : (ts.willR ?? -50) > -20 ? C.red : C.dark],
    ["CCI",      `${ts.cci ?? "—"}`,   (ts.cci ?? 0) < -100 ? C.green : (ts.cci ?? 0) > 100 ? C.red : C.dark],
    ["BB %B",    `${ts.bb?.pctB ?? "—"}${ts.bb?.squeeze ? " ⚡" : ""}`, (ts.bb?.pctB ?? 50) < 20 ? C.green : (ts.bb?.pctB ?? 50) > 80 ? C.red : C.dark],
  ];
  let ly = indY;
  for (const [lbl, val, col] of leftInds) {
    const y = ly;
    doc.fontSize(7).font("Helvetica").fillColor(C.mute).text(lbl, lCol, y, { width: indLw, lineBreak: false });
    doc.fontSize(7).font("Helvetica-Bold").fillColor(col).text(val, lCol + indLw + 2, y, { width: W / 2 - indLw - 4, lineBreak: false });
    ly += 11;
  }

  // RIGHT column: trend indicators
  const rightInds: [string, string, string][] = [
    ["Trend",    ts.trend, trendColor(ts.trend)],
    ["ADX",      `${ts.adx?.adx ?? "—"} (${ts.adx?.strength ?? "—"})`, C.dark],
    ["SuperTrend",ts.superTrend ? `${ts.superTrend.signal} @ ${ts.superTrend.value}` : "—", ts.superTrend?.isBull ? C.green : ts.superTrend ? C.red : C.mute],
    ["MACD",     ts.macd?.crossover ?? ts.macd?.histTrend ?? "—", ts.macd?.crossover === "BULLISH_CROSS" ? C.green : ts.macd?.crossover === "BEARISH_CROSS" ? C.red : C.dark],
    ["Ichimoku", ts.ichi?.position ?? "—", ts.ichi?.position === "ABOVE_CLOUD" ? C.green : ts.ichi?.position === "BELOW_CLOUD" ? C.red : C.amber],
    ["OBV",      ts.obv?.trend ?? "—", ts.obv?.trend === "ACCUMULATION" ? C.green : ts.obv?.trend === "DISTRIBUTION" ? C.red : C.mute],
    ["VWAP",     ts.vwap ? `${ts.vwap} (${pct(ts.vwapDevPct)})` : "—", (ts.vwapDevPct ?? 0) < 0 ? C.green : C.red],
    ["Volume",   ts.vol?.volRatio ? `${ts.vol.volRatio}x${ts.vol.volSpike ? " ⚡" : ""} (${ts.vol.volTrend})` : "—", ts.vol?.volSpike ? C.amber : C.dark],
  ];
  let ry2 = indY;
  for (const [lbl, val, col] of rightInds) {
    const y = ry2;
    doc.fontSize(7).font("Helvetica").fillColor(C.mute).text(lbl, rCol, y, { width: indLw, lineBreak: false });
    doc.fontSize(7).font("Helvetica-Bold").fillColor(col).text(val, rCol + indLw + 2, y, { width: W/2 - indLw - 4, lineBreak: false });
    ry2 += 11;
  }
  doc.y = Math.max(ly, ry2) + 4;

  // MAs compact row
  const maItems: [string, number|null][] = [["MA5",ts.ma5],["MA10",ts.ma10],["MA20",ts.ma20],["MA50",ts.ma50],["MA200",ts.ma200],["EMA9",ts.ema9],["EMA21",ts.ema21]];
  let maStr = "";
  for (const [lbl, val] of maItems.filter(([,v]) => v != null)) maStr += `${lbl}:${val}  `;
  if (maStr) {
    doc.fontSize(7).font("Helvetica").fillColor(C.mute).text("MAs: ", L, doc.y, { continued: true });
    doc.fillColor(C.dark).text(maStr.trim()); doc.y += 11;
  }

  // Pivots compact row
  if (ts.pivots) {
    const pv = ts.pivots;
    doc.fontSize(7).font("Helvetica").fillColor(C.mute).text("Pivots: ", L, doc.y, { continued: true });
    doc.fontSize(7).font("Helvetica-Bold").fillColor(C.red).text(`R2:${pv.r2}  R1:${pv.r1}  `, { continued: true });
    doc.fillColor(C.mute).text(`Pvt:${pv.pivot}  `, { continued: true });
    doc.fillColor(C.green).text(`S1:${pv.s1}  S2:${pv.s2}`);
    doc.y += 11;
  }

  // Signal reasons (max 3 bull + 3 bear, one-liners)
  const reasons: string[] = [];
  for (const r of ts.bullReasons.slice(0, 3)) reasons.push(`✓ ${r}`);
  for (const r of ts.bearReasons.slice(0, 3)) reasons.push(`✗ ${r}`);
  if (reasons.length) {
    doc.fontSize(7).font("Helvetica");
    for (let i = 0; i < reasons.length; i++) {
      ensureSpace(doc, 11);
      const isBull = reasons[i].startsWith("✓");
      doc.fillColor(isBull ? C.green : C.red).text(reasons[i], L + 2, doc.y, { width: W - 4, lineBreak: false });
      doc.y += 10;
    }
  }
  if (ts.patterns.length) {
    doc.fontSize(7).font("Helvetica-Oblique").fillColor(C.grey)
       .text(`Patterns: ${ts.patterns.map(p => `${p.name}(${p.bias})`).join(", ")}`, L, doc.y); doc.y += 10;
  }
  doc.y += 2;
  hr(doc, C.faint);

  // ══ TRADE INSTRUCTION BOX ══
  ensureSpace(doc, 50);
  const boxH = isBuy || isSell ? 48 : 28;
  doc.rect(L, doc.y, W, boxH).fill(acBg);
  doc.rect(L, doc.y, 3, boxH).fill(ac);
  const bx2 = doc.y;
  doc.fontSize(7.5).font("Helvetica-Bold").fillColor(ac).text("TRADE INSTRUCTION", L + 8, bx2 + 3);
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor(C.dark).text(ts.instruction, L + 8, bx2 + 14, { width: W - 16 });
  if ((isBuy || isSell) && ts.targetPrice != null) {
    doc.fontSize(7.5).font("Helvetica");
    doc.fillColor(C.green).text(`Target: ${pkr(ts.targetPrice)}`, L + 8, bx2 + 29, { continued: true });
    doc.fillColor(C.red).text(`   Stop: ${pkr(ts.stopLoss)}`, { continued: true });
    doc.fillColor(C.purple).text(`   R/R 1:${ts.rrRatio}`, { continued: true });
    doc.fillColor(C.mute).text(`   Gain: PKR ${ts.potentialGain?.toLocaleString() ?? "—"}  Risk: PKR ${ts.maxRisk?.toLocaleString() ?? "—"}`);
  }
  doc.y = bx2 + boxH + 4;

  // Beginner note
  ensureSpace(doc, 22);
  doc.rect(L, doc.y, W, 18).fill(C.blueBg);
  doc.fontSize(7).font("Helvetica-Bold").fillColor(C.blue).text("📗 SIMPLE EXPLANATION:", L + 4, doc.y + 3, { continued: true });
  doc.fontSize(7).font("Helvetica").fillColor(C.dark).text("  " + safe(ts.beginnerNote), { lineBreak: false });
  doc.y += 22;

  // Dividends
  if (rawData?.dividends?.length) {
    doc.fontSize(7).font("Helvetica").fillColor(C.green)
       .text(`Dividends: ${rawData.dividends.map(d => `PKR ${d.amount} (ex ${d.exDate})`).join("  ·  ")}`, L, doc.y);
    doc.y += 10;
  }

  // ══ SECTION B: AI FEEDBACK ══
  if (gv) {
    ensureSpace(doc, 14);
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(C.purple).text("🤖 AI FEEDBACK", L, doc.y); doc.y += 10;
    const verdCol = gv.verdict === "Agree" ? C.green : gv.verdict === "Disagree" ? C.red : C.amber;
    doc.fontSize(7).font("Helvetica").fillColor(C.mute)
       .text(`${gv.verdict}  ·  ${gv.conviction} conviction  ·  ${gv.time_horizon}  `, L, doc.y, { continued: true });
    if (gv.entry_zone) doc.fillColor(C.green).text(`Entry: PKR ${gv.entry_zone}  `, { continued: true });
    if (gv.exit_zone)  doc.fillColor(C.amber).text(`Exit: PKR ${gv.exit_zone}`);
    else doc.text("");
    doc.y += 11;
    if (gv.analyst_note) para(doc, gv.analyst_note, C.grey);
    if (gv.key_catalyst) {
      doc.fontSize(7).font("Helvetica").fillColor(C.green).text(`⚡ ${safe(gv.key_catalyst)}`, L, doc.y); doc.y += 10;
    }
    if (gv.key_risk) {
      doc.fontSize(7).font("Helvetica").fillColor(C.red).text(`⚠ ${safe(gv.key_risk)}`, L, doc.y); doc.y += 10;
    }
    // SELL: alt buy suggestions
    if ((isSell) && gv.alt_buy_suggestions?.length) {
      doc.fontSize(7).font("Helvetica-Bold").fillColor(C.green).text("Better alternatives to buy:", L, doc.y); doc.y += 10;
      for (const sug of gv.alt_buy_suggestions) {
        doc.fontSize(7).font("Helvetica").fillColor(C.dark).text(`  ▶ ${safe(sug)}`, L + 4, doc.y); doc.y += 10;
      }
    }
    if (gv.beginner_explanation) {
      ensureSpace(doc, 18);
      doc.rect(L, doc.y, W, 15).fill(C.purpleBg);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(C.purple).text("🎓 Coach:", L + 4, doc.y + 3, { continued: true });
      doc.fontSize(7).font("Helvetica").fillColor(C.dark).text("  " + safe(gv.beginner_explanation), { lineBreak: false });
      doc.y += 19;
    }
  }

  doc.y += 8;
  hr(doc);
}

// ─────────────────────────────────────────────────────────────
//  FOOTER on every page
// ─────────────────────────────────────────────────────────────

function addFooters(doc: Doc, timeStamp: string): void {
  const range = doc.bufferedPageRange?.() ?? { start: 0, count: doc._pageBuffer?.length ?? 1 };
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(6.5).font("Helvetica").fillColor(C.mute)
       .text(
         `PSX Agent  ·  ${timeStamp}  ·  Page ${i + 1} of ${range.count}  ·  Algorithmic signals + AI — not financial advice`,
         L, doc.page.height - 28, { width: W, align: "center" },
       );
  }
}

// ─────────────────────────────────────────────────────────────
//  MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export async function generatePdfReport(data: ReportData, outputPath: string): Promise<void> {
  const { stockData, signals, summary, performance, gemini, timeStamp } = data;

  const doc = new PDFDocument({
    size:           "A4",
    margin:         0,      // we handle all margins manually
    bufferPages:    true,   // needed for footer page-numbering
    info: { Title: `PSX Report ${timeStamp}`, Author: "PSX Agent", Subject: "KSE-100 Portfolio Analysis" },
  }) as Doc;

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const m = gemini?.market, a = gemini?.analysis, w = gemini?.weekly;

  const dataMap: Record<string, StockData> = {};
  for (const [k, d] of Object.entries(stockData)) {
    if (k !== "__market__" && !("error" in d)) dataMap[k] = d as StockData;
  }

  // ── PART 1: Cover + Market Analysis
  doc.y = 36;
  renderCover(doc, timeStamp, summary, performance, signals);

  if (m && !m.raw && a) {
    renderMarketAnalysis(doc, m, a);
  }

  // ── PART 2: Portfolio Analysis
  if (a) {
    renderPortfolioAnalysis(doc, a, w, signals);
  }

  // ── PART 3: Individual Stock Signals
  doc.addPage();
  banner(doc as Doc, "INDIVIDUAL STOCK SIGNALS", C.dark, "📈");
  doc.fontSize(7).font("Helvetica").fillColor(C.mute)
     .text("Algorithmic scoring + Gemini AI validation for each position", L, doc.y);
  doc.y += 12;

  for (const [sym, sig] of Object.entries(signals)) {
    if (sig.action === "SKIP") continue;
    const ts  = sig as TradeSignal;
    const gv  = a?.validation?.find(v => v.symbol === sym);
    renderSignalPage(doc as Doc, sym, ts, dataMap[sym], gv);
  }

  // ── Footers
  addFooters(doc as Doc, timeStamp);

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

export function getPdfPath(timeStamp: string): string {
  const safe2 = timeStamp.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-");
  const dir    = path.join(process.cwd(), "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `psx-report-${safe2}.pdf`);
}