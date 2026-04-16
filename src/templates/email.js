"use strict";

// ─── Mini helpers ─────────────────────────────────────────────
const esc   = (s) => String(s ?? "—").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const sign  = (n) => (n >= 0 ? "+" : "");
const col   = (n, pos = "#10b981", neg = "#f43f5e") => n >= 0 ? pos : neg;
const pnlC  = (n) => col(n);
const trendColor = (t) => ({ STRONG_BULL:"#10b981", BULL:"#4ade80", SIDEWAYS:"#f59e0b", BEAR:"#f87171", STRONG_BEAR:"#f43f5e" }[t] || "#94a3b8");

function actionBadge(action) {
    const map = {
        STRONG_BUY:  ["#10b981", "▲▲ STRONG BUY"],
        BUY:         ["#4ade80", "▲ BUY"],
        HOLD:        ["#f59e0b", "● HOLD"],
        SELL:        ["#f87171", "▼ SELL"],
        STRONG_SELL: ["#f43f5e", "▼▼ STRONG SELL"],
        SKIP:        ["#64748b", "— SKIP"],
    };
    const [c, label] = map[action] || ["#64748b", action];
    return `<span style="display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:0.5px;background:${c}22;color:${c};border:1px solid ${c}55;">${label}</span>`;
}

function confColor(c) {
    return { "Very High":"#a855f7", High:"#3b82f6", Medium:"#f59e0b", Low:"#64748b" }[c] || "#64748b";
}

function rsiMeter(rsi) {
    if (rsi == null) return "";
    const c    = rsi < 35 ? "#10b981" : rsi > 65 ? "#f43f5e" : "#f59e0b";
    const zone = rsi < 30 ? "Oversold" : rsi < 35 ? "Mildly OS" : rsi > 70 ? "Overbought" : rsi > 65 ? "Mildly OB" : "Neutral";
    const w    = Math.min(100, Math.max(0, rsi));
    return `
    <div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
        <span style="color:#94a3b8;font-weight:600;">RSI-14: <span style="color:${c};font-weight:800;">${rsi}</span></span>
        <span style="color:${c};font-size:10px;">${zone}</span>
      </div>
      <div style="height:6px;background:#0a1628;border-radius:3px;position:relative;">
        <!-- zones -->
        <div style="position:absolute;left:30%;right:35%;top:0;bottom:0;background:#1e293b;"></div>
        <div style="width:${w}%;height:100%;background:${c};border-radius:3px;transition:width .3s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#334155;margin-top:1px;">
        <span>0</span><span>30 OS</span><span>50</span><span>70 OB</span><span>100</span>
      </div>
    </div>`;
}

function stochMeter(stoch) {
    if (!stoch?.k) return "";
    const c = stoch.k < 20 ? "#10b981" : stoch.k > 80 ? "#f43f5e" : "#f59e0b";
    return `<div style="font-size:11px;color:#64748b;margin-bottom:3px;">
      <span style="color:#94a3b8;font-weight:600;">Stoch %K:</span>
      <span style="color:${c};font-weight:700;"> ${stoch.k}</span>
      <span style="color:#475569;"> / %D: ${stoch.d}</span>
      <span style="color:${c};margin-left:4px;font-size:10px;">(${stoch.zone})</span>
    </div>`;
}

// ─── Build one stock card ──────────────────────────────────────
function stockCard(sym, sig, d, gv, coaching) {
    const ac  = { STRONG_BUY:"#10b981", BUY:"#4ade80", HOLD:"#f59e0b", SELL:"#f87171", STRONG_SELL:"#f43f5e" }[sig.action] || "#64748b";
    const isBuy  = sig.action === "BUY" || sig.action === "STRONG_BUY";
    const isSell = sig.action === "SELL" || sig.action === "STRONG_SELL";
    const gvc = gv ? { Agree:"#10b981", Disagree:"#f43f5e", "Partially Agree":"#f59e0b" }[gv.verdict] || "#94a3b8" : null;

    const bullList = (sig.bullSignals || []).slice(0, 5).map(s =>
        `<tr><td style="padding:1px 0;font-size:11px;color:#4ade80;">✓ ${esc(s)}</td></tr>`).join("");
    const bearList = (sig.bearSignals || []).slice(0, 5).map(s =>
        `<tr><td style="padding:1px 0;font-size:11px;color:#f87171;">✗ ${esc(s)}</td></tr>`).join("");
    const neutralList = (sig.neutralNotes || []).slice(0, 2).map(s =>
        `<tr><td style="padding:1px 0;font-size:11px;color:#94a3b8;">◦ ${esc(s)}</td></tr>`).join("");

    const patternBadges = (sig.patterns || []).map(p => {
        const c = p.bias === "BULLISH" ? "#10b981" : p.bias === "BEARISH" ? "#f43f5e" : "#f59e0b";
        return `<span style="display:inline-block;margin:2px;padding:2px 8px;border-radius:4px;font-size:10px;background:${c}18;color:${c};border:1px solid ${c}33;">${p.name}</span>`;
    }).join("");

    const ichiColors = { ABOVE_CLOUD:"#10b981", BELOW_CLOUD:"#f43f5e", IN_CLOUD:"#f59e0b" };

    return `
<!-- ═══ ${sym} CARD ═══ -->
<div style="background:#0c1a2e;border:1px solid #1a3350;border-left:5px solid ${ac};border-radius:14px;margin-bottom:16px;overflow:hidden;">

  <!-- Header Row -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#071120;border-bottom:1px solid #1a2d40;">
    <tr>
      <td style="padding:12px 16px;">
        <span style="font-size:18px;font-weight:900;color:#f1f5f9;letter-spacing:0.5px;">${esc(sym)}</span>
        <span style="font-size:11px;color:#475569;margin-left:8px;background:#1e293b;padding:2px 9px;border-radius:99px;">${esc(d?.sector || "")}</span>
        <br/><span style="font-size:11px;color:#475569;margin-top:2px;display:inline-block;">${esc(d?.name || "")}</span>
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:top;">
        ${actionBadge(sig.action)}
        <br/><span style="font-size:10px;color:${confColor(sig.confidence)};font-weight:700;margin-top:4px;display:inline-block;">${sig.confidence} Confidence</span>
        <br/><span style="font-size:10px;color:#475569;">score ${sig.score >= 0 ? "+" : ""}${sig.score}</span>
      </td>
    </tr>
  </table>

  <!-- Price + P&L -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #1a2d40;">
    <tr>
      <td style="padding:11px 16px;">
        <div style="font-size:24px;font-weight:900;color:#f8fafc;letter-spacing:-0.5px;">PKR ${esc(sig.price)}</div>
        <div style="font-size:11px;color:#475569;margin-top:3px;">Cost avg: <b style="color:#94a3b8;">PKR ${esc(d?.avg_cost)}</b> &nbsp;·&nbsp; ${esc(d?.shares?.toLocaleString())} shares</div>
        <div style="font-size:11px;color:#475569;margin-top:1px;">Market value: <b style="color:#94a3b8;">PKR ${(sig.marketValue || 0).toLocaleString()}</b></div>
      </td>
      <td style="padding:11px 16px;text-align:right;vertical-align:top;">
        <div style="font-size:20px;font-weight:900;color:${pnlC(sig.unrealizedPct || 0)};">${sign(sig.unrealizedPct || 0)}${esc(sig.unrealizedPct)}%</div>
        <div style="font-size:12px;font-weight:600;color:${pnlC(sig.unrealized || 0)};margin-top:2px;">${sign(sig.unrealized || 0)}PKR ${(sig.unrealized || 0).toLocaleString()}</div>
        <div style="font-size:10px;color:#475569;margin-top:2px;">Unrealised P&L</div>
      </td>
    </tr>
  </table>

  <!-- Indicators Row -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #1a2d40;">
    <tr>
      <td style="padding:10px 16px;width:50%;vertical-align:top;border-right:1px solid #1a2d40;">
        ${rsiMeter(sig.rsi14)}
        ${stochMeter(sig.stoch)}
        <div style="font-size:11px;color:#64748b;margin-top:3px;">
          <span style="color:#94a3b8;font-weight:600;">Trend:</span>
          <span style="color:${trendColor(sig.trend)};font-weight:700;"> ${esc(sig.trend)}</span>
          &nbsp;|&nbsp;
          <span style="color:#94a3b8;font-weight:600;">ADX:</span>
          <span style="color:#94a3b8;"> ${esc(sig.adx?.adx)} (${esc(sig.adx?.trend)})</span>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">
          <span style="color:#94a3b8;font-weight:600;">Ichimoku:</span>
          <span style="color:${ichiColors[sig.ichiPosition] || "#94a3b8"};"> ${esc(sig.ichiPosition || "N/A")}</span>
          &nbsp;|&nbsp;
          <span style="color:#94a3b8;font-weight:600;">BB %B:</span>
          <span style="color:#94a3b8;"> ${esc(sig.bb?.pctB)}</span>
        </div>
        ${sig.macdCrossover ? `<div style="margin-top:4px;font-size:10px;padding:2px 8px;border-radius:4px;display:inline-block;background:${sig.macdCrossover==="BULLISH_CROSS"?"#10b98120":"#f43f5e20"};color:${sig.macdCrossover==="BULLISH_CROSS"?"#10b981":"#f43f5e"};border:1px solid ${sig.macdCrossover==="BULLISH_CROSS"?"#10b98140":"#f43f5e40"};">⚡ MACD ${sig.macdCrossover}</div>` : ""}
      </td>
      <td style="padding:10px 16px;vertical-align:top;">
        <div style="font-size:11px;color:#64748b;line-height:1.7;">
          <div><span style="color:#94a3b8;font-weight:600;">1D</span> <span style="color:${pnlC(d?.perf1d||0)}">${sign(d?.perf1d||0)}${d?.perf1d||0}%</span> &nbsp;
               <span style="color:#94a3b8;font-weight:600;">1W</span> <span style="color:${pnlC(d?.perf1w||0)}">${sign(d?.perf1w||0)}${d?.perf1w||0}%</span></div>
          <div><span style="color:#94a3b8;font-weight:600;">1M</span> <span style="color:${pnlC(d?.perf1m||0)}">${sign(d?.perf1m||0)}${d?.perf1m||0}%</span> &nbsp;
               <span style="color:#94a3b8;font-weight:600;">6M</span> <span style="color:${pnlC(d?.perf6m||0)}">${sign(d?.perf6m||0)}${d?.perf6m||0}%</span></div>
          <div><span style="color:#94a3b8;font-weight:600;">6M Hi</span> <span style="color:#94a3b8;">${esc(d?.high6m)}</span> &nbsp;
               <span style="color:#94a3b8;font-weight:600;">6M Lo</span> <span style="color:#94a3b8;">${esc(d?.low6m)}</span></div>
          <div><span style="color:#94a3b8;font-weight:600;">Max DD</span> <span style="color:#f87171;">${esc(d?.maxDrawdown)}%</span> &nbsp;
               <span style="color:#94a3b8;font-weight:600;">Vol</span> <span style="color:${d?.volSpike?"#f59e0b":"#94a3b8"}">${esc(d?.volRatio)}x</span></div>
        </div>
        ${patternBadges ? `<div style="margin-top:6px;">${patternBadges}</div>` : ""}
      </td>
    </tr>
  </table>

  <!-- Trade Instruction -->
  <div style="padding:11px 16px;border-bottom:1px solid #1a2d40;">
    <div style="background:${ac}0e;border-left:3px solid ${ac};border-radius:7px;padding:10px 13px;">
      <div style="font-size:10px;font-weight:800;color:${ac};letter-spacing:1px;text-transform:uppercase;margin-bottom:5px;">📋 Trade Instruction</div>
      <div style="font-size:14px;font-weight:700;color:#e2e8f0;">${esc(sig.instruction)}</div>
      ${(isBuy || isSell) ? `
      <table style="margin-top:9px;font-size:11px;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:14px;color:#10b981;">🎯 Target: <b>PKR ${esc(sig.targetPrice)}</b></td>
          <td style="padding-right:14px;color:#f43f5e;">🛑 Stop Loss: <b>PKR ${esc(sig.stopLoss)}</b></td>
          <td style="color:#a78bfa;">⚖️ R/R: <b>1:${esc(sig.rrRatio)}</b></td>
        </tr>
      </table>` : ""}
    </div>
    <!-- Noob summary -->
    <div style="margin-top:8px;padding:8px 12px;background:#0a1628;border-radius:7px;font-size:12px;color:#94a3b8;line-height:1.6;">${esc(sig.noobSummary)}</div>
    <!-- Pro summary -->
    <div style="margin-top:5px;font-size:10px;color:#334155;font-style:italic;padding:0 4px;">${esc(sig.proSummary)}</div>
  </div>

  <!-- Pivot Levels -->
  ${d?.pivots ? `
  <div style="padding:7px 16px;border-bottom:1px solid #1a2d40;font-size:11px;">
    <span style="color:#475569;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Pivot Levels: </span>
    <span style="color:#f43f5e;">R3 ${esc(d.pivots.r3)}</span> ·
    <span style="color:#f87171;">R2 ${esc(d.pivots.r2)}</span> ·
    <span style="color:#fca5a5;">R1 ${esc(d.pivots.r1)}</span> ·
    <span style="color:#94a3b8;font-weight:600;">Pivot ${esc(d.pivots.pivot)}</span> ·
    <span style="color:#86efac;">S1 ${esc(d.pivots.s1)}</span> ·
    <span style="color:#4ade80;">S2 ${esc(d.pivots.s2)}</span> ·
    <span style="color:#10b981;">S3 ${esc(d.pivots.s3)}</span>
  </div>` : ""}

  <!-- Signal Breakdown -->
  ${bullList || bearList ? `
  <div style="padding:8px 16px;border-bottom:1px solid #1a2d40;">
    <table cellpadding="0" cellspacing="0" width="100%">
      ${bullList}${bearList}${neutralList}
    </table>
  </div>` : ""}

  <!-- Gemini Validation -->
  ${gv ? `
  <div style="padding:9px 16px;border-bottom:1px solid #1a2d40;background:#070f1c;">
    <div style="font-size:11px;">
      <span style="color:#a78bfa;font-weight:800;">🤖 Gemini Verdict:</span>
      <span style="color:${gvc};font-weight:700;margin-left:6px;">${esc(gv.verdict)}</span>
      <span style="color:#475569;"> · ${esc(gv.conviction)} conviction · ${esc(gv.time_horizon)}</span>
    </div>
    <div style="color:#94a3b8;font-size:11px;margin-top:4px;line-height:1.6;">${esc(gv.reason)}</div>
    ${gv.alt_action ? `<div style="color:#f59e0b;font-size:11px;margin-top:3px;">↳ Gemini suggests: ${esc(gv.alt_action)}${gv.alt_limit_price ? ` @ PKR ${esc(gv.alt_limit_price)}` : ""}</div>` : ""}
    <div style="margin-top:4px;display:flex;gap:16px;font-size:11px;">
      ${gv.key_catalyst ? `<div style="color:#10b981;">⚡ ${esc(gv.key_catalyst)}</div>` : ""}
      ${gv.key_risk     ? `<div style="color:#f43f5e;">⚠️ ${esc(gv.key_risk)}</div>`     : ""}
    </div>
  </div>` : ""}

  <!-- Coaching -->
  ${coaching ? `
  <div style="padding:9px 16px;background:#060e1a;">
    <div style="font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">🎓 Coach Says</div>
    <div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-bottom:5px;">${esc(coaching.beginner)}</div>
    <div style="font-size:11px;color:#4b5563;font-style:italic;line-height:1.5;">${esc(coaching.pro_narrative)}</div>
    ${coaching.risk_warning ? `<div style="font-size:11px;color:#f59e0b;margin-top:4px;">⚠️ ${esc(coaching.risk_warning)}</div>` : ""}
    ${coaching.best_entry_timing ? `<div style="font-size:11px;color:#3b82f6;margin-top:2px;">⏰ Best entry: ${esc(coaching.best_entry_timing)}</div>` : ""}
  </div>` : ""}

</div>`;
}

// ─── Main template builder ─────────────────────────────────────
function buildHtmlEmail(stockData, signals, summary, performance, gemini, time) {
    const portfolioMap  = {};
    for (const [ticker, d] of Object.entries(stockData)) {
        portfolioMap[ticker.replace(".KA", "")] = d;
    }

    const counts = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
    for (const s of Object.values(signals)) counts[s.action] = (counts[s.action] || 0) + 1;
    const totalBuys  = counts.BUY + counts.STRONG_BUY;
    const totalSells = counts.SELL + counts.STRONG_SELL;

    const pnlUp = (summary.totalPnl || 0) >= 0;
    const pnlC  = pnlUp ? "#10b981" : "#f43f5e";

    const m = gemini?.market, a = gemini?.analysis, coach = gemini?.coaching;
    const stanceC = { Bullish:"#10b981", Bearish:"#f43f5e", Neutral:"#f59e0b" }[a?.overall_stance] || "#94a3b8";

    // Build stock cards
    let stockCards = "";
    for (const [sym, sig] of Object.entries(signals)) {
        if (sig.action === "SKIP") continue;
        const d        = portfolioMap[sym];
        const gv       = a?.validation?.find(v => v.symbol === sym);
        const coachItem= coach?.coaching?.find(c => c.symbol === sym);
        stockCards += stockCard(sym, sig, d, gv, coachItem);
    }

    // Sector weights
    const sectorRows = Object.entries(summary.sectorWeights || {})
        .sort(([,a],[,b]) => b - a)
        .map(([s, w]) => `<tr>
            <td style="font-size:11px;color:#94a3b8;padding:2px 0;width:120px;">${esc(s)}</td>
            <td style="padding:2px 0;">
              <div style="height:6px;background:#0a1628;border-radius:3px;overflow:hidden;">
                <div style="width:${w}%;height:100%;background:#3b82f6;border-radius:3px;"></div>
              </div>
            </td>
            <td style="font-size:11px;color:#64748b;padding:2px 0 2px 8px;">${w}%</td>
          </tr>`).join("");

    return `<!DOCTYPE html><html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PSX Report ${time}</title>
</head>
<body style="margin:0;padding:0;background:#030c18;font-family:'Segoe UI',system-ui,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="max-width:660px;margin:0 auto;padding:14px;">

  <!-- ═══ HEADER ═══ -->
  <div style="background:linear-gradient(140deg,#071e3d 0%,#0a2444 50%,#061628 100%);border:1px solid #1a3a5c;border-radius:18px;padding:24px;margin-bottom:14px;">
    <div style="font-size:10px;color:#3b82f6;font-weight:800;letter-spacing:3px;text-transform:uppercase;">Pakistan Stock Exchange · KSE-100</div>
    <div style="font-size:30px;font-weight:900;color:#f8fafc;margin:6px 0 3px;letter-spacing:-1px;">📊 Trading Report</div>
    <div style="font-size:12px;color:#475569;">${esc(time)}</div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
      ${counts.STRONG_BUY ? `<span style="padding:4px 13px;border-radius:99px;font-size:11px;font-weight:800;background:#10b98125;color:#10b981;border:1px solid #10b98145;">▲▲ S.BUY ${counts.STRONG_BUY}</span>` : ""}
      ${counts.BUY  ? `<span style="padding:4px 13px;border-radius:99px;font-size:11px;font-weight:700;background:#4ade8020;color:#4ade80;border:1px solid #4ade8040;">▲ BUY ${counts.BUY}</span>` : ""}
      <span style="padding:4px 13px;border-radius:99px;font-size:11px;font-weight:700;background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40;">● HOLD ${counts.HOLD}</span>
      ${counts.SELL ? `<span style="padding:4px 13px;border-radius:99px;font-size:11px;font-weight:700;background:#f8717120;color:#f87171;border:1px solid #f8717140;">▼ SELL ${counts.SELL}</span>` : ""}
      ${counts.STRONG_SELL ? `<span style="padding:4px 13px;border-radius:99px;font-size:11px;font-weight:800;background:#f43f5e25;color:#f43f5e;border:1px solid #f43f5e45;">▼▼ S.SELL ${counts.STRONG_SELL}</span>` : ""}
      ${performance ? `<span style="padding:4px 13px;border-radius:99px;font-size:11px;font-weight:700;background:#a855f720;color:#a855f7;border:1px solid #a855f740;">🎯 ${performance.accuracy}% acc</span>` : ""}
    </div>
  </div>

  <!-- ═══ PORTFOLIO SUMMARY ═══ -->
  <div style="background:#0c1a2e;border:1px solid #1a3350;border-radius:14px;padding:16px 20px;margin-bottom:14px;">
    <div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Portfolio Overview</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align:left;">
          <div style="font-size:10px;color:#475569;">Total Invested</div>
          <div style="font-size:16px;font-weight:700;color:#64748b;">PKR ${(summary.totalCost || 0).toLocaleString()}</div>
        </td>
        <td style="text-align:center;">
          <div style="font-size:10px;color:#475569;">Market Value</div>
          <div style="font-size:18px;font-weight:800;color:#f1f5f9;">PKR ${(summary.totalValue || 0).toLocaleString()}</div>
        </td>
        <td style="text-align:right;">
          <div style="font-size:10px;color:#475569;">Unrealised P&L</div>
          <div style="font-size:22px;font-weight:900;color:${pnlC};">${sign(summary.totalPnl||0)}PKR ${(summary.totalPnl || 0).toLocaleString()}</div>
          <div style="font-size:14px;font-weight:800;color:${pnlC};">${sign(summary.totalPnlPct||0)}${summary.totalPnlPct || 0}%</div>
        </td>
      </tr>
    </table>
    <!-- Sector weights -->
    <div style="margin-top:14px;border-top:1px solid #1a2d40;padding-top:12px;">
      <div style="font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Sector Allocation</div>
      <table width="100%" cellpadding="0" cellspacing="0">${sectorRows}</table>
    </div>
  </div>

  <!-- ═══ GEMINI MARKET INTELLIGENCE ═══ -->
  ${m || a ? `
  <div style="background:#0c1a2e;border:1px solid #1a3350;border-radius:14px;margin-bottom:14px;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#071120;border-bottom:1px solid #1a2d40;">
      <tr>
        <td style="padding:13px 16px;"><span style="font-size:13px;font-weight:900;color:#a78bfa;">🤖 GEMINI MARKET INTELLIGENCE</span></td>
        ${a?.overall_stance ? `<td style="padding:13px 16px;text-align:right;">
          <span style="padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;background:${stanceC}20;color:${stanceC};border:1px solid ${stanceC}50;">${esc(a.overall_stance)}</span>
        </td>` : ""}
      </tr>
    </table>

    ${m && !m.raw ? `
    <!-- Global -->
    <div style="padding:12px 16px;border-bottom:1px solid #1a2d40;">
      <div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Global Markets</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">🛢 Brent <b>${esc(m.global?.oil_brent_usd)}</b> <span style="color:${m.global?.oil_trend==="Rising"?"#10b981":"#f43f5e"}">${esc(m.global?.oil_trend)}</span></span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">💵 PKR/USD <b>~${esc(m.global?.usd_pkr)}</b></span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">🏦 Fed <b>${esc(m.global?.fed_stance)}</b></span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">📈 10Y <b>${esc(m.global?.us_10y_yield)}</b></span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:${m.global?.em_flows==="Inflows"?"#10b981":"#f43f5e"};">EM ${esc(m.global?.em_flows)}</span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:${m.global?.sentiment==="Risk-On"?"#10b981":"#f43f5e"};">${esc(m.global?.sentiment)}</span>
      </div>
      ${m.global?.key_global_drivers?.length ? `<div style="margin-top:7px;font-size:10px;color:#475569;">Key drivers: ${m.global.key_global_drivers.join(" · ")}</div>` : ""}
    </div>

    <!-- Pakistan -->
    <div style="padding:12px 16px;border-bottom:1px solid #1a2d40;">
      <div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Pakistan Macro</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">📊 KSE-100 <b>${esc(m.pakistan?.kse100_trend)}</b></span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">🏛 SBP <b>${esc(m.pakistan?.sbp_policy_rate)}</b> (${esc(m.pakistan?.sbp_next_meeting)})</span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">📉 CPI <b>${esc(m.pakistan?.inflation_cpi)}</b> ${esc(m.pakistan?.inflation_trend)}</span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">🤝 IMF <b>${esc(m.pakistan?.imf_program)}</b></span>
        <span style="background:#0f1a2e;border:1px solid #1a2d40;padding:4px 10px;border-radius:7px;color:#94a3b8;">🏦 Reserves <b>${esc(m.pakistan?.forex_reserves)}</b></span>
      </div>
      <div style="margin-top:8px;display:flex;gap:20px;font-size:11px;flex-wrap:wrap;">
        ${m.pakistan?.key_risks?.length  ? `<div style="color:#f43f5e;">⚠️ ${m.pakistan.key_risks.join(" · ")}</div>` : ""}
        ${m.pakistan?.key_tailwinds?.length ? `<div style="color:#10b981;">✅ ${m.pakistan.key_tailwinds.join(" · ")}</div>` : ""}
      </div>
    </div>

    <!-- Sector Outlook table -->
    ${m.sector_outlook ? `
    <div style="padding:12px 16px;border-bottom:1px solid #1a2d40;">
      <div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Sector Outlook</div>
      <table cellpadding="0" cellspacing="0" width="100%">
      ${Object.entries(m.sector_outlook).map(([sec, val]) => {
          const c = val.startsWith("Bull") ? "#10b981" : val.startsWith("Bear") ? "#f43f5e" : "#f59e0b";
          return `<tr><td style="font-size:11px;color:#64748b;padding:2px 0;min-width:110px;">${esc(sec)}</td><td style="font-size:11px;color:${c};padding:2px 0;">${esc(val)}</td></tr>`;
      }).join("")}
      </table>
    </div>` : ""}

    ${m.today_summary ? `
    <div style="padding:10px 16px;border-bottom:1px solid #1a2d40;font-size:12px;color:#94a3b8;font-style:italic;line-height:1.5;">"${esc(m.today_summary)}"</div>` : ""}
    ` : m?.raw ? `<div style="padding:12px 16px;font-size:12px;color:#94a3b8;">${esc(m.raw)}</div>` : ""}

    <!-- Portfolio Health -->
    ${a?.portfolio_health ? `
    <div style="padding:12px 16px;border-bottom:1px solid #1a2d40;">
      <div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Portfolio Health Assessment</div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">${esc(a.portfolio_health.sector_balance_comment)}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;">
        ${a.portfolio_health.best_positioned ? `<div style="color:#10b981;">⭐ Best: ${esc(a.portfolio_health.best_positioned)}</div>` : ""}
        ${a.portfolio_health.biggest_risk_position ? `<div style="color:#f43f5e;">⚠️ Risk: ${esc(a.portfolio_health.biggest_risk_position)}</div>` : ""}
      </div>
      ${a.macro_portfolio_impact ? `<div style="margin-top:6px;font-size:11px;color:#475569;font-style:italic;">${esc(a.macro_portfolio_impact)}</div>` : ""}
    </div>` : ""}

    <!-- Top Trade / Avoid -->
    ${a?.top_conviction_trade || a?.avoid_today ? `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${a.top_conviction_trade ? `<td style="padding:11px 16px;width:50%;vertical-align:top;">
          <div style="background:#10b98112;border:1px solid #10b98130;border-radius:9px;padding:9px;">
            <div style="font-size:10px;color:#10b981;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">⭐ Top Trade Today</div>
            <div style="font-size:12px;color:#94a3b8;line-height:1.5;">${esc(a.top_conviction_trade)}</div>
          </div>
        </td>` : ""}
        ${a.avoid_today ? `<td style="padding:11px 16px;vertical-align:top;">
          <div style="background:#f43f5e12;border:1px solid #f43f5e30;border-radius:9px;padding:9px;">
            <div style="font-size:10px;color:#f43f5e;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">🚫 Avoid Today</div>
            <div style="font-size:12px;color:#94a3b8;line-height:1.5;">${esc(a.avoid_today)}</div>
          </div>
        </td>` : ""}
      </tr>
    </table>` : ""}

    <!-- Daily Coaching Tip -->
    ${coach?.daily_coaching_tip ? `
    <div style="padding:10px 16px;background:#060e1a;border-top:1px solid #1a2d40;">
      <span style="font-size:10px;color:#a78bfa;font-weight:700;text-transform:uppercase;letter-spacing:1px;">🎓 Today's Coaching Tip: </span>
      <span style="font-size:12px;color:#94a3b8;">${esc(coach.daily_coaching_tip)}</span>
      ${coach.emotional_check ? `<div style="margin-top:4px;font-size:11px;color:#64748b;font-style:italic;">${esc(coach.emotional_check)}</div>` : ""}
    </div>` : ""}
  </div>` : ""}

  <!-- ═══ STOCK CARDS ═══ -->
  <div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;padding-left:4px;">
    Individual Position Signals
  </div>
  ${stockCards}

  <!-- FOOTER -->
  <div style="text-align:center;padding:18px;font-size:10px;color:#1e293b;line-height:1.6;">
    PSX Agent · ${esc(time)}<br/>
    Algorithmic analysis only — not financial advice. Always do your own research.
  </div>
</div>
</body></html>`;
}

module.exports = { buildHtmlEmail };