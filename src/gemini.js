"use strict";
const { ENV } = require("./config");

// ─────────────────────────────────────────────────────────────
//  CORE GEMINI CALL
// ─────────────────────────────────────────────────────────────

async function geminiCall(prompt, maxTokens = 2048) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ENV.GEMINI_MODEL}:generateContent?key=${ENV.GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.15,   // lower = more consistent JSON
                    maxOutputTokens: maxTokens,
                    responseMimeType: "application/json",  // force JSON output
                },
                // Google Search grounding — gives Gemini access to today's real news
                tools: [{ googleSearch: {} }],
            }),
        }
    );

    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json?.error || json));

    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Strip any stray markdown fences Gemini adds despite responseMimeType
    return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function safeParse(raw, label) {
    try {
        return JSON.parse(raw);
    } catch {
        // Try extracting first JSON object/array from response
        const match = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (match) {
            try { return JSON.parse(match[1]); } catch { /* fall through */ }
        }
        console.warn(`  ⚠ Gemini ${label}: JSON parse failed`);
        return { raw: raw.slice(0, 500) };
    }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 1 — Real-time market intelligence (with Google Search)
// ─────────────────────────────────────────────────────────────

async function fetchMarketIntelligence(today) {
    const prompt = `You are a senior Pakistan Stock Exchange (PSX/KSE-100) macro analyst. 
Today is ${today}. Use Google Search to find TODAY'S actual data before answering.

Search for: current Brent crude price, USD/PKR rate, KSE-100 index level, Pakistan SBP policy rate,
Pakistan inflation CPI, Pakistan IMF program status, global market sentiment today.

Return a single JSON object (no markdown, no text outside JSON):
{
  "global": {
    "sentiment": "Risk-On | Risk-Off | Neutral",
    "oil_brent_usd": "<actual current price from search>",
    "oil_wti_usd": "<actual>",
    "oil_trend": "Rising | Falling | Stable",
    "usd_pkr": "<actual rate>",
    "fed_stance": "Hawkish | Dovish | Neutral | Pause",
    "us_10y_yield": "<actual>",
    "em_flows": "Inflows | Outflows | Mixed",
    "china_growth": "Expanding | Contracting | Stable",
    "key_global_drivers": ["<actual driver from today's news 1>", "<driver 2>", "<driver 3>"]
  },
  "pakistan": {
    "kse100_level": "<actual today>",
    "kse100_trend": "Bullish | Bearish | Sideways",
    "kse100_change_pct": "<today's % change>",
    "sbp_policy_rate": "<actual rate>",
    "sbp_outlook": "Rate Cut Expected | Hold | Hike Risk",
    "cpi_inflation": "<actual latest %>" ,
    "inflation_trend": "Falling | Stable | Rising",
    "pkr_outlook": "Stable | Depreciation Risk | Appreciation",
    "imf_program": "On Track | At Risk | Suspended",
    "forex_reserves_usd_bn": "<actual>",
    "political_risk": "Low | Medium | High",
    "key_risks": ["<specific risk from today>", "<risk 2>"],
    "key_tailwinds": ["<tailwind 1>", "<tailwind 2>"]
  },
  "sector_outlook": {
    "Banking":      "<Bullish|Bearish|Neutral> — <specific reason mentioning SBP rate/spread>",
    "Oil & Gas":    "<Bullish|Bearish|Neutral> — <mention gas prices/oil & domestic E&P>",
    "Fertilizer":   "<Bullish|Bearish|Neutral> — <mention urea prices / gas tariffs>",
    "Cement":       "<Bullish|Bearish|Neutral> — <mention construction activity / exports>",
    "Energy":       "<Bullish|Bearish|Neutral> — <mention circular debt / power tariffs>",
    "Technology":   "<Bullish|Bearish|Neutral> — <mention IT exports / PKR>",
    "Conglomerate": "<Bullish|Bearish|Neutral> — <mention diversified exposure>"
  },
  "overall_stance": "Bullish | Bearish | Neutral",
  "today_headline": "<single sentence: the ONE thing that matters most for PSX today>"
}`;

    const raw = await geminiCall(prompt, 1800);
    return safeParse(raw, "Phase1-MarketIntel");
}

// ─────────────────────────────────────────────────────────────
//  PHASE 2 — Signal validation + coaching (combined to save latency)
// ─────────────────────────────────────────────────────────────

async function validateAndCoach(signals, snapshot, summary, performance, marketIntel, today) {
    const perfCtx = performance
        ? `Last session signal accuracy: ${performance.accuracy}% (${performance.correct}/${performance.total} correct). Per-stock: ${JSON.stringify(performance.breakdown?.slice(0, 5))}.`
        : "No previous session data.";

    const marketCtx = marketIntel && !marketIntel.raw
        ? `Today's macro: KSE-100 ${marketIntel.pakistan?.kse100_trend} at ${marketIntel.pakistan?.kse100_level}, Oil Brent $${marketIntel.global?.oil_brent_usd}, PKR/USD ${marketIntel.global?.usd_pkr}, SBP ${marketIntel.pakistan?.sbp_policy_rate} (${marketIntel.pakistan?.sbp_outlook}), IMF ${marketIntel.pakistan?.imf_program}.`
        : "";

    const prompt = `You are a dual-role PSX expert: senior quant analyst + retail investor coach.
Today: ${today}. ${marketCtx}
${perfCtx}

Portfolio: ${JSON.stringify(summary)}
Stock snapshot: ${JSON.stringify(snapshot)}
Algorithmic signals: ${JSON.stringify(signals)}

TASK: Perform TWO jobs in one JSON response.

JOB 1 — ANALYST: Validate each signal using sector expertise.
- For Banking: mention impact of SBP rate changes on NIMs and spreads.
- For Oil & Gas: mention oil price direction and domestic gas allocation.
- For Fertilizer: mention urea price trends and gas tariff impact.
- For Cement: mention PSDP spending, construction demand, export margins.
- For Technology: mention IT export growth, PKR stability impact.
- For Energy: mention circular debt resolution / IPP dividends / power tariffs.
- If you disagree with a signal, give a SPECIFIC alternate price level.

JOB 2 — COACH: Explain each ACTIONABLE signal to a beginner (no jargon).
- Use plain language like you're explaining to a first-time investor.
- Include the specific PKR entry, target, and stop amounts.
- Mention ONE specific thing to watch for that would cancel the trade.

Return a single JSON object:
{
  "portfolio_health": {
    "concentration_risk": "Low | Medium | High",
    "concentration_detail": "<which sector/stock is overweight and by how much>",
    "overall_pnl_comment": "<comment on current P&L situation>",
    "best_positioned": "<SYMBOL> — <why this is the strongest hold>",
    "biggest_risk": "<SYMBOL> — <why this needs monitoring>"
  },
  "validation": [
    {
      "symbol": "MEBL",
      "system_action": "BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL",
      "verdict": "Agree | Disagree | Partially Agree",
      "conviction": "High | Medium | Low",
      "analyst_note": "<2-3 sentences: technical reading + sector-specific catalyst>",
      "alt_action": null,
      "alt_price": null,
      "key_catalyst": "<specific named event or condition that triggers the move>",
      "key_risk": "<specific named risk that kills this trade>",
      "time_horizon": "1-3 days | 1-2 weeks | 1-3 months",
      "beginner_explanation": "<2 sentences in simple English: what is happening and what exactly to do with PKR amounts>"
    }
  ],
  "macro_impact_on_portfolio": "<how today's macro specifically affects THIS portfolio's mix of banking/oil/fertilizer/cement/tech>",
  "top_trade_today": "<SYMBOL> — <one sentence: why this is the single best risk/reward trade right now>",
  "avoid_today": "<SYMBOL or null> — <one sentence why to avoid if applicable>",
  "daily_tip": "<one actionable tip specific to today's market conditions>",
  "emotional_state": "Confident | Cautious | Patient | Defensive",
  "overall_stance": "Bullish | Bearish | Neutral"
}`;

    const raw = await geminiCall(prompt, 3000);
    return safeParse(raw, "Phase2-ValidateCoach");
}

// ─────────────────────────────────────────────────────────────
//  MASTER FUNCTION
// ─────────────────────────────────────────────────────────────

async function getGeminiInsight(stockData, signals, summary, performance, today) {
    if (!ENV.GEMINI_ENABLED || !ENV.GEMINI_API_KEY) {
        console.log("  ⚠ Gemini disabled");
        return null;
    }

    // Compact snapshot for Gemini (only what it needs)
    const snapshot = Object.entries(stockData)
        .filter(([, d]) => !d.error && d.price)
        .map(([ticker, d]) => ({
            symbol: ticker.replace(".KA", ""),
            sector: d.sector,
            price: d.price,
            avgCost: d.avgCost,
            unrealizedPct: d.unrealizedPct,
            rsi14: d.rsi14,
            trend: d.trend,
            adxVal: d.adx?.adx,
            adxStrength: d.adx?.strength,
            macdCross: d.macd?.crossover,
            stochK: d.stoch?.k,
            stochZone: d.stoch?.zone,
            ichiPos: d.ichi?.position,
            vwap: d.vwap,
            obvTrend: d.obv?.trend,
            bb_pctB: d.bb?.pctB,
            bbSqueeze: d.bb?.squeeze,
            willR: d.willR,
            cci: d.cci,
            patterns: d.patterns?.map(p => p.name),
            divergence: d.divergence,
            perf1w: d.perf1w,
            perf1m: d.perf1m,
            perf6m: d.perf6m,
            pivotS1: d.pivots?.s1,
            pivotR1: d.pivots?.r1,
            volRatio: d.vol?.volRatio,
            maxDrawdown: d.maxDrawdown,
        }));

    let market = null;
    let analysis = null;

    try {
        console.log("  → Phase 1: Market intelligence (Google Search grounding)...");
        market = await fetchMarketIntelligence(today);
        if (market && !market.raw) {
            console.log(`    KSE-100: ${market.pakistan?.kse100_level} | Oil: $${market.global?.oil_brent_usd} | PKR/USD: ${market.global?.usd_pkr}`);
        }
    } catch (err) {
        console.error("  ✗ Phase 1:", err.message);
    }

    try {
        console.log("  → Phase 2: Signal validation + coaching...");
        analysis = await validateAndCoach(signals, snapshot, summary, performance, market, today);
        if (analysis && !analysis.raw) {
            console.log(`    Stance: ${analysis.overall_stance} | Top trade: ${analysis.top_trade_today?.split("—")[0]?.trim()}`);
        }
    } catch (err) {
        console.error("  ✗ Phase 2:", err.message);
    }

    return { market, analysis };
}

module.exports = { getGeminiInsight };