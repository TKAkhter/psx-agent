// ─── Core Domain Types ────────────────────────────────────────────────────────

export type ShariahMode       = 'compliant' | 'non_compliant' | 'both';
export type IndexFilter       = 'KSE-100' | 'KSE-30' | 'ALL_SHARE' | 'CUSTOM';
export type AiModel           = 'claude' | 'gpt4o' | 'gemini';
export type RunMode           = 'full' | 'portfolio_only' | 'discovery_only' | 'alerts_only';
export type Signal            = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type Confidence        = 'High' | 'Medium' | 'Low';
export type AiValidation      = 'AGREE' | 'PARTIALLY_AGREE' | 'DISAGREE';
export type AlertSeverity     = 'CRITICAL' | 'WARNING' | 'INFO';
export type EmailProvider     = 'smtp' | 'sendgrid' | 'ses';
export type WhatsAppProvider  = 'twilio' | 'meta';
export type TrendDirection    = 'up' | 'down';
export type OBVTrend          = 'accumulation' | 'distribution' | 'neutral';
export type VolumeSignal      = 'spike_up' | 'spike_down' | 'normal';
export type MacdSignal        = 'bullish' | 'bearish' | 'none';
export type BBPosition        = 'above_upper' | 'inside' | 'below_lower';
export type MarketStance      = 'bullish' | 'bearish' | 'neutral' | 'cautious';
export type AiEndorsement     = 'ENDORSE' | 'NEUTRAL' | 'AVOID';

// ─── Config Snapshot ─────────────────────────────────────────────────────────

export interface ConfigSnapshot {
  shariahMode:  ShariahMode;
  indexFilter:  IndexFilter;
  runMode:      RunMode;
  aiModel:      AiModel;
  weights: {
    TECHNICAL:    number;
    SENTIMENT:    number;
    FUNDAMENTAL:  number;
    MACRO:        number;
  };
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export interface Holding {
  symbol:   string;
  ticker:   string;
  shares:   number;
  avgCost:  number;
  name:     string;
  sector:   string;
  type:     string;
}

export interface EnrichedHolding extends Holding {
  currentPrice:       number;
  unrealisedPlPkr:    number;
  unrealisedPlPct:    number;
  positionValue:      number;
  portfolioWeightPct: number;
  shariah:            boolean;
  shariahNote?:       string;
}

// ─── Market Data ──────────────────────────────────────────────────────────────

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
  candles:               OHLCVCandle[];
  currentPrice:          number;
  high52w:               number;
  low52w:                number;
  marketCap?:            number;
  freeFloatPct?:         number;
  upcomingDividendDate?: string;
  upcomingEarningsDate?: string;
}

// ─── News & Sentiment ─────────────────────────────────────────────────────────

export interface NewsArticle {
  headline:          string;
  body:              string;
  source:            string;
  publishedAt:       Date;
  url:               string;
  tickersMentioned:  string[];
  category:          'economy' | 'corporate' | 'political' | 'commodity' | 'general';
}

export interface SentimentResult {
  ticker:       string;
  score:        number;  // −1.0 to +1.0
  articleCount: number;
  confidence:   'high' | 'low';
  articles:     Array<Pick<NewsArticle, 'headline' | 'source' | 'publishedAt'>>;
}

// ─── Macro Data ───────────────────────────────────────────────────────────────

export interface MacroSnapshot {
  pkrUsdOfficial:    number;
  pkrUsdOpen:        number;
  sbpPolicyRate:     number;
  kibor1m:           number;
  pakistanCpi:       number;
  brentCrude:        number;
  fpiWeeklyMillion:  number;
  fpiDirection:      'inflow' | 'outflow' | 'neutral';
  kse100Level:       number;
  kse100ChangePct:   number;
  imfStatus:         string;
}

// ─── Fundamentals ─────────────────────────────────────────────────────────────

export interface FundamentalData {
  ticker:                 string;
  peRatio:                number;
  sectorAvgPe:            number;
  epsTtm:                 number;
  dividendYieldPct:       number;
  roe:                    number;
  roa:                    number;
  debtToEquity:           number;
  currentRatio:           number;
  revenueGrowthYoy:       number;
  netProfitMargin:        number;
  interestCoverageRatio:  number;
  upcomingDividendDate?:  string;
  upcomingEarningsDate?:  string;
}

// ─── Technical Analysis ───────────────────────────────────────────────────────

export interface TechnicalIndicators {
  sma20:              number;
  sma50:              number;
  sma200:             number;
  ema9:               number;
  ema12:              number;
  ema26:              number;
  rsi14:              number;
  macdLine:           number;
  macdSignalLine:     number;
  macdHistogram:      number;
  macdSignal:         MacdSignal;
  stochasticK:        number;
  stochasticD:        number;
  atr14:              number;
  bbUpper:            number;
  bbMid:              number;
  bbLower:            number;
  bbWidth:            number;
  bbPosition:         BBPosition;
  obv:                number;
  obvTrend:           OBVTrend;
  volumeRatio:        number;
  volumeSignal:       VolumeSignal;
  candlestickPattern: string;
  support1:           number;
  support2:           number;
  resistance1:        number;
  resistance2:        number;
  pivot:              number;
  trendShort:         TrendDirection;
  trendMid:           TrendDirection;
  trendLong:          TrendDirection;
}

export interface TechnicalSignal {
  name:   string;
  type:   'BUY' | 'SELL';
  weight: number;
}

export interface SignalResult {
  buySignals:      TechnicalSignal[];
  sellSignals:     TechnicalSignal[];
  convictionScore: number;
  overallSignal:   Signal;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface CompositeScore {
  technical:    number;
  sentiment:    number;
  fundamental:  number;
  macro:        number;
  composite:    number;
}

export interface PriceTargets {
  buyAt:             number;
  sellAt:            number;
  stopLoss:          number;
  target1:           number;
  target2:           number;
  target3:           number;
  riskRewardRatio:   number;
}

export interface PositionSizing {
  suggestedShares: number;
  suggestedValue:  number;
  riskPerShare:    number;
}

// ─── Stock Recommendation ─────────────────────────────────────────────────────

export interface StockRecommendation {
  ticker:             string;
  name:               string;
  sector:             string;
  shariah:            boolean;
  currentPrice:       number;
  signal:             Signal;
  compositeScore:     CompositeScore;
  priceTargets:       PriceTargets;
  positionSizing:     PositionSizing;
  technicals:         TechnicalIndicators;
  signalResult:       SignalResult;
  fundamentals:       FundamentalData;
  sentiment:          SentimentResult;
  flags:              string[];
  // Present only for portfolio holdings
  holding?:           EnrichedHolding;
  unrealisedPlPkr?:   number;
  unrealisedPlPct?:   number;
  portfolioWeightPct?: number;
}

// ─── AI Review ────────────────────────────────────────────────────────────────

export interface AiPortfolioReview {
  ticker:                  string;
  name:                    string;
  algorithmSignal:         Signal;
  algorithmCompositeScore: number;
  aiValidation:            AiValidation;
  aiSuggestedSignal:       Signal;
  confidence:              Confidence;
  reasoning:               string;
  shariahNote:             string | null;
  riskFlags:               string[];
  upcomingCatalysts:       string[];
  buyPriceView:            number | null;
  sellPriceView:           number | null;
  stopLossView:            number | null;
}

export interface AiDiscoveryReview {
  ticker:                string;
  name:                  string;
  aiEndorsement:         AiEndorsement;
  confidence:            Confidence;
  reasoning:             string;
  sectorFitForPortfolio: string;
}

export interface AiAlertCommentary {
  ticker:                  string;
  alertType:               string;
  aiActionRecommendation:  string;
}

export interface AiSectorOutlook {
  [sector: string]: string | undefined;
}

export interface AiReviewResult {
  runId:                  string;
  analysisTimestamp:      string;
  overallMarketView: {
    stance:      MarketStance;
    summary:     string;
    keyDrivers:  string[];
  };
  algorithmAccuracyRating: {
    score:        number;
    rationale:    string;
    strongAreas:  string[];
    weakAreas:    string[];
  };
  macroOverlay: {
    pkrUsdView:         string;
    sbpRateView:        string;
    commodityImpact:    string;
    imfRisk:            string;
    overallMacroScore:  number;
  };
  portfolioReview:        AiPortfolioReview[];
  discoveryPicksReview:   AiDiscoveryReview[];
  sectorAnalysis: {
    concentrationWarnings:  string[];
    rebalancingSuggestions: string[];
    sectorMacroOutlook:     AiSectorOutlook;
  };
  activeAlertsCommentary: AiAlertCommentary[];
  globalRiskFlags:        string[];
  notificationHeadline:   string;
  emailSubjectLine:       string;
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export interface Alert {
  ticker:     string;
  type:       string;
  severity:   AlertSeverity;
  detail:     string;
  timestamp:  Date;
}

// ─── Run Output ───────────────────────────────────────────────────────────────

export interface RunOutput {
  runId:                     string;
  runAt:                     Date;
  config:                    ConfigSnapshot;
  macroSnapshot:             MacroSnapshot;
  portfolioRecommendations:  StockRecommendation[];
  discoveryPicks:            StockRecommendation[];
  alerts:                    Alert[];
  sectorConcentration:       Record<string, number>;
  aiReview:                  AiReviewResult;
  circuitBreakerActive:      boolean;
  totalPortfolioValue:       number;
  totalUnrealisedPl:         number;
}

// ─── Notification ─────────────────────────────────────────────────────────────

export interface DeliveryLog {
  channel:    'email' | 'whatsapp';
  status:     'sent' | 'failed';
  timestamp:  Date;
  messageId?: string;
  error?:     string;
  attempts:   number;
}
