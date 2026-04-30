import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import moment from "moment-timezone";
import type {
  ReportData,
  TradeSignal,
  Signal,
  StockData,
  ValidationEntry,
} from "./types";

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

const sgn = (n: number | null | undefined) =>
  n == null ? "" : n >= 0 ? "+" : "";
const fmt = (v: unknown) => String(v ?? "—");
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${sgn(n)}${n}%`;

// Colors
const C = {
  green: "#16a34a",
  red: "#dc2626",
  amber: "#d97706",
  blue: "#1d4ed8",
  purple: "#7c3aed",
  dark: "#0f172a",
  mute: "#475569",
  light: "#f8fafc",
  bdr: "#e2e8f0",
};

function actionColor(action: string): string {
  if (action === "STRONG_BUY" || action === "BUY") return C.green;
  if (action === "STRONG_SELL" || action === "SELL") return C.red;
  return C.amber;
}

// ─────────────────────────────────────────────────────────────
//  PDF GENERATOR
// ─────────────────────────────────────────────────────────────

export async function generatePdfReport(
  data: ReportData,
  outputPath: string
): Promise<void> {
  const { stockData, signals, summary, performance, gemini, timeStamp } = data;

  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: { Title: `PSX Report ${timeStamp}`, Author: "PSX Agent" },
  });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const PAGE_W = 515; // usable width (595 - 80 margins)
  const COL_GAP = 10;
  const COL_W = (PAGE_W - COL_GAP) / 2;

  // ── Helper: horizontal rule
  const hr = (y?: number) => {
    const yy = y ?? doc.y;
    doc
      .moveTo(40, yy)
      .lineTo(555, yy)
      .strokeColor(C.bdr)
      .lineWidth(0.5)
      .stroke();
    doc.y = yy + 6;
  };

  // ── Helper: section header
  const sectionHeader = (title: string, color: string) => {
    if (doc.y > 720) doc.addPage();
    doc.rect(40, doc.y, PAGE_W, 18).fill(color).fillColor("white");
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("white")
      .text(title, 45, doc.y + 4, { width: PAGE_W });
    doc.y += 24;
    doc.fillColor(C.dark);
  };

  // ── Helper: key-value row
  const kvRow = (label: string, value: string, valueColor?: string) => {
    const y = doc.y;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text(label, 40, y, { width: 160, continued: false });
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(valueColor ?? C.dark)
      .text(value, 210, y, { width: 345 });
    doc.y = Math.max(doc.y, y + 13);
  };

  // ─── HEADER ─────────────────────────────────────────────────
  doc.rect(40, 40, PAGE_W, 60).fill(C.dark);
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor("white")
    .text("PSX Trading Report", 50, 52);
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#94a3b8")
    .text(timeStamp, 50, 75);

  // Action summary pills
  const counts: Record<string, number> = {
    STRONG_BUY: 0,
    BUY: 0,
    HOLD: 0,
    SELL: 0,
    STRONG_SELL: 0,
  };
  for (const s of Object.values(signals))
    if (s.action in counts) counts[s.action]++;
  let pillX = 300;
  const pillLabels = [
    ["SB", counts.STRONG_BUY, C.green],
    ["B", counts.BUY, C.green],
    ["H", counts.HOLD, C.amber],
    ["S", counts.SELL, C.red],
    ["SS", counts.STRONG_SELL, C.red],
  ] as [string, number, string][];
  for (const [lbl, cnt, col] of pillLabels) {
    if (cnt > 0) {
      doc.rect(pillX, 55, 30, 14).fill(col);
      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor("white")
        .text(`${lbl}:${cnt}`, pillX + 2, 58, { width: 28 });
      pillX += 34;
    }
  }
  doc.y = 115;
  doc.fillColor(C.dark);

  // ─── PORTFOLIO SUMMARY ──────────────────────────────────────
  sectionHeader("PORTFOLIO OVERVIEW", C.blue);
  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const pnlC = pnlUp ? C.green : C.red;
  kvRow("Total Invested", `PKR ${(summary.totalCost ?? 0).toLocaleString()}`);
  kvRow("Market Value", `PKR ${(summary.totalValue ?? 0).toLocaleString()}`);
  kvRow(
    "Unrealised P&L",
    `${pnlUp ? "+" : ""}PKR ${(summary.totalPnl ?? 0).toLocaleString()} (${sgn(
      summary.totalPnlPct
    )}${summary.totalPnlPct ?? 0}%)`,
    pnlC
  );
  if (performance)
    kvRow(
      "Signal Accuracy",
      `${performance.accuracy}% (${performance.correct}/${performance.total})`,
      C.purple
    );

  // Sector allocation
  if (Object.keys(summary.sectorWeights).length) {
    doc.y += 4;
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("SECTOR ALLOCATION", 40, doc.y);
    doc.y += 10;
    for (const [sec, wt] of Object.entries(summary.sectorWeights).sort(
      ([, a], [, b]) => b - a
    )) {
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(`${sec}`, 40, doc.y, { width: 150 });
      const barW = Math.min(200, wt * 3);
      doc.rect(200, doc.y, barW, 8).fill(C.blue);
      doc.fontSize(8).fillColor(C.mute).text(`${wt}%`, 405, doc.y);
      doc.y += 13;
    }
  }
  hr();

  // ─── GEMINI MARKET INTEL ─────────────────────────────────────
  const m = gemini?.market,
    a = gemini?.analysis;
  if (m && !m.raw) {
    sectionHeader(
      "🤖 AI MARKET INTELLIGENCE  (Google Search Grounded)",
      C.purple
    );
    if (m.today_headline) {
      doc
        .fontSize(9)
        .font("Helvetica-BoldOblique")
        .fillColor(C.dark)
        .text(`"${m.today_headline}"`, 40, doc.y, { width: PAGE_W });
      doc.y += 14;
    }
    if (a?.general_market_analysis) {
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.mute)
        .text("General Market Analysis:", 40, doc.y);
      doc.y += 11;
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(a.general_market_analysis, 40, doc.y, { width: PAGE_W });
      doc.y += 16;
    }

    // Two-column: Global | Pakistan
    const colY = doc.y;
    // Left: Global
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("GLOBAL", 40, colY);
    doc.y = colY + 12;
    if (m.global.oil_brent_usd)
      kvRow("Brent Oil", `$${m.global.oil_brent_usd} (${m.global.oil_trend})`);
    if (m.global.usd_pkr) kvRow("PKR/USD", m.global.usd_pkr);
    if (m.global.fed_stance) kvRow("Fed Stance", m.global.fed_stance);
    if (m.global.us_10y_yield) kvRow("US 10Y", m.global.us_10y_yield);
    if (m.global.sentiment)
      kvRow(
        "Sentiment",
        m.global.sentiment,
        m.global.sentiment === "Risk-On" ? C.green : C.red
      );
    const leftEndY = doc.y;

    // Right: Pakistan
    doc.y = colY;
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("PAKISTAN", 300, colY);
    doc.y = colY + 12;
    if (m.pakistan.kse100_level)
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(
          `KSE-100: ${m.pakistan.kse100_level} (${m.pakistan.kse100_chg}%)`,
          300,
          doc.y,
          { width: 255 }
        );
    doc.y += 13;
    if (m.pakistan.sbp_rate)
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(
          `SBP Rate: ${m.pakistan.sbp_rate} (${m.pakistan.sbp_outlook})`,
          300,
          doc.y,
          { width: 255 }
        );
    doc.y += 13;
    if (m.pakistan.cpi)
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(`CPI: ${m.pakistan.cpi} — ${m.pakistan.cpi_trend}`, 300, doc.y, {
          width: 255,
        });
    doc.y += 13;
    if (m.pakistan.imf_program)
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(`IMF: ${m.pakistan.imf_program}`, 300, doc.y, { width: 255 });
    doc.y += 13;
    if (m.pakistan.fx_reserves)
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(`FX Reserves: $${m.pakistan.fx_reserves}bn`, 300, doc.y, {
          width: 255,
        });
    doc.y += 13;
    doc.y = Math.max(leftEndY, doc.y) + 4;
    hr();

    // Sector outlook
    if (Object.keys(m.sector_outlook).length) {
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(C.mute)
        .text("SECTOR OUTLOOK", 40, doc.y);
      doc.y += 11;
      for (const [sec, val] of Object.entries(m.sector_outlook)) {
        const v = String(val);
        const sc = v.includes("Bull")
          ? C.green
          : v.includes("Bear")
          ? C.red
          : C.amber;
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor(C.dark)
          .text(sec, 40, doc.y, { width: 100 });
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor(sc)
          .text(v, 145, doc.y, { width: 370 });
        doc.y += 12;
      }
      hr();
    }

    // AI portfolio health
    if (a?.portfolio_health) {
      sectionHeader("🤖 AI PORTFOLIO HEALTH", C.purple);
      kvRow("P&L Comment", a.portfolio_health.pnl_comment);
      kvRow("Concentration", a.portfolio_health.concentration_detail);
      kvRow("Best Position", a.portfolio_health.best_positioned, C.green);
      kvRow("Biggest Risk", a.portfolio_health.biggest_risk, C.red);
      if (a.top_trade_today)
        kvRow("Top Trade Today", a.top_trade_today, C.green);
      if (a.avoid_today) kvRow("Avoid Today", a.avoid_today, C.red);
      if (a.sector_rotation)
        kvRow("Sector Rotation", a.sector_rotation, C.blue);
      if (a.daily_tip) kvRow("Daily Tip", a.daily_tip);
      hr();
    }
  }

  // ─── STOCK SIGNALS ──────────────────────────────────────────
  const dataMap: Record<string, StockData> = {};
  for (const [k, d] of Object.entries(stockData)) {
    if (k !== "__market__" && !("error" in d)) dataMap[k] = d as StockData;
  }

  for (const [sym, sig] of Object.entries(signals)) {
    if (sig.action === "SKIP") continue;
    const ts = sig as TradeSignal;
    const raw = dataMap[sym];
    const gv = a?.validation?.find((v) => v.symbol === sym);
    const ac = actionColor(ts.action);
    const isBuy = ts.action === "BUY" || ts.action === "STRONG_BUY";
    const isSell = ts.action === "SELL" || ts.action === "STRONG_SELL";

    if (doc.y > 680) doc.addPage();

    // ── Stock header bar
    doc.rect(40, doc.y, PAGE_W, 22).fill(C.dark);
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor("white")
      .text(sym, 45, doc.y + 5, { continued: true });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#94a3b8")
      .text(`  ${raw?.name ?? ""} · ${raw?.sector ?? ""}`, {
        continued: false,
      });
    // Action badge
    doc.rect(430, doc.y - 17, 125, 18).fill(ac);
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("white")
      .text(ts.action.replace("_", " "), 433, doc.y - 14, { width: 122 });
    doc.y += 28;
    doc.fillColor(C.dark);

    // ── Price + P&L row
    const pnlC2 = (ts.unrealizedPct ?? 0) >= 0 ? C.green : C.red;
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .fillColor(C.dark)
      .text(`PKR ${ts.price}`, 40, doc.y, { continued: true });
    if (ts.changePct != null)
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(ts.changePct >= 0 ? C.green : C.red)
        .text(` ${sgn(ts.changePct)}${ts.changePct}% today`);
    doc.y += 14;
    kvRow(
      "Avg Cost / Shares",
      `PKR ${ts.avgCost} × ${ts.shares.toLocaleString()} shares`
    );
    kvRow("Market Value", `PKR ${(ts.marketValue ?? 0).toLocaleString()}`);
    kvRow(
      "Unrealised P&L",
      `${sgn(ts.unrealizedPct)}${ts.unrealizedPct}% (PKR ${(
        ts.unrealizedPnl ?? 0
      ).toLocaleString()})`,
      pnlC2
    );
    if (raw?.fundamentals?.peRatio != null) {
      kvRow(
        "P/E · P/B · Div Yield",
        `${raw.fundamentals.peRatio}x · ${raw.fundamentals.pbRatio ?? "—"}x · ${
          raw.fundamentals.dividendYield
        }%`
      );
    }
    doc.y += 3;

    // ══ SECTION A: ALGO ANALYSIS ═════════════════════════════
    sectionHeader("📊  ALGO ANALYSIS NUMBERS", C.blue);

    // Performance
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("PERFORMANCE", 40, doc.y);
    doc.y += 10;
    const perfItems: [string, number | null][] = [
      ["1D", ts.perf1d],
      ["1W", ts.perf1w],
      ["1M", ts.perf1m],
      ["6M", ts.perf6m],
    ];
    let px2 = 40;
    for (const [lbl, val] of perfItems) {
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.mute)
        .text(lbl, px2, doc.y, { continued: true });
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor((val ?? 0) >= 0 ? C.green : C.red)
        .text(` ${pct(val)}  `);
      px2 += 65;
    }
    doc.y += 14;
    kvRow("Max Drawdown", `${ts.maxDrawdown}%`, C.red);
    kvRow("6m High / Low", `PKR ${ts.high6m} / PKR ${ts.low6m}`);
    doc.y += 3;

    // Two-column: Momentum | Trend & Flow
    const colStart = doc.y;
    // LEFT: Momentum
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("MOMENTUM OSCILLATORS", 40, colStart);
    doc.y = colStart + 11;
    const rsiC =
      (ts.rsi14 ?? 50) < 35 ? C.green : (ts.rsi14 ?? 50) > 65 ? C.red : C.amber;
    kvRow("RSI-14", `${ts.rsi14 ?? "—"}`, rsiC);
    kvRow("RSI-9", `${ts.rsi9 ?? "—"}`);
    kvRow(
      "MFI-14",
      `${ts.mfi ?? "—"}`,
      (ts.mfi ?? 50) < 30 ? C.green : (ts.mfi ?? 50) > 70 ? C.red : C.amber
    );
    kvRow("ROC-12", `${ts.roc != null ? sgn(ts.roc) + ts.roc + "%" : "—"}`);
    kvRow(
      "Stoch %K/%D",
      `${ts.stoch?.k ?? "—"} / ${ts.stoch?.d ?? "—"} (${ts.stoch?.zone ?? "—"})`
    );
    kvRow("Williams %R", `${ts.willR ?? "—"}`);
    kvRow("CCI", `${ts.cci ?? "—"}`);
    kvRow(
      "BB %B",
      `${ts.bb?.pctB ?? "—"}${ts.bb?.squeeze ? " ⚡SQUEEZE" : ""}`
    );
    const leftY2 = doc.y;

    // RIGHT: Trend & Flow
    doc.y = colStart;
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("TREND & FLOW", 300, colStart);
    doc.y = colStart + 11;
    const TREND_COLOR_MAP: Record<string, string> = {
      STRONG_BULL: C.green,
      BULL: C.green,
      SIDEWAYS: C.amber,
      BEAR: C.red,
      STRONG_BEAR: C.red,
      UNKNOWN: C.mute,
    };
    const trendC2 = TREND_COLOR_MAP[ts.trend] ?? C.mute;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("Trend", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(trendC2)
      .text(`  ${ts.trend}`, 360, doc.y);
    doc.y += 13;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("Regime", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.dark)
      .text(`  ${ts.marketRegime}`, 360, doc.y);
    doc.y += 13;
    doc.fontSize(8).font("Helvetica").fillColor(C.mute).text("ADX", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.dark)
      .text(`  ${ts.adx?.adx ?? "—"} (${ts.adx?.strength ?? "—"})`, 360, doc.y);
    doc.y += 13;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("SuperTrend", 300, doc.y);
    if (ts.superTrend) {
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(ts.superTrend.isBull ? C.green : C.red)
        .text(
          `  ${ts.superTrend.signal} @ PKR ${ts.superTrend.value}`,
          360,
          doc.y
        );
    }
    doc.y += 13;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("MACD", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(
        ts.macd?.crossover === "BULLISH_CROSS"
          ? C.green
          : ts.macd?.crossover === "BEARISH_CROSS"
          ? C.red
          : C.dark
      )
      .text(`  ${ts.macd?.crossover ?? ts.macd?.histTrend ?? "—"}`, 360, doc.y);
    doc.y += 13;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("Ichimoku", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(
        ts.ichi?.position === "ABOVE_CLOUD"
          ? C.green
          : ts.ichi?.position === "BELOW_CLOUD"
          ? C.red
          : C.amber
      )
      .text(`  ${ts.ichi?.position ?? "—"}`, 360, doc.y);
    doc.y += 13;
    doc.fontSize(8).font("Helvetica").fillColor(C.mute).text("OBV", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(
        ts.obv?.trend === "ACCUMULATION"
          ? C.green
          : ts.obv?.trend === "DISTRIBUTION"
          ? C.red
          : C.mute
      )
      .text(`  ${ts.obv?.trend ?? "—"}`, 360, doc.y);
    doc.y += 13;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("VWAP", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.dark)
      .text(`  PKR ${ts.vwap ?? "—"} (${pct(ts.vwapDevPct)})`, 360, doc.y);
    doc.y += 13;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.mute)
      .text("Volume", 300, doc.y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(ts.vol?.volSpike ? C.amber : C.dark)
      .text(
        `  ${ts.vol?.volRatio ?? "—"}x avg (${ts.vol?.volTrend ?? "—"})`,
        360,
        doc.y
      );
    doc.y += 13;
    doc.y = Math.max(leftY2, doc.y) + 4;

    // Moving averages
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.mute)
      .text("MOVING AVERAGES", 40, doc.y);
    doc.y += 10;
    const maItems: [string, number | null][] = [
      ["MA5", ts.ma5],
      ["MA10", ts.ma10],
      ["MA20", ts.ma20],
      ["MA50", ts.ma50],
      ["MA200", ts.ma200],
      ["EMA9", ts.ema9],
      ["EMA21", ts.ema21],
    ];
    let maX = 40;
    for (const [lbl, val] of maItems.filter(([, v]) => v != null)) {
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor(C.mute)
        .text(lbl, maX, doc.y, { continued: true });
      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor(ts.price >= (val ?? 0) ? C.green : C.red)
        .text(` ${val}  `);
      maX += 68;
      if (maX > 520) {
        maX = 40;
        doc.y += 11;
      }
    }
    doc.y += 13;

    // Pivot levels
    if (ts.pivots) {
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(C.mute)
        .text("PIVOT LEVELS", 40, doc.y);
      doc.y += 10;
      const pivItems: [string, number, string][] = [
        ["R2", ts.pivots.r2, C.red],
        ["R1", ts.pivots.r1, C.red],
        ["Pvt", ts.pivots.pivot, C.mute],
        ["S1", ts.pivots.s1, C.green],
        ["S2", ts.pivots.s2, C.green],
      ];
      let pvX = 40;
      for (const [lbl, val, col] of pivItems) {
        doc
          .fontSize(7)
          .font("Helvetica")
          .fillColor(C.mute)
          .text(`${lbl}:`, pvX, doc.y, { continued: true });
        doc
          .fontSize(7)
          .font("Helvetica-Bold")
          .fillColor(col)
          .text(` ${val}   `);
        pvX += 90;
      }
      doc.y += 13;
    }

    // Signal reasons
    if (ts.bullReasons.length || ts.bearReasons.length) {
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(C.mute)
        .text("SIGNAL REASONS", 40, doc.y);
      doc.y += 10;
      for (const r of ts.bullReasons.slice(0, 4)) {
        doc
          .fontSize(7.5)
          .font("Helvetica")
          .fillColor(C.green)
          .text(`✓ ${r}`, 40, doc.y, { width: PAGE_W });
        doc.y += 11;
      }
      for (const r of ts.bearReasons.slice(0, 4)) {
        doc
          .fontSize(7.5)
          .font("Helvetica")
          .fillColor(C.red)
          .text(`✗ ${r}`, 40, doc.y, { width: PAGE_W });
        doc.y += 11;
      }
    }

    // Patterns
    if (ts.patterns.length) {
      doc
        .fontSize(7.5)
        .font("Helvetica-Oblique")
        .fillColor(C.mute)
        .text(
          `Patterns: ${ts.patterns
            .map((p) => `${p.name}(${p.bias})`)
            .join(", ")}`,
          40,
          doc.y,
          { width: PAGE_W }
        );
      doc.y += 11;
    }
    if (ts.divergence) {
      doc
        .fontSize(7.5)
        .font("Helvetica-Oblique")
        .fillColor(ts.divergence.includes("BULLISH") ? C.green : C.red)
        .text(ts.divergence.replace(/_/g, " "), 40, doc.y);
      doc.y += 11;
    }
    doc.y += 3;

    // ── TRADE INSTRUCTION BOX
    doc
      .rect(40, doc.y, PAGE_W, 70)
      .fill(isBuy ? "#f0fdf4" : isSell ? "#fef2f2" : "#fffbeb");
    doc.rect(40, doc.y, 4, 70).fill(ac);
    const boxY = doc.y + 6;
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(ac)
      .text("TRADE INSTRUCTION", 50, boxY);
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor(C.dark)
      .text(ts.instruction, 50, boxY + 13, { width: PAGE_W - 20 });
    if ((isBuy || isSell) && ts.targetPrice != null) {
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.green)
        .text(`🎯 Target: PKR ${ts.targetPrice}`, 50, boxY + 31, {
          continued: true,
        });
      doc
        .fillColor(C.red)
        .text(`   🛑 Stop: PKR ${ts.stopLoss}`, { continued: true });
      doc.fillColor(C.purple).text(`   ⚖️ R/R 1:${ts.rrRatio}`);
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.mute)
        .text(
          `Potential gain: PKR ${ts.potentialGain.toLocaleString()}  ·  Max risk: PKR ${ts.maxRisk.toLocaleString()}`,
          50,
          boxY + 44
        );
    }
    doc.y += 78;
    doc.fillColor(C.dark);

    // Beginner note
    doc.rect(40, doc.y, PAGE_W, 30).fill("#eff6ff");
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(C.blue)
      .text("SIMPLE EXPLANATION", 45, doc.y + 4);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(C.dark)
      .text(ts.beginnerNote, 45, doc.y + 15, { width: PAGE_W - 10 });
    doc.y += 36;

    // Pro summary
    doc
      .fontSize(7)
      .font("Helvetica-Oblique")
      .fillColor(C.mute)
      .text(ts.proSummary, 40, doc.y, { width: PAGE_W });
    doc.y += 13;

    // Dividends
    if (raw?.dividends?.length) {
      doc
        .fontSize(7.5)
        .font("Helvetica")
        .fillColor(C.green)
        .text(
          `Recent dividends: ${raw.dividends
            .map((d) => `PKR ${d.amount} (ex ${d.exDate})`)
            .join("  ·  ")}`,
          40,
          doc.y,
          { width: PAGE_W }
        );
      doc.y += 11;
    }

    // ══ SECTION B: AI FEEDBACK ═══════════════════════════════
    if (gv) {
      sectionHeader("🤖  AI FEEDBACK (Gemini)", C.purple);
      const verdictC =
        { Agree: C.green, Disagree: C.red, Partial: C.amber }[gv.verdict] ??
        C.mute;
      kvRow(
        "Verdict",
        `${gv.verdict}  ·  ${gv.conviction} conviction  ·  ${gv.time_horizon}`,
        verdictC
      );
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(gv.analyst_note, 40, doc.y, { width: PAGE_W });
      doc.y += 16;
      if (gv.entry_zone)
        kvRow("AI Entry Zone", `PKR ${gv.entry_zone}`, C.green);
      if (gv.exit_zone) kvRow("AI Exit Zone", `PKR ${gv.exit_zone}`, C.amber);
      if (gv.key_catalyst) kvRow("Catalyst", gv.key_catalyst, C.green);
      if (gv.key_risk) kvRow("Key Risk", gv.key_risk, C.red);
      if (gv.alt_action)
        kvRow(
          "AI Alt Action",
          `${gv.alt_action}${gv.alt_price ? ` @ PKR ${gv.alt_price}` : ""}`
        );
      // Buy suggestions for SELL signals
      if (isSell && gv.alt_buy_suggestions?.length) {
        doc
          .fontSize(8)
          .font("Helvetica-Bold")
          .fillColor(C.green)
          .text("Better Buy Alternatives:", 40, doc.y);
        doc.y += 11;
        for (const sug of gv.alt_buy_suggestions) {
          doc
            .fontSize(8)
            .font("Helvetica")
            .fillColor(C.dark)
            .text(`  ▶ ${sug}`, 40, doc.y, { width: PAGE_W });
          doc.y += 11;
        }
      }
      // Coach note
      if (gv.beginner_explanation) {
        doc.rect(40, doc.y, PAGE_W, 28).fill("#f5f3ff");
        doc
          .fontSize(8)
          .font("Helvetica-Bold")
          .fillColor(C.purple)
          .text("AI Coach:", 45, doc.y + 4);
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor(C.dark)
          .text(gv.beginner_explanation, 45, doc.y + 15, {
            width: PAGE_W - 10,
          });
        doc.y += 34;
      }
    }

    hr();
  }

  // ─── WEEKLY REVIEW ──────────────────────────────────────────
  const w = gemini?.weekly;
  if (w && !w.raw) {
    if (doc.y > 650) doc.addPage();
    sectionHeader("📅  WEEKLY STRATEGIC REVIEW (AI)", C.purple);
    if (w.portfolioGrade) kvRow("Portfolio Grade", w.portfolioGrade, C.green);
    if (w.weeklyOutlook) {
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(C.dark)
        .text(w.weeklyOutlook, 40, doc.y, { width: PAGE_W });
      doc.y += 16;
    }
    if (w.rebalanceAdvice) kvRow("Rebalance Advice", w.rebalanceAdvice);
    if (w.riskWarning) kvRow("Risk Warning", w.riskWarning, C.red);
    if (w.weeklyTip) kvRow("Weekly Tip", w.weeklyTip, C.purple);
    if (w.positionsToWatch?.length) {
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(C.mute)
        .text("POSITIONS TO WATCH", 40, doc.y);
      doc.y += 11;
      for (const p of w.positionsToWatch) {
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor(C.dark)
          .text(
            `• ${p.sym}: ${p.reason}${
              p.upcomingCatalyst ? `  📌 ${p.upcomingCatalyst}` : ""
            }`,
            40,
            doc.y,
            { width: PAGE_W }
          );
        doc.y += 11;
      }
    }
    hr();
  }

  // ─── FOOTER ─────────────────────────────────────────────────
  doc
    .fontSize(7)
    .font("Helvetica-Oblique")
    .fillColor(C.mute)
    .text(
      "PSX Agent  ·  Algorithmic signals + AI feedback  ·  Not financial advice",
      40,
      doc.page.height - 40,
      { align: "center", width: PAGE_W }
    );

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

/** Generate a timestamped filename and return the full output path */
export function getPdfPath(timeStamp: string): string {
  const safe = timeStamp.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-");
  const dir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `psx-report-${safe}.pdf`);
}
