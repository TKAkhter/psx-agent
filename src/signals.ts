import { round2, calcPct } from "./indicators";
import { SIGNAL_THRESHOLDS, SCORE_WEIGHTS, RSI_LEVELS } from "./config";
import { StockData, StockDataMap, StockError } from "./fetch-data";

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────

export type ActionLabel =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG_SELL"
  | "SKIP";

export interface TradeSignal {
  // Identity
  symbol: string;
  action: ActionLabel;
  score: number;
  confidence: "Very High" | "High" | "Medium" | "Low";
  // Price levels
  limitPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  qty: number;
  rrRatio: number | null;
  potentialGain: number; // PKR
  maxRisk: number; // PKR
  // Instructions
  instruction: string;
  beginnerNote: string;
  proSummary: string;
  // Reasons (algo output)
  bullReasons: string[];
  bearReasons: string[];
  neutralNotes: string[];
  // Key display fields (mirrors from StockData)
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
  stoch: StockData["stoch"];
  macd: StockData["macd"];
  bb: StockData["bb"];
  adx: StockData["adx"];
  willR: number | null;
  cci: number | null;
  ichi: StockData["ichi"];
  superTrend: StockData["superTrend"];
  vwap: number | null;
  obv: StockData["obv"];
  pivots: StockData["pivots"];
  trend: StockData["trend"];
  vol: StockData["vol"];
  patterns: StockData["patterns"];
  divergence: StockData["divergence"];
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
export type TradeSignalMap = SignalMap; // alias — used by gemini.ts / templates

export interface PortfolioSummary {
  totalCost: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  sectorWeights: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────
//  SIGNAL BUILDER
// ─────────────────────────────────────────────────────────────

function buildSignal(symbol: string, d: StockData): TradeSignal {
  let score = 0;
  const bullReasons: string[] = [];
  const bearReasons: string[] = [];
  const neutralNotes: string[] = [];

  // ── RSI-14 ─────────────────────────────────────────────────
  if (d.rsi14 != null) {
    if (d.rsi14 < RSI_LEVELS.EXTREME_OVERSOLD) {
      score += SCORE_WEIGHTS.RSI_EXTREME;
      bullReasons.push(`RSI-14 ${d.rsi14} — extreme oversold`);
    } else if (d.rsi14 < RSI_LEVELS.DEEPLY_OVERSOLD) {
      score += SCORE_WEIGHTS.RSI_DEEP;
      bullReasons.push(`RSI-14 ${d.rsi14} — deeply oversold`);
    } else if (d.rsi14 < RSI_LEVELS.OVERSOLD) {
      score += SCORE_WEIGHTS.RSI_NORMAL;
      bullReasons.push(`RSI-14 ${d.rsi14} — oversold`);
    } else if (d.rsi14 < RSI_LEVELS.MILD_OVERSOLD) {
      score += SCORE_WEIGHTS.RSI_MILD;
      bullReasons.push(`RSI-14 ${d.rsi14} — mildly oversold`);
    } else if (d.rsi14 > RSI_LEVELS.EXTREME_OVERBOUGHT) {
      score -= SCORE_WEIGHTS.RSI_EXTREME;
      bearReasons.push(`RSI-14 ${d.rsi14} — extreme overbought`);
    } else if (d.rsi14 > RSI_LEVELS.DEEPLY_OVERBOUGHT) {
      score -= SCORE_WEIGHTS.RSI_DEEP;
      bearReasons.push(`RSI-14 ${d.rsi14} — deeply overbought`);
    } else if (d.rsi14 > RSI_LEVELS.OVERBOUGHT) {
      score -= SCORE_WEIGHTS.RSI_NORMAL;
      bearReasons.push(`RSI-14 ${d.rsi14} — overbought`);
    } else if (d.rsi14 > RSI_LEVELS.MILD_OVERBOUGHT) {
      score -= SCORE_WEIGHTS.RSI_MILD;
      bearReasons.push(`RSI-14 ${d.rsi14} — mildly overbought`);
    } else neutralNotes.push(`RSI-14 ${d.rsi14} — neutral`);
  }
  // RSI-9 confirmation
  if (d.rsi9 != null && d.rsi14 != null) {
    if (d.rsi9 < 30 && d.rsi14 < 40) {
      score += 1;
      bullReasons.push(`RSI-9 ${d.rsi9} confirms oversold`);
    } else if (d.rsi9 > 70 && d.rsi14 > 60) {
      score -= 1;
      bearReasons.push(`RSI-9 ${d.rsi9} confirms overbought`);
    }
  }

  // ── MFI  (Money Flow Index — volume-weighted RSI) ──────────
  if (d.mfi != null) {
    if (d.mfi < 20) {
      score += SCORE_WEIGHTS.MFI_EXTREME;
      bullReasons.push(
        `MFI ${d.mfi} — oversold with weak money flow (smart money buying opportunity)`
      );
    } else if (d.mfi < 30) {
      score += SCORE_WEIGHTS.MFI_NORMAL;
      bullReasons.push(`MFI ${d.mfi} — approaching oversold`);
    } else if (d.mfi > 80) {
      score -= SCORE_WEIGHTS.MFI_EXTREME;
      bearReasons.push(`MFI ${d.mfi} — overbought, money flowing out`);
    } else if (d.mfi > 70) {
      score -= SCORE_WEIGHTS.MFI_NORMAL;
      bearReasons.push(`MFI ${d.mfi} — approaching overbought`);
    } else neutralNotes.push(`MFI ${d.mfi} — neutral money flow`);
  }

  // ── ROC  (Rate of Change — momentum) ──────────────────────
  if (d.roc != null) {
    if (d.roc < -15) {
      score += SCORE_WEIGHTS.ROC_STRONG;
      bullReasons.push(
        `ROC ${d.roc}% — deeply negative momentum (mean-reversion zone)`
      );
    } else if (d.roc < -8) {
      score += SCORE_WEIGHTS.ROC_MILD;
      bullReasons.push(`ROC ${d.roc}% — negative momentum, bounce possible`);
    } else if (d.roc > 15) {
      score -= SCORE_WEIGHTS.ROC_STRONG;
      bearReasons.push(
        `ROC ${d.roc}% — deeply positive momentum (exhaustion risk)`
      );
    } else if (d.roc > 8) {
      score -= SCORE_WEIGHTS.ROC_MILD;
      bearReasons.push(`ROC ${d.roc}% — strong momentum, watch for reversal`);
    } else neutralNotes.push(`ROC ${d.roc}% — moderate momentum`);
  }

  // ── SUPERTREND ─────────────────────────────────────────────
  if (d.superTrend) {
    if (d.superTrend.signal === "BUY") {
      score += SCORE_WEIGHTS.SUPERTREND;
      bullReasons.push(
        `SuperTrend BUY at PKR ${d.superTrend.value} (${d.superTrend.distance}% above line)`
      );
    } else {
      score -= SCORE_WEIGHTS.SUPERTREND;
      bearReasons.push(
        `SuperTrend SELL at PKR ${d.superTrend.value} (${Math.abs(
          d.superTrend.distance
        )}% below line)`
      );
    }
  }

  // ── STOCHASTIC ─────────────────────────────────────────────
  if (d.stoch.k != null) {
    const { k, d: dLine, zone, kCrossD } = d.stoch;
    if (k < 15 && (dLine ?? 100) < 15) {
      score += SCORE_WEIGHTS.STOCH_EXTREME;
      bullReasons.push(`Stoch %K ${k}/%D ${dLine} — extreme oversold`);
    } else if (k < 20 && (dLine ?? 100) < 20) {
      score += SCORE_WEIGHTS.STOCH_NORMAL;
      bullReasons.push(`Stoch %K ${k}/%D ${dLine} — oversold`);
    } else if (k > 85 && (dLine ?? 0) > 85) {
      score -= SCORE_WEIGHTS.STOCH_EXTREME;
      bearReasons.push(`Stoch %K ${k}/%D ${dLine} — extreme overbought`);
    } else if (k > 80 && (dLine ?? 0) > 80) {
      score -= SCORE_WEIGHTS.STOCH_NORMAL;
      bearReasons.push(`Stoch %K ${k}/%D ${dLine} — overbought`);
    }
    if (kCrossD === "BULLISH" && k < 50) {
      score += SCORE_WEIGHTS.STOCH_CROSS;
      bullReasons.push(`Stoch K crossed above D from low`);
    } else if (kCrossD === "BEARISH" && k > 50) {
      score -= SCORE_WEIGHTS.STOCH_CROSS;
      bearReasons.push(`Stoch K crossed below D from high`);
    }
  }

  // ── MACD ───────────────────────────────────────────────────
  if (d.macd.macd != null) {
    if (d.macd.crossover === "BULLISH_CROSS") {
      score += SCORE_WEIGHTS.MACD_CROSSOVER;
      bullReasons.push(`MACD bullish crossover ⚡`);
    } else if (d.macd.crossover === "BEARISH_CROSS") {
      score -= SCORE_WEIGHTS.MACD_CROSSOVER;
      bearReasons.push(`MACD bearish crossover ⚡`);
    } else if (d.macd.histogram! > 0 && d.macd.histTrend === "EXPANDING") {
      score += SCORE_WEIGHTS.MACD_HISTOGRAM;
      bullReasons.push(`MACD histogram expanding +${d.macd.histogram}`);
    } else if (d.macd.histogram! < 0 && d.macd.histTrend === "EXPANDING") {
      score -= SCORE_WEIGHTS.MACD_HISTOGRAM;
      bearReasons.push(`MACD histogram expanding ${d.macd.histogram}`);
    } else if (d.macd.histogram! > 0) {
      score += SCORE_WEIGHTS.MACD_WEAK;
      bullReasons.push(`MACD histogram positive`);
    } else if (d.macd.histogram! < 0) {
      score -= SCORE_WEIGHTS.MACD_WEAK;
      bearReasons.push(`MACD histogram negative`);
    }
  }

  // ── BOLLINGER BANDS ────────────────────────────────────────
  if (d.bb?.pctB != null) {
    const { pctB, squeeze } = d.bb;
    if (pctB < 0) {
      score += SCORE_WEIGHTS.BB_EXTREME;
      bullReasons.push(`BB %B ${round2(pctB)} — below lower band (extreme)`);
    } else if (pctB < 10) {
      score += SCORE_WEIGHTS.BB_NEAR + 1;
      bullReasons.push(`BB %B ${round2(pctB)} — hugging lower band`);
    } else if (pctB < 25) {
      score += SCORE_WEIGHTS.BB_NEAR;
      bullReasons.push(`BB %B ${round2(pctB)} — near lower band`);
    } else if (pctB > 100) {
      score -= SCORE_WEIGHTS.BB_EXTREME;
      bearReasons.push(`BB %B ${round2(pctB)} — above upper band (extreme)`);
    } else if (pctB > 90) {
      score -= SCORE_WEIGHTS.BB_NEAR + 1;
      bearReasons.push(`BB %B ${round2(pctB)} — hugging upper band`);
    } else if (pctB > 75) {
      score -= SCORE_WEIGHTS.BB_NEAR;
      bearReasons.push(`BB %B ${round2(pctB)} — near upper band`);
    }
    if (squeeze)
      neutralNotes.push(
        `BB squeeze (${d.bb.bandwidth}%) — volatility compression, breakout ahead`
      );
  }

  // ── ADX ────────────────────────────────────────────────────
  if (d.adx.adx != null) {
    const { adx: adxVal, diPlus, diMinus, strength } = d.adx;
    if (strength === "STRONG_BULL") {
      score += SCORE_WEIGHTS.ADX_STRONG;
      bullReasons.push(
        `ADX ${adxVal} strong bull (DI+ ${diPlus} > DI- ${diMinus})`
      );
    } else if (strength === "WEAK_BULL") {
      score += SCORE_WEIGHTS.ADX_WEAK;
      bullReasons.push(`ADX ${adxVal} weak bull`);
    } else if (strength === "STRONG_BEAR") {
      score -= SCORE_WEIGHTS.ADX_STRONG;
      bearReasons.push(
        `ADX ${adxVal} strong bear (DI- ${diMinus} > DI+ ${diPlus})`
      );
    } else if (strength === "WEAK_BEAR") {
      score -= SCORE_WEIGHTS.ADX_WEAK;
      bearReasons.push(`ADX ${adxVal} weak bear`);
    } else if (strength === "RANGING")
      neutralNotes.push(
        `ADX ${adxVal} — ranging market, signals less reliable`
      );
  }

  // ── WILLIAMS %R ────────────────────────────────────────────
  if (d.willR != null) {
    if (d.willR < -90) {
      score += SCORE_WEIGHTS.WILLIAMS_EXTREME;
      bullReasons.push(`Williams %R ${d.willR} — extremely oversold`);
    } else if (d.willR < -80) {
      score += SCORE_WEIGHTS.WILLIAMS_NORMAL;
      bullReasons.push(`Williams %R ${d.willR} — oversold`);
    } else if (d.willR > -10) {
      score -= SCORE_WEIGHTS.WILLIAMS_EXTREME;
      bearReasons.push(`Williams %R ${d.willR} — extremely overbought`);
    } else if (d.willR > -20) {
      score -= SCORE_WEIGHTS.WILLIAMS_NORMAL;
      bearReasons.push(`Williams %R ${d.willR} — overbought`);
    }
  }

  // ── CCI ────────────────────────────────────────────────────
  if (d.cci != null) {
    if (d.cci < -200) {
      score += SCORE_WEIGHTS.CCI_EXTREME;
      bullReasons.push(`CCI ${d.cci} — extreme oversold`);
    } else if (d.cci < -100) {
      score += SCORE_WEIGHTS.CCI_NORMAL;
      bullReasons.push(`CCI ${d.cci} — oversold`);
    } else if (d.cci > 200) {
      score -= SCORE_WEIGHTS.CCI_EXTREME;
      bearReasons.push(`CCI ${d.cci} — extreme overbought`);
    } else if (d.cci > 100) {
      score -= SCORE_WEIGHTS.CCI_NORMAL;
      bearReasons.push(`CCI ${d.cci} — overbought`);
    }
  }

  // ── MOVING AVERAGES ────────────────────────────────────────
  if (d.ma20 != null) {
    if (d.price > d.ma20) {
      score += SCORE_WEIGHTS.MA_CROSS;
      bullReasons.push(`Price ${d.price} above MA20 ${d.ma20}`);
    } else {
      score -= SCORE_WEIGHTS.MA_CROSS;
      bearReasons.push(`Price ${d.price} below MA20 ${d.ma20}`);
    }
  }
  if (d.ma5 != null && d.ma20 != null) {
    if (d.ma5 > d.ma20) {
      score += SCORE_WEIGHTS.MA_CROSS;
      bullReasons.push(`MA5 ${d.ma5} > MA20 ${d.ma20} — golden cross`);
    } else {
      score -= SCORE_WEIGHTS.MA_CROSS;
      bearReasons.push(`MA5 ${d.ma5} < MA20 ${d.ma20} — death cross`);
    }
  }
  if (d.ma20 != null && d.ma50 != null) {
    if (d.ma20 > d.ma50) {
      score += SCORE_WEIGHTS.MA_CROSS;
      bullReasons.push(`MA20 > MA50 — medium uptrend`);
    } else {
      score -= SCORE_WEIGHTS.MA_CROSS;
      bearReasons.push(`MA20 < MA50 — medium downtrend`);
    }
  }
  if (d.ma200 != null) {
    if (d.price > d.ma200) {
      score += SCORE_WEIGHTS.MA_CROSS;
      bullReasons.push(`Price above MA200 ${d.ma200} — long-term bull`);
    } else {
      score -= SCORE_WEIGHTS.MA_CROSS;
      bearReasons.push(`Price below MA200 ${d.ma200} — long-term bear`);
    }
  }
  if (d.ema9 != null && d.ema21 != null) {
    if (d.ema9 > d.ema21) {
      score += SCORE_WEIGHTS.MA_CROSS;
      bullReasons.push(`EMA9 > EMA21 — short momentum up`);
    } else {
      score -= SCORE_WEIGHTS.MA_CROSS;
      bearReasons.push(`EMA9 < EMA21 — short momentum down`);
    }
  }

  // ── VWAP ───────────────────────────────────────────────────
  if (d.vwap != null) {
    const diff = calcPct(d.price, d.vwap)!;
    if (diff < -3) {
      score += SCORE_WEIGHTS.VWAP;
      bullReasons.push(
        `Price ${round2(diff)}% below VWAP ${d.vwap} — undervalued`
      );
    } else if (diff < 0) {
      score += 1;
      bullReasons.push(`Price slightly below VWAP ${d.vwap}`);
    } else if (diff > 3) {
      score -= SCORE_WEIGHTS.VWAP;
      bearReasons.push(
        `Price ${round2(diff)}% above VWAP ${d.vwap} — stretched`
      );
    } else if (diff > 0) {
      score -= 1;
      bearReasons.push(`Price slightly above VWAP ${d.vwap}`);
    }
  }

  // ── OBV ────────────────────────────────────────────────────
  if (d.obv.trend === "ACCUMULATION") {
    score += SCORE_WEIGHTS.OBV;
    bullReasons.push(`OBV accumulation — institutional buying`);
  } else if (d.obv.trend === "DISTRIBUTION") {
    score -= SCORE_WEIGHTS.OBV;
    bearReasons.push(`OBV distribution — institutional selling`);
  }

  // ── ICHIMOKU ───────────────────────────────────────────────
  if (d.ichi) {
    if (d.ichi.position === "ABOVE_CLOUD") {
      score += SCORE_WEIGHTS.ICHI_CLOUD;
      bullReasons.push(`Ichimoku: above ${d.ichi.cloudColor} cloud`);
    } else if (d.ichi.position === "BELOW_CLOUD") {
      score -= SCORE_WEIGHTS.ICHI_CLOUD;
      bearReasons.push(`Ichimoku: below ${d.ichi.cloudColor} cloud`);
    } else neutralNotes.push("Ichimoku: inside cloud — consolidation");
    if (d.ichi.tkBullish) {
      score += SCORE_WEIGHTS.ICHI_TK;
      bullReasons.push(
        `TK cross: Tenkan ${d.ichi.tenkan} > Kijun ${d.ichi.kijun}`
      );
    } else {
      score -= SCORE_WEIGHTS.ICHI_TK;
      bearReasons.push(`TK: Tenkan ${d.ichi.tenkan} < Kijun ${d.ichi.kijun}`);
    }
    if (d.ichi.chikouBullish)
      bullReasons.push("Chikou span bullish confirmation");
    else if (d.ichi.chikouBullish === false)
      bearReasons.push("Chikou span bearish");
  }

  // ── VOLUME SPIKE ───────────────────────────────────────────
  if (d.vol.volSpike) {
    if (score > 0) {
      score += SCORE_WEIGHTS.VOLUME_CONFIRM;
      bullReasons.push(`Volume ${d.vol.volRatio}x avg — confirms bull`);
    } else {
      score -= SCORE_WEIGHTS.VOLUME_CONFIRM;
      bearReasons.push(`Volume ${d.vol.volRatio}x avg — confirms bear`);
    }
  }

  // ── PIVOTS ─────────────────────────────────────────────────
  if (d.pivots) {
    const { s1, s2, r1, r2 } = d.pivots;
    if (d.price <= s1 * 1.005 && d.price > s2) {
      score += SCORE_WEIGHTS.PIVOT_LEVEL;
      bullReasons.push(`Near S1 pivot support ${s1}`);
    }
    if (d.price <= s2 * 1.005) {
      score += SCORE_WEIGHTS.PIVOT_LEVEL;
      bullReasons.push(`Near S2 support ${s2} — strong floor`);
    }
    if (d.price >= r1 * 0.995 && d.price < r2) {
      score -= SCORE_WEIGHTS.PIVOT_LEVEL;
      bearReasons.push(`Near R1 pivot resistance ${r1}`);
    }
    if (d.price >= r2 * 0.995) {
      score -= SCORE_WEIGHTS.PIVOT_LEVEL;
      bearReasons.push(`Near R2 resistance ${r2} — strong ceiling`);
    }
  }

  // ── 6M POSITION ────────────────────────────────────────────
  if (d.pctFrom6mLow != null && d.pctFrom6mLow < 3) {
    score += SCORE_WEIGHTS.POSITION_6M;
    bullReasons.push(`Near 6m low — base forming`);
  }
  if (d.pctFrom6mHigh != null && d.pctFrom6mHigh > -3) {
    score -= SCORE_WEIGHTS.POSITION_6M;
    bearReasons.push(`Near 6m high — limited upside`);
  }

  // ── CANDLESTICK PATTERNS ───────────────────────────────────
  const MAJOR_PATTERNS = new Set([
    "Bullish Engulfing",
    "Bearish Engulfing",
    "Three White Soldiers",
    "Three Black Crows",
    "Morning Star",
    "Evening Star",
  ]);
  for (const p of d.patterns) {
    const w = MAJOR_PATTERNS.has(p.name)
      ? SCORE_WEIGHTS.PATTERN_MAJOR
      : SCORE_WEIGHTS.PATTERN_MINOR;
    if (p.bias === "BULLISH") {
      score += w;
      bullReasons.push(`${p.name} — ${p.desc}`);
    } else if (p.bias === "BEARISH") {
      score -= w;
      bearReasons.push(`${p.name} — ${p.desc}`);
    } else neutralNotes.push(`${p.name} — ${p.desc}`);
  }

  // ── RSI DIVERGENCE ─────────────────────────────────────────
  if (d.divergence === "BULLISH_DIVERGENCE") {
    score += SCORE_WEIGHTS.DIVERGENCE;
    bullReasons.push("Bullish RSI divergence — price new low, RSI higher low");
  } else if (d.divergence === "BEARISH_DIVERGENCE") {
    score -= SCORE_WEIGHTS.DIVERGENCE;
    bearReasons.push("Bearish RSI divergence — price new high, RSI lower high");
  }

  // ── FUNDAMENTALS (mild context) ────────────────────────────
  if (d.fundamentals?.peRatio != null) {
    if (d.fundamentals.peRatio < 6) {
      score += SCORE_WEIGHTS.FUNDAMENTAL_PE;
      bullReasons.push(`P/E ${d.fundamentals.peRatio}x — cheap vs sector`);
    } else if (d.fundamentals.peRatio > 25) {
      score -= SCORE_WEIGHTS.FUNDAMENTAL_PE;
      bearReasons.push(`P/E ${d.fundamentals.peRatio}x — expensive`);
    }
  }
  if (
    d.fundamentals?.dividendYield != null &&
    d.fundamentals.dividendYield > 8
  ) {
    score += SCORE_WEIGHTS.FUNDAMENTAL_DIV;
    bullReasons.push(
      `Div yield ${d.fundamentals.dividendYield}% — attractive income`
    );
  }

  // ── P&L CONTEXT ────────────────────────────────────────────
  if ((d.unrealizedPct ?? 0) < -20)
    neutralNotes.push(
      `⚠️ Down ${Math.abs(d.unrealizedPct ?? 0)}% from cost — review thesis`
    );
  if ((d.unrealizedPct ?? 0) > 50)
    neutralNotes.push(
      `✅ Up ${d.unrealizedPct}% — consider partial profit booking`
    );

  // ──────────────────────────────────────────────────────────
  //  ACTION
  // ──────────────────────────────────────────────────────────
  let action: ActionLabel;
  if (score >= SIGNAL_THRESHOLDS.STRONG_BUY) action = "STRONG_BUY";
  else if (score >= SIGNAL_THRESHOLDS.BUY) action = "BUY";
  else if (score <= SIGNAL_THRESHOLDS.STRONG_SELL) action = "STRONG_SELL";
  else if (score <= SIGNAL_THRESHOLDS.SELL) action = "SELL";
  else action = "HOLD";

  const isBuy = action === "BUY" || action === "STRONG_BUY";
  const isSell = action === "SELL" || action === "STRONG_SELL";

  // ──────────────────────────────────────────────────────────
  //  PRICE LEVELS
  // ──────────────────────────────────────────────────────────
  const atr = d.atr ?? d.price * 0.02;
  const { s1, s2, r1, r2 } = d.pivots ?? {};

  let limitPrice: number | null;
  let targetPrice: number | null;
  let stopLoss: number | null;
  let qty: number;

  if (isBuy) {
    limitPrice = round2(s1 ? Math.min(d.price, s1) : d.price - atr * 0.25);
    targetPrice = round2(r1 ? r1 : d.price + atr * 2.5);
    stopLoss = round2(s2 ? s2 - atr * 0.1 : d.price - atr * 1.5);
    qty = Math.max(
      50,
      Math.round((d.shares * (action === "STRONG_BUY" ? 0.15 : 0.1)) / 10) * 10
    );
  } else if (isSell) {
    limitPrice = round2(r1 ? Math.max(d.price, r1) : d.price + atr * 0.25);
    targetPrice = round2(s1 ? s1 : d.price - atr * 2.5);
    stopLoss = round2(r2 ? r2 + atr * 0.1 : d.price + atr * 1.5);
    qty = Math.min(
      d.shares,
      Math.max(
        50,
        Math.round((d.shares * (action === "STRONG_SELL" ? 0.25 : 0.15)) / 10) *
          10
      )
    );
  } else {
    limitPrice = d.price;
    targetPrice = round2(r1 ?? d.price + atr);
    stopLoss = round2(s1 ?? d.price - atr);
    qty = 0;
  }

  const rewardAmt = Math.abs((targetPrice ?? 0) - (limitPrice ?? 0));
  const riskAmt = Math.abs((limitPrice ?? 0) - (stopLoss ?? 0));
  const rrRatio = riskAmt > 0 ? round2(rewardAmt / riskAmt) : null;
  const potentialGain = Math.round(rewardAmt * qty);
  const maxRisk = Math.round(riskAmt * qty);

  // ──────────────────────────────────────────────────────────
  //  CONFIDENCE
  // ──────────────────────────────────────────────────────────
  const absScore = Math.abs(score);
  const confidence: TradeSignal["confidence"] =
    absScore >= 16
      ? "Very High"
      : absScore >= 11
      ? "High"
      : absScore >= 7
      ? "Medium"
      : "Low";

  // ──────────────────────────────────────────────────────────
  //  HUMAN-READABLE
  // ──────────────────────────────────────────────────────────
  const instruction = isBuy
    ? `Buy ${qty} shares of ${symbol} at PKR ${limitPrice} or below (limit order)`
    : isSell
    ? `Sell ${qty} shares of ${symbol} at PKR ${limitPrice} or above (limit order)`
    : `Hold — support PKR ${stopLoss}, resistance PKR ${targetPrice}`;

  const stNote = d.superTrend ? ` SuperTrend is ${d.superTrend.signal}.` : "";
  const beginnerNote = isBuy
    ? `📗 ${symbol} looks like a buy.${stNote} Place a limit order at PKR ${limitPrice}. Target: PKR ${targetPrice}. If price falls to PKR ${stopLoss}, sell immediately to protect capital.`
    : isSell
    ? `📕 ${symbol} looks overextended.${stNote} Consider selling ${qty} shares at PKR ${limitPrice}. Stop loss at PKR ${stopLoss}.`
    : `📘 ${symbol} — no clear trade.${stNote} Watch PKR ${stopLoss} (buy zone) and PKR ${targetPrice} (sell zone). Check back next session.`;

  const proSummary = [
    `Score ${score >= 0 ? "+" : ""}${score}`,
    d.trend,
    `RSI ${d.rsi14}`,
    `MFI ${d.mfi}`,
    `ROC ${d.roc}%`,
    `ST ${d.superTrend?.signal ?? "—"}@${d.superTrend?.value ?? "—"}`,
    `MACD ${d.macd.crossover ?? d.macd.histTrend}`,
    `BB%B ${d.bb?.pctB}`,
    `ADX ${d.adx.adx}(${d.adx.strength})`,
    `Ichi ${d.ichi?.position ?? "N/A"}`,
  ].join(" | ");

  return {
    symbol,
    action,
    score,
    confidence,
    qty,
    limitPrice,
    targetPrice,
    stopLoss,
    rrRatio,
    potentialGain,
    maxRisk,
    instruction,
    beginnerNote,
    proSummary,
    bullReasons,
    bearReasons,
    neutralNotes,
    price: d.price,
    open: d.open,
    high: d.high,
    low: d.low,
    changePct: d.changePct,
    bid: d.bid,
    ask: d.ask,
    rsi14: d.rsi14,
    rsi9: d.rsi9,
    mfi: d.mfi,
    roc: d.roc,
    stoch: d.stoch,
    macd: d.macd,
    bb: d.bb,
    adx: d.adx,
    willR: d.willR,
    cci: d.cci,
    ichi: d.ichi,
    superTrend: d.superTrend,
    vwap: d.vwap,
    obv: d.obv,
    pivots: d.pivots,
    trend: d.trend,
    vol: d.vol,
    patterns: d.patterns,
    divergence: d.divergence,
    sparkline: d.sparkline,
    ma5: d.ma5,
    ma10: d.ma10,
    ma20: d.ma20,
    ma50: d.ma50,
    ma200: d.ma200,
    ema9: d.ema9,
    ema21: d.ema21,
    unrealizedPnl: d.unrealizedPnl,
    unrealizedPct: d.unrealizedPct,
    marketValue: d.marketValue,
    costBasis: d.costBasis,
    shares: d.shares,
    avgCost: d.avgCost,
    perf1d: d.perf1d,
    perf1w: d.perf1w,
    perf1m: d.perf1m,
    perf6m: d.perf6m,
    high6m: d.high6m,
    low6m: d.low6m,
    maxDrawdown: d.maxDrawdown,
    pctFrom6mHigh: d.pctFrom6mHigh,
    pctFrom6mLow: d.pctFrom6mLow,
  };
}

// ─────────────────────────────────────────────────────────────
//  GENERATE ALL SIGNALS
// ─────────────────────────────────────────────────────────────

export function getSignals(stockData: StockDataMap): SignalMap {
  const signals: SignalMap = {};
  for (const [symbol, d] of Object.entries(stockData)) {
    if (symbol === "__market__") continue;
    if (!d.price || (d as any).error) {
      signals[symbol] = {
        symbol,
        action: "SKIP",
        error: (d as StockError).error ?? "No price",
        score: 0,
        price: null,
      };
    } else {
      signals[symbol] = buildSignal(symbol, d as StockData);
    }
  }
  return signals;
}

// ─────────────────────────────────────────────────────────────
//  PORTFOLIO SUMMARY
// ─────────────────────────────────────────────────────────────

export function calcPortfolioSummary(
  stockData: StockDataMap
): PortfolioSummary {
  let totalCost = 0,
    totalValue = 0;
  const sectorMap: Record<string, number> = {};

  for (const [key, d] of Object.entries(stockData)) {
    if (key === "__market__") continue;
    if (!d.price || (d as any).error) continue;
    const sd = d as StockData;
    totalCost += sd.costBasis ?? 0;
    totalValue += sd.marketValue ?? 0;
    if (sd.sector)
      sectorMap[sd.sector] =
        (sectorMap[sd.sector] ?? 0) + (sd.marketValue ?? 0);
  }

  const totalPnl = round2(totalValue - totalCost)!;
  const totalPnlPct =
    totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100)! : 0;
  const sectorWeights: Record<string, number> = {};
  for (const [sec, val] of Object.entries(sectorMap)) {
    sectorWeights[sec] = totalValue > 0 ? round2((val / totalValue) * 100)! : 0;
  }
  return {
    totalCost: round2(totalCost)!,
    totalValue: round2(totalValue)!,
    totalPnl,
    totalPnlPct,
    sectorWeights,
  };
}
