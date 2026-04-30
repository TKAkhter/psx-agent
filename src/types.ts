// =============================================================
//  types.ts  —  ALL shared types in one place
//  Import from here everywhere. No type definitions elsewhere
//  (except local private interfaces that don't cross file boundaries).
// =============================================================

// ─────────────────────────────────────────────────────────────
//  CONFIG / ENV
// ─────────────────────────────────────────────────────────────

export type PortfolioType = "psx" | "yahoo";
export type EmailTheme = "dark" | "light";

export interface PortfolioEntry {
  symbol: string;
  ticker: string;
  shares: number;
  avgCost: number;
  name: string;
  sector: string;
}

export interface PositionInfo {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
}

export type PortfolioMap = Record<string, PositionInfo>;

// ─────────────────────────────────────────────────────────────
//  INDICATOR RESULT TYPES
// ─────────────────────────────────────────────────────────────

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MacdResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  prevHistogram: number | null;
  crossover: "BULLISH_CROSS" | "BEARISH_CROSS" | null;
  histTrend: "EXPANDING" | "CONTRACTING" | null;
}

export interface BollingerResult {
  upper: number;
  lower: number;
  mid: number;
  bandwidth: number;
  pctB: number; // 0 = at lower band, 100 = at upper band
  squeeze: boolean; // bandwidth < 4%
}

export interface StochasticResult {
  k: number | null;
  d: number | null;
  zone: "OVERSOLD" | "OVERBOUGHT" | "NEUTRAL" | null;
  kCrossD: "BULLISH" | "BEARISH" | null;
}

export interface AdxResult {
  adx: number | null;
  diPlus: number | null;
  diMinus: number | null;
  strength:
    | "VERY_STRONG"
    | "STRONG_BULL"
    | "STRONG_BEAR"
    | "WEAK_BULL"
    | "WEAK_BEAR"
    | "RANGING"
    | null;
}

export interface ObvResult {
  value: number;
  trend: "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
  slopeScore: number;
}

export interface VolumeMetrics {
  current: number;
  avg20: number | null;
  avg5: number | null;
  volRatio: number | null;
  volSpike: boolean;
  volTrend: "INCREASING" | "DECREASING" | "STABLE";
}

export interface IchimokuResult {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  position: "ABOVE_CLOUD" | "BELOW_CLOUD" | "IN_CLOUD";
  tkBullish: boolean;
  cloudColor: "GREEN" | "RED";
  chikouBullish: boolean | null;
  distanceToCloud: number;
}

export interface PivotResult {
  r3: number;
  r2: number;
  r1: number;
  pivot: number;
  s1: number;
  s2: number;
  s3: number;
}

export interface SuperTrendResult {
  value: number;
  signal: "BUY" | "SELL";
  direction: 1 | -1;
  distance: number; // % price is from SuperTrend line
  isBull: boolean;
}

export interface CandlePattern {
  name: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  desc: string;
}

export interface PerfStats {
  high6m: number;
  low6m: number;
  pctFrom6mHigh: number | null;
  pctFrom6mLow: number | null;
  perf6m: number | null;
  perf1m: number | null;
  perf1w: number | null;
  perf1d: number | null;
  maxDrawdown: number;
}

export type TrendLabel =
  | "STRONG_BULL"
  | "BULL"
  | "SIDEWAYS"
  | "BEAR"
  | "STRONG_BEAR"
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────────
//  FETCH / STOCK DATA
// ─────────────────────────────────────────────────────────────

export interface Fundamentals {
  peRatio?: number | null;
  dividendYield?: number | null;
  marketCap?: string | null;
  yearChange?: number | null;
  volume30Avg?: number | null;
  eps?: number | null; // Earnings per share
  bookValue?: number | null; // Book value per share
  pbRatio?: number | null; // Price-to-book ratio
}

export interface DividendRecord {
  exDate: string;
  amount: number;
  year: number;
}

export interface LiveTick {
  price: number;
  change: number;
  changePct: number;
  volume: number;
  trades: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  value: number;
}

export interface StockData extends PerfStats {
  // Identity
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
  // OHLCV (live-merged)
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  // Live tick extras
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  trades: number | null;
  // Moving averages
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  ema9: number | null;
  ema21: number | null;
  // Oscillators
  rsi14: number | null;
  rsi9: number | null;
  macd: MacdResult;
  bb: BollingerResult | null;
  stoch: StochasticResult;
  willR: number | null;
  cci: number | null;
  roc: number | null;
  mfi: number | null;
  // Trend & strength
  atr: number | null;
  adx: AdxResult;
  ichi: IchimokuResult | null;
  superTrend: SuperTrendResult | null;
  trend: TrendLabel;
  // Market regime (new)
  marketRegime:
    | "TRENDING_BULL"
    | "TRENDING_BEAR"
    | "RANGING"
    | "BREAKOUT"
    | "BREAKDOWN";
  // VWAP deviation %
  vwapDevPct: number | null; // % price deviates from VWAP
  // Flow
  vol: VolumeMetrics;
  obv: ObvResult;
  vwap: number | null;
  // Levels & patterns
  pivots: PivotResult | null;
  patterns: CandlePattern[];
  divergence: "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | null;
  // Visual
  sparkline: string;
  // P&L
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number | null;
  // Enrichment
  fundamentals: Fundamentals;
  dividends: DividendRecord[];
  dataSource: string;
  historyBars: number;
  error?: never;
}

export interface StockError {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
  error: string;
  price: null;
}

export type StockResult = StockData | StockError;

export interface MarketContext {
  kse100: {
    level: number;
    change: number;
    changePct: number;
    volume: number;
  } | null;
  breadth: {
    advances: number;
    declines: number;
    unchanged: number;
    adRatio: number;
    upVolume: number;
    downVolume: number;
  } | null;
}

// StockDataMap keyed by ticker. __market__ is the sentinel via intersection
// to avoid TS2411 "not assignable to string index type" error.
export type StockDataMap = Record<string, StockResult> & {
  __market__?: MarketContext;
};

// ─────────────────────────────────────────────────────────────
//  SIGNALS
// ─────────────────────────────────────────────────────────────

export type ActionLabel =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG_SELL"
  | "SKIP";
export type Confidence = "Very High" | "High" | "Medium" | "Low";

export interface TradeSignal {
  // Identity
  symbol: string;
  action: ActionLabel;
  score: number;
  confidence: Confidence;
  // Price levels
  limitPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  qty: number;
  rrRatio: number | null;
  potentialGain: number;
  maxRisk: number;
  // Human-readable
  instruction: string;
  beginnerNote: string;
  proSummary: string;
  // Algo reasoning
  bullReasons: string[];
  bearReasons: string[];
  neutralNotes: string[];
  // Key indicator snapshots (mirrors StockData)
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  rsi14: number | null;
  rsi9: number | null;
  mfi: number | null;
  roc: number | null;
  stoch: StochasticResult;
  macd: MacdResult;
  bb: BollingerResult | null;
  adx: AdxResult;
  willR: number | null;
  cci: number | null;
  ichi: IchimokuResult | null;
  superTrend: SuperTrendResult | null;
  vwap: number | null;
  vwapDevPct: number | null;
  obv: ObvResult;
  pivots: PivotResult | null;
  trend: TrendLabel;
  marketRegime: StockData["marketRegime"];
  vol: VolumeMetrics;
  patterns: CandlePattern[];
  divergence: "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | null;
  sparkline: string;
  // MAs
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  ema9: number | null;
  ema21: number | null;
  // P&L
  unrealizedPnl: number;
  unrealizedPct: number | null;
  marketValue: number;
  costBasis: number;
  shares: number;
  avgCost: number;
  // Performance
  perf1d: number | null;
  perf1w: number | null;
  perf1m: number | null;
  perf6m: number | null;
  high6m: number;
  low6m: number;
  maxDrawdown: number;
  pctFrom6mHigh: number | null;
  pctFrom6mLow: number | null;
  // Fundamentals snapshot
  fundamentals: Fundamentals;
  dividends: DividendRecord[];
}

export interface SkipSignal {
  symbol: string;
  action: "SKIP";
  error: string;
  score: 0;
  price: null;
}

export type Signal = TradeSignal | SkipSignal;
export type SignalMap = Record<string, Signal>;
export type TradeSignalMap = SignalMap;

export interface PortfolioSummary {
  totalCost: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  sectorWeights: Record<string, number>;
  // General market summary (from MarketContext)
  marketContext?: MarketContext | null;
}

// ─────────────────────────────────────────────────────────────
//  PERFORMANCE
// ─────────────────────────────────────────────────────────────

export interface BreakdownEntry {
  symbol: string;
  action: string;
  prevPrice: number;
  currPrice: number;
  delta: number;
  correct: boolean;
}

export interface PerformanceResult {
  accuracy: number;
  correct: number;
  total: number;
  breakdown: BreakdownEntry[];
  sessionDate: Date;
}

// ─────────────────────────────────────────────────────────────
//  GEMINI AI TYPES
// ─────────────────────────────────────────────────────────────

export interface GeminiGlobal {
  sentiment: string | null;
  oil_brent_usd: string | null;
  oil_trend: string | null;
  usd_pkr: string | null;
  fed_stance: string | null;
  us_10y_yield: string | null;
  em_flows: string | null;
  key_drivers: string[];
}

export interface GeminiPakistan {
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
}

export interface MarketIntelligence {
  global: GeminiGlobal;
  pakistan: GeminiPakistan;
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
  // New: if action is SELL, Gemini recommends alternative buys
  alt_buy_suggestions: string[] | null;
}

export interface PortfolioHealth {
  concentration_risk: string;
  concentration_detail: string;
  pnl_comment: string;
  best_positioned: string;
  biggest_risk: string;
}

export interface SignalAnalysis {
  portfolio_health: PortfolioHealth;
  validation: ValidationEntry[];
  macro_impact: string;
  top_trade_today: string;
  avoid_today: string | null;
  daily_tip: string;
  emotional_state: string;
  overall_stance: string;
  // New: general market analysis separate from portfolio
  market_analysis: string;
  general_market_analysis: string; // alias populated by gemini.ts
  // New: sector rotation recommendation
  sector_rotation: string | null;
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
//  PDF / REPORT
// ─────────────────────────────────────────────────────────────

export interface ReportData {
  stockData: StockDataMap;
  signals: TradeSignalMap;
  summary: PortfolioSummary;
  performance: PerformanceResult | null;
  gemini: GeminiInsight | null;
  timeStamp: string;
  sessionHour: number;
}
