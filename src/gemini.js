"use strict";
const { ENV } = require("./config");

// ─── Core Gemini call ─────────────────────────────────────────
async function geminiCall(prompt, maxTokens = 2048) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ENV.GEMINI_MODEL}:generateContent?key=${ENV.GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
            }),
        }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json?.error || json));
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Strip accidental markdown fences
    return raw.replace(/^```json\s*/m, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();
}

function safeParseJSON(raw, label) {
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`  ⚠ Gemini ${label} JSON parse failed — storing raw`);
        return { raw };
    }
}

// ─── Phase 1: Market Intelligence ─────────────────────────────
async function getMarketIntelligence(today) {
    const prompt = `You are a senior Pakistan Stock Exchange (PSX) macro analyst. Today is ${today}.

Using your latest knowledge, provide a structured market intelligence briefing.
Return ONLY valid JSON — no markdown, no preamble, no explanation:

{
  "global": {
    "sentiment": "Risk-On | Risk-Off | Neutral",
    "oil_brent_usd": "<current estimate>",
    "oil_trend": "Rising | Falling | Stable",
    "usd_pkr": "<current estimate>",
    "fed_stance": "Hawkish | Dovish | Neutral",
    "us_10y_yield": "<estimate>",
    "em_flows": "Inflows | Outflows | Mixed",
    "china_outlook": "Positive | Negative | Neutral",
    "key_global_drivers": ["<driver1>", "<driver2>", "<driver3>"]
  },
  "pakistan": {
    "kse100_trend": "Bullish | Bearish | Sideways",
    "kse100_level": "<estimate>",
    "sbp_policy_rate": "<rate>%",
    "sbp_next_meeting": "<outlook: Cut Expected | Hold | Hike Risk>",
    "inflation_cpi": "<estimate>%",
    "inflation_trend": "Falling | Stable | Rising",
    "pkr_stability": "Stable | Depreciation Risk | Appreciation",
    "imf_program": "On Track | At Risk | Suspended",
    "forex_reserves": "<estimate USD bn>",
    "political_risk": "Low | Medium | High",
    "key_risks": ["<risk1>", "<risk2>"],
    "key_tailwinds": ["<tailwind1>", "<tailwind2>"]
  },
  "sector_outlook": {
    "Banking":      "<Bullish|Bearish|Neutral> — <one line reason>",
    "Oil & Gas":    "<Bullish|Bearish|Neutral> — <one line reason>",
    "Fertilizer":  "<Bullish|Bearish|Neutral> — <one line reason>",
    "Cement":      "<Bullish|Bearish|Neutral> — <one line reason>",
    "Energy":      "<Bullish|Bearish|Neutral> — <one line reason>",
    "Technology":  "<Bullish|Bearish|Neutral> — <one line reason>",
    "Conglomerate":"<Bullish|Bearish|Neutral> — <one line reason>"
  },
  "overall_stance": "Bullish | Bearish | Neutral",
  "today_summary": "<1 crisp sentence: what is the single most important thing to know about markets today>"
}`;

    const raw = await geminiCall(prompt, 1500);
    return safeParseJSON(raw, "Phase1");
}

// ─── Phase 2: Signal Validation ───────────────────────────────
async function validateSignals(signals, stockSnapshot, summary, performance, today) {
    const perfContext = performance
        ? `Previous session accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total} correct). Breakdown: ${JSON.stringify(performance.breakdown?.slice(0, 5))}`
        : "No previous performance data available.";

    const prompt = `You are a senior PSX quantitative analyst. Today is ${today}.
${perfContext}

Portfolio Summary: ${JSON.stringify(summary)}
Holdings & Technicals: ${JSON.stringify(stockSnapshot)}
System-generated signals: ${JSON.stringify(signals)}

Task: For each position, validate the algorithmic signal with your sector knowledge and macro context.
Be specific — mention SBP rate impact on banks, gas prices on oil companies, urea prices on fertilizers, etc.

Return ONLY valid JSON:
{
  "portfolio_health": {
    "concentration_risk": "Low | Medium | High",
    "concentration_detail": "<which sector/stock is overweight>",
    "sector_balance_comment": "<brief assessment>",
    "overall_pnl_comment": "<comment on portfolio's current P&L>",
    "biggest_risk_position": "<SYMBOL> — <why>",
    "best_positioned": "<SYMBOL> — <why>"
  },
  "validation": [
    {
      "symbol": "<SYMBOL>",
      "system_action": "<BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL>",
      "verdict": "Agree | Disagree | Partially Agree",
      "conviction": "High | Medium | Low",
      "reason": "<2-3 sentences combining technical + sector catalyst>",
      "alt_action": null,
      "alt_limit_price": null,
      "key_risk": "<main specific risk for this trade>",
      "key_catalyst": "<specific event or condition that triggers the expected move>",
      "time_horizon": "Short-term (1-3 days) | Medium (1-2 weeks) | Long-term (1-3 months)"
    }
  ],
  "macro_portfolio_impact": "<how today's specific macro conditions affect THIS portfolio>",
  "top_conviction_trade": "<SYMBOL> — <full sentence: why this is the single best trade today>",
  "avoid_today": "<SYMBOL or null> — <why to avoid if applicable>",
  "overall_stance": "Bullish | Bearish | Neutral"
}`;

    const raw = await geminiCall(prompt, 2500);
    return safeParseJSON(raw, "Phase2");
}

// ─── Phase 3: Coaching Mode ────────────────────────────────────
async function getCoachingInsights(signals, stockSnapshot, today) {
    // Only coach on actionable signals
    const actionable = Object.entries(signals)
        .filter(([, s]) => s.action !== "HOLD" && s.action !== "SKIP")
        .map(([sym, s]) => ({
            symbol: sym,
            action: s.action,
            score: s.score,
            bullSignals: s.bullSignals?.slice(0, 3),
            bearSignals: s.bearSignals?.slice(0, 3),
            price: s.price,
            limitPrice: s.limitPrice,
            targetPrice: s.targetPrice,
            stopLoss: s.stopLoss,
            rrRatio: s.rrRatio,
            unrealizedPct: s.unrealizedPct,
        }));

    if (actionable.length === 0) return null;

    const prompt = `You are a friendly yet expert PSX stock market coach. Today is ${today}.

You have ${actionable.length} actionable signals for a Pakistani retail investor. Your job is to:
1. Give a BEGINNER explanation for each signal (simple, clear, no jargon)
2. Give a PRO-LEVEL chart narrative for each (use technical terms freely)
3. Give overall portfolio coaching advice

Return ONLY valid JSON:
{
  "coaching": [
    {
      "symbol": "<SYMBOL>",
      "beginner": "<2-3 sentences in plain Urdu/English mix or just English — explain what is happening and what to do, like explaining to a friend who just started investing. No technical jargon. Use PKR amounts.>",
      "pro_narrative": "<2-3 sentences using technical analysis language — mention specific indicator readings, price action context, and what confirmation to wait for>",
      "risk_warning": "<one sentence specific risk to be aware of>",
      "best_entry_timing": "Market Open | Wait for Dip | End of Day | Specific condition"
    }
  ],
  "daily_coaching_tip": "<one universal tip for today's market conditions that applies to this portfolio>",
  "emotional_check": "<brief comment on whether investor should be feeling cautious, confident, or patient today>"
}`;

    const raw = await geminiCall(prompt, 1500);
    return safeParseJSON(raw, "Phase3");
}

// ─── Master function ───────────────────────────────────────────
async function getGeminiInsight(stockData, signals, summary, performance, today) {
    if (!ENV.GEMINI_ENABLED || !ENV.GEMINI_API_KEY) {
        console.log("  ⚠ Gemini disabled or no API key");
        return null;
    }

    // Build compact snapshot for Gemini (avoid sending full raw data)
    const stockSnapshot = Object.entries(stockData)
        .filter(([, d]) => !d.error && d.price)
        .map(([t, d]) => ({
            symbol: t.replace(".KA", ""),
            sector: d.sector,
            price: d.price,
            avg_cost: d.avg_cost,
            unrealizedPct: d.unrealizedPct,
            rsi14: d.rsi14,
            trend: d.trend,
            adx: d.adx?.adx,
            adxTrend: d.adx?.trend,
            macdCross: d.macd?.crossover,
            stochK: d.stoch?.k,
            ichiPosition: d.ichi?.position,
            perf6m: d.perf6m,
            perf1m: d.perf1m,
            perf1w: d.perf1w,
            high6m: d.high6m,
            low6m: d.low6m,
            maxDrawdown: d.maxDrawdown,
            obvTrend: d.obv?.trend,
            volRatio: d.volRatio,
            patterns: d.patterns?.map(p => p.name),
            pivotS1: d.pivots?.s1,
            pivotR1: d.pivots?.r1,
        }));

    let market = null;
    let analysis = null;
    let coaching = null;

    try {
        console.log("  → Phase 1: Market intelligence...");
        market = await getMarketIntelligence(today);
    } catch (e) { console.error("  ✗ Phase 1:", e.message); }

    try {
        console.log("  → Phase 2: Signal validation...");
        analysis = await validateSignals(signals, stockSnapshot, summary, performance, today);
    } catch (e) { console.error("  ✗ Phase 2:", e.message); }

    try {
        console.log("  → Phase 3: Coaching mode...");
        coaching = await getCoachingInsights(signals, stockSnapshot, today);
    } catch (e) { console.error("  ✗ Phase 3:", e.message); }

    return { market, analysis, coaching };
}

module.exports = { getGeminiInsight };