"use strict";
const { ENV } = require("./config");

// ─────────────────────────────────────────────────────────────
//  SYSTEM INSTRUCTION  (shared across calls — reduces repetition)
// ─────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = {
    parts: [{
        text: `You are a dual-role Pakistan Stock Exchange (PSX/KSE-100) expert:
1. Senior quantitative analyst — validate algorithmic signals using sector fundamentals
2. Retail investor coach — explain trades in plain English with exact PKR amounts

PSX-specific knowledge you MUST apply:
- Banking: SBP policy rate directly affects net interest margins (NIMs). Rate cuts = bullish for banks
- Oil & Gas (OGDC/MARI/POL): Domestic gas allocation policy + global Brent price = key drivers
- Fertilizer (EFERT/FFC): Urea prices + gas tariff from SNGPL/SUI = margin drivers
- Cement (LUCK): PSDP spending, construction sector credit, export margins to Afghanistan/India
- Energy (HUBC): Circular debt resolution, IPP tariff renegotiation, capacity payments
- Technology (SYS): IT exports growth, PKR/USD stability, US tech demand
- Conglomerate (ENGROH): Diversified exposure across fertilizer, energy, food segments

ALWAYS return valid JSON only. No markdown. No explanation outside JSON.`
    }]
};

// ─────────────────────────────────────────────────────────────
//  CORE GEMINI CALL
// ─────────────────────────────────────────────────────────────

async function geminiCall(prompt, maxTokens = 2048, useSearch = false) {
    const body = {
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
        },
    };

    // Enable Google Search grounding only when needed (Phase 1)
    if (useSearch) {
        body.tools = [{ googleSearch: {} }];
    }

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ENV.GEMINI_MODEL}:generateContent?key=${ENV.GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );

    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json?.error || json));

    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Strip any stray markdown fences despite responseMimeType
    const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    try {
        return JSON.parse(clean);
    } catch {
        // Try extracting the first JSON block
        const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (match) {
            try { return JSON.parse(match[1]); } catch { /* fall through */ }
        }
        console.warn(`  ⚠ Gemini JSON parse failed — using raw`);
        return { raw: clean.slice(0, 300) };
    }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 1 — Market Intelligence  (Google Search grounded)
//  Optimized: compact schema, no verbose descriptions
// ─────────────────────────────────────────────────────────────

async function fetchMarketIntelligence(today, liveMarketData) {
    // Feed in any live data we already have to reduce hallucination
    const liveCtx = liveMarketData
        ? `Live data (from PSXTerminal.com API, just fetched):
           KSE-100: ${liveMarketData.kse100?.level} (${liveMarketData.kse100?.changePct}% today)
           Advances: ${liveMarketData.breadth?.advances}, Declines: ${liveMarketData.breadth?.declines}
           A/D Ratio: ${liveMarketData.breadth?.adRatio}
           Use Google Search to verify/update any missing figures.`
        : "Use Google Search for all live figures.";

    const prompt = `Today: ${today}. ${liveCtx}

Return this exact JSON (fill all fields, use null if unknown):
{
  "g": {
    "sent": "Risk-On|Risk-Off|Neutral",
    "oil": "<Brent USD/bbl>",
    "oilDir": "Rising|Falling|Stable",
    "pkrusd": "<rate>",
    "fed": "Hawkish|Dovish|Neutral|Pause",
    "us10y": "<yield%>",
    "em": "Inflows|Outflows|Mixed",
    "drivers": ["<d1>","<d2>","<d3>"]
  },
  "pk": {
    "kse100": "<level>",
    "kse100Chg": "<today %>",
    "sbp": "<rate%>",
    "sbpOut": "Cut|Hold|Hike",
    "cpi": "<%>",
    "cpiDir": "Falling|Stable|Rising",
    "pkrOut": "Stable|Weak|Strong",
    "imf": "OnTrack|AtRisk|Off",
    "fx": "<reserves USD bn>",
    "polRisk": "Low|Med|High",
    "risks": ["<r1>","<r2>"],
    "winds": ["<w1>","<w2>"]
  },
  "sectors": {
    "Banking":     "<Bull|Bear|Neutral>|<reason>",
    "Oil & Gas":   "<Bull|Bear|Neutral>|<reason>",
    "Fertilizer":  "<Bull|Bear|Neutral>|<reason>",
    "Cement":      "<Bull|Bear|Neutral>|<reason>",
    "Energy":      "<Bull|Bear|Neutral>|<reason>",
    "Technology":  "<Bull|Bear|Neutral>|<reason>",
    "Conglomerate":"<Bull|Bear|Neutral>|<reason>"
  },
  "stance": "Bull|Bear|Neutral",
  "headline": "<ONE sentence: most important thing for PSX today>"
}`;

    return geminiCall(prompt, 1200, true); // useSearch = true for Phase 1
}

// ─────────────────────────────────────────────────────────────
//  PHASE 2 — Signal Validation + Coaching  (combined, no search needed)
//  Optimized: signals passed as compact arrays, schema shortened
// ─────────────────────────────────────────────────────────────

async function validateAndCoach(signals, snapshot, summary, performance, marketIntel, today) {
    // Compact performance context
    const perfLine = performance
        ? `Last session: ${performance.accuracy}% accuracy (${performance.correct}/${performance.total}). ${performance.breakdown?.slice(0, 4).map(b => `${b.symbol}:${b.action}→${b.correct ? "✓" : "✗"}${b.delta}%`).join(", ")}`
        : "No prior session.";

    // Compact macro from Phase 1
    const macroLine = marketIntel && !marketIntel.raw
        ? `Macro: KSE100=${marketIntel.pk?.kse100}(${marketIntel.pk?.kse100Chg}%), SBP=${marketIntel.pk?.sbp}(${marketIntel.pk?.sbpOut}), Oil=$${marketIntel.g?.oil}(${marketIntel.g?.oilDir}), PKR=${marketIntel.g?.pkrusd}, IMF=${marketIntel.pk?.imf}, CPI=${marketIntel.pk?.cpi}(${marketIntel.pk?.cpiDir})`
        : "";

    // Compact signal list (only what Gemini needs for validation)
    const compactSignals = Object.entries(signals)
        .filter(([, s]) => s.action !== "SKIP")
        .map(([sym, s]) => ({
            sym,
            act: s.action,
            score: s.score,
            conf: s.confidence,
            entry: s.limitPrice,
            target: s.targetPrice,
            stop: s.stopLoss,
            rr: s.rrRatio,
            bull: s.bullReasons?.slice(0, 2),
            bear: s.bearReasons?.slice(0, 2),
        }));

    // Compact snapshot (key technical readings)
    const compactSnap = snapshot.map(d => ({
        sym: d.symbol, sec: d.sector, px: d.price, cost: d.avgCost,
        pnl: d.unrealizedPct, rsi: d.rsi14, trend: d.trend,
        adx: d.adxVal, macd: d.macdCross, stoch: d.stochK,
        ichi: d.ichiPos, obv: d.obvTrend, div: d.divergence,
        w1: d.perf1w, m1: d.perf1m, m6: d.perf6m,
        pe: d.pe, divYield: d.divYield,
        s1: d.pivotS1, r1: d.pivotR1,
    }));

    const prompt = `${today}. ${macroLine}
${perfLine}

Portfolio: cost=PKR${summary.totalCost?.toLocaleString()} value=PKR${summary.totalValue?.toLocaleString()} pnl=${summary.totalPnlPct}%
Sector weights: ${JSON.stringify(summary.sectorWeights)}

Signals: ${JSON.stringify(compactSignals)}
Holdings: ${JSON.stringify(compactSnap)}

Return this exact JSON:
{
  "health": {
    "concRisk": "Low|Med|High",
    "concDetail": "<which sector/stock overweight>",
    "pnlComment": "<1 line on portfolio P&L>",
    "best": "<SYM — why>",
    "risk": "<SYM — why>"
  },
  "v": [
    {
      "sym": "MEBL",
      "act": "BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL",
      "verdict": "Agree|Disagree|Partial",
      "conv": "High|Med|Low",
      "note": "<2 sentences: technicals + sector catalyst>",
      "altAct": null,
      "altPx": null,
      "catalyst": "<specific named trigger>",
      "risk": "<specific named risk>",
      "horizon": "1-3d|1-2w|1-3m",
      "simple": "<1-2 sentences plain English with PKR amounts for beginner>"
    }
  ],
  "macro": "<how today macro affects this specific portfolio mix>",
  "topTrade": "<SYM — one sentence why this is best R/R today>",
  "avoid": "<SYM or null — one sentence>",
  "tip": "<one actionable tip for today>",
  "mood": "Confident|Cautious|Patient|Defensive",
  "stance": "Bull|Bear|Neutral"
}`;

    return geminiCall(prompt, 2800, false); // no search needed for Phase 2
}

// ─────────────────────────────────────────────────────────────
//  MASTER FUNCTION
// ─────────────────────────────────────────────────────────────

async function getGeminiInsight(stockData, signals, summary, performance, today) {
    if (!ENV.GEMINI_ENABLED || !ENV.GEMINI_API_KEY) {
        console.log("  ⚠ Gemini disabled");
        return null;
    }

    // Pull live market data already fetched by fetchAllStocks
    const liveMarketData = stockData.__market__ || null;

    // Compact snapshot for Phase 2
    const snapshot = Object.entries(stockData)
        .filter(([k, d]) => k !== "__market__" && !d.error && d.price)
        .map(([, d]) => ({
            symbol: d.symbol,
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
            obvTrend: d.obv?.trend,
            bb_pctB: d.bb?.pctB,
            bbSqueeze: d.bb?.squeeze,
            willR: d.willR,
            cci: d.cci,
            divergence: d.divergence,
            patterns: d.patterns?.map(p => p.name),
            perf1w: d.perf1w,
            perf1m: d.perf1m,
            perf6m: d.perf6m,
            pivotS1: d.pivots?.s1,
            pivotR1: d.pivots?.r1,
            volRatio: d.vol?.volRatio,
            pe: d.fundamentals?.peRatio,
            divYield: d.fundamentals?.dividendYield,
        }));

    let market = null;
    let analysis = null;

    try {
        console.log("  → Phase 1: Market intelligence (Google Search grounding)...");
        market = await fetchMarketIntelligence(today, liveMarketData);
        if (market && !market.raw) {
            console.log(`    KSE-100: ${market.pk?.kse100} | Oil: $${market.g?.oil} | PKR/USD: ${market.g?.pkrusd} | Stance: ${market.stance}`);
        }
    } catch (err) {
        console.error("  ✗ Phase 1:", err.message);
    }

    try {
        console.log("  → Phase 2: Signal validation + coaching...");
        analysis = await validateAndCoach(signals, snapshot, summary, performance, market, today);
        if (analysis && !analysis.raw) {
            console.log(`    Stance: ${analysis.stance} | Top: ${analysis.topTrade?.split("—")[0]?.trim()} | Mood: ${analysis.mood}`);
        }
    } catch (err) {
        console.error("  ✗ Phase 2:", err.message);
    }

    return { market, analysis };
}

// ─────────────────────────────────────────────────────────────
//  HELPER — parse compact Gemini market response for templates
// ─────────────────────────────────────────────────────────────

function expandMarket(m) {
    if (!m || m.raw) return m;
    return {
        global: {
            sentiment: m.g?.sent,
            oil_brent_usd: m.g?.oil,
            oil_trend: m.g?.oilDir,
            usd_pkr: m.g?.pkrusd,
            fed_stance: m.g?.fed,
            us_10y_yield: m.g?.us10y,
            em_flows: m.g?.em,
            key_drivers: m.g?.drivers || [],
        },
        pakistan: {
            kse100_level: m.pk?.kse100,
            kse100_chg: m.pk?.kse100Chg,
            sbp_rate: m.pk?.sbp,
            sbp_outlook: m.pk?.sbpOut,
            cpi: m.pk?.cpi,
            cpi_trend: m.pk?.cpiDir,
            pkr_outlook: m.pk?.pkrOut,
            imf_program: m.pk?.imf,
            fx_reserves: m.pk?.fx,
            political_risk: m.pk?.polRisk,
            key_risks: m.pk?.risks || [],
            key_tailwinds: m.pk?.winds || [],
        },
        sector_outlook: m.sectors || {},
        overall_stance: m.stance,
        today_headline: m.headline,
        raw: m.raw,
    };
}

function expandAnalysis(a) {
    if (!a || a.raw) return a;
    return {
        portfolio_health: {
            concentration_risk: a.health?.concRisk,
            concentration_detail: a.health?.concDetail,
            pnl_comment: a.health?.pnlComment,
            best_positioned: a.health?.best,
            biggest_risk: a.health?.risk,
        },
        validation: (a.v || []).map(v => ({
            symbol: v.sym,
            system_action: v.act,
            verdict: v.verdict,
            conviction: v.conv,
            analyst_note: v.note,
            alt_action: v.altAct,
            alt_price: v.altPx,
            key_catalyst: v.catalyst,
            key_risk: v.risk,
            time_horizon: v.horizon,
            beginner_explanation: v.simple,
        })),
        macro_impact: a.macro,
        top_trade_today: a.topTrade,
        avoid_today: a.avoid,
        daily_tip: a.tip,
        emotional_state: a.mood,
        overall_stance: a.stance,
        raw: a.raw,
    };
}

module.exports = { getGeminiInsight, expandMarket, expandAnalysis };