import { round2, calcPct } from "./indicators";
import { SIGNAL_THRESHOLDS, SCORE_WEIGHTS, RSI_LEVELS } from "./config";
import type {
  StockData, StockError, StockResult, StockDataMap, TradeSignal, SkipSignal,
  Signal, SignalMap, TradeSignalMap, PortfolioSummary,
} from "./types";

export type { TradeSignal, SkipSignal, Signal, SignalMap, TradeSignalMap, PortfolioSummary };

// ─────────────────────────────────────────────────────────────
//  TYPE GUARD
// ─────────────────────────────────────────────────────────────

function isStockError(d: StockResult): d is StockError {
  return (d as StockError).error !== undefined;
}

// ─────────────────────────────────────────────────────────────
//  SIGNAL BUILDER
// ─────────────────────────────────────────────────────────────

function buildSignal(symbol: string, d: StockData): TradeSignal {
  let score = 0;
  const bullReasons:  string[] = [];
  const bearReasons:  string[] = [];
  const neutralNotes: string[] = [];

  // ── RSI-14 ────────────────────────────────────────────────
  if (d.rsi14 != null) {
    if      (d.rsi14 < RSI_LEVELS.EXTREME_OVERSOLD)   { score += SCORE_WEIGHTS.RSI_EXTREME; bullReasons.push(`RSI-14 ${d.rsi14} — extreme oversold`); }
    else if (d.rsi14 < RSI_LEVELS.DEEPLY_OVERSOLD)    { score += SCORE_WEIGHTS.RSI_DEEP;    bullReasons.push(`RSI-14 ${d.rsi14} — deeply oversold`); }
    else if (d.rsi14 < RSI_LEVELS.OVERSOLD)           { score += SCORE_WEIGHTS.RSI_NORMAL;  bullReasons.push(`RSI-14 ${d.rsi14} — oversold`); }
    else if (d.rsi14 < RSI_LEVELS.MILD_OVERSOLD)      { score += SCORE_WEIGHTS.RSI_MILD;    bullReasons.push(`RSI-14 ${d.rsi14} — mildly oversold`); }
    else if (d.rsi14 > RSI_LEVELS.EXTREME_OVERBOUGHT) { score -= SCORE_WEIGHTS.RSI_EXTREME; bearReasons.push(`RSI-14 ${d.rsi14} — extreme overbought`); }
    else if (d.rsi14 > RSI_LEVELS.DEEPLY_OVERBOUGHT)  { score -= SCORE_WEIGHTS.RSI_DEEP;    bearReasons.push(`RSI-14 ${d.rsi14} — deeply overbought`); }
    else if (d.rsi14 > RSI_LEVELS.OVERBOUGHT)         { score -= SCORE_WEIGHTS.RSI_NORMAL;  bearReasons.push(`RSI-14 ${d.rsi14} — overbought`); }
    else if (d.rsi14 > RSI_LEVELS.MILD_OVERBOUGHT)    { score -= SCORE_WEIGHTS.RSI_MILD;    bearReasons.push(`RSI-14 ${d.rsi14} — mildly overbought`); }
    else neutralNotes.push(`RSI-14 ${d.rsi14} — neutral`);
  }
  // RSI-9 confirmation
  if (d.rsi9 != null && d.rsi14 != null) {
    if      (d.rsi9 < 30 && d.rsi14 < 40) { score += 1; bullReasons.push(`RSI-9 ${d.rsi9} confirms oversold`); }
    else if (d.rsi9 > 70 && d.rsi14 > 60) { score -= 1; bearReasons.push(`RSI-9 ${d.rsi9} confirms overbought`); }
  }

  // ── MFI ──────────────────────────────────────────────────
  if (d.mfi != null) {
    if      (d.mfi < 20) { score += SCORE_WEIGHTS.MFI_EXTREME; bullReasons.push(`MFI ${d.mfi} — oversold (volume-confirmed)`); }
    else if (d.mfi < 30) { score += SCORE_WEIGHTS.MFI_NORMAL;  bullReasons.push(`MFI ${d.mfi} — approaching oversold`); }
    else if (d.mfi > 80) { score -= SCORE_WEIGHTS.MFI_EXTREME; bearReasons.push(`MFI ${d.mfi} — overbought (volume-confirmed)`); }
    else if (d.mfi > 70) { score -= SCORE_WEIGHTS.MFI_NORMAL;  bearReasons.push(`MFI ${d.mfi} — approaching overbought`); }
    else neutralNotes.push(`MFI ${d.mfi} — neutral money flow`);
  }

  // ── ROC ───────────────────────────────────────────────────
  if (d.roc != null) {
    if      (d.roc < -15) { score += SCORE_WEIGHTS.ROC_STRONG; bullReasons.push(`ROC ${d.roc}% — deep negative momentum, mean-reversion setup`); }
    else if (d.roc < -8)  { score += SCORE_WEIGHTS.ROC_MILD;   bullReasons.push(`ROC ${d.roc}% — negative momentum, potential bounce`); }
    else if (d.roc > 15)  { score -= SCORE_WEIGHTS.ROC_STRONG; bearReasons.push(`ROC ${d.roc}% — overextended momentum`); }
    else if (d.roc > 8)   { score -= SCORE_WEIGHTS.ROC_MILD;   bearReasons.push(`ROC ${d.roc}% — watch for momentum exhaustion`); }
  }

  // ── SuperTrend ────────────────────────────────────────────
  if (d.superTrend) {
    if (d.superTrend.signal === "BUY") { score += SCORE_WEIGHTS.SUPERTREND; bullReasons.push(`SuperTrend BUY @ PKR ${d.superTrend.value} (${d.superTrend.distance}% above ST line)`); }
    else                                { score -= SCORE_WEIGHTS.SUPERTREND; bearReasons.push(`SuperTrend SELL @ PKR ${d.superTrend.value} (${Math.abs(d.superTrend.distance)}% below ST line)`); }
  }

  // ── Stochastic ────────────────────────────────────────────
  if (d.stoch?.k != null) {
    const { k, d: dL, zone, kCrossD } = d.stoch;
    if      (k < 15 && (dL ?? 100) < 15)  { score += SCORE_WEIGHTS.STOCH_EXTREME; bullReasons.push(`Stoch %K ${k}/%D ${dL} — extreme oversold`); }
    else if (k < 20 && (dL ?? 100) < 20)  { score += SCORE_WEIGHTS.STOCH_NORMAL;  bullReasons.push(`Stoch %K ${k}/%D ${dL} — oversold`); }
    else if (k > 85 && (dL ?? 0) > 85)    { score -= SCORE_WEIGHTS.STOCH_EXTREME; bearReasons.push(`Stoch %K ${k}/%D ${dL} — extreme overbought`); }
    else if (k > 80 && (dL ?? 0) > 80)    { score -= SCORE_WEIGHTS.STOCH_NORMAL;  bearReasons.push(`Stoch %K ${k}/%D ${dL} — overbought`); }
    if (kCrossD === "BULLISH" && k < 50)   { score += SCORE_WEIGHTS.STOCH_CROSS;   bullReasons.push(`Stoch K crossed above D from low`); }
    else if (kCrossD === "BEARISH" && k > 50) { score -= SCORE_WEIGHTS.STOCH_CROSS; bearReasons.push(`Stoch K crossed below D from high`); }
  }

  // ── MACD ─────────────────────────────────────────────────
  if (d.macd?.macd != null) {
    if      (d.macd.crossover === "BULLISH_CROSS") { score += SCORE_WEIGHTS.MACD_CROSSOVER; bullReasons.push(`MACD bullish crossover ⚡`); }
    else if (d.macd.crossover === "BEARISH_CROSS") { score -= SCORE_WEIGHTS.MACD_CROSSOVER; bearReasons.push(`MACD bearish crossover ⚡`); }
    else if (d.macd.histogram != null && d.macd.histogram > 0 && d.macd.histTrend === "EXPANDING") { score += SCORE_WEIGHTS.MACD_HISTOGRAM; bullReasons.push(`MACD histogram expanding bullish`); }
    else if (d.macd.histogram != null && d.macd.histogram < 0 && d.macd.histTrend === "EXPANDING") { score -= SCORE_WEIGHTS.MACD_HISTOGRAM; bearReasons.push(`MACD histogram expanding bearish`); }
    else if (d.macd.histogram != null && d.macd.histogram > 0) { score += SCORE_WEIGHTS.MACD_WEAK; bullReasons.push(`MACD histogram positive`); }
    else if (d.macd.histogram != null && d.macd.histogram < 0) { score -= SCORE_WEIGHTS.MACD_WEAK; bearReasons.push(`MACD histogram negative`); }
  }

  // ── Bollinger Bands ───────────────────────────────────────
  if (d.bb?.pctB != null) {
    const { pctB, squeeze } = d.bb;
    if      (pctB < 0)   { score += SCORE_WEIGHTS.BB_EXTREME;  bullReasons.push(`BB %B ${round2(pctB)} — below lower band`); }
    else if (pctB < 10)  { score += SCORE_WEIGHTS.BB_NEAR + 1; bullReasons.push(`BB %B ${round2(pctB)} — hugging lower band`); }
    else if (pctB < 25)  { score += SCORE_WEIGHTS.BB_NEAR;     bullReasons.push(`BB %B ${round2(pctB)} — near lower band`); }
    else if (pctB > 100) { score -= SCORE_WEIGHTS.BB_EXTREME;  bearReasons.push(`BB %B ${round2(pctB)} — above upper band`); }
    else if (pctB > 90)  { score -= SCORE_WEIGHTS.BB_NEAR + 1; bearReasons.push(`BB %B ${round2(pctB)} — hugging upper band`); }
    else if (pctB > 75)  { score -= SCORE_WEIGHTS.BB_NEAR;     bearReasons.push(`BB %B ${round2(pctB)} — near upper band`); }
    if (squeeze) neutralNotes.push(`BB squeeze (${d.bb.bandwidth}%) — breakout approaching`);
  }

  // ── Market Regime ─────────────────────────────────────────
  if (d.marketRegime === "TRENDING_BULL")  { score += SCORE_WEIGHTS.MARKET_REGIME; bullReasons.push(`Market regime: TRENDING BULL — trend signals reliable`); }
  else if (d.marketRegime === "TRENDING_BEAR") { score -= SCORE_WEIGHTS.MARKET_REGIME; bearReasons.push(`Market regime: TRENDING BEAR`); }
  else if (d.marketRegime === "BREAKOUT")  { score += SCORE_WEIGHTS.MARKET_REGIME; bullReasons.push(`Market regime: BREAKOUT from squeeze`); }
  else if (d.marketRegime === "BREAKDOWN") { score -= SCORE_WEIGHTS.MARKET_REGIME; bearReasons.push(`Market regime: BREAKDOWN from squeeze`); }
  else neutralNotes.push(`Market regime: RANGING — oscillators more reliable than trend signals`);

  // ── ADX ───────────────────────────────────────────────────
  if (d.adx?.adx != null) {
    const { adx: adxVal, diPlus, diMinus, strength } = d.adx;
    if      (strength === "STRONG_BULL" || strength === "VERY_STRONG" && (diPlus ?? 0) > (diMinus ?? 0)) { score += SCORE_WEIGHTS.ADX_STRONG; bullReasons.push(`ADX ${adxVal} — strong bull (DI+ ${diPlus} > DI- ${diMinus})`); }
    else if (strength === "WEAK_BULL")   { score += SCORE_WEIGHTS.ADX_WEAK;   bullReasons.push(`ADX ${adxVal} — weak bull`); }
    else if (strength === "STRONG_BEAR") { score -= SCORE_WEIGHTS.ADX_STRONG; bearReasons.push(`ADX ${adxVal} — strong bear`); }
    else if (strength === "WEAK_BEAR")   { score -= SCORE_WEIGHTS.ADX_WEAK;   bearReasons.push(`ADX ${adxVal} — weak bear`); }
    else neutralNotes.push(`ADX ${adxVal} — ranging`);
  }

  // ── Williams %R ───────────────────────────────────────────
  if (d.willR != null) {
    if      (d.willR < -90) { score += SCORE_WEIGHTS.WILLIAMS_EXTREME; bullReasons.push(`Williams %R ${d.willR} — extremely oversold`); }
    else if (d.willR < -80) { score += SCORE_WEIGHTS.WILLIAMS_NORMAL;  bullReasons.push(`Williams %R ${d.willR} — oversold`); }
    else if (d.willR > -10) { score -= SCORE_WEIGHTS.WILLIAMS_EXTREME; bearReasons.push(`Williams %R ${d.willR} — extremely overbought`); }
    else if (d.willR > -20) { score -= SCORE_WEIGHTS.WILLIAMS_NORMAL;  bearReasons.push(`Williams %R ${d.willR} — overbought`); }
  }

  // ── CCI ───────────────────────────────────────────────────
  if (d.cci != null) {
    if      (d.cci < -200) { score += SCORE_WEIGHTS.CCI_EXTREME; bullReasons.push(`CCI ${d.cci} — extreme oversold`); }
    else if (d.cci < -100) { score += SCORE_WEIGHTS.CCI_NORMAL;  bullReasons.push(`CCI ${d.cci} — oversold`); }
    else if (d.cci > 200)  { score -= SCORE_WEIGHTS.CCI_EXTREME; bearReasons.push(`CCI ${d.cci} — extreme overbought`); }
    else if (d.cci > 100)  { score -= SCORE_WEIGHTS.CCI_NORMAL;  bearReasons.push(`CCI ${d.cci} — overbought`); }
  }

  // ── Moving Averages ───────────────────────────────────────
  if (d.ma20 != null) { d.price > d.ma20 ? (score += SCORE_WEIGHTS.MA_CROSS, bullReasons.push(`Price above MA20 ${d.ma20}`)) : (score -= SCORE_WEIGHTS.MA_CROSS, bearReasons.push(`Price below MA20 ${d.ma20}`)); }
  if (d.ma5  != null && d.ma20 != null) { d.ma5 > d.ma20 ? (score += SCORE_WEIGHTS.MA_CROSS, bullReasons.push(`MA5 > MA20 — short bull`)) : (score -= SCORE_WEIGHTS.MA_CROSS, bearReasons.push(`MA5 < MA20 — short bear`)); }
  if (d.ma20 != null && d.ma50 != null) { d.ma20 > d.ma50 ? (score += SCORE_WEIGHTS.MA_CROSS, bullReasons.push(`MA20 > MA50 — medium uptrend`)) : (score -= SCORE_WEIGHTS.MA_CROSS, bearReasons.push(`MA20 < MA50 — medium downtrend`)); }
  if (d.ma200 != null) { d.price > d.ma200 ? (score += SCORE_WEIGHTS.MA_CROSS, bullReasons.push(`Price above MA200 — long-term bull`)) : (score -= SCORE_WEIGHTS.MA_CROSS, bearReasons.push(`Price below MA200 — long-term bear`)); }
  if (d.ema9 != null && d.ema21 != null) { d.ema9 > d.ema21 ? (score += SCORE_WEIGHTS.MA_CROSS, bullReasons.push(`EMA9 > EMA21 — momentum up`)) : (score -= SCORE_WEIGHTS.MA_CROSS, bearReasons.push(`EMA9 < EMA21 — momentum down`)); }

  // ── VWAP ─────────────────────────────────────────────────
  if (d.vwapDevPct != null) {
    if      (d.vwapDevPct < -5)  { score += SCORE_WEIGHTS.VWAP + SCORE_WEIGHTS.VWAP_DEV; bullReasons.push(`Price ${d.vwapDevPct}% below VWAP — deeply undervalued vs fair value`); }
    else if (d.vwapDevPct < -2)  { score += SCORE_WEIGHTS.VWAP;                            bullReasons.push(`Price ${d.vwapDevPct}% below VWAP`); }
    else if (d.vwapDevPct < 0)   { score += 1;                                             bullReasons.push(`Price slightly below VWAP`); }
    else if (d.vwapDevPct > 5)   { score -= SCORE_WEIGHTS.VWAP + SCORE_WEIGHTS.VWAP_DEV; bearReasons.push(`Price ${d.vwapDevPct}% above VWAP — stretched`); }
    else if (d.vwapDevPct > 2)   { score -= SCORE_WEIGHTS.VWAP;                            bearReasons.push(`Price ${d.vwapDevPct}% above VWAP`); }
    else if (d.vwapDevPct > 0)   { score -= 1;                                             bearReasons.push(`Price slightly above VWAP`); }
  }

  // ── OBV ───────────────────────────────────────────────────
  if (d.obv.trend === "ACCUMULATION")  { score += SCORE_WEIGHTS.OBV; bullReasons.push(`OBV ACCUMULATION — institutional buying`); }
  else if (d.obv.trend === "DISTRIBUTION") { score -= SCORE_WEIGHTS.OBV; bearReasons.push(`OBV DISTRIBUTION — institutional selling`); }

  // ── Ichimoku ──────────────────────────────────────────────
  if (d.ichi) {
    if      (d.ichi.position === "ABOVE_CLOUD") { score += SCORE_WEIGHTS.ICHI_CLOUD; bullReasons.push(`Ichimoku: above ${d.ichi.cloudColor} cloud`); }
    else if (d.ichi.position === "BELOW_CLOUD") { score -= SCORE_WEIGHTS.ICHI_CLOUD; bearReasons.push(`Ichimoku: below ${d.ichi.cloudColor} cloud`); }
    else neutralNotes.push("Ichimoku: inside cloud — consolidation");
    if (d.ichi.tkBullish) { score += SCORE_WEIGHTS.ICHI_TK; bullReasons.push(`TK cross: Tenkan ${d.ichi.tenkan} > Kijun ${d.ichi.kijun}`); }
    else                   { score -= SCORE_WEIGHTS.ICHI_TK; bearReasons.push(`TK: Tenkan < Kijun`); }
    if (d.ichi.chikouBullish != null) {
      d.ichi.chikouBullish ? bullReasons.push("Chikou bullish") : bearReasons.push("Chikou bearish");
    }
  }

  // ── Volume spike ─────────────────────────────────────────
  if (d.vol.volSpike) {
    if   (score > 0) { score += SCORE_WEIGHTS.VOLUME_CONFIRM; bullReasons.push(`Volume ${d.vol.volRatio}x avg — confirms bullish`); }
    else              { score -= SCORE_WEIGHTS.VOLUME_CONFIRM; bearReasons.push(`Volume ${d.vol.volRatio}x avg — confirms bearish`); }
  }

  // ── Pivots ────────────────────────────────────────────────
  if (d.pivots) {
    const { s1, s2, r1, r2 } = d.pivots;
    if (d.price <= s1 * 1.005 && d.price > s2) { score += SCORE_WEIGHTS.PIVOT_LEVEL; bullReasons.push(`Near S1 support ${s1}`); }
    if (d.price <= s2 * 1.005)                  { score += SCORE_WEIGHTS.PIVOT_LEVEL; bullReasons.push(`Near S2 support ${s2} — strong floor`); }
    if (d.price >= r1 * 0.995 && d.price < r2) { score -= SCORE_WEIGHTS.PIVOT_LEVEL; bearReasons.push(`Near R1 resistance ${r1}`); }
    if (d.price >= r2 * 0.995)                  { score -= SCORE_WEIGHTS.PIVOT_LEVEL; bearReasons.push(`Near R2 resistance ${r2} — strong ceiling`); }
  }

  // ── 6-month position ──────────────────────────────────────
  if (d.pctFrom6mLow  != null && d.pctFrom6mLow  < 3)  { score += SCORE_WEIGHTS.POSITION_6M; bullReasons.push(`Near 6m low — base forming`); }
  if (d.pctFrom6mHigh != null && d.pctFrom6mHigh > -3) { score -= SCORE_WEIGHTS.POSITION_6M; bearReasons.push(`Near 6m high — limited upside`); }

  // ── Patterns ──────────────────────────────────────────────
  for (const p of d.patterns) {
    const w = ["Bullish Engulfing","Bearish Engulfing","Three White Soldiers","Three Black Crows","Morning Star","Evening Star"].includes(p.name)
      ? SCORE_WEIGHTS.PATTERN_MAJOR : SCORE_WEIGHTS.PATTERN_MINOR;
    if      (p.bias === "BULLISH") { score += w; bullReasons.push(`${p.name} — ${p.desc}`); }
    else if (p.bias === "BEARISH") { score -= w; bearReasons.push(`${p.name} — ${p.desc}`); }
    else                            neutralNotes.push(`${p.name} — ${p.desc}`);
  }

  // ── Divergence ────────────────────────────────────────────
  if      (d.divergence === "BULLISH_DIVERGENCE") { score += SCORE_WEIGHTS.DIVERGENCE; bullReasons.push("Bullish RSI divergence — price new low, RSI higher low"); }
  else if (d.divergence === "BEARISH_DIVERGENCE") { score -= SCORE_WEIGHTS.DIVERGENCE; bearReasons.push("Bearish RSI divergence — price new high, RSI lower high"); }

  // ── Fundamentals ─────────────────────────────────────────
  const { peRatio: pe, dividendYield: dy, pbRatio: pb } = d.fundamentals;
  if (pe != null) {
    if      (pe < 6)  { score += SCORE_WEIGHTS.FUNDAMENTAL_PE; bullReasons.push(`P/E ${pe}x — very cheap`); }
    else if (pe > 30) { score -= SCORE_WEIGHTS.FUNDAMENTAL_PE; bearReasons.push(`P/E ${pe}x — expensive`); }
  }
  if (dy != null && dy > 8) { score += SCORE_WEIGHTS.FUNDAMENTAL_DIV; bullReasons.push(`Dividend yield ${dy}% — attractive`); }
  if (pb != null) {
    if      (pb < 1)  { score += SCORE_WEIGHTS.FUNDAMENTAL_PB; bullReasons.push(`P/B ${pb}x — below book value`); }
    else if (pb > 4)  { score -= SCORE_WEIGHTS.FUNDAMENTAL_PB; bearReasons.push(`P/B ${pb}x — pricey vs book`); }
  }

  // ── P&L context ───────────────────────────────────────────
  if ((d.unrealizedPct ?? 0) < -25) neutralNotes.push(`⚠️ Down ${Math.abs(d.unrealizedPct!)}% from cost — re-evaluate thesis`);
  if ((d.unrealizedPct ?? 0) > 50)  neutralNotes.push(`✅ Up ${d.unrealizedPct}% — consider partial profit booking`);

  // ─────────────────────────────────────────────────────────
  //  ACTION
  // ─────────────────────────────────────────────────────────

  let action: TradeSignal["action"];
  if      (score >= SIGNAL_THRESHOLDS.STRONG_BUY)  action = "STRONG_BUY";
  else if (score >= SIGNAL_THRESHOLDS.BUY)          action = "BUY";
  else if (score <= SIGNAL_THRESHOLDS.STRONG_SELL)  action = "STRONG_SELL";
  else if (score <= SIGNAL_THRESHOLDS.SELL)         action = "SELL";
  else                                               action = "HOLD";

  const isBuy  = action === "BUY"  || action === "STRONG_BUY";
  const isSell = action === "SELL" || action === "STRONG_SELL";

  // ─────────────────────────────────────────────────────────
  //  PRICE LEVELS  (ATR-anchored, pivot-refined)
  // ─────────────────────────────────────────────────────────

  const atr = d.atr ?? d.price * 0.02;
  const { s1, s2, r1, r2 } = d.pivots ?? { s1: null, s2: null, r1: null, r2: null };

  let limitPrice: number | null, targetPrice: number | null, stopLoss: number | null, qty: number;

  if (isBuy) {
    limitPrice  = round2(s1 ? Math.min(d.price, s1) : d.price - atr * 0.25);
    targetPrice = round2(r1 ? r1 : d.price + atr * 2.5);
    stopLoss    = round2(s2 ? s2 - atr * 0.1 : d.price - atr * 1.5);
    qty = Math.max(50, Math.round(d.shares * (action === "STRONG_BUY" ? 0.15 : 0.10) / 10) * 10);
  } else if (isSell) {
    limitPrice  = round2(r1 ? Math.max(d.price, r1) : d.price + atr * 0.25);
    targetPrice = round2(s1 ? s1 : d.price - atr * 2.5);
    stopLoss    = round2(r2 ? r2 + atr * 0.1 : d.price + atr * 1.5);
    qty = Math.min(d.shares, Math.max(50, Math.round(d.shares * (action === "STRONG_SELL" ? 0.25 : 0.15) / 10) * 10));
  } else {
    limitPrice  = d.price;
    targetPrice = round2(r1 ?? d.price + atr);
    stopLoss    = round2(s1 ?? d.price - atr);
    qty = 0;
  }

  const rewardAmt = Math.abs((targetPrice ?? 0) - (limitPrice ?? 0));
  const riskAmt   = Math.abs((limitPrice  ?? 0) - (stopLoss   ?? 0));
  const rrRatio   = riskAmt > 0 ? round2(rewardAmt / riskAmt) : null;
  const potentialGain = Math.round(rewardAmt * qty);
  const maxRisk       = Math.round(riskAmt   * qty);

  const absScore   = Math.abs(score);
  const confidence: TradeSignal["confidence"] =
    absScore >= 18 ? "Very High" : absScore >= 13 ? "High" : absScore >= 8 ? "Medium" : "Low";

  const stNote = d.superTrend ? ` SuperTrend: ${d.superTrend.signal}.` : "";

  const instruction = isBuy
    ? `Buy ${qty} shares of ${symbol} at PKR ${limitPrice} or below (limit order)`
    : isSell
    ? `Sell ${qty} shares of ${symbol} at PKR ${limitPrice} or above (limit order)`
    : `Hold — support PKR ${stopLoss}, resistance PKR ${targetPrice}`;

  const beginnerNote = isBuy
    ? `📗 ${symbol} shows multiple buy signals.${stNote} Place a limit buy at PKR ${limitPrice}. Target: PKR ${targetPrice}. If it drops to PKR ${stopLoss}, exit to protect capital.`
    : isSell
    ? `📕 ${symbol} shows multiple sell signals.${stNote} Consider selling ${qty} shares at PKR ${limitPrice}. Stop loss at PKR ${stopLoss} if trade moves against you.`
    : `📘 ${symbol} is a wait-and-watch.${stNote} No action now. Buy opportunity if price hits PKR ${stopLoss}. Take profit if it reaches PKR ${targetPrice}.`;

  const proSummary = `Score ${score >= 0 ? "+" : ""}${score} | ${d.trend} | Regime:${d.marketRegime} | RSI:${d.rsi14} MFI:${d.mfi} ROC:${d.roc}% ST:${d.superTrend?.signal ?? "—"} | MACD:${d.macd?.crossover ?? d.macd?.histTrend} | BB%B:${d.bb?.pctB} | ADX:${d.adx?.adx}(${d.adx?.strength}) | Ichi:${d.ichi?.position ?? "N/A"} | VWAP±${d.vwapDevPct}%`;

  return {
    symbol, action, score, confidence, qty, limitPrice, targetPrice, stopLoss, rrRatio, potentialGain, maxRisk,
    instruction, beginnerNote, proSummary, bullReasons, bearReasons, neutralNotes,
    price: d.price, open: d.open, high: d.high, low: d.low,
    changePct: d.changePct, bid: d.bid, ask: d.ask,
    rsi14: d.rsi14, rsi9: d.rsi9, mfi: d.mfi, roc: d.roc,
    stoch: d.stoch, macd: d.macd, bb: d.bb, adx: d.adx,
    willR: d.willR, cci: d.cci, ichi: d.ichi, superTrend: d.superTrend,
    vwap: d.vwap, vwapDevPct: d.vwapDevPct, obv: d.obv,
    pivots: d.pivots, trend: d.trend, marketRegime: d.marketRegime,
    vol: d.vol, patterns: d.patterns, divergence: d.divergence, sparkline: d.sparkline,
    ma5: d.ma5, ma10: d.ma10, ma20: d.ma20, ma50: d.ma50, ma200: d.ma200, ema9: d.ema9, ema21: d.ema21,
    unrealizedPnl: d.unrealizedPnl, unrealizedPct: d.unrealizedPct, marketValue: d.marketValue,
    costBasis: d.costBasis, shares: d.shares, avgCost: d.avgCost,
    perf1d: d.perf1d, perf1w: d.perf1w, perf1m: d.perf1m, perf6m: d.perf6m,
    high6m: d.high6m, low6m: d.low6m, maxDrawdown: d.maxDrawdown,
    pctFrom6mHigh: d.pctFrom6mHigh, pctFrom6mLow: d.pctFrom6mLow,
    fundamentals: d.fundamentals, dividends: d.dividends,
  };
}

// ─────────────────────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────────────────────

export function getSignals(stockData: StockDataMap): SignalMap {
  const signals: SignalMap = {};
  for (const [symbol, entry] of Object.entries(stockData)) {
    if (symbol === "__market__") continue;
    const d = entry as StockResult;
    if (!d.price || isStockError(d)) {
      signals[symbol] = { symbol, action: "SKIP", error: isStockError(d) ? d.error : "No price", score: 0, price: null };
    } else {
      signals[symbol] = buildSignal(symbol, d as StockData);
    }
  }
  return signals;
}

export function calcPortfolioSummary(stockData: StockDataMap): PortfolioSummary {
  let totalCost = 0, totalValue = 0;
  const sectorMap: Record<string, number> = {};
  for (const [key, entry] of Object.entries(stockData)) {
    if (key === "__market__") continue;
    const d = entry as StockResult;
    if (!d.price || isStockError(d)) continue;
    const sd = d as StockData;
    totalCost  += sd.costBasis;
    totalValue += sd.marketValue;
    if (sd.sector) sectorMap[sd.sector] = (sectorMap[sd.sector] ?? 0) + sd.marketValue;
  }
  const totalPnl    = round2(totalValue - totalCost)!;
  const totalPnlPct = totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100)! : 0;
  const sectorWeights: Record<string, number> = {};
  for (const [sec, val] of Object.entries(sectorMap)) {
    sectorWeights[sec] = totalValue > 0 ? round2((val / totalValue) * 100)! : 0;
  }
  return {
    totalCost: round2(totalCost)!, totalValue: round2(totalValue)!,
    totalPnl, totalPnlPct, sectorWeights,
    marketContext: stockData.__market__ ?? null,
  };
}