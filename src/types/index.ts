export type ShariahMode      = 'compliant' | 'non_compliant' | 'both';
export type IndexFilter      = 'KSE-100' | 'KSE-30' | 'ALL_SHARE' | 'CUSTOM';
export type AiModel          = 'claude' | 'gpt4o' | 'gemini';
export type Signal           = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type Confidence       = 'High' | 'Medium' | 'Low';
export type AiValidation     = 'AGREE' | 'PARTIALLY_AGREE' | 'DISAGREE';
export type AlertSeverity    = 'CRITICAL' | 'WARNING' | 'INFO';
export type TrendDirection   = 'up' | 'down' | 'sideways';
export type OBVTrend         = 'accumulation' | 'distribution' | 'neutral';
export type VolumeSignal     = 'spike_up' | 'spike_down' | 'normal';
export type MacdSignal       = 'bullish_cross' | 'bearish_cross' | 'bullish' | 'bearish' | 'none';
export type BBPosition       = 'above_upper' | 'inside_upper' | 'middle' | 'inside_lower' | 'below_lower';
export type MarketStance     = 'bullish' | 'bearish' | 'neutral' | 'cautious';
export type EmailProvider    = 'smtp' | 'sendgrid' | 'ses';

export interface Holding {
  ticker:  string;
  symbol:  string;
  shares:  number;
  avgCost: number;
  name:    string;
  sector:  string;
}

export interface PortfolioPosition extends Holding {
  currentPrice:       number;
  marketValue:        number;
  costBasis:          number;
  unrealisedPlPkr:    number;
  unrealisedPlPct:    number;
  portfolioWeightPct: number;
  shariah:            boolean;
}

export interface OHLCVCandle {
  date:   string;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface TickerMarketData {
  ticker:                string;
  name:                  string;
  sector:                string;
  candles:               OHLCVCandle[];
  currentPrice:          number;
  previousClose:         number;
  dayChangePct:          number;
  high52w:               number;
  low52w:                number;
  avgVolume30d:          number;
  marketCap:             number;
  freeFloatPct:          number;
  listedShares:          number;
  upcomingDividendDate?: string;
  upcomingEarningsDate?: string;
}

export interface FundamentalData {
  ticker:                   string;
  peRatioTtm:               number;
  peRatioForward:           number;
  pbRatio:                  number;
  psRatio:                  number;
  evEbitda:                 number;
  sectorAvgPe:              number;
  epsTtm:                   number;
  epsGrowthYoy:             number;
  roeTtm:                   number;
  roaTtm:                   number;
  roicTtm:                  number;
  grossMarginPct:           number;
  netProfitMarginPct:       number;
  ebitdaMarginPct:          number;
  revenueGrowthYoy:         number;
  revenueGrowthQoq:         number;
  earningsGrowthYoy:        number;
  dividendYieldPct:         number;
  dividendPerShare:         number;
  dividendPayoutRatioPct:   number;
  consecutiveDividendYears: number;
  debtToEquity:             number;
  currentRatio:             number;
  quickRatio:               number;
  interestCoverageRatio:    number;
  netDebtToEbitda:          number;
  freeCashFlowYield:        number;
  operatingCashFlowGrowth:  number;
  bookValuePerShare:        number;
  priceToBookDiscount:      number;
  upcomingDividendDate?:    string;
  upcomingEarningsDate?:    string;
}

export interface NewsArticle {
  headline:         string;
  body:             string;
  source:           string;
  publishedAt:      Date;
  url:              string;
  tickersMentioned: string[];
  category:         'economy' | 'corporate' | 'political' | 'commodity' | 'regulatory' | 'general';
  sentimentScore:   number;
}

export interface SentimentResult {
  ticker:           string;
  score:            number;
  articleCount:     number;
  confidence:       'high' | 'medium' | 'low';
  topHeadlines:     string[];
  recentCatalysts:  string[];
}

export interface MacroSnapshot {
  pkrUsdOfficial:           number;
  pkrUsdOpen:               number;
  pkrTrend:                 'appreciating' | 'depreciating' | 'stable';
  sbpPolicyRate:            number;
  sbpRateTrend:             'hiking' | 'cutting' | 'holding';
  kibor1w:                  number;
  kibor1m:                  number;
  kibor3m:                  number;
  pakistanCpi:              number;
  coreCpi:                  number;
  gdpGrowthPct:             number;
  fpiWeeklyMillion:         number;
  fpiDirection:             'inflow' | 'outflow' | 'neutral';
  kse100Level:              number;
  kse100ChangePct:          number;
  kse100Ytd:                number;
  brentCrude:               number;
  naturalGasMmBtu:          number;
  coalPerTonne:             number;
  ureaTonne:                number;
  imfStatus:                string;
  imfProgrammeActive:       boolean;
}

export interface TechnicalIndicators {
  sma10: number; sma20: number; sma50: number; sma100: number; sma200: number;
  ema9: number; ema12: number; ema21: number; ema26: number; ema50: number;
  vwap: number;
  rsi14: number; rsi9: number;
  rsiDivergence: 'bullish' | 'bearish' | 'none';
  macdLine: number; macdSignalLine: number; macdHistogram: number; macdSignal: MacdSignal;
  stochasticK: number; stochasticD: number;
  williamsR: number;
  cci20: number;
  mfi14: number;
  roc10: number;
  atr14: number; atrPct: number;
  bbUpper: number; bbMid: number; bbLower: number; bbWidth: number;
  bbSqueeze: boolean; bbPosition: BBPosition;
  historicalVolatility30d: number;
  obv: number; obvTrend: OBVTrend;
  volumeRatio: number; volumeSignal: VolumeSignal;
  accDistLine: number; chaikinMoneyFlow: number;
  adx14: number; diPlus: number; diMinus: number;
  trendShort: TrendDirection; trendMid: TrendDirection; trendLong: TrendDirection;
  ichimokuSignal: 'above_cloud' | 'below_cloud' | 'inside_cloud';
  support1: number; support2: number; support3: number;
  resistance1: number; resistance2: number; resistance3: number;
  pivot: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
  fibRetracement382: number; fibRetracement500: number; fibRetracement618: number;
  candlestickPattern: string; candlestickBullish: boolean;
  // New: PSX-context indicators
  priceVsVwapPct:         number;   // % above/below VWAP
  priceVs52wHighPct:      number;   // % below 52w high (drawdown)
  priceVs52wLowPct:       number;   // % above 52w low (recovery)
  goldenCrossActive:      boolean;  // SMA50 > SMA200 currently
  deathCrossActive:       boolean;  // SMA50 < SMA200 currently
  trendConsistency:       number;   // 0–100: how aligned short/mid/long trends are
  // On-Balance Volume divergence
  obvDivergence:          'bullish' | 'bearish' | 'none';
  // Parabolic SAR
  parabolicSarSignal:     'bullish' | 'bearish';
  parabolicSarValue:      number;
  // Keltner Channel
  keltnerUpper:           number;
  keltnerMid:             number;
  keltnerLower:           number;
  keltnerPosition:        'above' | 'inside' | 'below';
  // Relative strength vs KSE-100
  relativeStrengthVsIndex: number;  // stock return / index return (>1 = outperforming)
}

export interface TechnicalSignal {
  name:        string;
  type:        'BUY' | 'SELL';
  weight:      number;
  description: string;
}

export interface SignalResult {
  buySignals:       TechnicalSignal[];
  sellSignals:      TechnicalSignal[];
  convictionScore:  number;
  overallSignal:    Signal;
  technicalSummary: string;
}

export interface CompositeScore {
  technical:      number;
  sentiment:      number;
  fundamental:    number;
  macro:          number;
  composite:      number;
  grade:          'A' | 'B' | 'C' | 'D' | 'F';
  interpretation: string;
}

export interface PriceTargets {
  aggressiveBuyAt:      number;
  conservativeBuyAt:    number;
  target1:              number;
  target2:              number;
  target3:              number;
  stopLoss:             number;
  hardStopLoss:         number;
  riskRewardRatio:      number;
  potentialUpsidePct:   number;
  potentialDownsidePct: number;
  currentVsTargetLabel: string;
}

export interface PositionSizing {
  suggestedShares:        number;
  suggestedValuePkr:      number;
  portfolioRiskPct:       number;
  riskPerSharePkr:        number;
  maxSharesForRiskBudget: number;
}

export interface StockRecommendation {
  ticker:               string;
  name:                 string;
  sector:               string;
  shariah:              boolean;
  currentPrice:         number;
  dayChangePct:         number;
  signal:               Signal;
  signalLabel:          string;
  compositeScore:       CompositeScore;
  priceTargets:         PriceTargets;
  positionSizing:       PositionSizing;
  technicals:           TechnicalIndicators;
  signalResult:         SignalResult;
  fundamentals:         FundamentalData;
  sentiment:            SentimentResult;
  flags:                string[];
  position?:            PortfolioPosition;
  suggestedReplacement?: string;
}

export interface Alert {
  ticker:    string;
  name:      string;
  type:      string;
  severity:  AlertSeverity;
  detail:    string;
  action:    string;
  timestamp: Date;
}

export interface AiStockReview {
  ticker:               string;
  name:                 string;
  algorithmSignal:      Signal;
  algorithmScore:       number;
  aiValidation:         AiValidation;
  finalSignal:          Signal;
  confidence:           Confidence;
  reasoning:            string;
  keyRisks:             string[];
  keyCatalysts:         string[];
  buyPriceView:         number | null;
  sellPriceView:        number | null;
  stopLossView:         number | null;
  shariahNote:          string | null;
  suggestedReplacement?: string;
}

export interface AiReviewResult {
  runId:                string;
  timestamp:            string;
  marketStance:         MarketStance;
  marketSummary:        string;
  keyMarketDrivers:     string[];
  portfolioReview:      AiStockReview[];
  discoveryReview:      AiStockReview[];
  sectorOutlook:        Record<string, string>;
  concentrationRisks:   string[];
  macroRisks:           string[];
  macroOpportunities:   string[];
  algorithmScore:       number;
  algorithmFeedback:    string;
  globalRiskFlags:      string[];
  notificationHeadline: string;
  emailSubject:         string;
}

export interface RunOutput {
  runId:                 string;
  runAt:                 Date;
  config: {
    shariahMode:  ShariahMode;
    indexFilter:  IndexFilter;
    aiModel:      AiModel;
    weights:      Record<string, number>;
  };
  macro:                 MacroSnapshot;
  portfolioRecs:         StockRecommendation[];
  discoveryPicks:        StockRecommendation[];
  alerts:                Alert[];
  sectorConcentration:   Record<string, number>;
  aiReview:              AiReviewResult;
  circuitBreakerActive:  boolean;
  totalPortfolioValue:   number;
  totalCostBasis:        number;
  totalUnrealisedPl:     number;
  totalUnrealisedPlPct:  number;
}

export interface DeliveryLog {
  channel:   'email' | 'whatsapp';
  status:    'sent' | 'failed';
  timestamp: Date;
  messageId?: string;
  error?:    string;
  attempts:  number;
}

// ─── PSX Terminal extended fundamental data ───────────────────────────────────
// Used when PSX Terminal API provides richer fields
export interface PSXCompanyInfo {
  ticker:            string;
  name:              string;
  sector:            string;
  subSector:         string;
  listingDate:       string;
  listedCapital:     number;
  faceValue:         number;
  sharesOutstanding: number;
  isinCode:          string;
  lotSize:           number;
}

// ─── Market Breadth (for KSE-100 context) ─────────────────────────────────────
export interface MarketBreadth {
  advancers:         number;
  decliners:         number;
  unchanged:         number;
  totalVolume:       number;
  totalValue:        number;
  advanceDeclineRatio: number;   // > 1 = more advancers = bullish breadth
  newHighs:          number;
  newLows:           number;
}

// ─── Sector Performance ────────────────────────────────────────────────────────
export interface SectorPerformance {
  sector:            string;
  dayChangePct:      number;
  weekChangePct:     number;
  monthChangePct:    number;
  ytdChangePct:      number;
  relativeStrength:  number;
}
