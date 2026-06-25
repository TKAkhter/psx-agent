import PDFDocument from "pdfkit";
import type {
  StockDataMap, StockData, TradeSignalMap, TradeSignal,
  PortfolioSummary, GeminiInsight, ValidationEntry, PerformanceResult,
} from "./types";

// ─────────────────────────────────────────────────────────────
//  NOTE: pdfkit does NOT support emoji (renders as garbled bytes).
//  All icons use plain ASCII/Latin characters only.
// ─────────────────────────────────────────────────────────────

const C = {
  bg:       "#ffffff",
  card:     "#f8fafc",
  border:   "#e2e8f0",
  text:     "#0f172a",
  mute:     "#64748b",
  dim:      "#94a3b8",
  green:    "#16a34a",
  greenBg:  "#dcfce7",
  red:      "#dc2626",
  redBg:    "#fee2e2",
  amber:    "#d97706",
  amberBg:  "#fef3c7",
  blue:     "#1d4ed8",
  blueBg:   "#dbeafe",
  purple:   "#7c3aed",
  purpleBg: "#ede9fe",
  header:   "#0f172a",
};

const ACTION_FG: Record<string, string> = {
  STRONG_BUY: "#ffffff", BUY: "#ffffff",
  HOLD: "#92400e",
  SELL: "#ffffff",       STRONG_SELL: "#ffffff",
};
const ACTION_BG: Record<string, string> = {
  STRONG_BUY: "#16a34a", BUY: "#22c55e",
  HOLD: "#fef3c7",
  SELL: "#ef4444",       STRONG_SELL: "#dc2626",
};

const W  = 595.28;   // A4 width
const H  = 841.89;   // A4 height
const ML = 36;       // left margin
const MR = 36;       // right margin
const MT = 36;       // top margin
const MB = 50;       // bottom margin (footer space)
const CW = W - ML - MR; // content width = 523.28

const sgn = (n: number | null | undefined) => (!n ? "" : n >= 0 ? "+" : "");
const num = (n: number | null | undefined, d = 2) =>
  n == null ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// ─────────────────────────────────────────────────────────────
//  LAYOUT ENGINE  (pure flow, never absolute Y)
// ─────────────────────────────────────────────────────────────

type Doc = PDFKit.PDFDocument;

function nl(doc: Doc, h = 6): void { doc.moveDown(0); doc.y += h; }

function guard(doc: Doc, need: number): void {
  if (doc.y + need > H - MB) doc.addPage();
}

function hRule(doc: Doc, color = C.border, lw = 0.5): void {
  const y = doc.y;
  doc.save().moveTo(ML, y).lineTo(W - MR, y)
    .strokeColor(color).lineWidth(lw).stroke().restore();
  doc.y = y + 4;
}

function sectionHead(doc: Doc, title: string, color = C.text): void {
  guard(doc, 28);
  doc.save()
    .font("Helvetica-Bold").fontSize(11).fillColor(color)
    .text(title.toUpperCase(), ML, doc.y);
  doc.restore();
  nl(doc, 3);
  hRule(doc, color === C.text ? C.border : color);
  nl(doc, 4);
}

function kv(
  doc: Doc, label: string, value: string,
  vColor = C.text, lw = 120,
): void {
  guard(doc, 14);
  const y = doc.y;
  doc.save()
    .font("Helvetica").fontSize(8.5).fillColor(C.mute)
    .text(label, ML, y, { width: lw, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(vColor)
    .text(value, ML + lw, y, { width: CW - lw, lineBreak: false });
  doc.restore();
  doc.y = y + 13;
}

function note(doc: Doc, text: string, fg = C.blue, bg = C.blueBg): void {
  const innerWidth = CW - 14;
  doc.font("Helvetica").fontSize(8);
  const textH = doc.heightOfString(text, { width: innerWidth });
  const bh = textH + 10;
  guard(doc, bh + 6);
  const y = doc.y;
  doc.save().roundedRect(ML, y, CW, bh, 3).fill(bg);
  doc.fillColor(fg).text(text, ML + 7, y + 5, { width: innerWidth });
  doc.restore();
  doc.y = y + bh + 6;
}

function tag(
  doc: Doc, text: string, x: number, y: number,
  fg: string, bg: string, fs = 8,
): number {
  doc.save().font("Helvetica-Bold").fontSize(fs);
  const tw = doc.widthOfString(text);
  const pw = tw + 12; const ph = fs + 8;
  doc.roundedRect(x, y, pw, ph, 3).fill(bg);
  doc.fillColor(fg).text(text, x + 6, y + 4, { lineBreak: false });
  doc.restore();
  return pw;
}

// ─────────────────────────────────────────────────────────────
//  COVER  PAGE  (page 1)
// ─────────────────────────────────────────────────────────────

function renderCover(
  doc: Doc, ts: string,
  summary: PortfolioSummary,
  signals: TradeSignalMap,
  perf: PerformanceResult | null,
  gemini: GeminiInsight | null,
): void {
  // header band
  doc.rect(0, 0, W, 76).fill(C.header);
  doc.save()
    .font("Helvetica-Bold").fontSize(20).fillColor("#ffffff")
    .text("PSX Trading Report", ML, 20);
  doc.font("Helvetica").fontSize(10).fillColor("#94a3b8")
    .text(ts, ML, 48);
  doc.restore();
  doc.y = 92;

  // signal count tags
  const counts: Record<string, number> = { STRONG_BUY:0, BUY:0, HOLD:0, SELL:0, STRONG_SELL:0 };
  for (const s of Object.values(signals)) if (s.action in counts) counts[s.action]++;
  const labels: [string,string][] = [
    ["STRONG BUY", "STRONG_BUY"],["BUY","BUY"],["HOLD","HOLD"],["SELL","SELL"],["STRONG SELL","STRONG_SELL"],
  ];
  let tx = ML;
  for (const [label, key] of labels) {
    if (!counts[key]) continue;
    const w = tag(doc, `${label} ${counts[key]}`, tx, doc.y, ACTION_FG[key], ACTION_BG[key], 8.5);
    tx += w + 6;
  }
  doc.y += 22; nl(doc, 8);

  // 2-column summary
  sectionHead(doc, "Portfolio Summary");

  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const half  = CW / 2 - 8;

  const leftY = doc.y;
  // left column
  doc.save()
    .font("Helvetica").fontSize(8.5).fillColor(C.mute)
    .text("Invested", ML, leftY, { width: half, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
    .text(`PKR ${summary.totalCost.toLocaleString()}`, ML + 70, leftY, { lineBreak: false });
  doc.restore();

  const r1Y = leftY + 14;
  doc.save()
    .font("Helvetica").fontSize(8.5).fillColor(C.mute)
    .text("Market Value", ML, r1Y, { width: half, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
    .text(`PKR ${summary.totalValue.toLocaleString()}`, ML + 70, r1Y, { lineBreak: false });
  doc.restore();

  const r2Y = r1Y + 14;
  doc.save()
    .font("Helvetica").fontSize(8.5).fillColor(C.mute)
    .text("Unrealised P&L", ML, r2Y, { width: half, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(pnlUp ? C.green : C.red)
    .text(
      `${pnlUp?"+":""}PKR ${Math.abs(summary.totalPnl).toLocaleString()}  (${sgn(summary.totalPnlPct)}${summary.totalPnlPct}%)`,
      ML + 70, r2Y, { lineBreak: false }
    );
  doc.restore();

  // right column
  const rc = ML + half + 16;
  if (perf) {
    doc.save()
      .font("Helvetica").fontSize(8.5).fillColor(C.mute)
      .text("Signal Accuracy", rc, leftY, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.purple)
      .text(`${perf.accuracy}%  (${perf.correct}/${perf.total})`, rc + 90, leftY, { lineBreak: false });
    doc.restore();
  }
  const m = gemini?.market;
  if (m?.pakistan?.kse100_level) {
    doc.save()
      .font("Helvetica").fontSize(8.5).fillColor(C.mute)
      .text("KSE-100", rc, r1Y, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
      .text(`${m.pakistan.kse100_level}  (${m.pakistan.kse100_chg}%)`, rc + 90, r1Y, { lineBreak: false });
    doc.restore();
  }
  doc.y = r2Y + 20;
  nl(doc, 6);

  // Sector allocation mini-bars
  sectionHead(doc, "Sector Allocation");
  const sectors = Object.entries(summary.sectorWeights).sort(([,a],[,b]) => b-a);
  for (const [sec, pct] of sectors) {
    guard(doc, 14);
    const y = doc.y;
    doc.save().font("Helvetica").fontSize(8).fillColor(C.mute)
      .text(sec, ML, y, { width: 120, lineBreak: false });
    const bx = ML + 125; const bw = 200; const filled = Math.max(2, (pct/100)*bw);
    doc.roundedRect(bx, y+1, bw, 8, 2).fill(C.border);
    doc.roundedRect(bx, y+1, filled, 8, 2).fill(C.blue);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.text)
      .text(`${pct}%`, bx + bw + 6, y, { lineBreak: false });
    doc.restore();
    doc.y = y + 14;
  }

  // Gemini stance
  const a = gemini?.analysis;
  if (a && !a.raw) {
    nl(doc, 8);
    sectionHead(doc, "AI Market Stance");
    kv(doc, "Stance", a.overall_stance ?? "-",
       a.overall_stance === "Bull" ? C.green : a.overall_stance === "Bear" ? C.red : C.amber);
    if (a.top_trade_today) kv(doc, "Top Trade", a.top_trade_today, C.green);
    if (a.avoid_today)     kv(doc, "Avoid Today", a.avoid_today, C.red);
    if (a.daily_tip)       note(doc, `Tip: ${a.daily_tip}`, C.blue, C.blueBg);
    if (a.macro_impact)    note(doc, `Macro: ${a.macro_impact}`, C.purple, C.purpleBg);
  }
  if (m && !m.raw) {
    nl(doc, 4);
    kv(doc, "Brent Oil",  `$${m.global.oil_brent_usd ?? "-"}  (${m.global.oil_trend ?? "-"})`);
    kv(doc, "PKR/USD",    m.global.usd_pkr ?? "-");
    kv(doc, "SBP Rate",   `${m.pakistan.sbp_rate ?? "-"}  (${m.pakistan.sbp_outlook ?? "-"})`);
    kv(doc, "IMF Status", m.pakistan.imf_program ?? "-");
    if (m.today_headline) note(doc, `Headline: ${m.today_headline}`, C.purple, C.purpleBg);
  }
}

// ─────────────────────────────────────────────────────────────
//  HOLD STOCKS  —  compact table (all HOLDs on 1 page)
// ─────────────────────────────────────────────────────────────

function renderHoldTable(
  doc: Doc, holds: [string, TradeSignal][],
): void {
  if (!holds.length) return;
  doc.addPage();
  sectionHead(doc, "Hold Positions");

  // Table header
  const cols = { sym:ML, px:ML+55, chg:ML+115, pnl:ML+170, rsi:ML+225, st:ML+265 };
  guard(doc, 16);
  const hy = doc.y;
  doc.save().rect(ML, hy, CW, 14).fill(C.card);
  const hdr = (t: string, x: number) =>
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.mute).text(t, x, hy+3, { lineBreak: false });
  hdr("SYMBOL", cols.sym); hdr("PRICE", cols.px); hdr("TODAY", cols.chg);
  hdr("P&L", cols.pnl); hdr("RSI", cols.rsi); hdr("SUPERTREND / TREND", cols.st);
  doc.restore();
  doc.y = hy + 16;

  for (const [sym, s] of holds) {
    guard(doc, 16);
    const y = doc.y;
    const pnlColor = (s.unrealizedPct ?? 0) >= 0 ? C.green : C.red;
    const chgColor = (s.changePct ?? 0) >= 0 ? C.green : C.red;
    const stColor = s.superTrend?.signal === "BUY" ? C.green : s.superTrend?.signal === "SELL" ? C.red : C.mute;
    const stText = s.superTrend
      ? `${s.superTrend.signal} @ ${num(s.superTrend.value)}  (${s.trend})`
      : s.trend;

    doc.save()
      .font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
      .text(sym, cols.sym, y, { lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(C.text)
      .text(`PKR ${num(s.price)}`, cols.px, y, { width: 56, lineBreak: false });
    doc.fillColor(chgColor).fontSize(8)
      .text(s.changePct != null ? `${sgn(s.changePct)}${s.changePct}%` : "-", cols.chg, y, { width: 52, lineBreak: false });
    doc.fillColor(pnlColor)
      .text(`${sgn(s.unrealizedPct)}${s.unrealizedPct}%`, cols.pnl, y, { width: 52, lineBreak: false });
    doc.fillColor(C.text)
      .text(String(s.rsi14 ?? "-"), cols.rsi, y, { width: 36, lineBreak: false });
    doc.fillColor(stColor).fontSize(7.5)
      .text(stText, cols.st, y, { width: W - MR - cols.st, lineBreak: false });
    doc.restore();
    doc.y = y + 14;

    // Sub-row: support/resistance
    const sy = doc.y;
    doc.save().font("Helvetica").fontSize(7.5).fillColor(C.dim)
      .text(`S: PKR ${s.stopLoss ?? "-"}  R: PKR ${s.targetPrice ?? "-"}  |  ${s.instruction}`,
        ML + 60, sy, { width: CW - 60, lineBreak: false });
    doc.restore();
    doc.y = sy + 11;
    hRule(doc, C.border, 0.3);
    nl(doc, 2);
  }
}

// ─────────────────────────────────────────────────────────────
//  BUY / SELL STOCK CARD  (compact, ~1/2 page each)
// ─────────────────────────────────────────────────────────────

function renderSignalCard(
  doc: Doc, sym: string, sig: TradeSignal,
  raw: StockData | undefined, gv: ValidationEntry | undefined,
): void {
  guard(doc, 200);

  const isBuy  = sig.action === "BUY"  || sig.action === "STRONG_BUY";
  const isSell = sig.action === "SELL" || sig.action === "STRONG_SELL";
  const fg     = ACTION_FG[sig.action] ?? "#ffffff";
  const bg     = ACTION_BG[sig.action] ?? C.blue;
  const pnlColor = (sig.unrealizedPct ?? 0) >= 0 ? C.green : C.red;

  // ── header row
  const hy = doc.y;
  doc.save().rect(ML, hy, CW, 22).fill(bg);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(fg)
    .text(sym, ML + 8, hy + 4, { continued: true, lineBreak: false });
  doc.font("Helvetica").fontSize(8.5)
    .text(`  ${raw?.name ?? ""}`, { lineBreak: false });
  const actionLabel = sig.action.replace("_", " ");
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(fg)
    .text(actionLabel, W - MR - 80, hy + 6, { width: 76, align: "right", lineBreak: false });
  doc.restore();
  doc.y = hy + 26;

  // ── price + position row
  const py = doc.y;
  const chgColor = (sig.changePct ?? 0) >= 0 ? C.green : C.red;
  doc.save()
    .font("Helvetica-Bold").fontSize(14).fillColor(C.text)
    .text(`PKR ${num(sig.price)}`, ML, py, { continued: true, lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(chgColor)
    .text(sig.changePct != null ? `  ${sgn(sig.changePct)}${sig.changePct}% today` : "", { lineBreak: false });
  doc.restore();

  const posStr = `${sig.shares} sh @ PKR ${sig.avgCost}  |  Val: PKR ${sig.marketValue.toLocaleString()}  |  P&L: `;
  const pnlStr = `${sgn(sig.unrealizedPct)}${sig.unrealizedPct}%`;
  doc.save().font("Helvetica").fontSize(8).fillColor(C.mute)
    .text(posStr, ML, py + 16, { continued: true, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8).fillColor(pnlColor)
    .text(pnlStr, { lineBreak: false });
  doc.restore();
  doc.y = py + 30;

  // ── trade instruction box
  if (isBuy || isSell) {
    guard(doc, 52);
    const by = doc.y;
    doc.save().roundedRect(ML, by, CW, 48, 3).fill(C.card);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(isBuy ? C.green : C.red)
      .text(sig.instruction, ML + 8, by + 5, { width: CW - 16 });
    const line2 = `Target: PKR ${num(sig.targetPrice)}   Stop: PKR ${num(sig.stopLoss)}   R/R 1:${sig.rrRatio}   Gain: PKR ${sig.potentialGain.toLocaleString()}   Risk: PKR ${sig.maxRisk.toLocaleString()}   Conf: ${sig.confidence}`;
    doc.font("Helvetica").fontSize(7.5).fillColor(C.mute)
      .text(line2, ML + 8, by + 21, { width: CW - 16 });
    if (raw?.fundamentals?.peRatio != null) {
      doc.text(
        `P/E ${raw.fundamentals.peRatio}x   Div Yield ${raw.fundamentals.dividendYield ?? "-"}%   Mkt Cap ${raw.fundamentals.marketCap ?? "-"}` +
        (raw.dividends?.length ? `   Latest Div: PKR ${raw.dividends[0].amount} (ex ${raw.dividends[0].exDate})` : ""),
        ML + 8, by + 35, { width: CW - 16 }
      );
    }
    doc.restore();
    doc.y = by + 54;
  }

  // ── indicator grid  (2 columns, 5 rows)
  guard(doc, 70);
  const gridY = doc.y;
  const col1  = ML;
  const col2  = ML + CW / 2;
  const cw    = CW / 2 - 4;
  const lw    = 70;

  const leftInds: [string, string, string][] = [
    ["RSI-14", String(sig.rsi14 ?? "-"), (sig.rsi14 ?? 50) < 35 ? C.green : (sig.rsi14 ?? 50) > 65 ? C.red : C.text],
    ["MFI",    String(sig.mfi   ?? "-"), (sig.mfi   ?? 50) < 35 ? C.green : (sig.mfi   ?? 50) > 65 ? C.red : C.text],
    ["ROC",    sig.roc != null ? `${sgn(sig.roc)}${sig.roc}%` : "-", (sig.roc ?? 0) >= 0 ? C.green : C.red],
    ["Stoch",  sig.stoch?.k != null ? `${sig.stoch.k}/${sig.stoch.d} (${sig.stoch.zone})` : "-", C.text],
    ["ADX",    sig.adx?.adx != null ? `${sig.adx.adx} (${sig.adx.strength})` : "-", C.text],
  ];
  const rightInds: [string, string, string][] = [
    ["SuperTrend", sig.superTrend ? `${sig.superTrend.signal} @ PKR ${num(sig.superTrend.value)}` : "-",
      sig.superTrend?.signal === "BUY" ? C.green : sig.superTrend?.signal === "SELL" ? C.red : C.text],
    ["MACD",     sig.macd?.crossover ?? sig.macd?.histTrend ?? "-", C.text],
    ["Ichimoku", sig.ichi?.position ?? "-",
      sig.ichi?.position === "ABOVE_CLOUD" ? C.green : sig.ichi?.position === "BELOW_CLOUD" ? C.red : C.amber],
    ["OBV",      sig.obv?.trend ?? "-",
      sig.obv?.trend === "ACCUMULATION" ? C.green : sig.obv?.trend === "DISTRIBUTION" ? C.red : C.text],
    ["VWAP",     sig.vwap != null ? `PKR ${num(sig.vwap)}` : "-", C.text],
  ];

  for (let i = 0; i < 5; i++) {
    const rowY = gridY + i * 13;
    const [ll, lv, lc] = leftInds[i];
    const [rl, rv, rc2] = rightInds[i];
    doc.save()
      .font("Helvetica").fontSize(7.5).fillColor(C.mute)
      .text(ll, col1, rowY, { width: lw, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(lc)
      .text(lv, col1 + lw + 2, rowY, { width: cw - lw - 4, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(C.mute)
      .text(rl, col2, rowY, { width: lw, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(rc2)
      .text(rv, col2 + lw + 2, rowY, { width: cw - lw - 4, lineBreak: false });
    doc.restore();
  }
  doc.y = gridY + 5 * 13 + 4;

  // ── perf row
  const perfStr = `1D ${sgn(sig.perf1d)}${sig.perf1d ?? "-"}%   1W ${sgn(sig.perf1w)}${sig.perf1w ?? "-"}%   1M ${sgn(sig.perf1m)}${sig.perf1m ?? "-"}%   6M ${sgn(sig.perf6m)}${sig.perf6m ?? "-"}%`;
  doc.save().font("Helvetica").fontSize(7.5).fillColor(C.dim).text(perfStr, ML, doc.y);
  doc.restore();
  nl(doc, 4);

  // ── reasons (max 2 bull + 2 bear on one line each)
  for (const r of sig.bullReasons.slice(0, 2)) {
    guard(doc, 11);
    doc.save().font("Helvetica").fontSize(7.5).fillColor(C.green)
      .text(`[+] ${r}`, ML, doc.y, { width: CW }); doc.restore(); nl(doc, 1);
  }
  for (const r of sig.bearReasons.slice(0, 2)) {
    guard(doc, 11);
    doc.save().font("Helvetica").fontSize(7.5).fillColor(C.red)
      .text(`[-] ${r}`, ML, doc.y, { width: CW }); doc.restore(); nl(doc, 1);
  }
  nl(doc, 2);

  // ── beginner note
  note(doc, sig.beginnerNote, C.blue, C.blueBg);

  // ── AI feedback (compact)
  if (gv) {
    guard(doc, 50);
    const vColor = gv.verdict === "Agree" ? C.green : gv.verdict === "Disagree" ? C.red : C.amber;
    const fbY = doc.y;
    doc.save()
      .font("Helvetica-Bold").fontSize(8).fillColor(C.purple)
      .text("AI FEEDBACK", ML, fbY, { continued: true, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(vColor)
      .text(`  ${gv.verdict}  [${gv.conviction} conviction, ${gv.time_horizon}]`, { lineBreak: false });
    doc.restore();
    doc.y = fbY + 12;
    nl(doc, 3);
    if (gv.entry_zone) kv(doc, "Entry Zone", `PKR ${gv.entry_zone}`, C.green, 80);
    if (gv.exit_zone)  kv(doc, "Exit Zone",  `PKR ${gv.exit_zone}`,  C.red,   80);
    if (gv.analyst_note) {
      doc.save().font("Helvetica").fontSize(8).fillColor(C.text)
        .text(gv.analyst_note, ML, doc.y, { width: CW }); doc.restore(); nl(doc, 3);
    }
    if (gv.key_catalyst) {
      doc.save().font("Helvetica").fontSize(7.5).fillColor(C.green)
        .text(`Catalyst: ${gv.key_catalyst}`, ML, doc.y, { width: CW }); doc.restore(); nl(doc, 2);
    }
    if (gv.key_risk) {
      doc.save().font("Helvetica").fontSize(7.5).fillColor(C.red)
        .text(`Risk: ${gv.key_risk}`, ML, doc.y, { width: CW }); doc.restore(); nl(doc, 2);
    }
    if (gv.alt_buy_suggestions?.length) {
      note(doc, `Rotation: If selling ${sym}, consider adding to: ${gv.alt_buy_suggestions.join(", ")}`, C.purple, C.purpleBg);
    }
    if (gv.beginner_explanation) {
      note(doc, gv.beginner_explanation, C.blue, C.blueBg);
    }
  }

  nl(doc, 4);
  hRule(doc, C.border);
  nl(doc, 8);
}

// ─────────────────────────────────────────────────────────────
//  WEEKLY REVIEW  (compact section, not a full page)
// ─────────────────────────────────────────────────────────────

function renderWeekly(doc: Doc, weekly: GeminiInsight["weekly"]): void {
  if (!weekly || weekly.raw) return;
  guard(doc, 100);
  sectionHead(doc, "Weekly Strategic Review (AI)");
  if (weekly.portfolioGrade) kv(doc, "Grade", weekly.portfolioGrade, C.purple);
  if (weekly.weeklyOutlook)  {
    doc.save().font("Helvetica").fontSize(8.5).fillColor(C.text)
      .text(weekly.weeklyOutlook, ML, doc.y, { width: CW }); doc.restore(); nl(doc, 4);
  }
  if (weekly.riskWarning)    note(doc, `Risk: ${weekly.riskWarning}`, C.red, C.redBg);
  if (weekly.rebalanceAdvice)note(doc, `Rebalance: ${weekly.rebalanceAdvice}`, C.amber, C.amberBg);
  if (weekly.weeklyTip)      note(doc, `Tip: ${weekly.weeklyTip}`, C.blue, C.blueBg);
  if (weekly.positionsToWatch?.length) {
    kv(doc, "Watch", weekly.positionsToWatch.map(p => `${p.sym}${p.upcomingCatalyst ? ` (${p.upcomingCatalyst})` : ""}`).join(", "));
  }
}

// ─────────────────────────────────────────────────────────────
//  FOOTER  (added after all pages are buffered)
// ─────────────────────────────────────────────────────────────

function addFooters(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save()
      .font("Helvetica").fontSize(7).fillColor(C.dim)
      .text(
        `PSX Agent  |  Algorithmic signals + AI analysis  |  Not financial advice  |  Page ${i - range.start + 1} / ${range.count}`,
        ML, H - 30, { width: CW, align: "center" }
      );
    doc.restore();
  }
}

// ─────────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────────

export function generateReportPdf(
  stockData:   StockDataMap,
  signals:     TradeSignalMap,
  summary:     PortfolioSummary,
  performance: PerformanceResult | null,
  gemini:      GeminiInsight | null,
  timeStamp:   string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: { Title: `PSX Report — ${timeStamp}`, Author: "PSX Agent" },
    });

    const chunks: Buffer[] = [];
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const dataMap: Record<string, StockData> = {};
    for (const [k, d] of Object.entries(stockData))
      if (k !== "__market__" && !("error" in d)) dataMap[k] = d as StockData;

    const analysis = gemini?.analysis ?? null;
    doc.y = MT;

    // Page 1: cover + market intel + sector outlook
    renderCover(doc, timeStamp, summary, signals, performance, gemini);

    // HOLDs table (compact, all on one page)
    const holds = (Object.entries(signals) as [string, TradeSignal][])
      .filter(([, s]) => s.action === "HOLD");
    renderHoldTable(doc, holds);

    // BUY / SELL cards (each ~half page, 2 per page typically)
    const actionable = (Object.entries(signals) as [string, TradeSignal][])
      .filter(([, s]) => s.action !== "SKIP" && s.action !== "HOLD");

    if (actionable.length) {
      doc.addPage(); doc.y = MT;
      sectionHead(doc, "Active Signals — Buy & Sell");
      for (const [sym, sig] of actionable) {
        const gv = analysis?.validation?.find(v => v.symbol === sym);
        renderSignalCard(doc, sym, sig, dataMap[sym], gv);
      }
    }

    // Weekly review appended at end of last page (no forced new page unless needed)
    renderWeekly(doc, gemini?.weekly ?? null);

    addFooters(doc);
    doc.end();
  });
}
