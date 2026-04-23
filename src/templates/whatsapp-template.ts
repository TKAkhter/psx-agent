import {
  TradeSignalMap,
  PortfolioSummary,
  Signal,
  TradeSignal,
} from "../signals";
import { StockDataMap, StockData } from "../fetch-data";
import { GeminiInsight } from "../gemini";
import { PerformanceResult } from "../performance";

const sgn = (n: number | null | undefined): string =>
  n == null ? "" : n >= 0 ? "+" : "";
const fmt = (v: unknown): string => String(v ?? "—");

export function buildWhatsAppMessage(
  stockData: StockDataMap,
  signals: TradeSignalMap,
  summary: PortfolioSummary,
  gemini: GeminiInsight | null,
  performance: PerformanceResult | null,
  timeStamp: string
): string {
  const dataMap: Record<string, StockData> = {};
  for (const [k, d] of Object.entries(stockData)) {
    if (k !== "__market__" && !("error" in d)) dataMap[k] = d as StockData;
  }

  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const buys = Object.entries(signals).filter(
    ([, s]) => s.action === "BUY" || s.action === "STRONG_BUY"
  ) as [string, TradeSignal][];
  const sells = Object.entries(signals).filter(
    ([, s]) => s.action === "SELL" || s.action === "STRONG_SELL"
  ) as [string, TradeSignal][];
  const holds = Object.entries(signals).filter(
    ([, s]) => s.action === "HOLD"
  ) as [string, TradeSignal][];

  const m = gemini?.market;
  const a = gemini?.analysis;
  const w = gemini?.weekly;

  let msg = "";

  // ── Header ──────────────────────────────────────────────────
  msg += `🇵🇰 *PSX TRADING REPORT*\n📅 ${timeStamp}\n${"━".repeat(34)}\n\n`;

  // ── Portfolio ────────────────────────────────────────────────
  msg += `${pnlUp ? "📈" : "📉"} *PORTFOLIO SUMMARY*\n`;
  msg += `  Value:    PKR ${(summary.totalValue ?? 0).toLocaleString()}\n`;
  msg += `  Invested: PKR ${(summary.totalCost ?? 0).toLocaleString()}\n`;
  msg += `  P&L:      ${pnlUp ? "+" : ""}PKR ${(
    summary.totalPnl ?? 0
  ).toLocaleString()} (${sgn(summary.totalPnlPct)}${
    summary.totalPnlPct ?? 0
  }%)\n`;
  if (performance)
    msg += `  Accuracy: 🎯 ${performance.accuracy}% (${performance.correct}/${performance.total})\n`;
  msg += "\n";

  // ── Gemini market brief ──────────────────────────────────────
  if (m && !m.raw) {
    msg += `🤖 *AI MARKET INTEL* (Google Search)\n`;
    if (m.today_headline) msg += `  📌 ${m.today_headline}\n`;
    if (m.global.oil_brent_usd)
      msg += `  🛢 Brent $${m.global.oil_brent_usd} (${m.global.oil_trend})\n`;
    if (m.global.usd_pkr)
      msg += `  💵 PKR/USD ${m.global.usd_pkr} · ${m.global.sentiment}\n`;
    if (m.pakistan.kse100_level)
      msg += `  📊 KSE-100 ${m.pakistan.kse100_level} (${m.pakistan.kse100_chg}%)\n`;
    if (m.pakistan.sbp_rate)
      msg += `  🏛 SBP ${m.pakistan.sbp_rate} · ${m.pakistan.sbp_outlook}\n`;
    if (m.pakistan.imf_program) msg += `  🤝 IMF: ${m.pakistan.imf_program}\n`;
    if (a?.overall_stance)
      msg += `  Stance: *${a.overall_stance}* · Mood: ${a.emotional_state}\n`;
    msg += "\n";
  }

  // ── Weekly review (9am only) ─────────────────────────────────
  if (w && !w.raw) {
    msg += `📅 *WEEKLY AI REVIEW*\n${"─".repeat(28)}\n`;
    if (w.portfolioGrade) msg += `  Grade: *${w.portfolioGrade}*\n`;
    if (w.weeklyOutlook) msg += `  ${w.weeklyOutlook.slice(0, 200)}\n`;
    if (w.riskWarning) msg += `  ⚠️ ${w.riskWarning}\n`;
    if (w.rebalanceAdvice) msg += `  ⚖️ ${w.rebalanceAdvice}\n`;
    if (w.positionsToWatch?.length) {
      msg += `  👀 Watch: ${w.positionsToWatch
        .map(
          (p) =>
            `${p.sym}${p.upcomingCatalyst ? ` (${p.upcomingCatalyst})` : ""}`
        )
        .join(", ")}\n`;
    }
    if (w.weeklyTip) msg += `  🎓 ${w.weeklyTip}\n`;
    msg += "\n";
  }

  // ─────────────────────────────────────────────────────────────
  //  BUY SIGNALS
  // ─────────────────────────────────────────────────────────────
  if (buys.length) {
    msg += `✅ *BUY SIGNALS (${buys.length})*\n${"─".repeat(34)}\n`;
    for (const [sym, s] of buys) {
      const d = dataMap[sym];
      const gv = a?.validation?.find((v) => v.symbol === sym);
      const isStrong = s.action === "STRONG_BUY";

      msg += `${isStrong ? "📗📗" : "📗"} *${sym}*${
        isStrong ? " ★ STRONG BUY" : ""
      }\n`;
      if (s.sparkline) msg += `  ${s.sparkline}\n`;
      msg += `  Price: PKR ${s.price}${
        s.changePct != null ? ` (${sgn(s.changePct)}${s.changePct}%)` : ""
      }\n`;
      msg += `  P&L: ${sgn(s.unrealizedPct)}${s.unrealizedPct}%  |  Pos: PKR ${(
        s.marketValue ?? 0
      ).toLocaleString()}\n`;
      if (d?.fundamentals?.peRatio != null)
        msg += `  P/E: ${d.fundamentals.peRatio}x  Div: ${d.fundamentals.dividendYield}%\n`;
      msg += "\n";

      // ── 📋 Trade Instruction
      msg += `  📋 *${s.instruction}*\n`;
      msg += `  🎯 Target:    PKR ${s.targetPrice}\n`;
      msg += `  🛑 Stop Loss: PKR ${s.stopLoss}\n`;
      msg += `  ⚖️ R/R: 1:${s.rrRatio}  |  ${s.confidence} confidence\n`;
      if (s.potentialGain && s.maxRisk) {
        msg += `  💰 Gain: PKR ${s.potentialGain.toLocaleString()}  |  Risk: PKR ${s.maxRisk.toLocaleString()}\n`;
      }
      msg += "\n";

      // ── 📊 Algo Numbers
      msg += `  📊 *ALGO ANALYSIS*\n`;
      msg += `  RSI-14: ${s.rsi14}  MFI: ${s.mfi}  ROC: ${
        s.roc != null ? sgn(s.roc) + s.roc + "%" : "—"
      }\n`;
      msg += `  SuperTrend: ${s.superTrend?.signal ?? "—"} @ PKR ${
        s.superTrend?.value ?? "—"
      } (${s.superTrend?.distance ?? "—"}% away)\n`;
      msg += `  Stoch: ${s.stoch?.k}/${s.stoch?.d} (${s.stoch?.zone})  |  ADX: ${s.adx?.adx}(${s.adx?.strength})\n`;
      msg += `  MACD: ${
        s.macd?.crossover ?? s.macd?.histTrend ?? "—"
      }  |  Ichi: ${s.ichi?.position ?? "—"}\n`;
      msg += `  OBV: ${s.obv?.trend ?? "—"}  |  VWAP: ${s.vwap}  |  Vol: ${
        s.vol?.volRatio
      }x\n`;
      if (s.divergence) msg += `  📐 ${s.divergence.replace(/_/g, " ")}\n`;
      msg += `  1D:${sgn(s.perf1d)}${s.perf1d}%  1W:${sgn(s.perf1w)}${
        s.perf1w
      }%  1M:${sgn(s.perf1m)}${s.perf1m}%  6M:${sgn(s.perf6m)}${s.perf6m}%\n`;
      if (s.pivots)
        msg += `  Pivots: S2:${s.pivots.s2}  S1:${s.pivots.s1}  Pvt:${s.pivots.pivot}  R1:${s.pivots.r1}  R2:${s.pivots.r2}\n`;
      if (s.ma20)
        msg += `  MAs: MA5:${s.ma5}  MA20:${s.ma20}  MA50:${
          s.ma50 ?? "—"
        }  EMA9:${s.ema9}\n`;
      if (s.bullReasons.length)
        msg += `\n  ✓ ${s.bullReasons.slice(0, 2).join("\n  ✓ ")}\n`;
      if (d?.dividends?.length)
        msg += `  💸 Div: PKR ${d.dividends[0].amount} (ex ${d.dividends[0].exDate})\n`;
      msg += `\n  📗 ${s.beginnerNote}\n`;

      // ── 🤖 AI Feedback
      if (gv) {
        const ico =
          gv.verdict === "Agree"
            ? "✅"
            : gv.verdict === "Disagree"
            ? "❌"
            : "⚠️";
        msg += `\n  🤖 *AI FEEDBACK*\n`;
        msg += `  ${ico} ${gv.verdict} [${gv.conviction} conv · ${gv.time_horizon}]\n`;
        if (gv.entry_zone)
          msg += `  Entry: PKR ${gv.entry_zone}  Exit: PKR ${
            gv.exit_zone ?? "—"
          }\n`;
        msg += `  ${gv.analyst_note.slice(0, 130)}\n`;
        if (gv.key_catalyst) msg += `  ⚡ ${gv.key_catalyst}\n`;
        if (gv.key_risk) msg += `  ⚠️ ${gv.key_risk}\n`;
        if (gv.beginner_explanation)
          msg += `  🎓 ${gv.beginner_explanation.slice(0, 140)}\n`;
      }
      msg += "\n";
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  SELL SIGNALS
  // ─────────────────────────────────────────────────────────────
  if (sells.length) {
    msg += `🔴 *SELL SIGNALS (${sells.length})*\n${"─".repeat(34)}\n`;
    for (const [sym, s] of sells) {
      const gv = a?.validation?.find((v) => v.symbol === sym);
      const isStrong = s.action === "STRONG_SELL";

      msg += `${isStrong ? "📕📕" : "📕"} *${sym}*${
        isStrong ? " ★ STRONG SELL" : ""
      }\n`;
      if (s.sparkline) msg += `  ${s.sparkline}\n`;
      msg += `  Price: PKR ${s.price}${
        s.changePct != null ? ` (${sgn(s.changePct)}${s.changePct}%)` : ""
      }  P&L: ${sgn(s.unrealizedPct)}${s.unrealizedPct}%\n\n`;

      msg += `  📋 *${s.instruction}*\n`;
      msg += `  🎯 Target: PKR ${s.targetPrice}  |  🛑 Stop: PKR ${s.stopLoss}  |  R/R 1:${s.rrRatio}\n\n`;

      msg += `  📊 *ALGO ANALYSIS*\n`;
      msg += `  RSI-14:${s.rsi14}  MFI:${s.mfi}  ROC:${
        s.roc != null ? sgn(s.roc) + s.roc + "%" : "—"
      }  ST:${s.superTrend?.signal ?? "—"}\n`;
      msg += `  Stoch:${s.stoch?.k}/${s.stoch?.d}  ADX:${s.adx?.adx}(${
        s.adx?.strength
      })  MACD:${s.macd?.crossover ?? s.macd?.histTrend ?? "—"}\n`;
      if (s.bearReasons.length)
        msg += `\n  ✗ ${s.bearReasons.slice(0, 2).join("\n  ✗ ")}\n`;
      msg += `\n  📕 ${s.beginnerNote}\n`;

      if (gv) {
        const ico =
          gv.verdict === "Agree"
            ? "✅"
            : gv.verdict === "Disagree"
            ? "❌"
            : "⚠️";
        msg += `\n  🤖 *AI:* ${ico} ${gv.verdict} [${gv.conviction}]  ⚠️ ${gv.key_risk}\n`;
        if (gv.beginner_explanation)
          msg += `  🎓 ${gv.beginner_explanation.slice(0, 120)}\n`;
      }
      msg += "\n";
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  HOLD (compact)
  // ─────────────────────────────────────────────────────────────
  if (holds.length) {
    msg += `⏸ *HOLD (${holds.length})*\n${"─".repeat(34)}\n`;
    for (const [sym, s] of holds) {
      const pnlIcon = (s.unrealizedPct ?? 0) >= 0 ? "🟢" : "🔴";
      const stIcon =
        s.superTrend?.signal === "BUY"
          ? "▲"
          : s.superTrend?.signal === "SELL"
          ? "▼"
          : "●";
      msg += `  ${pnlIcon} *${sym.padEnd(7)}* PKR ${String(s.price).padStart(
        7
      )}  P&L: ${sgn(s.unrealizedPct)}${s.unrealizedPct}%\n`;
      msg += `         RSI:${s.rsi14}  MFI:${s.mfi}  ROC:${
        s.roc != null ? sgn(s.roc) + s.roc + "%" : "—"
      }  ST:${stIcon}${s.superTrend?.signal ?? "—"}  ${s.trend}\n`;
      msg += `         S:${s.stopLoss}  R:${s.targetPrice}\n`;
      if (s.sparkline) msg += `         ${s.sparkline}\n`;
    }
    msg += "\n";
  }

  // ── AI calls ─────────────────────────────────────────────────
  if (a?.top_trade_today || a?.avoid_today || a?.daily_tip) {
    msg += `${"─".repeat(34)}\n🤖 *AI RECOMMENDATIONS*\n`;
    if (a.top_trade_today) msg += `⭐ Top Trade: ${a.top_trade_today}\n`;
    if (a.avoid_today) msg += `🚫 Avoid: ${a.avoid_today}\n`;
    if (a.daily_tip) msg += `🎓 Tip: ${a.daily_tip}\n`;
    msg += "\n";
  }

  // ── Sector outlook ────────────────────────────────────────────
  if (m?.sector_outlook && Object.keys(m.sector_outlook).length) {
    msg += `${"─".repeat(34)}\n📊 *SECTOR OUTLOOK (AI)*\n`;
    for (const [sec, val] of Object.entries(m.sector_outlook)) {
      const icon = String(val).includes("Bull")
        ? "▲"
        : String(val).includes("Bear")
        ? "▼"
        : "●";
      msg += `  ${icon} ${sec}: ${val}\n`;
    }
    msg += "\n";
  }

  msg += `${"━".repeat(
    34
  )}\n_Algo signals + AI feedback — not financial advice_`;
  return msg;
}
