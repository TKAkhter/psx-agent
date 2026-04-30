import { CONFIG } from '../config';
import type { TechnicalIndicators, TechnicalSignal, SignalResult, Signal } from '../types';

// ─── Signal definitions ───────────────────────────────────────────────────────
// weight = conviction contribution; higher = stronger evidence

const BULLISH_CANDLES = new Set(['hammer','bullish_engulfing','morning_star','inverted_hammer']);
const BEARISH_CANDLES = new Set(['shooting_star','bearish_engulfing','evening_star','doji']);

export function generateSignals(ti: TechnicalIndicators, circuitBreakerActive: boolean): SignalResult {
  const buy:  TechnicalSignal[] = [];
  const sell: TechnicalSignal[] = [];

  const add = (arr: TechnicalSignal[], name: string, type: 'BUY'|'SELL', weight: number, description: string) =>
    arr.push({ name, type, weight, description });

  // ── 1. RSI ─── weight 1.0 ────────────────────────────────────────────────────
  if (ti.rsi14 < CONFIG.ALERT_RSI_OVERSOLD)
    add(buy,  'RSI_OVERSOLD',    'BUY',  1.0, `RSI ${ti.rsi14.toFixed(0)} < ${CONFIG.ALERT_RSI_OVERSOLD} — oversold, potential bounce`);
  if (ti.rsi14 > CONFIG.ALERT_RSI_OVERBOUGHT)
    add(sell, 'RSI_OVERBOUGHT',  'SELL', 1.0, `RSI ${ti.rsi14.toFixed(0)} > ${CONFIG.ALERT_RSI_OVERBOUGHT} — overbought, potential pullback`);
  // Extreme zones carry extra weight
  if (ti.rsi14 < 20)
    add(buy,  'RSI_EXTREME_OVERSOLD', 'BUY', 0.5, `RSI ${ti.rsi14.toFixed(0)} — extreme oversold zone`);
  if (ti.rsi14 > 80)
    add(sell, 'RSI_EXTREME_OVERBOUGHT','SELL',0.5, `RSI ${ti.rsi14.toFixed(0)} — extreme overbought zone`);

  // ── 2. RSI Divergence ─── weight 1.5 ─────────────────────────────────────────
  if (ti.rsiDivergence === 'bullish')
    add(buy,  'RSI_BULLISH_DIVERGENCE', 'BUY',  1.5, 'Price lower low but RSI higher low — bullish divergence');
  if (ti.rsiDivergence === 'bearish')
    add(sell, 'RSI_BEARISH_DIVERGENCE', 'SELL', 1.5, 'Price higher high but RSI lower high — bearish divergence');

  // ── 3. MACD ─── weight 1.5 / 2.0 for cross ───────────────────────────────────
  if (ti.macdSignal === 'bullish_cross')
    add(buy,  'MACD_BULLISH_CROSS', 'BUY',  2.0, 'MACD crossed above signal line — momentum turning bullish');
  if (ti.macdSignal === 'bearish_cross')
    add(sell, 'MACD_BEARISH_CROSS', 'SELL', 2.0, 'MACD crossed below signal line — momentum turning bearish');
  if (ti.macdSignal === 'bullish' && ti.macdLine > 0)
    add(buy,  'MACD_ABOVE_ZERO',    'BUY',  1.0, 'MACD above zero line — positive momentum');
  if (ti.macdSignal === 'bearish' && ti.macdLine < 0)
    add(sell, 'MACD_BELOW_ZERO',    'SELL', 1.0, 'MACD below zero line — negative momentum');

  // ── 4. Stochastic ─── weight 0.8 ────────────────────────────────────────────
  if (ti.stochasticK < 20 && ti.stochasticD < 20)
    add(buy,  'STOCH_OVERSOLD',    'BUY',  0.8, `Stochastic K:${ti.stochasticK.toFixed(0)} D:${ti.stochasticD.toFixed(0)} — both oversold`);
  if (ti.stochasticK > 80 && ti.stochasticD > 80)
    add(sell, 'STOCH_OVERBOUGHT',  'SELL', 0.8, `Stochastic K:${ti.stochasticK.toFixed(0)} D:${ti.stochasticD.toFixed(0)} — both overbought`);
  // K crosses D
  if (ti.stochasticK < 25 && ti.stochasticK > ti.stochasticD)
    add(buy,  'STOCH_BULL_CROSS',  'BUY',  0.6, 'Stochastic K crossed above D in oversold zone');
  if (ti.stochasticK > 75 && ti.stochasticK < ti.stochasticD)
    add(sell, 'STOCH_BEAR_CROSS',  'SELL', 0.6, 'Stochastic K crossed below D in overbought zone');

  // ── 5. Williams %R ─── weight 0.6 ────────────────────────────────────────────
  if (ti.williamsR < -80)
    add(buy,  'WILLIAMS_OVERSOLD',   'BUY',  0.6, `Williams %R ${ti.williamsR.toFixed(0)} — oversold`);
  if (ti.williamsR > -20)
    add(sell, 'WILLIAMS_OVERBOUGHT', 'SELL', 0.6, `Williams %R ${ti.williamsR.toFixed(0)} — overbought`);

  // ── 6. CCI ─── weight 0.6 ─────────────────────────────────────────────────────
  if (ti.cci20 < -100)
    add(buy,  'CCI_OVERSOLD',   'BUY',  0.6, `CCI ${ti.cci20.toFixed(0)} below -100 — oversold`);
  if (ti.cci20 > 100)
    add(sell, 'CCI_OVERBOUGHT', 'SELL', 0.6, `CCI ${ti.cci20.toFixed(0)} above +100 — overbought`);

  // ── 7. MFI (Money Flow Index) ─── weight 0.8 ─────────────────────────────────
  if (ti.mfi14 < 20)
    add(buy,  'MFI_OVERSOLD',   'BUY',  0.8, `MFI ${ti.mfi14.toFixed(0)} — money flowing in at low prices`);
  if (ti.mfi14 > 80)
    add(sell, 'MFI_OVERBOUGHT', 'SELL', 0.8, `MFI ${ti.mfi14.toFixed(0)} — money flowing out at high prices`);

  // ── 8. ADX / Trend Strength ─── weight 1.0 ───────────────────────────────────
  if (ti.adx14 > 25 && ti.diPlus > ti.diMinus)
    add(buy,  'ADX_STRONG_UPTREND',   'BUY',  1.0, `ADX ${ti.adx14.toFixed(0)} — strong uptrend confirmed`);
  if (ti.adx14 > 25 && ti.diMinus > ti.diPlus)
    add(sell, 'ADX_STRONG_DOWNTREND', 'SELL', 1.0, `ADX ${ti.adx14.toFixed(0)} — strong downtrend confirmed`);

  // ── 9. Bollinger Bands ─── weight 0.8 ────────────────────────────────────────
  if (ti.bbPosition === 'below_lower')
    add(buy,  'BB_LOWER_BREACH',  'BUY',  0.8, 'Price below lower Bollinger Band — mean reversion likely');
  if (ti.bbPosition === 'above_upper')
    add(sell, 'BB_UPPER_BREACH',  'SELL', 0.8, 'Price above upper Bollinger Band — extended, pullback possible');
  if (ti.bbSqueeze)
    add(buy,  'BB_SQUEEZE',       'BUY',  0.5, 'Bollinger squeeze — low volatility often precedes strong breakout');

  // ── 10. Moving Average Trends ─── weight 1.5–2.0 ─────────────────────────────
  if (ti.sma50 > ti.sma200 && ti.sma20 > ti.sma50)
    add(buy,  'GOLDEN_CROSS_FULL',  'BUY',  2.0, 'SMA20 > SMA50 > SMA200 — full bullish alignment');
  if (ti.sma50 < ti.sma200 && ti.sma20 < ti.sma50)
    add(sell, 'DEATH_CROSS_FULL',   'SELL', 2.0, 'SMA20 < SMA50 < SMA200 — full bearish alignment');
  if (ti.trendMid === 'up' && ti.trendLong === 'up')
    add(buy,  'DUAL_UPTREND',       'BUY',  1.0, 'Mid and long-term trend both up');
  if (ti.trendMid === 'down' && ti.trendLong === 'down')
    add(sell, 'DUAL_DOWNTREND',     'SELL', 1.0, 'Mid and long-term trend both down');

  // ── 11. VWAP ─── weight 0.6 ──────────────────────────────────────────────────
  if (ti.vwap > 0) {
    const vwapDiff = ((ti.vwap - ti.sma20) / ti.sma20) * 100;
    // Approximate: price below VWAP = below fair intraday value
    // We proxy with sma20 vs vwap since we use daily data
    if (vwapDiff < -2) add(buy,  'PRICE_BELOW_VWAP', 'BUY',  0.6, 'Price below VWAP — potential institutional buy zone');
    if (vwapDiff > 2)  add(sell, 'PRICE_ABOVE_VWAP', 'SELL', 0.6, 'Price above VWAP — extended above fair value');
  }

  // ── 12. OBV & Volume ─── weight 1.0 ──────────────────────────────────────────
  if (ti.obvTrend === 'accumulation')
    add(buy,  'OBV_ACCUMULATION',  'BUY',  1.0, 'OBV rising — institutional accumulation in progress');
  if (ti.obvTrend === 'distribution')
    add(sell, 'OBV_DISTRIBUTION',  'SELL', 1.0, 'OBV falling — smart money distributing shares');
  if (ti.volumeSignal === 'spike_up')
    add(buy,  'VOLUME_SPIKE_UP',   'BUY',  1.0, `Volume ${ti.volumeRatio.toFixed(1)}x average on up move — buying conviction`);
  if (ti.volumeSignal === 'spike_down')
    add(sell, 'VOLUME_SPIKE_DOWN', 'SELL', 1.0, `Volume ${ti.volumeRatio.toFixed(1)}x average on down move — selling pressure`);

  // ── 13. Chaikin Money Flow ─── weight 0.8 ────────────────────────────────────
  if (ti.chaikinMoneyFlow > 0.15)
    add(buy,  'CMF_STRONG_INFLOW',  'BUY',  0.8, `CMF ${ti.chaikinMoneyFlow.toFixed(2)} — strong buying pressure`);
  if (ti.chaikinMoneyFlow < -0.15)
    add(sell, 'CMF_STRONG_OUTFLOW', 'SELL', 0.8, `CMF ${ti.chaikinMoneyFlow.toFixed(2)} — strong selling pressure`);

  // ── 14. Ichimoku Cloud ─── weight 1.0 ────────────────────────────────────────
  if (ti.ichimokuSignal === 'above_cloud')
    add(buy,  'ICHIMOKU_ABOVE_CLOUD', 'BUY',  1.0, 'Price above Ichimoku cloud — bullish long-term momentum');
  if (ti.ichimokuSignal === 'below_cloud')
    add(sell, 'ICHIMOKU_BELOW_CLOUD', 'SELL', 1.0, 'Price below Ichimoku cloud — bearish long-term momentum');

  // ── 15. Rate of Change ─── weight 0.5 ────────────────────────────────────────
  if (ti.roc10 < -10)
    add(buy,  'ROC_SHARP_DROP', 'BUY',  0.5, `ROC ${ti.roc10.toFixed(1)}% — sharp 10-day drop, potential bounce`);
  if (ti.roc10 > 15)
    add(sell, 'ROC_SHARP_RALLY', 'SELL', 0.5, `ROC ${ti.roc10.toFixed(1)}% — sharp 10-day rally, potential exhaustion`);

  // ── 16. Candlestick Patterns ─── weight 0.7 ──────────────────────────────────
  if (BULLISH_CANDLES.has(ti.candlestickPattern))
    add(buy,  `CANDLE_${ti.candlestickPattern.toUpperCase()}`, 'BUY',  0.7, `${ti.candlestickPattern.replace(/_/g,' ')} — bullish reversal candle`);
  if (BEARISH_CANDLES.has(ti.candlestickPattern))
    add(sell, `CANDLE_${ti.candlestickPattern.toUpperCase()}`, 'SELL', 0.7, `${ti.candlestickPattern.replace(/_/g,' ')} — bearish reversal candle`);

  // ── 17. Fibonacci & Support/Resistance ─── weight 0.6 ────────────────────────
  const curPrice = ti.sma20; // proxy for "current" in signal context
  if (Math.abs(curPrice - ti.fibRetracement618) / curPrice < 0.01)
    add(buy,  'NEAR_FIB_618', 'BUY',  0.6, 'Price near 61.8% Fibonacci retracement — key support');
  if (Math.abs(curPrice - ti.fibRetracement382) / curPrice < 0.01)
    add(sell, 'NEAR_FIB_382', 'SELL', 0.6, 'Price near 38.2% Fibonacci — potential resistance');

  // ── Net conviction ────────────────────────────────────────────────────────────
  const convictionScore =
    buy.reduce((s,x)=>s+x.weight,0) -
    sell.reduce((s,x)=>s+x.weight,0);

  let overallSignal: Signal;
  if      (convictionScore >= 5.0)  overallSignal = 'STRONG_BUY';
  else if (convictionScore >= 2.5)  overallSignal = 'BUY';
  else if (convictionScore <= -5.0) overallSignal = 'STRONG_SELL';
  else if (convictionScore <= -2.5) overallSignal = 'SELL';
  else                              overallSignal = 'HOLD';

  // Circuit breaker suppresses BUY
  if (circuitBreakerActive && (overallSignal === 'BUY' || overallSignal === 'STRONG_BUY')) {
    overallSignal = 'HOLD';
    buy.push({ name:'CIRCUIT_BREAKER', type:'BUY', weight:0, description:'BUY suppressed — KSE-100 circuit breaker active' });
  }

  // Plain-English summary
  const topBuy  = buy.filter(s=>s.weight>0).slice(0,3).map(s=>s.description).join('; ');
  const topSell = sell.slice(0,3).map(s=>s.description).join('; ');
  const technicalSummary = overallSignal === 'HOLD'
    ? `Mixed signals — ${buy.length} bullish vs ${sell.length} bearish indicators.`
    : overallSignal.includes('BUY')
      ? `${topBuy || 'Multiple bullish indicators align.'}`
      : `${topSell || 'Multiple bearish indicators align.'}`;

  return { buySignals: buy, sellSignals: sell, convictionScore, overallSignal, technicalSummary };
}
