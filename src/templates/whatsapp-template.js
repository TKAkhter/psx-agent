"use strict";

const sgn = (n) => (n == null ? "" : n >= 0 ? "+" : "");
const fmt = (v) => (v == null ? "—" : String(v));

function buildWhatsAppMessage(stockData, signals, summary, gemini, performance, timeStamp) {
    const dataMap = {};
    for (const [t, d] of Object.entries(stockData)) dataMap[t.replace(".KA", "")] = d;

    const pnlUp = (summary.totalPnl || 0) >= 0;
    const buys = Object.entries(signals).filter(([, s]) => s.action === "BUY" || s.action === "STRONG_BUY");
    const sells = Object.entries(signals).filter(([, s]) => s.action === "SELL" || s.action === "STRONG_SELL");
    const holds = Object.entries(signals).filter(([, s]) => s.action === "HOLD");

    const m = gemini?.market;
    const a = gemini?.analysis;

    let msg = "";

    // ── Header ──────────────────────────────────────────────
    msg += `🇵🇰 *PSX TRADING REPORT*\n`;
    msg += `📅 ${timeStamp}\n`;
    msg += `${"━".repeat(34)}\n\n`;

    // ── Portfolio ────────────────────────────────────────────
    msg += `${pnlUp ? "📈" : "📉"} *PORTFOLIO*\n`;
    msg += `  Value:    PKR ${(summary.totalValue || 0).toLocaleString()}\n`;
    msg += `  Invested: PKR ${(summary.totalCost || 0).toLocaleString()}\n`;
    msg += `  P&L:      ${pnlUp ? "+" : ""}PKR ${(summary.totalPnl || 0).toLocaleString()} (${sgn(summary.totalPnlPct)}${summary.totalPnlPct || 0}%)\n`;
    if (performance) msg += `  Accuracy: 🎯 ${performance.accuracy}% (${performance.correct}/${performance.total})\n`;
    msg += "\n";

    // ── Gemini market brief ───────────────────────────────────
    if (m && !m.raw) {
        msg += `🤖 *MARKET INTEL* (Google Search)\n`;
        if (m.today_headline) msg += `  📌 ${m.today_headline}\n`;
        if (m.global?.oil_brent_usd) msg += `  🛢 Brent $${m.global.oil_brent_usd} (${m.global.oil_trend})\n`;
        if (m.global?.usd_pkr) msg += `  💵 PKR/USD ${m.global.usd_pkr} · Sentiment: ${m.global.sentiment}\n`;
        if (m.pakistan?.kse100_level) msg += `  📊 KSE-100 ${m.pakistan.kse100_level} (${m.pakistan.kse100_change_pct}%)\n`;
        if (m.pakistan?.sbp_policy_rate) msg += `  🏛 SBP ${m.pakistan.sbp_policy_rate} · ${m.pakistan.sbp_outlook}\n`;
        if (m.pakistan?.imf_program) msg += `  🤝 IMF: ${m.pakistan.imf_program}\n`;
        if (a?.overall_stance) msg += `  📊 Stance: *${a.overall_stance}*\n`;
        if (a?.emotional_state) msg += `  💬 Mood: ${a.emotional_state}\n`;
        msg += "\n";
    }

    // ── BUY signals ──────────────────────────────────────────
    if (buys.length) {
        msg += `✅ *BUY SIGNALS (${buys.length})*\n`;
        msg += `${"─".repeat(34)}\n`;
        for (const [sym, s] of buys) {
            const d = dataMap[sym] || {};
            const gv = a?.validation?.find(v => v.symbol === sym);
            const isStrong = s.action === "STRONG_BUY";

            msg += `${isStrong ? "📗📗" : "📗"} *${sym}*${isStrong ? " ★ STRONG BUY" : ""}\n`;
            // Sparkline
            if (s.sparkline) msg += `  ${s.sparkline}\n`;
            msg += `  Price: PKR ${s.price}  |  P&L: ${sgn(s.unrealizedPct)}${s.unrealizedPct}%\n`;
            msg += `  O:${s.open}  H:${s.high}  L:${s.low}\n`;
            msg += "\n";
            msg += `  📋 *${s.instruction}*\n`;
            msg += `  🎯 Target:    PKR ${s.targetPrice}\n`;
            msg += `  🛑 Stop Loss: PKR ${s.stopLoss}\n`;
            msg += `  ⚖️ R/R Ratio: 1:${s.rrRatio}  |  ${s.confidence} confidence\n`;
            msg += "\n";
            msg += `  📊 *Indicators*\n`;
            msg += `  RSI-14: ${s.rsi14}  |  Stoch: ${s.stoch?.k}/${s.stoch?.d} (${s.stoch?.zone})\n`;
            msg += `  MACD: ${s.macd?.crossover || (s.macd?.histogram > 0 ? "Hist+" : "Hist-")}  |  ADX: ${s.adx?.adx} (${s.adx?.strength})\n`;
            msg += `  Ichimoku: ${s.ichi?.position || "—"}  |  OBV: ${s.obv?.trend}\n`;
            msg += `  VWAP: ${s.vwap}  |  Williams %R: ${s.willR}  |  CCI: ${s.cci}\n`;
            msg += `  Vol: ${s.vol?.volRatio}x avg (${s.vol?.volTrend})\n`;
            if (s.divergence) msg += `  📐 ${s.divergence.replace(/_/g, " ")}\n`;
            msg += "\n";
            msg += `  📅 Perf: 1D ${sgn(s.perf1d)}${s.perf1d}%  1W ${sgn(s.perf1w)}${s.perf1w}%  1M ${sgn(s.perf1m)}${s.perf1m}%  6M ${sgn(s.perf6m)}${s.perf6m}%\n`;
            if (s.pivots) msg += `  📍 S2:${s.pivots.s2}  S1:${s.pivots.s1}  Pvt:${s.pivots.pivot}  R1:${s.pivots.r1}  R2:${s.pivots.r2}\n`;
            if (s.ma20) msg += `  📈 MA5:${s.ma5}  MA20:${s.ma20}  MA50:${s.ma50 || "—"}  EMA9:${s.ema9}\n`;
            if ((s.patterns || []).length) msg += `  🕯 ${s.patterns.map(p => `${p.name}(${p.bias})`).join(", ")}\n`;
            // Top 2 bull reasons
            if ((s.bullReasons || []).length) {
                msg += `\n  ✓ ${s.bullReasons.slice(0, 2).join("\n  ✓ ")}\n`;
            }
            // Gemini validation
            if (gv) {
                const ico = gv.verdict === "Agree" ? "✅" : gv.verdict === "Disagree" ? "❌" : "⚠️";
                msg += `\n  🤖 *Gemini:* ${ico} ${gv.verdict}  [${gv.conviction} conviction · ${gv.time_horizon}]\n`;
                msg += `  ${(gv.analyst_note || "").slice(0, 130)}\n`;
                if (gv.key_catalyst) msg += `  ⚡ ${gv.key_catalyst}\n`;
                if (gv.key_risk) msg += `  ⚠️ ${gv.key_risk}\n`;
                if (gv.beginner_explanation) msg += `  🎓 ${gv.beginner_explanation.slice(0, 140)}\n`;
            }
            // Potential PKR gain/loss
            const gain = Math.round(((s.targetPrice || 0) - (s.limitPrice || 0)) * (s.qty || 0));
            const risk = Math.round(Math.abs(((s.limitPrice || 0) - (s.stopLoss || 0)) * (s.qty || 0)));
            if (gain && risk) msg += `\n  💰 Potential gain: PKR ${gain.toLocaleString()}  |  Max risk: PKR ${risk.toLocaleString()}\n`;
            msg += `\n  📗 ${s.beginnerNote}\n`;
            msg += "\n";
        }
    }

    // ── SELL signals ──────────────────────────────────────────
    if (sells.length) {
        msg += `🔴 *SELL SIGNALS (${sells.length})*\n`;
        msg += `${"─".repeat(34)}\n`;
        for (const [sym, s] of sells) {
            const gv = a?.validation?.find(v => v.symbol === sym);
            const isStrong = s.action === "STRONG_SELL";

            msg += `${isStrong ? "📕📕" : "📕"} *${sym}*${isStrong ? " ★ STRONG SELL" : ""}\n`;
            if (s.sparkline) msg += `  ${s.sparkline}\n`;
            msg += `  Price: PKR ${s.price}  |  P&L: ${sgn(s.unrealizedPct)}${s.unrealizedPct}%\n`;
            msg += "\n";
            msg += `  📋 *${s.instruction}*\n`;
            msg += `  🎯 Target:    PKR ${s.targetPrice}\n`;
            msg += `  🛑 Stop Loss: PKR ${s.stopLoss}\n`;
            msg += `  ⚖️ R/R Ratio: 1:${s.rrRatio}  |  ${s.confidence} confidence\n`;
            msg += "\n";
            msg += `  📊 RSI-14: ${s.rsi14}  |  ADX: ${s.adx?.adx}(${s.adx?.strength})\n`;
            msg += `  Stoch: ${s.stoch?.k}/${s.stoch?.d}  |  Williams %R: ${s.willR}\n`;
            msg += `  Ichimoku: ${s.ichi?.position || "—"}  |  MACD: ${s.macd?.crossover || s.macd?.histTrend}\n`;
            if ((s.bearReasons || []).length) {
                msg += `\n  ✗ ${s.bearReasons.slice(0, 2).join("\n  ✗ ")}\n`;
            }
            if (gv) {
                const ico = gv.verdict === "Agree" ? "✅" : gv.verdict === "Disagree" ? "❌" : "⚠️";
                msg += `\n  🤖 *Gemini:* ${ico} ${gv.verdict}  [${gv.conviction} · ${gv.time_horizon}]\n`;
                msg += `  ${(gv.analyst_note || "").slice(0, 130)}\n`;
                if (gv.key_risk) msg += `  ⚠️ ${gv.key_risk}\n`;
            }
            msg += `\n  📕 ${s.beginnerNote}\n\n`;
        }
    }

    // ── HOLD (compact) ────────────────────────────────────────
    if (holds.length) {
        msg += `⏸ *HOLD (${holds.length})*\n`;
        msg += `${"─".repeat(34)}\n`;
        for (const [sym, s] of holds) {
            const pnlTag = `${sgn(s.unrealizedPct)}${s.unrealizedPct}%`;
            const pnlIcon = (s.unrealizedPct || 0) >= 0 ? "🟢" : "🔴";
            msg += `  ${pnlIcon} *${sym.padEnd(7)}*  PKR ${String(s.price).padStart(7)}  P&L: ${pnlTag.padStart(7)}\n`;
            msg += `         RSI:${s.rsi14}  S:${s.stopLoss}  R:${s.targetPrice}  ${s.trend}\n`;
            if (s.sparkline) msg += `         ${s.sparkline}\n`;
        }
        msg += "\n";
    }

    // ── Gemini top calls ──────────────────────────────────────
    if (a?.top_trade_today || a?.avoid_today || a?.daily_tip) {
        msg += `${"─".repeat(34)}\n`;
        if (a.top_trade_today) msg += `⭐ *Top Trade:* ${a.top_trade_today}\n`;
        if (a.avoid_today) msg += `🚫 *Avoid:* ${a.avoid_today}\n`;
        if (a.daily_tip) msg += `🎓 *Tip:* ${a.daily_tip}\n`;
        msg += "\n";
    }

    // ── Sector outlook (compact) ──────────────────────────────
    if (m?.sector_outlook) {
        msg += `${"─".repeat(34)}\n`;
        msg += `📊 *SECTOR OUTLOOK*\n`;
        for (const [sec, val] of Object.entries(m.sector_outlook)) {
            const icon = val.startsWith("Bull") ? "▲" : val.startsWith("Bear") ? "▼" : "●";
            msg += `  ${icon} ${sec}: ${val}\n`;
        }
        msg += "\n";
    }

    msg += `${"━".repeat(34)}\n`;
    msg += `_Algorithmic signals — not financial advice_`;

    return msg;
}

module.exports = { buildWhatsAppMessage };