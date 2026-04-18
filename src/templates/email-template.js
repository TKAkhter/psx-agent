"use strict";
const { ENV } = require("../config");

// ─────────────────────────────────────────────────────────────
//  THEME  (toggled by EMAIL_THEME env variable)
// ─────────────────────────────────────────────────────────────

const THEMES = {
  dark: {
    pageBg: "#07101a",
    cardBg: "#0c1a2e",
    headerBg: "#071120",
    subBg: "#0a1520",
    deepBg: "#060f1a",
    border: "#1e3347",
    textPrim: "#f1f5f9",
    textSec: "#cbd5e1",
    textMute: "#94a3b8",
    textDim: "#64748b",
    textFaint: "#334155",
    green: "#22c55e",
    red: "#f87171",
    amber: "#fbbf24",
    blue: "#60a5fa",
    purple: "#a78bfa",
  },
  light: {
    pageBg: "#f0f4f8",
    cardBg: "#ffffff",
    headerBg: "#f8fafc",
    subBg: "#f1f5f9",
    deepBg: "#e2e8f0",
    border: "#cbd5e1",
    textPrim: "#0f172a",
    textSec: "#1e293b",
    textMute: "#334155",
    textDim: "#64748b",
    textFaint: "#94a3b8",
    green: "#16a34a",
    red: "#dc2626",
    amber: "#d97706",
    blue: "#2563eb",
    purple: "#7c3aed",
  },
};

const T = THEMES[ENV.EMAIL_THEME] || THEMES.dark;

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

const esc = (v) => String(v ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sgn = (n) => (n == null ? "" : n >= 0 ? "+" : "");
const pC = (n) => n == null ? T.textMute : n >= 0 ? T.green : T.red;

const TREND_COLOR = { STRONG_BULL: T.green, BULL: T.green, SIDEWAYS: T.amber, BEAR: T.red, STRONG_BEAR: T.red };
const ACTION_CFG = {
  STRONG_BUY: { color: T.green, label: "▲▲ STRONG BUY" },
  BUY: { color: T.green, label: "▲ BUY" },
  HOLD: { color: T.amber, label: "● HOLD" },
  SELL: { color: T.red, label: "▼ SELL" },
  STRONG_SELL: { color: T.red, label: "▼▼ STRONG SELL" },
  SKIP: { color: T.textDim, label: "— N/A" },
};
const CONF_COLOR = { "Very High": T.purple, High: T.blue, Medium: T.amber, Low: T.textDim };

function pill(text, color) {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}44;">${esc(text)}</span>`;
}

function rsiBar(rsi) {
  if (rsi == null) return "";
  const c = rsi < 30 ? T.green : rsi > 70 ? T.red : T.amber;
  const zone = rsi < 20 ? "Extreme OS" : rsi < 30 ? "Oversold" : rsi < 45 ? "Mild OS"
    : rsi > 80 ? "Extreme OB" : rsi > 70 ? "Overbought" : rsi > 55 ? "Mild OB" : "Neutral";
  const w = Math.max(0, Math.min(100, rsi));
  return `<div style="margin-bottom:7px;">
  <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
    <span style="color:${T.textMute};font-weight:600;">RSI-14: <b style="color:${c};">${rsi}</b></span>
    <span style="font-size:10px;color:${c};font-weight:700;">${zone}</span>
  </div>
  <div style="height:7px;background:${T.subBg};border-radius:4px;overflow:hidden;position:relative;">
    <div style="position:absolute;left:30%;width:1px;height:100%;background:${T.border};"></div>
    <div style="position:absolute;left:70%;width:1px;height:100%;background:${T.border};"></div>
    <div style="width:${w}%;height:100%;background:${c};border-radius:4px;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:9px;color:${T.textFaint};margin-top:1px;">
    <span>0</span><span>30</span><span>70</span><span>100</span>
  </div>
</div>`;
}

function kv(label, value, valueColor) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid ${T.border}22;">
  <span style="font-size:10px;color:${T.textDim};text-transform:uppercase;letter-spacing:.4px;">${esc(label)}</span>
  <span style="font-size:12px;font-weight:600;color:${valueColor || T.textSec};">${esc(value)}</span>
</div>`;
}

// ─────────────────────────────────────────────────────────────
//  STOCK CARD
// ─────────────────────────────────────────────────────────────

function stockCard(sym, sig, rawData, gv) {
  if (sig.action === "SKIP") return "";

  const cfg = ACTION_CFG[sig.action] || ACTION_CFG.HOLD;
  const isBuy = sig.action === "BUY" || sig.action === "STRONG_BUY";
  const isSell = sig.action === "SELL" || sig.action === "STRONG_SELL";
  const gvc = gv ? { Agree: T.green, Disagree: T.red, Partial: T.amber }[gv.verdict] || T.textMute : null;

  const macdLabel = sig.macd?.crossover
    ? `⚡ ${sig.macd.crossover.replace("_", " ")}`
    : sig.macd?.histogram != null
      ? `Hist ${sig.macd.histogram > 0 ? "+" : ""}${sig.macd.histogram} (${sig.macd.histTrend})`
      : "—";

  const bullRows = (sig.bullReasons || []).slice(0, 5)
    .map(r => `<div style="padding:2px 0;font-size:11px;color:${T.green};">✓ ${esc(r)}</div>`).join("");
  const bearRows = (sig.bearReasons || []).slice(0, 5)
    .map(r => `<div style="padding:2px 0;font-size:11px;color:${T.red};">✗ ${esc(r)}</div>`).join("");
  const neutralRows = (sig.neutralNotes || []).slice(0, 2)
    .map(r => `<div style="padding:2px 0;font-size:11px;color:${T.textDim};">◦ ${esc(r)}</div>`).join("");

  const patternPills = (sig.patterns || [])
    .map(p => pill(p.name, p.bias === "BULLISH" ? T.green : p.bias === "BEARISH" ? T.red : T.amber))
    .join(" ");

  const maRow = [["MA5", sig.ma5], ["MA10", sig.ma10], ["MA20", sig.ma20], ["MA50", sig.ma50], ["MA200", sig.ma200], ["EMA9", sig.ema9], ["EMA21", sig.ema21]]
    .filter(([, v]) => v != null)
    .map(([l, v]) => `<span style="margin-right:10px;font-size:11px;"><span style="color:${T.textDim};">${l} </span><span style="color:${sig.price >= v ? T.green : T.red};font-weight:600;">${v}</span></span>`)
    .join("");

  const pivotRow = sig.pivots
    ? [["R2", sig.pivots.r2, T.red], ["R1", sig.pivots.r1, T.red], ["Pvt", sig.pivots.pivot, T.textMute], ["S1", sig.pivots.s1, T.green], ["S2", sig.pivots.s2, T.green]]
      .filter(([, v]) => v != null)
      .map(([l, v, c]) => `<span style="margin-right:8px;font-size:11px;color:${c};">${l}: <b>${v}</b></span>`)
      .join("")
    : "";

  // Potential gain/loss PKR amounts
  const gainAmt = isBuy || isSell
    ? Math.round(Math.abs(((sig.targetPrice || 0) - (sig.limitPrice || 0)) * (sig.qty || 0)))
    : 0;
  const riskAmt = isBuy || isSell
    ? Math.round(Math.abs(((sig.limitPrice || 0) - (sig.stopLoss || 0)) * (sig.qty || 0)))
    : 0;

  return `
<div style="background:${T.cardBg};border:1px solid ${T.border};border-left:5px solid ${cfg.color};border-radius:14px;margin-bottom:18px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${T.headerBg};border-bottom:1px solid ${T.border};">
    <tr>
      <td style="padding:12px 16px;">
        <div>
          <span style="font-size:20px;font-weight:900;color:${T.textPrim};">${esc(sym)}</span>
          <span style="font-size:11px;color:${T.textDim};margin-left:8px;padding:2px 8px;background:${T.subBg};border-radius:99px;">${esc(rawData?.sector || "")}</span>
        </div>
        <div style="font-size:11px;color:${T.textDim};margin-top:2px;">${esc(rawData?.name || "")}</div>
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:top;">
        ${pill(cfg.label, cfg.color)}
        <div style="margin-top:5px;">
          <span style="font-size:10px;color:${CONF_COLOR[sig.confidence] || T.textDim};font-weight:700;">${esc(sig.confidence)} Confidence</span>
          <span style="font-size:10px;color:${T.textDim};margin-left:6px;">(score ${sig.score >= 0 ? "+" : ""}${sig.score})</span>
        </div>
      </td>
    </tr>
  </table>

  <!-- Price + P&L + live tick -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${T.border};">
    <tr>
      <td style="padding:12px 16px;">
        <div style="font-size:28px;font-weight:900;color:${T.textPrim};letter-spacing:-1px;">
          PKR ${esc(sig.price)}
          ${sig.changePct != null ? `<span style="font-size:14px;font-weight:700;color:${pC(sig.changePct)};margin-left:8px;">${sgn(sig.changePct)}${esc(sig.changePct)}%</span>` : ""}
        </div>
        <div style="font-size:11px;color:${T.textDim};margin-top:3px;">
          O: <b style="color:${T.textMute};">${esc(sig.open)}</b> &nbsp;
          H: <b style="color:${T.green};">${esc(sig.high)}</b> &nbsp;
          L: <b style="color:${T.red};">${esc(sig.low)}</b>
          ${sig.bid != null ? `&nbsp;· Bid: <b style="color:${T.textMute};">${esc(sig.bid)}</b> Ask: <b style="color:${T.textMute};">${esc(sig.ask)}</b>` : ""}
        </div>
        <div style="font-size:11px;color:${T.textDim};margin-top:2px;">
          Avg cost: <b style="color:${T.textMute};">PKR ${esc(sig.avgCost)}</b> &nbsp;·&nbsp;
          ${esc(sig.shares?.toLocaleString())} shares &nbsp;·&nbsp;
          Value: <b style="color:${T.textMute};">PKR ${(sig.marketValue || 0).toLocaleString()}</b>
        </div>
        <!-- Fundamentals if available -->
        ${rawData?.fundamentals?.peRatio != null ? `
        <div style="font-size:11px;color:${T.textDim};margin-top:2px;">
          P/E: <b style="color:${T.textMute};">${rawData.fundamentals.peRatio}x</b> &nbsp;·&nbsp;
          Div Yield: <b style="color:${T.green};">${rawData.fundamentals.dividendYield}%</b>
          ${rawData.fundamentals.marketCap ? `&nbsp;·&nbsp; Mkt Cap: <b style="color:${T.textMute};">${rawData.fundamentals.marketCap}</b>` : ""}
        </div>` : ""}
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:middle;">
        <div style="font-size:22px;font-weight:900;color:${pC(sig.unrealizedPct)};">${sgn(sig.unrealizedPct)}${esc(sig.unrealizedPct)}%</div>
        <div style="font-size:13px;font-weight:700;color:${pC(sig.unrealizedPnl)};">${sgn(sig.unrealizedPnl)}PKR ${(sig.unrealizedPnl || 0).toLocaleString()}</div>
        <div style="font-size:10px;color:${T.textDim};margin-top:2px;">Unrealised P&amp;L</div>
      </td>
    </tr>
  </table>

  <!-- Sparkline + performance -->
  <div style="padding:8px 16px;border-bottom:1px solid ${T.border};background:${T.subBg};">
    ${sig.sparkline ? `<div style="font-family:monospace;font-size:14px;color:${pC(sig.perf1d)};letter-spacing:1px;margin-bottom:5px;">${esc(sig.sparkline)}&nbsp;<span style="font-size:10px;color:${T.textDim};">20-day</span></div>` : ""}
    <div style="display:flex;gap:14px;font-size:11px;flex-wrap:wrap;">
      ${[["1D", sig.perf1d], ["1W", sig.perf1w], ["1M", sig.perf1m], ["6M", sig.perf6m]].map(([l, v]) =>
    `<span><span style="color:${T.textDim};">${l}</span> <span style="color:${pC(v)};font-weight:700;">${sgn(v)}${esc(v)}%</span></span>`
  ).join("")}
      <span style="margin-left:auto;"><span style="color:${T.textDim};">MaxDD</span> <span style="color:${T.red};">${esc(sig.maxDrawdown)}%</span></span>
    </div>
  </div>

  <!-- Indicators 2-column -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${T.border};">
    <tr>
      <td style="padding:10px 16px;width:50%;vertical-align:top;border-right:1px solid ${T.border};">
        ${rsiBar(sig.rsi14)}
        <div style="font-size:11px;color:${T.textSec};margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">Stoch: </span>
          <span style="color:${sig.stoch?.zone === "OVERSOLD" ? T.green : sig.stoch?.zone === "OVERBOUGHT" ? T.red : T.textMute};font-weight:600;">${esc(sig.stoch?.k)}/${esc(sig.stoch?.d)}</span>
          <span style="color:${T.textDim};font-size:10px;"> (${esc(sig.stoch?.zone)})</span>
        </div>
        <div style="font-size:11px;color:${T.textSec};margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">MACD: </span>
          <span style="color:${sig.macd?.crossover ? (sig.macd.crossover === "BULLISH_CROSS" ? T.green : T.red) : sig.macd?.histogram > 0 ? T.green : T.red};">${esc(macdLabel)}</span>
        </div>
        <div style="font-size:11px;color:${T.textSec};margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">Williams %R: </span>
          <span style="color:${sig.willR != null ? (sig.willR < -80 ? T.green : sig.willR > -20 ? T.red : T.textMute) : T.textMute};">${esc(sig.willR)}</span>
          &nbsp;<span style="color:${T.textDim};font-weight:600;">CCI: </span>
          <span style="color:${sig.cci != null ? (sig.cci < -100 ? T.green : sig.cci > 100 ? T.red : T.textMute) : T.textMute};">${esc(sig.cci)}</span>
        </div>
        <div style="font-size:11px;color:${T.textSec};">
          <span style="color:${T.textDim};font-weight:600;">BB %B: </span>
          <span style="color:${sig.bb?.pctB != null ? (sig.bb.pctB < 20 ? T.green : sig.bb.pctB > 80 ? T.red : T.textMute) : T.textMute};">${esc(round2(sig.bb?.pctB))}</span>
          ${sig.bb?.squeeze ? `<span style="color:${T.amber};font-size:10px;margin-left:6px;">⚡SQUEEZE</span>` : ""}
        </div>
      </td>
      <td style="padding:10px 16px;vertical-align:top;">
        <div style="font-size:11px;margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">Trend: </span>
          <span style="color:${TREND_COLOR[sig.trend] || T.textMute};font-weight:700;">${esc(sig.trend)}</span>
        </div>
        <div style="font-size:11px;margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">ADX: </span>
          <span style="color:${sig.adx?.strength?.includes("BULL") ? T.green : sig.adx?.strength?.includes("BEAR") ? T.red : T.textMute};">${esc(sig.adx?.adx)} (${esc(sig.adx?.strength)})</span>
        </div>
        <div style="font-size:11px;margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">Ichimoku: </span>
          <span style="color:${sig.ichi?.position === "ABOVE_CLOUD" ? T.green : sig.ichi?.position === "BELOW_CLOUD" ? T.red : T.amber};">${esc(sig.ichi?.position)}</span>
        </div>
        <div style="font-size:11px;margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">OBV: </span>
          <span style="color:${sig.obv?.trend === "ACCUMULATION" ? T.green : sig.obv?.trend === "DISTRIBUTION" ? T.red : T.textMute};">${esc(sig.obv?.trend)}</span>
        </div>
        <div style="font-size:11px;margin-bottom:4px;">
          <span style="color:${T.textDim};font-weight:600;">VWAP: </span>
          <span style="color:${T.textMute};">PKR ${esc(sig.vwap)}</span>
          <span style="color:${sig.price < sig.vwap ? T.green : T.red};font-size:10px;"> (${sig.price < sig.vwap ? "below" : "above"})</span>
        </div>
        <div style="font-size:11px;">
          <span style="color:${T.textDim};font-weight:600;">Vol: </span>
          <span style="color:${sig.vol?.volSpike ? T.amber : T.textMute};">${esc(sig.vol?.volRatio)}x avg</span>
          <span style="color:${T.textDim};"> (${esc(sig.vol?.volTrend)})</span>
        </div>
        ${sig.divergence ? `<div style="margin-top:5px;">${pill(sig.divergence.replace(/_/g, " "), sig.divergence.includes("BULLISH") ? T.green : T.red)}</div>` : ""}
      </td>
    </tr>
  </table>

  <!-- Moving averages -->
  <div style="padding:7px 16px;border-bottom:1px solid ${T.border};background:${T.subBg};">
    <span style="font-size:10px;color:${T.textDim};text-transform:uppercase;letter-spacing:.5px;font-weight:700;">MAs: </span>
    ${maRow}
  </div>

  <!-- Trade instruction -->
  <div style="padding:12px 16px;border-bottom:1px solid ${T.border};">
    <div style="background:${cfg.color}10;border-left:4px solid ${cfg.color};border-radius:8px;padding:12px 14px;">
      <div style="font-size:10px;font-weight:800;color:${cfg.color};text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📋 Trade Instruction</div>
      <div style="font-size:15px;font-weight:700;color:${T.textPrim};">${esc(sig.instruction)}</div>
      ${(isBuy || isSell) && sig.targetPrice ? `
      <table style="margin-top:10px;width:100%;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:${T.green};padding-right:14px;">🎯 Target: <b>PKR ${esc(sig.targetPrice)}</b></td>
          <td style="font-size:12px;color:${T.red};padding-right:14px;">🛑 Stop Loss: <b>PKR ${esc(sig.stopLoss)}</b></td>
          <td style="font-size:12px;color:${T.purple};">⚖️ R/R: <b>1:${esc(sig.rrRatio)}</b></td>
        </tr>
        <tr>
          <td colspan="3" style="padding-top:5px;font-size:11px;color:${T.textDim};">
            Potential gain: <b style="color:${T.green};">PKR ${gainAmt.toLocaleString()}</b>
            &nbsp;·&nbsp; Max risk: <b style="color:${T.red};">PKR ${riskAmt.toLocaleString()}</b>
          </td>
        </tr>
      </table>` : ""}
    </div>
    <!-- Beginner note -->
    <div style="margin-top:8px;padding:9px 12px;background:${T.subBg};border-radius:7px;border-left:3px solid ${T.blue};">
      <div style="font-size:10px;color:${T.blue};font-weight:700;margin-bottom:3px;">📗 SIMPLE EXPLANATION</div>
      <div style="font-size:12px;color:${T.textSec};line-height:1.6;">${esc(sig.beginnerNote)}</div>
    </div>
    <!-- Pro summary -->
    <div style="margin-top:5px;font-size:10px;color:${T.textDim};font-style:italic;padding:3px 6px;">${esc(sig.proSummary)}</div>
  </div>

  <!-- Pivot levels -->
  ${pivotRow ? `
  <div style="padding:7px 16px;border-bottom:1px solid ${T.border};background:${T.subBg};">
    <span style="font-size:10px;color:${T.textDim};font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Pivots: </span>
    ${pivotRow}
  </div>` : ""}

  <!-- Signal reasons -->
  ${bullRows || bearRows || neutralRows ? `
  <div style="padding:8px 16px;border-bottom:1px solid ${T.border};">
    ${bullRows}${bearRows}${neutralRows}
    ${patternPills ? `<div style="margin-top:5px;">${patternPills}</div>` : ""}
  </div>` : ""}

  <!-- Recent dividends -->
  ${rawData?.dividends?.length ? `
  <div style="padding:7px 16px;border-bottom:1px solid ${T.border};background:${T.subBg};font-size:11px;">
    <span style="color:${T.textDim};font-weight:700;">Recent Dividends: </span>
    ${rawData.dividends.map(d => `<span style="color:${T.green};margin-right:10px;">PKR ${d.amount} (${d.exDate})</span>`).join("")}
  </div>` : ""}

  <!-- Gemini validation -->
  ${gv ? `
  <div style="padding:10px 16px;border-bottom:1px solid ${T.border};background:${T.deepBg};">
    <div style="font-size:11px;margin-bottom:4px;">
      <span style="color:${T.purple};font-weight:800;">🤖 Gemini:</span>
      <span style="color:${gvc};font-weight:700;margin-left:6px;">${esc(gv.verdict)}</span>
      <span style="color:${T.textDim};margin-left:6px;">· ${esc(gv.conviction)} conv · ${esc(gv.time_horizon)}</span>
    </div>
    <div style="font-size:11px;color:${T.textSec};line-height:1.6;margin-bottom:5px;">${esc(gv.analyst_note)}</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;margin-bottom:5px;">
      ${gv.key_catalyst ? `<div style="color:${T.green};">⚡ ${esc(gv.key_catalyst)}</div>` : ""}
      ${gv.key_risk ? `<div style="color:${T.red};">⚠️ ${esc(gv.key_risk)}</div>` : ""}
    </div>
    ${gv.alt_action ? `<div style="font-size:11px;color:${T.amber};">↳ Alt: ${esc(gv.alt_action)}${gv.alt_price ? ` @ PKR ${esc(gv.alt_price)}` : ""}</div>` : ""}
    ${gv.beginner_explanation ? `
    <div style="margin-top:6px;padding:7px 10px;background:${T.subBg};border-radius:6px;border-left:3px solid ${T.purple};">
      <div style="font-size:10px;color:${T.purple};font-weight:700;margin-bottom:2px;">🎓 Coach</div>
      <div style="font-size:12px;color:${T.textSec};line-height:1.5;">${esc(gv.beginner_explanation)}</div>
    </div>` : ""}
  </div>` : ""}

</div>`;
}

// ─────────────────────────────────────────────────────────────
//  HELPER: parse compact Gemini keys for display
// ─────────────────────────────────────────────────────────────

function round2(n) { return (n == null || isNaN(n)) ? null : Math.round(n * 100) / 100; }

// ─────────────────────────────────────────────────────────────
//  MAIN EMAIL BUILDER
// ─────────────────────────────────────────────────────────────

function buildHtmlEmail(stockData, signals, summary, performance, gemini, timeStamp) {
  const dataMap = {};
  for (const [k, d] of Object.entries(stockData)) {
    if (k !== "__market__") dataMap[k] = d;
  }

  const counts = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0, SKIP: 0 };
  for (const s of Object.values(signals)) counts[s.action] = (counts[s.action] || 0) + 1;

  const pnlUp = (summary.totalPnl || 0) >= 0;
  const pnlC = pnlUp ? T.green : T.red;

  // Expand compact Gemini response
  const { expandMarket, expandAnalysis } = require("../gemini");
  const m = expandMarket(gemini?.market);
  const a = expandAnalysis(gemini?.analysis);
  const stanceC = { Bull: T.green, Bear: T.red, Neutral: T.amber, Bullish: T.green, Bearish: T.red }[a?.overall_stance || m?.overall_stance] || T.textMute;

  // Sector weight bars
  const sectorRows = Object.entries(summary.sectorWeights || {})
    .sort(([, a], [, b]) => b - a)
    .map(([s, w]) => `
        <tr>
          <td style="font-size:11px;color:${T.textSec};padding:3px 0;width:120px;">${esc(s)}</td>
          <td style="padding:3px 8px;">
            <div style="height:7px;background:${T.subBg};border-radius:4px;overflow:hidden;">
              <div style="width:${Math.min(100, w * 3)}%;height:100%;background:${T.blue};border-radius:4px;"></div>
            </div>
          </td>
          <td style="font-size:11px;color:${T.textDim};padding:3px 0;width:36px;">${esc(w)}%</td>
        </tr>`).join("");

  let cards = "";
  for (const [sym, sig] of Object.entries(signals)) {
    if (sig.action === "SKIP") continue;
    const gv = a?.validation?.find(v => v.symbol === sym);
    cards += stockCard(sym, sig, dataMap[sym], gv);
  }

  // Gemini intelligence block
  const stanceLabel = a?.overall_stance || m?.overall_stance;
  const geminiBlock = (m || a) ? `
<div style="background:${T.cardBg};border:1px solid ${T.border};border-radius:14px;margin-bottom:18px;overflow:hidden;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${T.headerBg};border-bottom:1px solid ${T.border};">
    <tr>
      <td style="padding:12px 16px;">
        <span style="font-size:13px;font-weight:900;color:${T.purple};">🤖 GEMINI AI INTELLIGENCE</span>
        ${m?.global?.oil_brent_usd ? `<span style="font-size:10px;color:${T.textDim};margin-left:8px;">(Google Search grounded)</span>` : ""}
      </td>
      ${stanceLabel ? `<td style="padding:12px 16px;text-align:right;">${pill(stanceLabel, stanceC)}</td>` : ""}
    </tr>
  </table>

  ${m && !m.raw ? `
  <div style="padding:12px 16px;border-bottom:1px solid ${T.border};">
    <div style="font-size:10px;color:${T.textDim};font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Global Markets</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">🛢 Brent <b>$${esc(m.global?.oil_brent_usd)}</b> <span style="color:${m.global?.oil_trend === "Rising" ? T.green : T.red};">${esc(m.global?.oil_trend)}</span></span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">💵 PKR/USD <b>${esc(m.global?.usd_pkr)}</b></span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">🏦 Fed <b>${esc(m.global?.fed_stance)}</b></span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">📈 10Y <b>${esc(m.global?.us_10y_yield)}</b></span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${m.global?.sentiment === "Risk-On" ? T.green : T.red};">${esc(m.global?.sentiment)}</span>
    </div>
    ${(m.global?.key_drivers || []).length ? `<div style="margin-top:7px;font-size:11px;color:${T.textDim};">Drivers: ${m.global.key_drivers.map(esc).join(" · ")}</div>` : ""}
  </div>

  <div style="padding:12px 16px;border-bottom:1px solid ${T.border};">
    <div style="font-size:10px;color:${T.textDim};font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Pakistan Macro</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">📊 KSE-100 <b>${esc(m.pakistan?.kse100_level)}</b> <span style="color:${pC(parseFloat(m.pakistan?.kse100_chg))};">${esc(m.pakistan?.kse100_chg)}%</span></span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">🏛 SBP <b>${esc(m.pakistan?.sbp_rate)}</b> (${esc(m.pakistan?.sbp_outlook)})</span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">📉 CPI <b>${esc(m.pakistan?.cpi)}</b> ${esc(m.pakistan?.cpi_trend)}</span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">🤝 IMF <b>${esc(m.pakistan?.imf_program)}</b></span>
      <span style="background:${T.subBg};border:1px solid ${T.border};padding:4px 10px;border-radius:7px;color:${T.textSec};">💰 FX <b>$${esc(m.pakistan?.fx_reserves)}bn</b></span>
    </div>
    <div style="margin-top:7px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;">
      ${(m.pakistan?.key_risks || []).length ? `<div style="color:${T.red};">⚠️ ${m.pakistan.key_risks.map(esc).join(" · ")}</div>` : ""}
      ${(m.pakistan?.key_tailwinds || []).length ? `<div style="color:${T.green};">✅ ${m.pakistan.key_tailwinds.map(esc).join(" · ")}</div>` : ""}
    </div>
  </div>

  ${m.sector_outlook ? `
  <div style="padding:12px 16px;border-bottom:1px solid ${T.border};">
    <div style="font-size:10px;color:${T.textDim};font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Sector Outlook</div>
    <table cellpadding="0" cellspacing="0" width="100%">
    ${Object.entries(m.sector_outlook).map(([sec, val]) => {
    const v = String(val);
    const sc = v.includes("Bull") ? T.green : v.includes("Bear") ? T.red : T.amber;
    return `<tr><td style="font-size:11px;color:${T.textDim};padding:3px 0;min-width:110px;">${esc(sec)}</td><td style="font-size:11px;color:${sc};padding:3px 0;">${esc(val)}</td></tr>`;
  }).join("")}
    </table>
  </div>` : ""}

  ${m.today_headline ? `<div style="padding:10px 16px;border-bottom:1px solid ${T.border};font-size:13px;color:${T.textSec};font-style:italic;line-height:1.5;">"${esc(m.today_headline)}"</div>` : ""}
  ` : m?.raw ? `<div style="padding:12px 16px;font-size:12px;color:${T.textSec};">${esc(m.raw)}</div>` : ""}

  ${a?.portfolio_health ? `
  <div style="padding:12px 16px;border-bottom:1px solid ${T.border};">
    <div style="font-size:10px;color:${T.textDim};font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Portfolio Assessment</div>
    <div style="font-size:12px;color:${T.textSec};margin-bottom:4px;">${esc(a.portfolio_health.pnl_comment)}</div>
    <div style="font-size:12px;color:${T.textSec};margin-bottom:6px;">${esc(a.portfolio_health.concentration_detail)}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;">
      ${a.portfolio_health.best_positioned ? `<div style="color:${T.green};">⭐ Best: ${esc(a.portfolio_health.best_positioned)}</div>` : ""}
      ${a.portfolio_health.biggest_risk ? `<div style="color:${T.red};">⚠️ Risk: ${esc(a.portfolio_health.biggest_risk)}</div>` : ""}
    </div>
    ${a.macro_impact ? `<div style="margin-top:6px;font-size:11px;color:${T.textDim};font-style:italic;">${esc(a.macro_impact)}</div>` : ""}
  </div>` : ""}

  ${(a?.top_trade_today || a?.avoid_today) ? `
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      ${a.top_trade_today ? `<td style="padding:11px 16px;width:50%;vertical-align:top;">
        <div style="background:${T.green}0d;border:1px solid ${T.green}30;border-radius:9px;padding:10px;">
          <div style="font-size:10px;color:${T.green};font-weight:800;letter-spacing:1px;margin-bottom:4px;">⭐ TOP TRADE TODAY</div>
          <div style="font-size:12px;color:${T.textSec};line-height:1.5;">${esc(a.top_trade_today)}</div>
        </div>
      </td>` : ""}
      ${a.avoid_today ? `<td style="padding:11px 16px;vertical-align:top;">
        <div style="background:${T.red}0d;border:1px solid ${T.red}30;border-radius:9px;padding:10px;">
          <div style="font-size:10px;color:${T.red};font-weight:800;letter-spacing:1px;margin-bottom:4px;">🚫 AVOID TODAY</div>
          <div style="font-size:12px;color:${T.textSec};line-height:1.5;">${esc(a.avoid_today)}</div>
        </div>
      </td>` : ""}
    </tr>
  </table>` : ""}

  ${a?.daily_tip ? `
  <div style="padding:10px 16px;background:${T.deepBg};border-top:1px solid ${T.border};">
    <span style="font-size:10px;color:${T.purple};font-weight:700;text-transform:uppercase;letter-spacing:1px;">🎓 Tip: </span>
    <span style="font-size:12px;color:${T.textSec};">${esc(a.daily_tip)}</span>
    ${a.emotional_state ? `<span style="margin-left:8px;">${pill(a.emotional_state, T.purple)}</span>` : ""}
  </div>` : ""}
</div>` : "";

  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PSX Report · ${timeStamp}</title></head>
<body style="margin:0;padding:0;background:${T.pageBg};-webkit-font-smoothing:antialiased;">
<div style="max-width:680px;margin:0 auto;padding:14px;font-family:'Segoe UI',system-ui,Arial,sans-serif;">

  <!-- HEADER -->
  <div style="background:${ENV.EMAIL_THEME === "light" ? "linear-gradient(140deg,#e0f2fe,#f0f9ff,#dbeafe)" : "linear-gradient(140deg,#071e3d,#0a2444,#061628)"};border:1px solid ${T.border};border-radius:18px;padding:24px;margin-bottom:14px;">
    <div style="font-size:10px;color:${T.blue};font-weight:800;letter-spacing:3px;text-transform:uppercase;">Pakistan Stock Exchange · KSE-100</div>
    <div style="font-size:30px;font-weight:900;color:${T.textPrim};margin:6px 0 3px;letter-spacing:-1px;">📊 Trading Report</div>
    <div style="font-size:12px;color:${T.textDim};">${esc(timeStamp)}</div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
      ${counts.STRONG_BUY ? pill(`▲▲ STRONG BUY ${counts.STRONG_BUY}`, T.green) : ""}
      ${counts.BUY ? pill(`▲ BUY ${counts.BUY}`, T.green) : ""}
      ${pill(`● HOLD ${counts.HOLD}`, T.amber)}
      ${counts.SELL ? pill(`▼ SELL ${counts.SELL}`, T.red) : ""}
      ${counts.STRONG_SELL ? pill(`▼▼ STRONG SELL ${counts.STRONG_SELL}`, T.red) : ""}
      ${performance ? pill(`🎯 ${performance.accuracy}% accuracy`, T.purple) : ""}
    </div>
  </div>

  <!-- PORTFOLIO SUMMARY -->
  <div style="background:${T.cardBg};border:1px solid ${T.border};border-radius:14px;padding:16px 20px;margin-bottom:14px;">
    <div style="font-size:10px;color:${T.textDim};font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Portfolio Overview</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align:left;padding-bottom:8px;">
          <div style="font-size:10px;color:${T.textDim};">Invested</div>
          <div style="font-size:16px;font-weight:700;color:${T.textDim};">PKR ${(summary.totalCost || 0).toLocaleString()}</div>
        </td>
        <td style="text-align:center;padding-bottom:8px;">
          <div style="font-size:10px;color:${T.textDim};">Market Value</div>
          <div style="font-size:20px;font-weight:800;color:${T.textPrim};">PKR ${(summary.totalValue || 0).toLocaleString()}</div>
        </td>
        <td style="text-align:right;padding-bottom:8px;">
          <div style="font-size:10px;color:${T.textDim};">Unrealised P&amp;L</div>
          <div style="font-size:24px;font-weight:900;color:${pnlC};">${pnlUp ? "+" : ""}PKR ${(summary.totalPnl || 0).toLocaleString()}</div>
          <div style="font-size:14px;font-weight:800;color:${pnlC};">${pnlUp ? "+" : ""}${summary.totalPnlPct || 0}%</div>
        </td>
      </tr>
    </table>
    <div style="margin-top:14px;border-top:1px solid ${T.border};padding-top:12px;">
      <div style="font-size:10px;color:${T.textDim};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Sector Allocation</div>
      <table width="100%" cellpadding="0" cellspacing="0">${sectorRows}</table>
    </div>
  </div>

  ${geminiBlock}

  <div style="font-size:10px;color:${T.textDim};font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Individual Position Signals</div>
  ${cards}

  <div style="text-align:center;padding:20px;font-size:10px;color:${T.textFaint};line-height:1.7;">
    PSX Agent · ${esc(timeStamp)}<br/>
    Algorithmic signals only — not financial advice.
  </div>
</div></body></html>`;
}

module.exports = { buildHtmlEmail };