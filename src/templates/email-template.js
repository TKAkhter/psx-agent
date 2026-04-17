"use strict";

// ─── Template utilities ───────────────────────────────────────
const esc = (v) => String(v ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sgn = (n) => (n == null ? "" : n >= 0 ? "+" : "");
const upC = "#22c55e";   // green  — always ≥ 4.5:1 on dark bg
const dnC = "#f87171";   // red
const amC = "#fbbf24";   // amber
const muC = "#a78bfa";   // purple (Gemini/AI)
const blC = "#60a5fa";   // blue (info)
const ntC = "#94a3b8";   // neutral text
const dimC = "#64748b";   // dim labels
const bgC = "#0f1923";   // card bg
const bdrC = "#1e3347";   // border

const pnlColor = (n) => n == null ? ntC : n >= 0 ? upC : dnC;
const trendColor = (t) => ({ STRONG_BULL: upC, BULL: upC, SIDEWAYS: amC, BEAR: dnC, STRONG_BEAR: dnC }[t] || ntC);

// Action → color + label
const ACTION_MAP = {
  STRONG_BUY: { color: upC, label: "▲▲ STRONG BUY", border: upC },
  BUY: { color: upC, label: "▲ BUY", border: upC },
  HOLD: { color: amC, label: "● HOLD", border: amC },
  SELL: { color: dnC, label: "▼ SELL", border: dnC },
  STRONG_SELL: { color: dnC, label: "▼▼ STRONG SELL", border: dnC },
  SKIP: { color: dimC, label: "— N/A", border: dimC },
};
const confColor = (c) => ({ "Very High": muC, High: blC, Medium: amC, Low: dimC }[c] || dimC);

function badge(text, color, bg) {
  const bgVal = bg || color + "22";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.3px;background:${bgVal};color:${color};border:1px solid ${color}44;">${esc(text)}</span>`;
}

// ─── RSI visual bar ──────────────────────────────────────────
function rsiBar(rsi) {
  if (rsi == null) return `<span style="color:${dimC};font-size:11px;">RSI —</span>`;
  const c = rsi < 30 ? upC : rsi > 70 ? dnC : amC;
  const zone = rsi < 20 ? "Extreme OS" : rsi < 30 ? "Oversold" : rsi < 45 ? "Mild OS"
    : rsi > 80 ? "Extreme OB" : rsi > 70 ? "Overbought" : rsi > 55 ? "Mild OB" : "Neutral";
  const pct = Math.max(0, Math.min(100, rsi));
  return `
    <div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
        <span style="font-size:11px;color:${ntC};font-weight:600;">RSI-14: <b style="color:${c};">${rsi}</b></span>
        <span style="font-size:10px;color:${c};font-weight:600;">${zone}</span>
      </div>
      <div style="height:7px;background:#162130;border-radius:4px;position:relative;overflow:hidden;">
        <div style="position:absolute;left:30%;width:1px;height:100%;background:#334155;"></div>
        <div style="position:absolute;left:70%;width:1px;height:100%;background:#334155;"></div>
        <div style="width:${pct}%;height:100%;background:${c};border-radius:4px;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:1px;font-size:9px;color:#2d4258;">
        <span>0</span><span style="margin-left:24%;">30</span><span style="margin-left:30%;">70</span><span>100</span>
      </div>
    </div>`;
}

// ─── Sparkline row ───────────────────────────────────────────
function sparkRow(sparkline, perf1d) {
  if (!sparkline) return "";
  const c = (perf1d || 0) >= 0 ? upC : dnC;
  return `
    <div style="margin:6px 0;padding:6px 10px;background:#0a1520;border-radius:6px;font-family:monospace;">
      <span style="font-size:13px;color:${c};letter-spacing:1px;">${esc(sparkline)}</span>
      <span style="font-size:10px;color:${dimC};margin-left:8px;">20-day price</span>
    </div>`;
}

// ─── Indicator grid cell ─────────────────────────────────────
function cell(label, value, color) {
  return `<td style="padding:4px 8px 4px 0;vertical-align:top;white-space:nowrap;">
      <div style="font-size:9px;color:${dimC};text-transform:uppercase;letter-spacing:.5px;">${esc(label)}</div>
      <div style="font-size:12px;font-weight:700;color:${color || ntC};">${esc(value)}</div>
    </td>`;
}

// ─── One stock card ──────────────────────────────────────────
function buildStockCard(sym, sig, rawData, geminiValidation, geminiBeginnerNote) {
  if (sig.action === "SKIP") return "";
  const am = ACTION_MAP[sig.action] || ACTION_MAP.HOLD;
  const isBuy = sig.action === "BUY" || sig.action === "STRONG_BUY";
  const isSell = sig.action === "SELL" || sig.action === "STRONG_SELL";
  const pnlC = pnlColor(sig.unrealizedPct);
  const gv = geminiValidation;
  const gvc = gv ? { Agree: upC, Disagree: dnC, "Partially Agree": amC }[gv.verdict] || ntC : null;

  const bullRows = (sig.bullReasons || []).slice(0, 5)
    .map(r => `<div style="padding:2px 0;font-size:11px;color:${upC};">✓ ${esc(r)}</div>`).join("");
  const bearRows = (sig.bearReasons || []).slice(0, 5)
    .map(r => `<div style="padding:2px 0;font-size:11px;color:${dnC};">✗ ${esc(r)}</div>`).join("");
  const neutralRows = (sig.neutralNotes || []).slice(0, 2)
    .map(r => `<div style="padding:2px 0;font-size:11px;color:${dimC};">◦ ${esc(r)}</div>`).join("");

  const patternBadges = (sig.patterns || []).map(p => {
    const c = p.bias === "BULLISH" ? upC : p.bias === "BEARISH" ? dnC : amC;
    return badge(p.name, c);
  }).join(" ");

  const stochStr = sig.stoch?.k != null
    ? `${sig.stoch.k}/${sig.stoch.d} <span style="color:${sig.stoch.zone === "OVERSOLD" ? upC : sig.stoch.zone === "OVERBOUGHT" ? dnC : amC};">(${sig.stoch.zone})</span>`
    : "—";

  const adxStr = sig.adx?.adx != null
    ? `${sig.adx.adx} <span style="color:${sig.adx.strength?.includes("BULL") ? upC : sig.adx.strength?.includes("BEAR") ? dnC : amC};">${sig.adx.strength}</span>`
    : "—";

  const ichiStr = sig.ichi?.position
    ? `<span style="color:${sig.ichi.position === "ABOVE_CLOUD" ? upC : sig.ichi.position === "BELOW_CLOUD" ? dnC : amC};">${sig.ichi.position}</span>`
    : "—";

  const macdStr = sig.macd?.crossover
    ? `<span style="color:${sig.macd.crossover === "BULLISH_CROSS" ? upC : dnC};">⚡ ${sig.macd.crossover}</span>`
    : sig.macd?.histogram != null
      ? `<span style="color:${sig.macd.histogram > 0 ? upC : dnC};">Hist ${sig.macd.histogram} (${sig.macd.histTrend})</span>`
      : "—";

  const obvStr = sig.obv?.trend === "ACCUMULATION"
    ? `<span style="color:${upC};">ACCUMULATION</span>`
    : sig.obv?.trend === "DISTRIBUTION"
      ? `<span style="color:${dnC};">DISTRIBUTION</span>`
      : `<span style="color:${dimC};">NEUTRAL</span>`;

  return `
<!-- ╔═══ ${sym} ═══╗ -->
<div style="background:${bgC};border:1px solid ${bdrC};border-left:5px solid ${am.color};border-radius:14px;margin-bottom:18px;overflow:hidden;font-family:'Segoe UI',system-ui,Arial,sans-serif;">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#091320;border-bottom:1px solid ${bdrC};">
    <tr>
      <td style="padding:12px 16px;">
        <div>
          <span style="font-size:20px;font-weight:900;color:#f1f5f9;letter-spacing:.5px;">${esc(sym)}</span>
          <span style="font-size:11px;color:${dimC};margin-left:8px;padding:2px 8px;background:#162130;border-radius:99px;">${esc(rawData?.sector || "")}</span>
        </div>
        <div style="font-size:11px;color:${dimC};margin-top:2px;">${esc(rawData?.name || "")}</div>
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:top;">
        ${badge(am.label, am.color)}
        <div style="margin-top:5px;">
          <span style="font-size:10px;color:${confColor(sig.confidence)};font-weight:700;">${esc(sig.confidence)} Confidence</span>
          <span style="font-size:10px;color:${dimC};margin-left:6px;">(score ${sig.score >= 0 ? "+" : ""}${sig.score})</span>
        </div>
      </td>
    </tr>
  </table>

  <!-- Price + P&L -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${bdrC};">
    <tr>
      <td style="padding:12px 16px;">
        <div style="font-size:26px;font-weight:900;color:#f8fafc;letter-spacing:-1px;">PKR ${esc(sig.price)}</div>
        <div style="font-size:11px;color:${dimC};margin-top:3px;">
          O: <b style="color:${ntC};">${esc(sig.open)}</b> &nbsp;
          H: <b style="color:${upC};">${esc(sig.high)}</b> &nbsp;
          L: <b style="color:${dnC};">${esc(sig.low)}</b>
        </div>
        <div style="font-size:11px;color:${dimC};margin-top:3px;">
          Cost avg: <b style="color:${ntC};">PKR ${esc(sig.avgCost)}</b> &nbsp;·&nbsp; ${esc(sig.shares?.toLocaleString())} shares
        </div>
        <div style="font-size:11px;color:${dimC};margin-top:1px;">
          Market value: <b style="color:${ntC};">PKR ${(sig.marketValue || 0).toLocaleString()}</b> &nbsp;·&nbsp;
          Cost basis: <b style="color:${ntC};">PKR ${(sig.costBasis || 0).toLocaleString()}</b>
        </div>
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:middle;">
        <div style="font-size:22px;font-weight:900;color:${pnlC};">${sgn(sig.unrealizedPct)}${esc(sig.unrealizedPct)}%</div>
        <div style="font-size:13px;font-weight:700;color:${pnlC};">${sgn(sig.unrealizedPnl)}PKR ${(sig.unrealizedPnl || 0).toLocaleString()}</div>
        <div style="font-size:10px;color:${dimC};margin-top:2px;">Unrealised P&amp;L</div>
      </td>
    </tr>
  </table>

  <!-- Sparkline -->
  <div style="padding:4px 16px 2px;border-bottom:1px solid ${bdrC};">
    ${sparkRow(sig.sparkline, sig.perf1d)}
    <div style="display:flex;gap:14px;font-size:11px;padding:2px 0 6px;">
      ${[["1D", sig.perf1d], ["1W", sig.perf1w], ["1M", sig.perf1m], ["6M", sig.perf6m]].map(([l, v]) =>
    `<span><span style="color:${dimC};font-weight:600;">${l}</span> <span style="color:${pnlColor(v)};font-weight:700;">${sgn(v)}${esc(v)}%</span></span>`
  ).join("")}
      <span style="margin-left:auto;"><span style="color:${dimC};">MaxDD</span> <span style="color:${dnC};">${esc(sig.maxDrawdown)}%</span></span>
    </div>
  </div>

  <!-- Indicators grid -->
  <div style="padding:10px 16px;border-bottom:1px solid ${bdrC};">
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:0;vertical-align:top;width:50%;padding-right:12px;">
          ${rsiBar(sig.rsi14)}
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">Stoch %K/%D:</span> ${stochStr}</div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">MACD:</span> ${macdStr}</div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">Williams %R:</span> <span style="color:${sig.willR != null ? (sig.willR < -80 ? upC : sig.willR > -20 ? dnC : ntC) : ntC};">${esc(sig.willR)}</span></div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">CCI:</span> <span style="color:${sig.cci != null ? (sig.cci < -100 ? upC : sig.cci > 100 ? dnC : ntC) : ntC};">${esc(sig.cci)}</span></div>
        </td>
        <td style="padding:0;vertical-align:top;padding-left:12px;border-left:1px solid ${bdrC};">
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">Trend:</span> <span style="color:${trendColor(sig.trend)};font-weight:700;">${esc(sig.trend)}</span></div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">ADX:</span> ${adxStr}</div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">Ichimoku:</span> ${ichiStr}</div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">OBV:</span> ${obvStr}</div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">VWAP:</span> <span style="color:${ntC};">PKR ${esc(sig.vwap)}</span> <span style="color:${dimC};font-size:10px;">(${sig.price < sig.vwap ? "below" : "above"})</span></div>
          <div style="font-size:11px;color:${ntC};margin-bottom:4px;"><span style="color:${dimC};font-weight:600;">Vol ratio:</span> <span style="color:${sig.vol?.volSpike ? amC : ntC};">${esc(sig.vol?.volRatio)}x</span> <span style="color:${dimC};">(${sig.vol?.volTrend})</span></div>
          ${sig.divergence ? `<div style="font-size:11px;margin-bottom:4px;">${badge(sig.divergence.replace("_", " "), sig.divergence.includes("BULLISH") ? upC : dnC)}</div>` : ""}
        </td>
      </tr>
    </table>
  </div>

  <!-- Moving averages row -->
  <div style="padding:8px 16px;border-bottom:1px solid ${bdrC};background:#0b1826;">
    <div style="font-size:10px;color:${dimC};text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Moving Averages</div>
    <table cellpadding="0" cellspacing="0">
      <tr>
        ${[["MA5", sig.ma5], ["MA10", sig.ma10], ["MA20", sig.ma20], ["MA50", sig.ma50], ["MA200", sig.ma200], ["EMA9", sig.ema9], ["EMA21", sig.ema21]]
      .filter(([, v]) => v != null)
      .map(([l, v]) => cell(l, `PKR ${v}`, sig.price >= v ? upC : dnC)).join("")}
      </tr>
    </table>
  </div>

  <!-- Trade instruction box -->
  <div style="padding:12px 16px;border-bottom:1px solid ${bdrC};">
    <div style="background:${am.color}0d;border-left:4px solid ${am.color};border-radius:8px;padding:12px 14px;">
      <div style="font-size:10px;font-weight:800;color:${am.color};text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📋 Trade Instruction</div>
      <div style="font-size:14px;font-weight:700;color:#f1f5f9;">${esc(sig.instruction)}</div>
      ${(isBuy || isSell) && sig.targetPrice ? `
      <table style="margin-top:10px;width:100%;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:${upC};padding-right:16px;">🎯 Target: <b>PKR ${esc(sig.targetPrice)}</b></td>
          <td style="font-size:12px;color:${dnC};padding-right:16px;">🛑 Stop Loss: <b>PKR ${esc(sig.stopLoss)}</b></td>
          <td style="font-size:12px;color:${muC};">⚖️ R/R: <b>1:${esc(sig.rrRatio)}</b></td>
        </tr>
        <tr>
          <td colspan="3" style="padding-top:6px;font-size:11px;color:${dimC};">
            Potential gain: PKR ${Math.round(((sig.targetPrice || 0) - (sig.limitPrice || 0)) * (sig.qty || 0)).toLocaleString()}
            &nbsp;·&nbsp;
            Max risk: PKR ${Math.round(Math.abs(((sig.limitPrice || 0) - (sig.stopLoss || 0)) * (sig.qty || 0))).toLocaleString()}
          </td>
        </tr>
      </table>` : ""}
    </div>
    <!-- Beginner note -->
    <div style="margin-top:8px;padding:8px 12px;background:#0a1520;border-radius:7px;border-left:3px solid ${blC};">
      <div style="font-size:10px;color:${blC};font-weight:700;margin-bottom:3px;">📗 SIMPLE EXPLANATION</div>
      <div style="font-size:12px;color:#c7d9ea;line-height:1.6;">${esc(sig.beginnerNote)}</div>
    </div>
    <!-- Pro summary -->
    <div style="margin-top:5px;padding:5px 8px;background:#060f1a;border-radius:5px;">
      <div style="font-size:10px;color:${dimC};font-style:italic;">${esc(sig.proSummary)}</div>
    </div>
  </div>

  <!-- Pivot levels -->
  ${sig.pivots ? `
  <div style="padding:8px 16px;border-bottom:1px solid ${bdrC};font-size:11px;line-height:2;">
    <span style="color:${dimC};font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px;">Pivot Levels: </span>
    ${[["R3", sig.pivots.r3, dnC], ["R2", sig.pivots.r2, dnC], ["R1", sig.pivots.r1, dnC],
      ["Pivot", sig.pivots.pivot, ntC],
      ["S1", sig.pivots.s1, upC], ["S2", sig.pivots.s2, upC], ["S3", sig.pivots.s3, upC]]
        .filter(([, v]) => v != null)
        .map(([l, v, c]) => `<span style="color:${c};margin-right:10px;"><span style="color:${dimC};">${l} </span>${v}</span>`)
        .join("")}
  </div>` : ""}

  <!-- Signal reasons -->
  ${bullRows || bearRows || neutralRows ? `
  <div style="padding:8px 16px;border-bottom:1px solid ${bdrC};background:#0a1520;">
    ${bullRows}${bearRows}${neutralRows}
    ${patternBadges ? `<div style="margin-top:6px;">${patternBadges}</div>` : ""}
  </div>` : ""}

  <!-- Gemini validation -->
  ${gv ? `
  <div style="padding:10px 16px;border-bottom:1px solid ${bdrC};background:#070f1a;">
    <div style="font-size:11px;margin-bottom:4px;">
      <span style="color:${muC};font-weight:800;">🤖 Gemini Verdict:</span>
      <span style="color:${gvc};font-weight:700;margin-left:6px;">${esc(gv.verdict)}</span>
      <span style="color:${dimC};margin-left:6px;">· ${esc(gv.conviction)} conviction · ${esc(gv.time_horizon)}</span>
    </div>
    <div style="font-size:11px;color:#b0c9e0;line-height:1.6;margin-bottom:5px;">${esc(gv.analyst_note)}</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;margin-bottom:5px;">
      ${gv.key_catalyst ? `<div style="color:${upC};">⚡ ${esc(gv.key_catalyst)}</div>` : ""}
      ${gv.key_risk ? `<div style="color:${dnC};">⚠️ ${esc(gv.key_risk)}</div>` : ""}
    </div>
    ${gv.alt_action ? `<div style="font-size:11px;color:${amC};">↳ Gemini suggests: ${esc(gv.alt_action)}${gv.alt_price ? ` @ PKR ${esc(gv.alt_price)}` : ""}</div>` : ""}
    ${gv.beginner_explanation ? `
    <div style="margin-top:6px;padding:7px 10px;background:#0a1520;border-radius:6px;border-left:3px solid ${muC};">
      <div style="font-size:10px;color:${muC};font-weight:700;margin-bottom:3px;">🎓 Gemini Coach Says</div>
      <div style="font-size:12px;color:#b0c9e0;line-height:1.5;">${esc(gv.beginner_explanation)}</div>
    </div>` : ""}
  </div>` : ""}

</div>`;
}

// ─────────────────────────────────────────────────────────────
//  MAIN EMAIL BUILDER
// ─────────────────────────────────────────────────────────────

function buildHtmlEmail(stockData, signals, summary, performance, gemini, timeStamp) {
  const dataMap = {};
  for (const [t, d] of Object.entries(stockData)) dataMap[t.replace(".KA", "")] = d;

  // Count actions
  const counts = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0, SKIP: 0 };
  for (const s of Object.values(signals)) counts[s.action] = (counts[s.action] || 0) + 1;
  const totalBuys = counts.STRONG_BUY + counts.BUY;
  const totalSells = counts.SELL + counts.STRONG_SELL;

  const pnlUp = (summary.totalPnl || 0) >= 0;
  const pnlC = pnlUp ? upC : dnC;

  const m = gemini?.market, a = gemini?.analysis;
  const stanceC = { Bullish: upC, Bearish: dnC, Neutral: amC }[a?.overall_stance] || ntC;

  // Sector weight bars
  const sectorRows = Object.entries(summary.sectorWeights || {})
    .sort(([, a], [, b]) => b - a)
    .map(([s, w]) => `
        <tr>
          <td style="font-size:11px;color:${ntC};padding:3px 0;width:110px;white-space:nowrap;">${esc(s)}</td>
          <td style="padding:3px 8px;">
            <div style="height:7px;background:#0a1520;border-radius:4px;overflow:hidden;">
              <div style="width:${Math.min(100, w * 3)}%;height:100%;background:${blC};border-radius:4px;"></div>
            </div>
          </td>
          <td style="font-size:11px;color:${dimC};padding:3px 0;width:36px;">${esc(w)}%</td>
        </tr>`).join("");

  // Stock cards
  let cards = "";
  for (const [sym, sig] of Object.entries(signals)) {
    if (sig.action === "SKIP") continue;
    const gv = a?.validation?.find(v => v.symbol === sym);
    cards += buildStockCard(sym, sig, dataMap[sym], gv, gv?.beginner_explanation);
  }

  // Gemini macro block
  const geminiBlock = (m || a) ? `
    <div style="background:${bgC};border:1px solid ${bdrC};border-radius:14px;margin-bottom:18px;overflow:hidden;">
      <!-- Gemini header -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#091320;border-bottom:1px solid ${bdrC};">
        <tr>
          <td style="padding:12px 16px;"><span style="font-size:13px;font-weight:900;color:${muC};">🤖 GEMINI AI MARKET INTELLIGENCE</span>${m?.global?.oil_brent_usd ? `<span style="font-size:10px;color:${dimC};margin-left:8px;">(Google Search grounded)</span>` : ""}</td>
          ${a?.overall_stance ? `<td style="padding:12px 16px;text-align:right;">${badge(a.overall_stance, stanceC)}</td>` : ""}
        </tr>
      </table>

      ${m && !m.raw ? `
      <!-- Global pills -->
      <div style="padding:12px 16px;border-bottom:1px solid ${bdrC};">
        <div style="font-size:10px;color:${dimC};text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:8px;">Global Markets</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">🛢 Brent <b>$${esc(m.global?.oil_brent_usd)}</b> <span style="color:${m.global?.oil_trend === "Rising" ? upC : dnC};">${esc(m.global?.oil_trend)}</span></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">💵 PKR/USD <b>${esc(m.global?.usd_pkr)}</b></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">🏦 Fed <b>${esc(m.global?.fed_stance)}</b></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">📈 10Y <b>${esc(m.global?.us_10y_yield)}</b></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${m.global?.sentiment === "Risk-On" ? upC : dnC};">${esc(m.global?.sentiment)}</span>
        </div>
        ${(m.global?.key_global_drivers || []).length ? `<div style="margin-top:7px;font-size:11px;color:${dimC};">Drivers: ${m.global.key_global_drivers.map(esc).join(" · ")}</div>` : ""}
      </div>

      <!-- Pakistan -->
      <div style="padding:12px 16px;border-bottom:1px solid ${bdrC};">
        <div style="font-size:10px;color:${dimC};text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:8px;">Pakistan Macro</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">📊 KSE-100 <b>${esc(m.pakistan?.kse100_level)}</b> <span style="color:${m.pakistan?.kse100_trend === "Bullish" ? upC : dnC};">${esc(m.pakistan?.kse100_change_pct)}%</span></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">🏛 SBP <b>${esc(m.pakistan?.sbp_policy_rate)}</b> (${esc(m.pakistan?.sbp_outlook)})</span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">📉 CPI <b>${esc(m.pakistan?.cpi_inflation)}</b></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">🤝 IMF <b>${esc(m.pakistan?.imf_program)}</b></span>
          <span style="background:#0a1520;border:1px solid ${bdrC};padding:4px 10px;border-radius:7px;color:${ntC};">💰 FX <b>$${esc(m.pakistan?.forex_reserves_usd_bn)}bn</b></span>
        </div>
        <div style="margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;">
          ${(m.pakistan?.key_risks || []).length ? `<div style="color:${dnC};">⚠️ ${m.pakistan.key_risks.map(esc).join(" · ")}</div>` : ""}
          ${(m.pakistan?.key_tailwinds || []).length ? `<div style="color:${upC};">✅ ${m.pakistan.key_tailwinds.map(esc).join(" · ")}</div>` : ""}
        </div>
      </div>

      <!-- Sector table -->
      ${m.sector_outlook ? `
      <div style="padding:12px 16px;border-bottom:1px solid ${bdrC};">
        <div style="font-size:10px;color:${dimC};text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:8px;">Sector Outlook</div>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${Object.entries(m.sector_outlook).map(([sec, val]) => {
    const c = val.startsWith("Bull") ? upC : val.startsWith("Bear") ? dnC : amC;
    return `<tr><td style="font-size:11px;color:${dimC};padding:3px 0;min-width:110px;white-space:nowrap;">${esc(sec)}</td><td style="font-size:11px;color:${c};padding:3px 0;">${esc(val)}</td></tr>`;
  }).join("")}
        </table>
      </div>` : ""}

      ${m.today_headline ? `<div style="padding:10px 16px;border-bottom:1px solid ${bdrC};font-size:13px;color:#c7d9ea;font-style:italic;line-height:1.5;">"${esc(m.today_headline)}"</div>` : ""}
      ` : m?.raw ? `<div style="padding:12px 16px;font-size:12px;color:${ntC};">${esc(m.raw)}</div>` : ""}

      <!-- Portfolio health + conviction -->
      ${a?.portfolio_health ? `
      <div style="padding:12px 16px;border-bottom:1px solid ${bdrC};">
        <div style="font-size:10px;color:${dimC};text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:8px;">Portfolio Assessment</div>
        <div style="font-size:12px;color:${ntC};margin-bottom:6px;">${esc(a.portfolio_health.overall_pnl_comment)}</div>
        <div style="font-size:12px;color:${ntC};margin-bottom:6px;">${esc(a.portfolio_health.concentration_detail)}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;">
          ${a.portfolio_health.best_positioned ? `<div style="color:${upC};">⭐ Best: ${esc(a.portfolio_health.best_positioned)}</div>` : ""}
          ${a.portfolio_health.biggest_risk ? `<div style="color:${dnC};">⚠️ Risk: ${esc(a.portfolio_health.biggest_risk)}</div>` : ""}
        </div>
        ${a.macro_impact_on_portfolio ? `<div style="margin-top:6px;font-size:11px;color:${dimC};font-style:italic;">${esc(a.macro_impact_on_portfolio)}</div>` : ""}
      </div>` : ""}

      <!-- Top trade / Avoid -->
      ${(a?.top_trade_today || a?.avoid_today) ? `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${a.top_trade_today ? `<td style="padding:11px 16px;width:50%;vertical-align:top;">
            <div style="background:${upC}0d;border:1px solid ${upC}30;border-radius:9px;padding:10px;">
              <div style="font-size:10px;color:${upC};font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">⭐ TOP TRADE TODAY</div>
              <div style="font-size:12px;color:#c7d9ea;line-height:1.5;">${esc(a.top_trade_today)}</div>
            </div>
          </td>` : ""}
          ${a.avoid_today ? `<td style="padding:11px 16px;vertical-align:top;">
            <div style="background:${dnC}0d;border:1px solid ${dnC}30;border-radius:9px;padding:10px;">
              <div style="font-size:10px;color:${dnC};font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🚫 AVOID TODAY</div>
              <div style="font-size:12px;color:#c7d9ea;line-height:1.5;">${esc(a.avoid_today)}</div>
            </div>
          </td>` : ""}
        </tr>
      </table>` : ""}

      <!-- Daily tip -->
      ${a?.daily_tip ? `
      <div style="padding:10px 16px;background:#060f1a;border-top:1px solid ${bdrC};">
        <span style="font-size:10px;color:${muC};font-weight:700;text-transform:uppercase;letter-spacing:1px;">🎓 Daily Tip: </span>
        <span style="font-size:12px;color:${ntC};">${esc(a.daily_tip)}</span>
        ${a.emotional_state ? `<span style="margin-left:8px;">${badge(a.emotional_state, muC)}</span>` : ""}
      </div>` : ""}
    </div>` : "";

  return `<!DOCTYPE html><html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PSX Report · ${timeStamp}</title>
</head>
<body style="margin:0;padding:0;background:#070f1a;-webkit-font-smoothing:antialiased;">
<div style="max-width:680px;margin:0 auto;padding:14px;font-family:'Segoe UI',system-ui,Arial,sans-serif;">

  <!-- ═══ HEADER ═══ -->
  <div style="background:linear-gradient(140deg,#071e3d,#0a2444,#061628);border:1px solid #1a3a5c;border-radius:18px;padding:24px;margin-bottom:14px;">
    <div style="font-size:10px;color:${blC};font-weight:800;letter-spacing:3px;text-transform:uppercase;">Pakistan Stock Exchange · KSE-100</div>
    <div style="font-size:30px;font-weight:900;color:#f8fafc;margin:6px 0 3px;letter-spacing:-1px;">📊 Trading Report</div>
    <div style="font-size:12px;color:${dimC};">${esc(timeStamp)}</div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
      ${counts.STRONG_BUY ? badge(`▲▲ STRONG BUY ${counts.STRONG_BUY}`, upC) : ""}
      ${counts.BUY ? badge(`▲ BUY ${counts.BUY}`, upC) : ""}
      ${badge(`● HOLD ${counts.HOLD}`, amC)}
      ${counts.SELL ? badge(`▼ SELL ${counts.SELL}`, dnC) : ""}
      ${counts.STRONG_SELL ? badge(`▼▼ STRONG SELL ${counts.STRONG_SELL}`, dnC) : ""}
      ${performance ? badge(`🎯 ${performance.accuracy}% accuracy`, muC) : ""}
    </div>
  </div>

  <!-- ═══ PORTFOLIO SUMMARY ═══ -->
  <div style="background:${bgC};border:1px solid ${bdrC};border-radius:14px;padding:16px 20px;margin-bottom:14px;">
    <div style="font-size:10px;color:${dimC};font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Portfolio Overview</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align:left;padding-bottom:8px;">
          <div style="font-size:10px;color:${dimC};">Total Invested</div>
          <div style="font-size:16px;font-weight:700;color:${dimC};">PKR ${(summary.totalCost || 0).toLocaleString()}</div>
        </td>
        <td style="text-align:center;padding-bottom:8px;">
          <div style="font-size:10px;color:${dimC};">Market Value</div>
          <div style="font-size:20px;font-weight:800;color:#f1f5f9;">PKR ${(summary.totalValue || 0).toLocaleString()}</div>
        </td>
        <td style="text-align:right;padding-bottom:8px;">
          <div style="font-size:10px;color:${dimC};">Unrealised P&amp;L</div>
          <div style="font-size:24px;font-weight:900;color:${pnlC};">${pnlUp ? "+" : ""}PKR ${(summary.totalPnl || 0).toLocaleString()}</div>
          <div style="font-size:14px;font-weight:800;color:${pnlC};">${pnlUp ? "+" : ""}${summary.totalPnlPct || 0}%</div>
        </td>
      </tr>
    </table>
    <!-- Sector allocation -->
    <div style="margin-top:14px;border-top:1px solid ${bdrC};padding-top:12px;">
      <div style="font-size:10px;color:${dimC};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Sector Allocation</div>
      <table width="100%" cellpadding="0" cellspacing="0">${sectorRows}</table>
    </div>
  </div>

  <!-- ═══ GEMINI INTELLIGENCE ═══ -->
  ${geminiBlock}

  <!-- ═══ STOCK SIGNALS ═══ -->
  <div style="font-size:10px;color:${dimC};font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;padding-left:4px;">
    Individual Position Signals
  </div>
  ${cards}

  <!-- FOOTER -->
  <div style="text-align:center;padding:20px;font-size:10px;color:#1e3347;line-height:1.7;">
    PSX Agent · ${esc(timeStamp)}<br/>
    Algorithmic signals only — not financial advice. Always verify before trading.
  </div>
</div>
</body></html>`;
}

module.exports = { buildHtmlEmail };