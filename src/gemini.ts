import axios from "axios";
import { ENV } from "./config";
import type {
  TradeSignalMap, TradeSignal, Signal,
  PortfolioSummary, StockDataMap, StockData, MarketContext,
  MarketIntelligence, SignalAnalysis, WeeklyReview, GeminiInsight,
  ValidationEntry, PerformanceResult,
} from "./types";

export type { MarketIntelligence, SignalAnalysis, WeeklyReview, GeminiInsight, ValidationEntry };

// ─────────────────────────────────────────────────────────────
//  SYSTEM INSTRUCTION  (sent once — not repeated per call)
//  Saves ~200 tokens per call vs embedding it in each prompt.
// ─────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = {
  parts: [{
    text: `PSX/KSE-100 expert. Two roles:
1. Quant Analyst: validate signals using macro+sector fundamentals.
2. Retail Coach: plain English with exact PKR amounts.

PSX sector rules (ALWAYS apply):
Banking(MEBL): SBP cuts→wider NIMs→bullish. Watch KIBOR.
Oil/Gas(OGDC/MARI/POL): Brent+gas allocation=key.
Fertilizer(EFERT/FFC): Urea price+SNGPL tariff=margins.
Cement(LUCK): PSDP+construction credit+export margins.
Energy(HUBC): Circular debt+capacity payments+tariff talks.
Tech(SYS): IT exports+PKR/USD+US demand.
Conglomerate(ENGROH): Diversified—fertilizer,energy,food.

On SELL signals: suggest 1-2 better PSX alternatives to buy.
Return ONLY valid JSON. No markdown. No text outside JSON.`,
  }],
};

// ─────────────────────────────────────────────────────────────
//  CORE CALL  (axios, responseMimeType=JSON, Google Search optional)
// ─────────────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function geminiCall(prompt: string, maxTokens: number, useSearch: boolean): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    systemInstruction: SYSTEM_INSTRUCTION,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature:      0.1,          // low temp = consistent JSON
      maxOutputTokens:  maxTokens,
      responseMimeType: "application/json",  // forces valid JSON output
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
    console.warn("  ⚠ Gemini JSON parse failed — returning raw snippet");
    return { raw: clean.slice(0, 400) };
  }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 1 — Market Intelligence
//  Uses Google Search for live KSE-100, Brent, PKR/USD etc.
//  Compact key schema saves ~35% tokens vs verbose keys.
//  We pass already-fetched live PSX data to ground the model.
// ─────────────────────────────────────────────────────────────

async function fetchMarketIntelligence(
  today:       string,
  liveMarket:  MarketContext | null,
): Promise<MarketIntelligence> {
  // Give Gemini what we already fetched — reduces hallucination
  const live = liveMarket?.kse100
    ? `Live(PSXTerminal API just fetched): KSE100=${liveMarket.kse100.level}(${liveMarket.kse100.changePct}%), Advances=${liveMarket.breadth?.advances}, Declines=${liveMarket.breadth?.declines}, A/D=${liveMarket.breadth?.adRatio}. Use Search to fill/verify remaining.`
    : "Use Search for all figures.";

  // One-liner compact JSON schema — avoids repeating field descriptions
  const prompt =
`Today:${today}. ${live}
Return JSON (null if unknown):
{"g":{"sent":"Risk-On|Risk-Off|Neutral","oil":"<Brent USD>","oilDir":"Rising|Falling|Stable","pkrusd":"<rate>","fed":"Hawkish|Dovish|Neutral|Pause","us10y":"<yield>","em":"Inflows|Outflows|Mixed","drivers":["<d1>","<d2>","<d3>"]},"pk":{"kse100":"<level>","kse100Chg":"<pct>","sbp":"<rate%>","sbpOut":"Cut|Hold|Hike","cpi":"<pct>","cpiDir":"Falling|Stable|Rising","pkrOut":"Stable|Weak|Strong","imf":"OnTrack|AtRisk|Off","fx":"<bn USD>","polRisk":"Low|Med|High","risks":["<r1>","<r2>"],"winds":["<w1>","<w2>"]},"sectors":{"Banking":"<Bull|Bear|Neutral>|<1-line reason>","Oil & Gas":"<Bull|Bear|Neutral>|<reason>","Fertilizer":"<Bull|Bear|Neutral>|<reason>","Cement":"<Bull|Bear|Neutral>|<reason>","Energy":"<Bull|Bear|Neutral>|<reason>","Technology":"<Bull|Bear|Neutral>|<reason>","Conglomerate":"<Bull|Bear|Neutral>|<reason>"},"generalMarket":"<3 sentences: PSX state today, breadth, key themes, what type of stocks to favour>","stance":"Bull|Bear|Neutral","headline":"<1 sentence: single most important PSX driver today>"}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await geminiCall(prompt, 1100, true);
  return expandMarketRaw(raw);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 2 — Signal Validation + Coaching
//  No Search needed — we provide all data.
//  SELL signals get alt_buys (2 PSX alternatives).
//  Compact snapshot format saves ~40% tokens.
// ─────────────────────────────────────────────────────────────

interface CompactSnap {
  sym:string; sec:string; px:number; cost:number; pnl:number|null;
  rsi:number|null; mfi:number|null; roc:number|null; regime:string;
  st:string|null; trend:string; adx:number|null; macd:string|null;
  ichi:string|null; obv:string; m1:number|null; m6:number|null;
  pe:number|null; div:number|null; pb:number|null;
  s1:number|null; r1:number|null;
}

function buildSnapshot(stockData: StockDataMap): CompactSnap[] {
  return Object.entries(stockData)
    .filter(([k, d]) => k !== "__market__" && !("error" in d) && (d as StockData).price)
    .map(([, d]) => {
      const sd = d as StockData;
      return {
        sym:sd.symbol, sec:sd.sector, px:sd.price, cost:sd.avgCost, pnl:sd.unrealizedPct,
        rsi:sd.rsi14, mfi:sd.mfi, roc:sd.roc, regime:sd.marketRegime,
        st:sd.superTrend?.signal??null, trend:sd.trend,
        adx:sd.adx?.adx??null, macd:sd.macd?.crossover??sd.macd?.histTrend??null,
        ichi:sd.ichi?.position??null, obv:sd.obv?.trend??"NEUTRAL",
        m1:sd.perf1m, m6:sd.perf6m,
        pe:sd.fundamentals?.peRatio??null, div:sd.fundamentals?.dividendYield??null,
        pb:sd.fundamentals?.pbRatio??null,
        s1:sd.pivots?.s1??null, r1:sd.pivots?.r1??null,
      };
    });
}

async function validateAndCoach(
  signals:     TradeSignalMap,
  snapshot:    CompactSnap[],
  summary:     PortfolioSummary,
  performance: PerformanceResult | null,
  market:      MarketIntelligence | null,
  today:       string,
): Promise<SignalAnalysis> {
  // Compact macro line — saves ~60 tokens vs full object
  const macroLine = market && !market.raw
    ? `Macro:KSE=${market.pakistan.kse100_level}(${market.pakistan.kse100_chg}%),SBP=${market.pakistan.sbp_rate}(${market.pakistan.sbp_outlook}),Oil=$${market.global.oil_brent_usd}(${market.global.oil_trend}),PKR=${market.global.usd_pkr},IMF=${market.pakistan.imf_program},CPI=${market.pakistan.cpi}(${market.pakistan.cpi_trend})`
    : "";

  // Compact performance line
  const perfLine = performance
    ? `PrevAcc:${performance.accuracy}%(${performance.correct}/${performance.total}). ${performance.breakdown.slice(0, 4).map(b => `${b.symbol}:${b.action}→${b.correct?"✓":"✗"}${b.delta}%`).join(",")}`
    : "NoHistory.";

  // Only send non-SKIP signals; cast to TradeSignal (safe: SKIP filtered)
  const sigs = (Object.entries(signals) as [string, Signal][])
    .filter(([, s]) => s.action !== "SKIP")
    .map(([, s]) => {
      const ts = s as TradeSignal;
      return {
        sym:ts.symbol, act:ts.action, score:ts.score,
        entry:ts.limitPrice, tgt:ts.targetPrice, sl:ts.stopLoss, rr:ts.rrRatio,
        rsi:ts.rsi14, mfi:ts.mfi, roc:ts.roc, st:ts.superTrend?.signal, regime:ts.marketRegime,
        trend:ts.trend, adx:ts.adx?.adx, macd:ts.macd?.crossover??ts.macd?.histTrend,
        bull:ts.bullReasons.slice(0, 2), bear:ts.bearReasons.slice(0, 2),
      };
    });

  const prompt =
`${today}. ${macroLine}
${perfLine}
Port:cost=PKR${summary.totalCost?.toLocaleString()} val=PKR${summary.totalValue?.toLocaleString()} pnl=${summary.totalPnlPct}%
Sectors:${JSON.stringify(summary.sectorWeights)}
Signals:${JSON.stringify(sigs)}
Holdings:${JSON.stringify(snapshot)}
Return JSON:
{"health":{"concRisk":"Low|Med|High","concDetail":"<txt>","pnlComment":"<1 line>","best":"<SYM—why>","risk":"<SYM—why>"},"v":[{"sym":"SYM","act":"BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL","verdict":"Agree|Disagree|Partial","conv":"High|Med|Low","note":"<2 sentences: technicals+sector catalyst>","altAct":null,"altPx":null,"catalyst":"<named trigger>","risk":"<named risk>","horizon":"1-3d|1-2w|1-3m","simple":"<1-2 plain English sentences with PKR amounts>","entryZone":"<PKR range or null>","exitZone":"<PKR range or null>","alt_buy_suggestions":["<SYM: reason — ONLY for SELL signals, else null>"]}],"macro":"<how today macro affects this specific portfolio>","generalMarketAnalysis":"<3 sentences: PSX state, hot/cold sectors, what to buy today>","topTrade":"<SYM—1 sentence why best R/R>","avoid":"<SYM or null—why>","sectorRotation":"<rotation opportunity or null>","tip":"<1 specific actionable tip>","mood":"Confident|Cautious|Patient|Defensive","stance":"Bull|Bear|Neutral"}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await geminiCall(prompt, 3200, false);
  return expandAnalysisRaw(raw);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 3 — Weekly Strategic Review  (9am only, uses Search)
//  Searches for upcoming PSX catalysts: results, board meetings, dividends.
// ─────────────────────────────────────────────────────────────

async function weeklyStrategicReview(
  snapshot: CompactSnap[],
  summary:  PortfolioSummary,
  today:    string,
): Promise<WeeklyReview> {
  const prompt =
`${today}. Weekly PSX strategic review. Use Search for upcoming catalysts (board meetings, results, dividends, PSX announcements).
Port:cost=PKR${summary.totalCost?.toLocaleString()} val=PKR${summary.totalValue?.toLocaleString()} pnl=${summary.totalPnlPct}%
Sectors:${JSON.stringify(summary.sectorWeights)}
Holdings:${JSON.stringify(snapshot.map(d=>({sym:d.sym,sec:d.sec,px:d.px,cost:d.cost,pnl:d.pnl,pe:d.pe,div:d.div,m1:d.m1,m6:d.m6})))}
Return JSON:
{"weeklyOutlook":"<2-3 sentences on what to expect this week>","portfolioGrade":"A|B|C|D — <why>","positionsToWatch":[{"sym":"<SYM>","reason":"<why watch>","upcomingCatalyst":"<named event or null>"}],"rebalanceAdvice":"<txt>","riskWarning":"<biggest risk this week>","weeklyTip":"<1 strategic weekly tip>"}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await geminiCall(prompt, 1500, true);
  return raw as WeeklyReview;
}

// ─────────────────────────────────────────────────────────────
//  MASTER FUNCTION
// ─────────────────────────────────────────────────────────────

export async function getGeminiInsight(
  stockData:   StockDataMap,
  signals:     TradeSignalMap,
  summary:     PortfolioSummary,
  performance: PerformanceResult | null,
  today:       string,
  sessionHour: number,
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
    console.log("  → Phase 1: Market intel (Google Search)...");
    market = await fetchMarketIntelligence(today, liveMarket);
    if (!market.raw) {
      console.log(`    KSE-100:${market.pakistan.kse100_level} | Oil:$${market.global.oil_brent_usd} | PKR:${market.global.usd_pkr} | ${market.overall_stance}`);
    }
  } catch (e) { console.error("  ✗ Phase 1:", (e as Error).message); }

  try {
    console.log("  → Phase 2: Signal validation + coaching...");
    analysis = await validateAndCoach(signals, snapshot, summary, performance, market, today);
    if (!analysis.raw) {
      console.log(`    Stance:${analysis.overall_stance} | Top:${analysis.top_trade_today?.split("—")[0]?.trim()} | ${analysis.emotional_state}`);
    }
  } catch (e) { console.error("  ✗ Phase 2:", (e as Error).message); }

  // Phase 3 only at first session (≤11:00 PKT) — weekly catalysts
  if (sessionHour < 11) {
    try {
      console.log("  → Phase 3: Weekly review (9am only)...");
      weekly = await weeklyStrategicReview(snapshot, summary, today);
      if (!weekly.raw) console.log(`    Grade:${weekly.portfolioGrade?.split("—")[0]?.trim()}`);
    } catch (e) { console.error("  ✗ Phase 3:", (e as Error).message); }
  }

  return { market, analysis, weekly };
}

// ─────────────────────────────────────────────────────────────
//  EXPAND HELPERS  (compact raw keys → readable field names)
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
    sector_outlook:  m.sectors  ?? {},
    overall_stance:  m.stance   ?? null,
    today_headline:  m.headline ?? null,
    raw:             m.raw,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandAnalysisRaw(a: any): SignalAnalysis {
  if (!a || a.raw) return a as SignalAnalysis;
  return {
    portfolio_health: {
      concentration_risk:   a.health?.concRisk    ?? "",
      concentration_detail: a.health?.concDetail  ?? "",
      pnl_comment:          a.health?.pnlComment  ?? "",
      best_positioned:      a.health?.best        ?? "",
      biggest_risk:         a.health?.risk        ?? "",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validation: (a.v ?? []).map((v: any): ValidationEntry => ({
      symbol:               v.sym       ?? "",
      system_action:        v.act       ?? "",
      verdict:              v.verdict   ?? "Partial",
      conviction:           v.conv      ?? "Med",
      analyst_note:         v.note      ?? "",
      alt_action:           v.altAct    ?? null,
      alt_price:            v.altPx     ?? null,
      key_catalyst:         v.catalyst  ?? "",
      key_risk:             v.risk      ?? "",
      time_horizon:         v.horizon   ?? "",
      beginner_explanation: v.simple    ?? "",
      entry_zone:           v.entryZone ?? null,
      exit_zone:            v.exitZone  ?? null,
      alt_buy_suggestions:  Array.isArray(v.alt_buy_suggestions) ? v.alt_buy_suggestions : null,
    })),
    macro_impact:             a.macro                  ?? "",
    general_market_analysis:  a.generalMarketAnalysis  ?? "",
    market_analysis:          a.generalMarketAnalysis  ?? "",  // alias
    top_trade_today:          a.topTrade               ?? "",
    avoid_today:              a.avoid                  ?? null,
    sector_rotation:          a.sectorRotation         ?? null,
    daily_tip:                a.tip                    ?? "",
    emotional_state:          a.mood                   ?? "",
    overall_stance:           a.stance                 ?? "",
    raw:                      a.raw,
  };
}