import axios from "axios";
import { ENV } from "./config";
import type {
  TradeSignalMap, TradeSignal, Signal,
  PortfolioSummary, StockDataMap, StockData, MarketContext,
  MarketOverview, HistoricalTrend,
  MarketIntelligence, SignalAnalysis, WeeklyReview, GeminiInsight,
  ValidationEntry, PerformanceResult,
} from "./types";

export type { MarketIntelligence, SignalAnalysis, WeeklyReview, GeminiInsight, ValidationEntry };

// ─────────────────────────────────────────────────────────────
//  SYSTEM INSTRUCTION  (sent once per call — saves ~200 tokens
//  compared to embedding sector rules in every prompt)
// ─────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = {
  parts: [{
    text: `You are a Pakistan Stock Exchange (PSX/KSE-100) expert with two roles:
1. Senior Quant Analyst — validate algorithmic signals using macro + sector fundamentals.
2. Retail Coach — explain every trade in plain English with exact PKR amounts.

PSX sector rules (always apply in validation):
• Banking(MEBL): SBP rate cuts→wider NIMs→bullish. Watch KIBOR spread.
• Oil/Gas(OGDC,MARI,POL): Brent + domestic gas allocation quota = key drivers.
• Fertilizer(EFERT,FFC): Urea price + SNGPL/SSGC gas tariff = gross margin.
• Cement(LUCK): PSDP disbursement + construction credit + Afghan/India export margins.
• Energy/IPP(HUBC): Circular debt settlement + capacity payments + tariff renegotiation.
• Technology(SYS): IT export remittance data + PKR stability + US tech demand cycle.
• Conglomerate(ENGROH): Diversified across fertilizer, energy, food — moderate macro sensitivity.

When action is SELL: suggest only stocks the investor ALREADY HOLDS that look relatively better.
Return ONLY valid compact JSON. No markdown, no extra text.`,
  }],
};

// ─────────────────────────────────────────────────────────────
//  CORE CALL  (axios, responseMimeType forces JSON output)
// ─────────────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function geminiCall(prompt: string, maxTokens: number, useSearch: boolean): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    systemInstruction: SYSTEM_INSTRUCTION,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature:      0.1,
      maxOutputTokens:  maxTokens,
    },
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const url = `${GEMINI_BASE}/${ENV.GEMINI_MODEL}:generateContent?key=${ENV.GEMINI_API_KEY}`;
  const res  = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 60_000,
  });

  const raw   = (res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "") as string;
  const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(clean); }
  catch {
    const m = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) { try { return JSON.parse(m[1]); } catch { /* fall */ } }
    console.warn("  ⚠ Gemini JSON parse failed");
    return { raw: clean.slice(0, 400) };
  }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 1 — Real-time Market Intelligence
//  Google Search grounded; feeds live PSX data we already have.
//  Adds general market analysis for the analyst role.
// ─────────────────────────────────────────────────────────────

async function fetchMarketIntelligence(
  today:          string,
  liveMarket:     MarketContext | null,
  marketOverview: MarketOverview | null,
): Promise<MarketIntelligence> {
  // Feed what we already fetched → reduces hallucination
  const liveCtx = liveMarket?.kse100
    ? `Live(PSXTerminal): KSE100=${liveMarket.kse100.level}(${liveMarket.kse100.changePct}%), Adv=${liveMarket.breadth?.advances}, Dec=${liveMarket.breadth?.declines}, A/D=${liveMarket.breadth?.adRatio}. Verify/fill rest via Search.`
    : "Use Search for all live figures.";

  const moversCtx = marketOverview?.topGainers?.length
    ? `Top Gainers: ${marketOverview.topGainers.slice(0,3).map(m=>`${m.symbol}(${m.changePct}%)`).join(",")}. Top Losers: ${marketOverview.topLosers.slice(0,3).map(m=>`${m.symbol}(${m.changePct}%)`).join(",")}.`
    : "";

  const prompt =
`Today:${today}. ${liveCtx} ${moversCtx}
Return JSON(null if unknown):
{"g":{"sent":"Risk-On|Risk-Off|Neutral","oil":"<Brent>","oilDir":"Rising|Falling|Stable","pkrusd":"<rate>","fed":"Hawkish|Dovish|Neutral|Pause","us10y":"<yield>","em":"Inflows|Outflows|Mixed","drivers":["<d1>","<d2>","<d3>"]},"pk":{"kse100":"<level>","kse100Chg":"<pct>","sbp":"<rate%>","sbpOut":"Cut|Hold|Hike","cpi":"<pct>","cpiDir":"Falling|Stable|Rising","pkrOut":"Stable|Weak|Strong","imf":"OnTrack|AtRisk|Off","fx":"<bn USD>","polRisk":"Low|Med|High","risks":["<r1>","<r2>"],"winds":["<w1>","<w2>"]},"sectors":{"Banking":"<Bull|Bear|Neutral>|<reason>","Oil & Gas":"<Bull|Bear|Neutral>|<reason>","Fertilizer":"<Bull|Bear|Neutral>|<reason>","Cement":"<Bull|Bear|Neutral>|<reason>","Energy":"<Bull|Bear|Neutral>|<reason>","Technology":"<Bull|Bear|Neutral>|<reason>","Conglomerate":"<Bull|Bear|Neutral>|<reason>"},"generalMarket":"<3 sentences: PSX breadth today, key themes, best sectors to focus on — for a market analyst>","stance":"Bull|Bear|Neutral","headline":"<1 sentence: single most important PSX driver today>"}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await geminiCall(prompt, 1100, true);
  return expandMarketRaw(raw);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 2 — Signal Validation + Coaching
//  Includes:
//  • DB historical trend context per stock (7-session trend)
//  • Market-wide top movers context
//  • SELL signals → alt_buy_suggestions from PORTFOLIO ONLY
//  • market_wide_insight for analyst role
// ─────────────────────────────────────────────────────────────

interface CompactSnap {
  sym:string; sec:string; px:number; cost:number; pnl:number|null;
  rsi:number|null; mfi:number|null; roc:number|null; regime:string;
  st:string|null; trend:string; adx:number|null; macd:string|null;
  ichi:string|null; obv:string; m1:number|null; m6:number|null;
  pe:number|null; div:number|null; pb:number|null;
  s1:number|null; r1:number|null;
  // Historical trend from DB
  prevPx:number|null; chg7d:number|null; avgScore7d:number|null; prevAct:string|null;
}

function buildSnapshot(stockData: StockDataMap): CompactSnap[] {
  return Object.entries(stockData)
    .filter(([k, d]) => k !== "__market__" && !("error" in d) && (d as StockData).price)
    .map(([, d]) => {
      const sd = d as StockData;
      const ht = sd.historicalTrend;
      return {
        sym: sd.symbol, sec: sd.sector, px: sd.price, cost: sd.avgCost, pnl: sd.unrealizedPct,
        rsi: sd.rsi14, mfi: sd.mfi, roc: sd.roc, regime: sd.marketRegime,
        st:  sd.superTrend?.signal ?? null, trend: sd.trend,
        adx: sd.adx?.adx ?? null,
        macd: sd.macd?.crossover ?? sd.macd?.histTrend ?? null,
        ichi: sd.ichi?.position ?? null,
        obv:  sd.obv?.trend ?? "NEUTRAL",
        m1: sd.perf1m, m6: sd.perf6m,
        pe: sd.fundamentals?.peRatio ?? null,
        div: sd.fundamentals?.dividendYield ?? null,
        pb:  sd.fundamentals?.pbRatio ?? null,
        s1: sd.pivots?.s1 ?? null, r1: sd.pivots?.r1 ?? null,
        // DB history
        prevPx:     ht?.prevPrice      ?? null,
        chg7d:      ht?.priceChange7d  ?? null,
        avgScore7d: ht?.avgScore7d     ?? null,
        prevAct:    ht?.prevAction     ?? null,
      };
    });
}

async function validateAndCoach(
  signals:        TradeSignalMap,
  snapshot:       CompactSnap[],
  summary:        PortfolioSummary,
  performance:    PerformanceResult | null,
  market:         MarketIntelligence | null,
  marketOverview: MarketOverview | null,
  today:          string,
): Promise<SignalAnalysis> {
  const macroLine = market && !market.raw
    ? `Macro:KSE=${market.pakistan.kse100_level}(${market.pakistan.kse100_chg}%),SBP=${market.pakistan.sbp_rate}(${market.pakistan.sbp_outlook}),Oil=$${market.global.oil_brent_usd}(${market.global.oil_trend}),PKR=${market.global.usd_pkr},IMF=${market.pakistan.imf_program}`
    : "";

  const perfLine = performance
    ? `PrevAcc:${performance.accuracy}%(${performance.correct}/${performance.total}). ${performance.breakdown.slice(0, 4).map(b => `${b.symbol}:${b.action}→${b.correct ? "✓" : "✗"}${b.delta}%`).join(",")}`
    : "NoHistory.";

  // Compact top-movers context for analyst-level insight
  const moversLine = marketOverview?.topGainers?.length
    ? `MarketWide-Gainers:${marketOverview.topGainers.slice(0,3).map(m=>`${m.symbol}(${m.changePct}%)`).join(",")} Losers:${marketOverview.topLosers.slice(0,3).map(m=>`${m.symbol}(${m.changePct}%)`).join(",")}`
    : "";

  // List of portfolio symbols available for alt_buy_suggestions
  const portfolioSyms = snapshot.map(s => s.sym).join(",");

  const sigs = (Object.entries(signals) as [string, Signal][])
    .filter(([, s]) => s.action !== "SKIP")
    .map(([, s]) => {
      const ts = s as TradeSignal;
      return {
        sym: ts.symbol, act: ts.action, score: ts.score,
        entry: ts.limitPrice, tgt: ts.targetPrice, sl: ts.stopLoss, rr: ts.rrRatio,
        rsi: ts.rsi14, mfi: ts.mfi, roc: ts.roc, st: ts.superTrend?.signal,
        regime: ts.marketRegime, trend: ts.trend, adx: ts.adx?.adx,
        macd: ts.macd?.crossover ?? ts.macd?.histTrend,
        bull: ts.bullReasons.slice(0, 2),
        bear: ts.bearReasons.slice(0, 2),
      };
    });

  const prompt =
`${today}. ${macroLine}
${perfLine}
${moversLine}
Portfolio: cost=PKR${summary.totalCost?.toLocaleString()} val=PKR${summary.totalValue?.toLocaleString()} pnl=${summary.totalPnlPct}%
Sectors: ${JSON.stringify(summary.sectorWeights)}
Signals: ${JSON.stringify(sigs)}
Holdings(with 7-day DB history): ${JSON.stringify(snapshot)}
PortfolioSymbols(for alt_buy): ${portfolioSyms}

Return JSON:
{"health":{"concRisk":"Low|Med|High","concDetail":"<txt>","pnlComment":"<1 line>","best":"<SYM—why>","risk":"<SYM—why>"},"v":[{"sym":"SYM","act":"BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL","verdict":"Agree|Disagree|Partial","conv":"High|Med|Low","note":"<2 sentences: technicals+sector catalyst>","altAct":null,"altPx":null,"catalyst":"<named trigger>","risk":"<named risk>","horizon":"1-3d|1-2w|1-3m","simple":"<1-2 plain English with PKR amounts>","entryZone":"<PKR range or null>","exitZone":"<PKR range or null>","alt_buy_suggestions":["<SYM: reason — ONLY from portfolio, ONLY for SELL signals, else null>"],"trend_note":"<1 sentence on 7-day price trend from DB history, or null>"}],"macro":"<how macro affects this portfolio specifically>","generalMarketAnalysis":"<3 sentences: overall PSX state today, which sectors are hot/cold, what type of stocks to favour — analyst perspective>","market_wide_insight":"<2 sentences: what the top movers today signal about market breadth and sector rotation — for analyst role beyond own portfolio>","topTrade":"<SYM—why best R/R today>","avoid":"<SYM or null—why>","sectorRotation":"<rotation opportunity or null>","tip":"<1 specific actionable tip for today>","mood":"Confident|Cautious|Patient|Defensive","stance":"Bull|Bear|Neutral"}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await geminiCall(prompt, 3400, false);
  return expandAnalysisRaw(raw);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 3 — Weekly Strategic Review  (9am only, Search)
// ─────────────────────────────────────────────────────────────

async function weeklyStrategicReview(
  snapshot: CompactSnap[],
  summary:  PortfolioSummary,
  today:    string,
): Promise<WeeklyReview> {
  const prompt =
`${today}. Weekly PSX review. Use Search for upcoming catalysts: board meetings, results, dividends, PSX announcements.
Port: val=PKR${summary.totalValue?.toLocaleString()} pnl=${summary.totalPnlPct}% sectors=${JSON.stringify(summary.sectorWeights)}
Holdings: ${JSON.stringify(snapshot.map(d => ({ sym: d.sym, sec: d.sec, px: d.px, cost: d.cost, pnl: d.pnl, pe: d.pe, div: d.div, m1: d.m1, m6: d.m6, chg7d: d.chg7d })))}
Return JSON:
{"weeklyOutlook":"<2-3 sentences>","portfolioGrade":"A|B|C|D — <why>","positionsToWatch":[{"sym":"SYM","reason":"<why>","upcomingCatalyst":"<named event or null>"}],"rebalanceAdvice":"<txt>","riskWarning":"<biggest risk this week>","weeklyTip":"<1 strategic tip>"}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await geminiCall(prompt, 1500, true);
  return raw as WeeklyReview;
}

// ─────────────────────────────────────────────────────────────
//  MASTER FUNCTION
// ─────────────────────────────────────────────────────────────

export async function getGeminiInsight(
  stockData:        StockDataMap,
  signals:          TradeSignalMap,
  summary:          PortfolioSummary,
  performance:      PerformanceResult | null,
  marketOverview:   MarketOverview | null,
  today:            string,
  sessionHour:      number,
): Promise<GeminiInsight | null> {
  if (!ENV.GEMINI_ENABLED || !ENV.GEMINI_API_KEY) {
    console.log("  ⚠ Gemini disabled");
    return null;
  }

  const liveMarket = stockData.__market__ ?? null;
  const snapshot   = buildSnapshot(stockData);

  let market:   MarketIntelligence | null = null;
  let analysis: SignalAnalysis      | null = null;
  let weekly:   WeeklyReview        | null = null;

  try {
    console.log("  → Phase 1 · Market intelligence (Google Search)...");
    market = await fetchMarketIntelligence(today, liveMarket, marketOverview);
    if (!market.raw) {
      console.log(`    KSE-100: ${market.pakistan.kse100_level} | Oil: $${market.global.oil_brent_usd} | PKR: ${market.global.usd_pkr} | Stance: ${market.overall_stance}`);
    }
  } catch (e) { console.error(`  ✗ Phase 1: ${(e as Error).message}`); }

  try {
    console.log("  → Phase 2 · Validation + coaching (with DB history)...");
    analysis = await validateAndCoach(signals, snapshot, summary, performance, market, marketOverview, today);
    if (!analysis.raw) {
      console.log(`    Stance: ${analysis.overall_stance} | Top: ${analysis.top_trade_today?.split("—")[0]?.trim()} | ${analysis.emotional_state}`);
    }
  } catch (e) { console.error(`  ✗ Phase 2: ${(e as Error).message}`); }

  if (sessionHour < 11) {
    try {
      console.log("  → Phase 3 · Weekly review (9am only, Search)...");
      weekly = await weeklyStrategicReview(snapshot, summary, today);
      if (!weekly.raw) console.log(`    Grade: ${weekly.portfolioGrade?.split("—")[0]?.trim()}`);
    } catch (e) { console.error(`  ✗ Phase 3: ${(e as Error).message}`); }
  }

  return { market, analysis, weekly };
}

// ─────────────────────────────────────────────────────────────
//  EXPAND HELPERS  (compact keys → full readable field names)
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandMarketRaw(m: any): MarketIntelligence {
  if (!m || m.raw) return m as MarketIntelligence;
  return {
    global: {
      sentiment:     m.g?.sent    ?? null,
      oil_brent_usd: m.g?.oil     ?? null,
      oil_trend:     m.g?.oilDir  ?? null,
      usd_pkr:       m.g?.pkrusd  ?? null,
      fed_stance:    m.g?.fed     ?? null,
      us_10y_yield:  m.g?.us10y   ?? null,
      em_flows:      m.g?.em      ?? null,
      key_drivers:   m.g?.drivers ?? [],
    },
    pakistan: {
      kse100_level:   m.pk?.kse100    ?? null,
      kse100_chg:     m.pk?.kse100Chg ?? null,
      sbp_rate:       m.pk?.sbp       ?? null,
      sbp_outlook:    m.pk?.sbpOut    ?? null,
      cpi:            m.pk?.cpi       ?? null,
      cpi_trend:      m.pk?.cpiDir    ?? null,
      pkr_outlook:    m.pk?.pkrOut    ?? null,
      imf_program:    m.pk?.imf       ?? null,
      fx_reserves:    m.pk?.fx        ?? null,
      political_risk: m.pk?.polRisk   ?? null,
      key_risks:      m.pk?.risks     ?? [],
      key_tailwinds:  m.pk?.winds     ?? [],
    },
    sector_outlook:          m.sectors       ?? {},
    overall_stance:          m.stance        ?? null,
    today_headline:          m.headline      ?? null,
    general_market_analysis: m.generalMarket ?? undefined,
    raw:                     m.raw,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandAnalysisRaw(a: any): SignalAnalysis {
  if (!a || a.raw) return a as SignalAnalysis;
  return {
    portfolio_health: {
      concentration_risk:   a.health?.concRisk   ?? "",
      concentration_detail: a.health?.concDetail  ?? "",
      pnl_comment:          a.health?.pnlComment  ?? "",
      best_positioned:      a.health?.best        ?? "",
      biggest_risk:         a.health?.risk        ?? "",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validation: (a.v ?? []).map((v: any): ValidationEntry => ({
      symbol:               v.sym        ?? "",
      system_action:        v.act        ?? "",
      verdict:              v.verdict    ?? "Partial",
      conviction:           v.conv       ?? "Med",
      analyst_note:         v.note       ?? "",
      alt_action:           v.altAct     ?? null,
      alt_price:            v.altPx      ?? null,
      key_catalyst:         v.catalyst   ?? "",
      key_risk:             v.risk       ?? "",
      time_horizon:         v.horizon    ?? "",
      beginner_explanation: v.simple     ?? "",
      entry_zone:           v.entryZone  ?? null,
      exit_zone:            v.exitZone   ?? null,
      alt_buy_suggestions:  Array.isArray(v.alt_buy_suggestions) ? v.alt_buy_suggestions : null,
      trend_note:           v.trend_note ?? null,
    })),
    macro_impact:            a.macro                  ?? "",
    general_market_analysis: a.generalMarketAnalysis  ?? "",
    market_analysis:         a.generalMarketAnalysis  ?? "",
    market_wide_insight:     a.market_wide_insight    ?? "",
    top_trade_today:         a.topTrade               ?? "",
    avoid_today:             a.avoid                  ?? null,
    sector_rotation:         a.sectorRotation         ?? null,
    daily_tip:               a.tip                    ?? "",
    emotional_state:         a.mood                   ?? "",
    overall_stance:          a.stance                 ?? "",
    raw:                     a.raw,
  };
}
