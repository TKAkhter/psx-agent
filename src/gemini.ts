import axios from "axios";
import { ENV } from "./config";
import { TradeSignalMap, PortfolioSummary } from "./signals";
import { StockDataMap, StockData, MarketContext } from "./fetch-data";
import { PerformanceResult } from "./performance";

// ─────────────────────────────────────────────────────────────
//  TYPES  — compact Gemini JSON keys expand to these
// ─────────────────────────────────────────────────────────────

export interface MarketIntelligence {
  global: {
    sentiment: string | null;
    oil_brent_usd: string | null;
    oil_trend: string | null;
    usd_pkr: string | null;
    fed_stance: string | null;
    us_10y_yield: string | null;
    em_flows: string | null;
    key_drivers: string[];
  };
  pakistan: {
    kse100_level: string | null;
    kse100_chg: string | null;
    sbp_rate: string | null;
    sbp_outlook: string | null;
    cpi: string | null;
    cpi_trend: string | null;
    pkr_outlook: string | null;
    imf_program: string | null;
    fx_reserves: string | null;
    political_risk: string | null;
    key_risks: string[];
    key_tailwinds: string[];
  };
  sector_outlook: Record<string, string>;
  overall_stance: string | null;
  today_headline: string | null;
  raw?: string;
}

export interface ValidationEntry {
  symbol: string;
  system_action: string;
  verdict: "Agree" | "Disagree" | "Partial";
  conviction: "High" | "Med" | "Low";
  analyst_note: string;
  alt_action: string | null;
  alt_price: string | null;
  key_catalyst: string;
  key_risk: string;
  time_horizon: string;
  beginner_explanation: string;
  entry_zone: string | null;
  exit_zone: string | null;
}

export interface SignalAnalysis {
  portfolio_health: {
    concentration_risk: string;
    concentration_detail: string;
    pnl_comment: string;
    best_positioned: string;
    biggest_risk: string;
  };
  validation: ValidationEntry[];
  macro_impact: string;
  top_trade_today: string;
  avoid_today: string | null;
  daily_tip: string;
  emotional_state: string;
  overall_stance: string;
  raw?: string;
}

export interface WeeklyReview {
  weeklyOutlook: string;
  portfolioGrade: string;
  positionsToWatch: Array<{
    sym: string;
    reason: string;
    upcomingCatalyst: string | null;
  }>;
  rebalanceAdvice: string;
  riskWarning: string;
  weeklyTip: string;
  raw?: string;
}

export interface GeminiInsight {
  market: MarketIntelligence | null;
  analysis: SignalAnalysis | null;
  weekly: WeeklyReview | null;
}

// ─────────────────────────────────────────────────────────────
//  SYSTEM INSTRUCTION  (once — reduces per-call token count)
// ─────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = {
  parts: [
    {
      text: `You are a dual-role Pakistan Stock Exchange (PSX/KSE-100) expert:
1. Senior quant analyst — validate algorithmic signals with sector fundamentals & macro
2. Retail investor coach — explain trades in plain English with exact PKR amounts

PSX sector knowledge (apply in every validation):
• Banking (MEBL): SBP rate cuts=wider spreads=bullish NIMs. Watch KIBOR trend.
• Oil & Gas (OGDC/MARI/POL): Brent price + domestic gas allocation = key drivers.
• Fertilizer (EFERT/FFC): Urea prices + SNGPL/SSGC gas tariff = margin drivers.
• Cement (LUCK): PSDP spending + construction credit + Afghanistan/India export margins.
• Energy/IPP (HUBC): Circular debt resolution + capacity payments + tariff renegotiation.
• Technology (SYS): IT export growth (SBP data) + PKR/USD + US tech demand.
• Conglomerate (ENGROH): Diversified: fertilizer, energy, food.

RULES: Return valid JSON only. No markdown. No text outside JSON.`,
    },
  ],
};

// ─────────────────────────────────────────────────────────────
//  CORE CALL  (axios)
// ─────────────────────────────────────────────────────────────

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function geminiCall(
  prompt: string,
  maxTokens: number,
  useSearch: boolean
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    systemInstruction: SYSTEM_INSTRUCTION,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: maxTokens,
      // responseMimeType: "application/json",
    },
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const url = `${GEMINI_URL}/${ENV.GEMINI_MODEL}:generateContent?key=${ENV.GEMINI_API_KEY}`;
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 60_000,
  });

  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const clean = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        /* fall */
      }
    }
    console.warn("  ⚠ Gemini JSON parse failed");
    return { raw: clean.slice(0, 400) };
  }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 1 — Market Intelligence  (Google Search grounded)
//  Compact schema: abbreviated keys save ~40% tokens vs verbose
// ─────────────────────────────────────────────────────────────

async function fetchMarketIntelligence(
  today: string,
  liveMarket: MarketContext | null
): Promise<MarketIntelligence> {
  const liveCtx = liveMarket?.kse100
    ? `Live(PSXTerminal): KSE100=${liveMarket.kse100.level}(${liveMarket.kse100.changePct}%),Adv=${liveMarket.breadth?.advances},Dec=${liveMarket.breadth?.declines},A/D=${liveMarket.breadth?.adRatio}. Search to fill/verify missing.`
    : "Search for all live figures.";

  // One-liner compact JSON schema — saves tokens vs multi-line
  const prompt = `Today:${today}. ${liveCtx}
Return compact JSON (null if unknown):
{"g":{"sent":"Risk-On|Risk-Off|Neutral","oil":"<Brent>","oilDir":"Rising|Falling|Stable","pkrusd":"<rate>","fed":"Hawkish|Dovish|Neutral|Pause","us10y":"<yield>","em":"Inflows|Outflows|Mixed","drivers":["<d1>","<d2>","<d3>"]},"pk":{"kse100":"<level>","kse100Chg":"<pct>","sbp":"<rate>","sbpOut":"Cut|Hold|Hike","cpi":"<pct>","cpiDir":"Falling|Stable|Rising","pkrOut":"Stable|Weak|Strong","imf":"OnTrack|AtRisk|Off","fx":"<bn USD>","polRisk":"Low|Med|High","risks":["<r1>","<r2>"],"winds":["<w1>","<w2>"]},"sectors":{"Banking":"<Bull|Bear|Neutral>|<reason>","Oil & Gas":"<Bull|Bear|Neutral>|<reason>","Fertilizer":"<Bull|Bear|Neutral>|<reason>","Cement":"<Bull|Bear|Neutral>|<reason>","Energy":"<Bull|Bear|Neutral>|<reason>","Technology":"<Bull|Bear|Neutral>|<reason>","Conglomerate":"<Bull|Bear|Neutral>|<reason>"},"stance":"Bull|Bear|Neutral","headline":"<1 sentence>"}`;

  const raw = await geminiCall(prompt, 1000, true);
  return expandMarketRaw(raw);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 2 — Signal Validation + Coaching  (no search needed)
// ─────────────────────────────────────────────────────────────

async function validateAndCoach(
  signals: TradeSignalMap,
  snapshot: CompactSnapshot[],
  summary: PortfolioSummary,
  performance: PerformanceResult | null,
  market: MarketIntelligence | null,
  today: string
): Promise<SignalAnalysis> {
  const perfLine = performance
    ? `PrevAcc:${performance.accuracy}%(${performance.correct}/${
        performance.total
      }).${performance.breakdown
        .slice(0, 4)
        .map(
          (b) => `${b.symbol}:${b.action}→${b.correct ? "✓" : "✗"}${b.delta}%`
        )
        .join(",")}`
    : "NoHistory.";

  const macroLine =
    market && !market.raw
      ? `Macro:KSE=${market.pakistan.kse100_level}(${market.pakistan.kse100_chg}%),SBP=${market.pakistan.sbp_rate}(${market.pakistan.sbp_outlook}),Oil=$${market.global.oil_brent_usd}(${market.global.oil_trend}),PKR=${market.global.usd_pkr},IMF=${market.pakistan.imf_program},CPI=${market.pakistan.cpi}`
      : "";

  // Compact signals — only validation-relevant fields
  const sigs = Object.entries(signals)
    .filter(([, s]) => s.action !== "SKIP")
    .map(([, s]: any) => ({
      sym: s.symbol,
      act: s.action,
      score: s.score,
      entry: s.limitPrice,
      tgt: s.targetPrice,
      sl: s.stopLoss,
      rr: s.rrRatio,
      rsi: s.rsi14,
      mfi: s.mfi,
      roc: s.roc,
      st: s.superTrend?.signal,
      trend: s.trend,
      adx: s.adx?.adx,
      macd: s.macd?.crossover ?? s.macd?.histTrend,
      ichi: s.ichi?.position,
      bull: s.bullReasons.slice(0, 2),
      bear: s.bearReasons.slice(0, 2),
    }));

  const prompt = `${today}. ${macroLine}
${perfLine}
Port:cost=${summary.totalCost?.toLocaleString()} val=${summary.totalValue?.toLocaleString()} pnl=${
    summary.totalPnlPct
  }%
Sectors:${JSON.stringify(summary.sectorWeights)}
Signals:${JSON.stringify(sigs)}
Holdings:${JSON.stringify(snapshot)}
Return JSON:
{"health":{"concRisk":"Low|Med|High","concDetail":"<txt>","pnlComment":"<txt>","best":"<SYM—why>","risk":"<SYM—why>"},"v":[{"sym":"SYM","act":"BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL","verdict":"Agree|Disagree|Partial","conv":"High|Med|Low","note":"<2 sentences: tech+sector>","altAct":null,"altPx":null,"catalyst":"<named trigger>","risk":"<named risk>","horizon":"1-3d|1-2w|1-3m","simple":"<1-2 plain English sentences with PKR amounts>","entryZone":"<PKR range>","exitZone":"<PKR range>"}],"macro":"<portfolio-specific impact>","topTrade":"<SYM—why best R/R>","avoid":"<SYM or null>","tip":"<1 tip>","mood":"Confident|Cautious|Patient|Defensive","stance":"Bull|Bear|Neutral"}`;

  const raw = await geminiCall(prompt, 3000, false);
  return expandAnalysisRaw(raw);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 3 — Weekly Strategic Review  (9am only, uses Search)
// ─────────────────────────────────────────────────────────────

async function weeklyStrategicReview(
  snapshot: CompactSnapshot[],
  summary: PortfolioSummary,
  today: string
): Promise<WeeklyReview> {
  const prompt = `${today}. Weekly PSX strategic review.
Port:cost=${summary.totalCost?.toLocaleString()} val=${summary.totalValue?.toLocaleString()} pnl=${
    summary.totalPnlPct
  }% sectors:${JSON.stringify(summary.sectorWeights)}
Holdings:${JSON.stringify(
    snapshot.map((d) => ({
      sym: d.sym,
      sec: d.sec,
      px: d.px,
      cost: d.cost,
      pnl: d.pnl,
      pe: d.pe,
      div: d.div,
      m1: d.m1,
      m6: d.m6,
    }))
  )}
Use Google Search for upcoming PSX catalysts (results dates, board meetings, dividend announcements).
Return JSON:
{"weeklyOutlook":"<2-3 sentences>","portfolioGrade":"A|B|C|D — <why>","positionsToWatch":[{"sym":"<SYM>","reason":"<why>","upcomingCatalyst":"<event or null>"}],"rebalanceAdvice":"<txt>","riskWarning":"<txt>","weeklyTip":"<txt>"}`;

  const raw = await geminiCall(prompt, 1500, true);
  return raw as WeeklyReview;
}

// ─────────────────────────────────────────────────────────────
//  COMPACT SNAPSHOT (what we send to Gemini per stock)
// ─────────────────────────────────────────────────────────────

interface CompactSnapshot {
  sym: string;
  sec: string;
  px: number;
  cost: number;
  pnl: number | null;
  rsi: number | null;
  mfi: number | null;
  roc: number | null;
  st: string | null;
  trend: string;
  adx: number | null;
  macd: string | null;
  ichi: string | null;
  obv: string;
  m1: number | null;
  m6: number | null;
  pe: number | null;
  div: number | null;
  s1: number | null;
  r1: number | null;
}

function buildSnapshot(stockData: StockDataMap): CompactSnapshot[] {
  return Object.entries(stockData)
    .filter(
      ([k, d]) =>
        k !== "__market__" && !("error" in d) && (d as StockData).price
    )
    .map(([, d]) => {
      const sd = d as StockData;
      return {
        sym: sd.symbol,
        sec: sd.sector,
        px: sd.price,
        cost: sd.avgCost,
        pnl: sd.unrealizedPct,
        rsi: sd.rsi14,
        mfi: sd.mfi,
        roc: sd.roc,
        st: sd.superTrend?.signal ?? null,
        trend: sd.trend,
        adx: sd.adx?.adx ?? null,
        macd: sd.macd?.crossover ?? sd.macd?.histTrend ?? null,
        ichi: sd.ichi?.position ?? null,
        obv: sd.obv?.trend ?? "NEUTRAL",
        m1: sd.perf1m,
        m6: sd.perf6m,
        pe: sd.fundamentals?.peRatio ?? null,
        div: sd.fundamentals?.dividendYield ?? null,
        s1: sd.pivots?.s1 ?? null,
        r1: sd.pivots?.r1 ?? null,
      };
    });
}

// ─────────────────────────────────────────────────────────────
//  MASTER FUNCTION
// ─────────────────────────────────────────────────────────────

export async function getGeminiInsight(
  stockData: StockDataMap,
  signals: TradeSignalMap,
  summary: PortfolioSummary,
  performance: PerformanceResult | null,
  today: string,
  sessionHour: number
): Promise<GeminiInsight | null> {
  if (!ENV.GEMINI_ENABLED || !ENV.GEMINI_API_KEY) {
    console.log("  ⚠ Gemini disabled");
    return null;
  }

  const liveMarket = (stockData.__market__ as MarketContext) ?? null;
  const snapshot = buildSnapshot(stockData);

  let market: MarketIntelligence | null = null;
  let analysis: SignalAnalysis | null = null;
  let weekly: WeeklyReview | null = null;

  try {
    console.log("  → Phase 1: Market intel (Google Search grounding)...");
    market = await fetchMarketIntelligence(today, liveMarket);
    if (!market.raw) {
      console.log(
        `    KSE-100:${market.pakistan.kse100_level} | Oil:$${market.global.oil_brent_usd} | PKR:${market.global.usd_pkr} | ${market.overall_stance}`
      );
    }
  } catch (e) {
    console.error("  ✗ Phase 1:", (e as Error).message);
  }

  try {
    console.log("  → Phase 2: Signal validation + coaching...");
    analysis = await validateAndCoach(
      signals,
      snapshot,
      summary,
      performance,
      market,
      today
    );
    if (!analysis.raw) {
      console.log(
        `    Stance:${analysis.overall_stance} | Top:${analysis.top_trade_today
          ?.split("—")[0]
          ?.trim()} | Mood:${analysis.emotional_state}`
      );
    }
  } catch (e) {
    console.error("  ✗ Phase 2:", (e as Error).message);
  }

  // Phase 3 only at first session of day (≤ 11:00 PKT)
  if (sessionHour < 11) {
    try {
      console.log("  → Phase 3: Weekly strategic review (9am only)...");
      weekly = await weeklyStrategicReview(snapshot, summary, today);
      if (!weekly.raw)
        console.log(
          `    Grade:${weekly.portfolioGrade?.split("—")[0]?.trim()}`
        );
    } catch (e) {
      console.error("  ✗ Phase 3:", (e as Error).message);
    }
  }

  return { market, analysis, weekly };
}

// ─────────────────────────────────────────────────────────────
//  EXPAND HELPERS — compact raw keys → readable fields
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandMarketRaw(m: any): MarketIntelligence {
  if (!m || m.raw) return m as MarketIntelligence;
  return {
    global: {
      sentiment: m.g?.sent ?? null,
      oil_brent_usd: m.g?.oil ?? null,
      oil_trend: m.g?.oilDir ?? null,
      usd_pkr: m.g?.pkrusd ?? null,
      fed_stance: m.g?.fed ?? null,
      us_10y_yield: m.g?.us10y ?? null,
      em_flows: m.g?.em ?? null,
      key_drivers: m.g?.drivers ?? [],
    },
    pakistan: {
      kse100_level: m.pk?.kse100 ?? null,
      kse100_chg: m.pk?.kse100Chg ?? null,
      sbp_rate: m.pk?.sbp ?? null,
      sbp_outlook: m.pk?.sbpOut ?? null,
      cpi: m.pk?.cpi ?? null,
      cpi_trend: m.pk?.cpiDir ?? null,
      pkr_outlook: m.pk?.pkrOut ?? null,
      imf_program: m.pk?.imf ?? null,
      fx_reserves: m.pk?.fx ?? null,
      political_risk: m.pk?.polRisk ?? null,
      key_risks: m.pk?.risks ?? [],
      key_tailwinds: m.pk?.winds ?? [],
    },
    sector_outlook: m.sectors ?? {},
    overall_stance: m.stance ?? null,
    today_headline: m.headline ?? null,
    raw: m.raw,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandAnalysisRaw(a: any): SignalAnalysis {
  if (!a || a.raw) return a as SignalAnalysis;
  return {
    portfolio_health: {
      concentration_risk: a.health?.concRisk ?? "",
      concentration_detail: a.health?.concDetail ?? "",
      pnl_comment: a.health?.pnlComment ?? "",
      best_positioned: a.health?.best ?? "",
      biggest_risk: a.health?.risk ?? "",
    },
    validation: (a.v ?? []).map((v: Record<string, unknown>) => ({
      symbol: v.sym,
      system_action: v.act,
      verdict: v.verdict,
      conviction: v.conv,
      analyst_note: v.note,
      alt_action: v.altAct ?? null,
      alt_price: v.altPx ?? null,
      key_catalyst: v.catalyst ?? "",
      key_risk: v.risk ?? "",
      time_horizon: v.horizon ?? "",
      beginner_explanation: v.simple ?? "",
      entry_zone: v.entryZone ?? null,
      exit_zone: v.exitZone ?? null,
    })),
    macro_impact: a.macro ?? "",
    top_trade_today: a.topTrade ?? "",
    avoid_today: a.avoid ?? null,
    daily_tip: a.tip ?? "",
    emotional_state: a.mood ?? "",
    overall_stance: a.stance ?? "",
    raw: a.raw,
  };
}
