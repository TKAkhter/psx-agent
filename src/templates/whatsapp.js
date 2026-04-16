"use strict";

const sign = (n) => (n >= 0 ? "+" : "");
const esc  = (s) => String(s ?? "—");

function buildWhatsApp(stockData, signals, summary, gemini, performance, time) {
    const portfolioMap = {};
    for (const [ticker, d] of Object.entries(stockData)) {
        portfolioMap[ticker.replace(".KA", "")] = d;
    }

    const pnlUp    = (summary.totalPnl || 0) >= 0;
    const pnlEmoji = pnlUp ? "📈" : "📉";
    const buys     = Object.entries(signals).filter(([, s]) => s.action === "BUY" || s.action === "STRONG_BUY");
    const sells    = Object.entries(signals).filter(([, s]) => s.action === "SELL" || s.action === "STRONG_SELL");
    const holds    = Object.entries(signals).filter(([, s]) => s.action === "HOLD");

    let msg = "";

    // ── Header ──────────────────────────────────────────────────
    msg += `🇵🇰 *PSX TRADING REPORT*\n`;
    msg += `📅 ${time}\n`;
    msg += `${"━".repeat(32)}\n\n`;

    // ── Portfolio Snapshot ─────────────────────────────────────
    msg += `${pnlEmoji} *PORTFOLIO OVERVIEW*\n`;
    msg += `  💼 Value:     PKR ${(summary.totalValue || 0).toLocaleString()}\n`;
    msg += `  📥 Invested:  PKR ${(summary.totalCost  || 0).toLocaleString()}\n`;
    msg += `  ${pnlUp ? "🟢" : "🔴"} P&L:       ${sign(summary.totalPnl||0)}PKR ${(summary.totalPnl||0).toLocaleString()} (${sign(summary.totalPnlPct||0)}${summary.totalPnlPct||0}%)\n`;
    if (performance) {
        msg += `  🎯 Signal accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total})\n`;
    }
    msg += "\n";

    // ── Gemini Market Brief ────────────────────────────────────
    const m = gemini?.market, a = gemini?.analysis, coach = gemini?.coaching;
    if (m && !m.raw) {
        msg += `🤖 *GEMINI MARKET BRIEF*\n`;
        if (m.today_summary)             msg += `  📌 ${m.today_summary}\n`;
        if (m.global?.oil_brent_usd)     msg += `  🛢 Brent ~${m.global.oil_brent_usd} (${m.global.oil_trend})\n`;
        if (m.global?.usd_pkr)           msg += `  💵 PKR/USD ~${m.global.usd_pkr} · ${m.global?.sentiment}\n`;
        if (m.pakistan?.sbp_policy_rate) msg += `  🏛 SBP ${m.pakistan.sbp_policy_rate} · ${m.pakistan.sbp_next_meeting}\n`;
        if (m.pakistan?.imf_program)     msg += `  🤝 IMF: ${m.pakistan.imf_program}\n`;
        if (a?.overall_stance)           msg += `  📊 Stance: *${a.overall_stance}*\n`;
        msg += "\n";
    }

    // ── BUY Signals ────────────────────────────────────────────
    if (buys.length) {
        msg += `✅ *${buys.length === 1 ? "BUY SIGNAL" : `BUY SIGNALS (${buys.length})`}*\n`;
        msg += `${"─".repeat(30)}\n`;
        for (const [sym, s] of buys) {
            const d  = portfolioMap[sym] || {};
            const gv = a?.validation?.find(v => v.symbol === sym);
            const coachItem = coach?.coaching?.find(c => c.symbol === sym);
            const isStrong = s.action === "STRONG_BUY";

            msg += `${isStrong ? "📗📗" : "📗"} *${sym}* ${isStrong ? "— STRONG BUY" : ""}\n`;
            msg += `   PKR ${s.price}  |  P&L ${sign(s.unrealizedPct||0)}${s.unrealizedPct||0}%\n`;
            msg += `\n`;
            msg += `   📋 *${s.instruction}*\n`;
            msg += `   🎯 Target: PKR ${s.targetPrice}\n`;
            msg += `   🛑 Stop Loss: PKR ${s.stopLoss}\n`;
            msg += `   ⚖️ Risk/Reward: 1:${s.rrRatio}   |   ${s.confidence} confidence\n`;
            msg += `\n`;
            msg += `   📊 RSI ${s.rsi14} · Stoch ${s.stoch?.k}/${s.stoch?.d} · ${s.trend}\n`;
            if (d.perf1w != null) msg += `   📅 1W ${sign(d.perf1w)}${d.perf1w}%  1M ${sign(d.perf1m)}${d.perf1m}%  6M ${sign(d.perf6m)}${d.perf6m}%\n`;
            if (s.pivots?.s1)     msg += `   📍 S1 ${s.pivots.s1} · S2 ${s.pivots.s2} · R1 ${s.pivots.r1}\n`;
            if ((s.bullSignals || []).length > 0) {
                msg += `   ✓ ${s.bullSignals.slice(0, 2).join("\n   ✓ ")}\n`;
            }
            if (gv) {
                const icon = gv.verdict === "Agree" ? "✅" : gv.verdict === "Disagree" ? "❌" : "⚠️";
                msg += `\n   🤖 Gemini: ${icon} ${gv.verdict} · ${gv.conviction} conv.\n`;
                msg += `   ${(gv.reason || "").slice(0, 120)}\n`;
                if (gv.key_catalyst) msg += `   ⚡ ${gv.key_catalyst}\n`;
                if (gv.key_risk)     msg += `   ⚠️ ${gv.key_risk}\n`;
            }
            if (coachItem?.beginner) {
                msg += `\n   🎓 ${coachItem.beginner.slice(0, 140)}\n`;
            }
            msg += "\n";
        }
    }

    // ── SELL Signals ───────────────────────────────────────────
    if (sells.length) {
        msg += `🔴 *${sells.length === 1 ? "SELL SIGNAL" : `SELL SIGNALS (${sells.length})`}*\n`;
        msg += `${"─".repeat(30)}\n`;
        for (const [sym, s] of sells) {
            const d  = portfolioMap[sym] || {};
            const gv = a?.validation?.find(v => v.symbol === sym);
            const isStrong = s.action === "STRONG_SELL";

            msg += `${isStrong ? "📕📕" : "📕"} *${sym}* ${isStrong ? "— STRONG SELL" : ""}\n`;
            msg += `   PKR ${s.price}  |  P&L ${sign(s.unrealizedPct||0)}${s.unrealizedPct||0}%\n`;
            msg += `\n`;
            msg += `   📋 *${s.instruction}*\n`;
            msg += `   🎯 Target: PKR ${s.targetPrice}\n`;
            msg += `   🛑 Stop Loss: PKR ${s.stopLoss}\n`;
            msg += `   ⚖️ Risk/Reward: 1:${s.rrRatio}   |   ${s.confidence} confidence\n`;
            msg += `\n`;
            msg += `   📊 RSI ${s.rsi14} · Stoch ${s.stoch?.k}/${s.stoch?.d} · ${s.trend}\n`;
            if (d.perf1w != null) msg += `   📅 1W ${sign(d.perf1w)}${d.perf1w}%  1M ${sign(d.perf1m)}${d.perf1m}%  6M ${sign(d.perf6m)}${d.perf6m}%\n`;
            if ((s.bearSignals || []).length > 0) {
                msg += `   ✗ ${s.bearSignals.slice(0, 2).join("\n   ✗ ")}\n`;
            }
            if (gv) {
                const icon = gv.verdict === "Agree" ? "✅" : gv.verdict === "Disagree" ? "❌" : "⚠️";
                msg += `\n   🤖 Gemini: ${icon} ${gv.verdict} · ${gv.conviction} conv.\n`;
                msg += `   ${(gv.reason || "").slice(0, 120)}\n`;
                if (gv.key_risk) msg += `   ⚠️ ${gv.key_risk}\n`;
            }
            msg += "\n";
        }
    }

    // ── HOLD positions (compact table) ────────────────────────
    if (holds.length) {
        msg += `⏸ *HOLD (${holds.length} positions)*\n`;
        msg += `${"─".repeat(30)}\n`;
        for (const [sym, s] of holds) {
            const pnlTag = `${sign(s.unrealizedPct||0)}${s.unrealizedPct||0}%`;
            const pnlIcon = (s.unrealizedPct||0) >= 0 ? "🟢" : "🔴";
            msg += `  ${pnlIcon} *${sym.padEnd(7)}* PKR ${String(s.price).padStart(7)} | ${pnlTag.padStart(7)} | S:${s.stopLoss} R:${s.targetPrice}\n`;
        }
        msg += "\n";
    }

    // ── Gemini Conviction calls ────────────────────────────────
    if (a?.top_conviction_trade || a?.avoid_today) {
        msg += `${"─".repeat(30)}\n`;
        if (a.top_conviction_trade) msg += `⭐ *Top Trade:* ${a.top_conviction_trade}\n`;
        if (a.avoid_today)          msg += `🚫 *Avoid:* ${a.avoid_today}\n`;
        msg += "\n";
    }

    // ── Daily coaching tip ─────────────────────────────────────
    if (coach?.daily_coaching_tip) {
        msg += `🎓 *Coach:* ${coach.daily_coaching_tip}\n`;
        if (coach.emotional_check) msg += `💬 ${coach.emotional_check}\n`;
        msg += "\n";
    }

    msg += `${"━".repeat(32)}\n`;
    msg += `_Algorithmic signals · Not financial advice_`;

    return msg;
}

module.exports = { buildWhatsApp };