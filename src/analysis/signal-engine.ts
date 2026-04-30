/**
 * Signal Engine — PSX Analyzer v2
 *
 * 20 signal categories, weighted by evidence quality.
 * Each signal carries a human-readable description that appears in the PDF report
 * so both novice and professional readers can understand what triggered it.
 *
 * Conviction score:
 *   >= +6.0 → STRONG_BUY
 *   >= +3.0 → BUY
 *   <= -6.0 → STRONG_SELL
 *   <= -3.0 → SELL
 *   else    → HOLD
 */
import { CONFIG } from '../config';
import type { TechnicalIndicators, TechnicalSignal, SignalResult, Signal } from '../types';

const BULLISH_CANDLES = new Set(['hammer','bullish_engulfing','morning_star','inverted_hammer']);
const BEARISH_CANDLES = new Set(['shooting_star','bearish_engulfing','evening_star']);

type BuySell = 'BUY' | 'SELL';

export function generateSignals(ti: TechnicalIndicators, circuitBreakerActive: boolean): SignalResult {
  const buy:  TechnicalSignal[] = [];
  const sell: TechnicalSignal[] = [];

  function add(side: TechnicalSignal[], name: string, type: BuySell, weight: number, description: string) {
    side.push({ name, type, weight, description });
  }

  // ── 1. RSI (14-period) ─── momentum ──────────────────────────────────────
  if (ti.rsi14 < CONFIG.ALERT_RSI_OVERSOLD)
    add(buy,  'RSI_OVERSOLD',          'BUY',  1.0, `RSI-14 at ${ti.rsi14.toFixed(0)} — below ${CONFIG.ALERT_RSI_OVERSOLD}: stock is oversold, sellers may be exhausted`);
  if (ti.rsi14 < 20)
    add(buy,  'RSI_EXTREME_OVERSOLD',  'BUY',  0.8, `RSI-14 at ${ti.rsi14.toFixed(0)} — extreme oversold: high-probability mean reversion setup`);
  if (ti.rsi14 > CONFIG.ALERT_RSI_OVERBOUGHT)
    add(sell, 'RSI_OVERBOUGHT',        'SELL', 1.0, `RSI-14 at ${ti.rsi14.toFixed(0)} — above ${CONFIG.ALERT_RSI_OVERBOUGHT}: stock is overbought, buyers may be exhausted`);
  if (ti.rsi14 > 80)
    add(sell, 'RSI_EXTREME_OVERBOUGHT','SELL', 0.8, `RSI-14 at ${ti.rsi14.toFixed(0)} — extreme overbought: elevated pullback risk`);

  // ── 2. RSI Divergence ─── leading indicator ───────────────────────────────
  if (ti.rsiDivergence === 'bullish')
    add(buy,  'RSI_BULLISH_DIVERGENCE','BUY',  1.8, 'Bullish RSI divergence: price making new lows but RSI rising — hidden buying pressure, reversal likely');
  if (ti.rsiDivergence === 'bearish')
    add(sell, 'RSI_BEARISH_DIVERGENCE','SELL', 1.8, 'Bearish RSI divergence: price making new highs but RSI falling — hidden selling pressure, reversal likely');

  // ── 3. MACD ─── trend momentum ────────────────────────────────────────────
  if (ti.macdSignal === 'bullish_cross')
    add(buy,  'MACD_BULLISH_CROSS',   'BUY',  2.0, 'MACD crossed above signal line — momentum officially turning bullish: strong buy signal');
  if (ti.macdSignal === 'bearish_cross')
    add(sell, 'MACD_BEARISH_CROSS',   'SELL', 2.0, 'MACD crossed below signal line — momentum officially turning bearish: strong sell signal');
  if (ti.macdSignal === 'bullish' && ti.macdLine > 0)
    add(buy,  'MACD_POSITIVE_ZONE',   'BUY',  0.8, `MACD ${ti.macdLine.toFixed(2)} above zero — positive momentum zone, trend is bullish`);
  if (ti.macdSignal === 'bearish' && ti.macdLine < 0)
    add(sell, 'MACD_NEGATIVE_ZONE',   'SELL', 0.8, `MACD ${ti.macdLine.toFixed(2)} below zero — negative momentum zone, trend is bearish`);

  // ── 4. Stochastic Oscillator ─── overbought/oversold ─────────────────────
  if (ti.stochasticK < 20 && ti.stochasticD < 20)
    add(buy,  'STOCH_OVERSOLD',       'BUY',  0.9, `Stochastic K(${ti.stochasticK.toFixed(0)})/D(${ti.stochasticD.toFixed(0)}) both below 20 — strong oversold reading`);
  if (ti.stochasticK > 80 && ti.stochasticD > 80)
    add(sell, 'STOCH_OVERBOUGHT',     'SELL', 0.9, `Stochastic K(${ti.stochasticK.toFixed(0)})/D(${ti.stochasticD.toFixed(0)}) both above 80 — strong overbought reading`);
  if (ti.stochasticK < 30 && ti.stochasticK > ti.stochasticD)
    add(buy,  'STOCH_BULLISH_CROSS',  'BUY',  0.7, 'Stochastic K crossed above D in oversold zone — potential short-term reversal');
  if (ti.stochasticK > 70 && ti.stochasticK < ti.stochasticD)
    add(sell, 'STOCH_BEARISH_CROSS',  'SELL', 0.7, 'Stochastic K crossed below D in overbought zone — potential short-term reversal');

  // ── 5. Williams %R ─── short-term overbought/sold ─────────────────────────
  if (ti.williamsR < -80)
    add(buy,  'WILLIAMS_OVERSOLD',    'BUY',  0.6, `Williams %R at ${ti.williamsR.toFixed(0)} — deeply oversold (below -80)`);
  if (ti.williamsR > -20)
    add(sell, 'WILLIAMS_OVERBOUGHT',  'SELL', 0.6, `Williams %R at ${ti.williamsR.toFixed(0)} — deeply overbought (above -20)`);

  // ── 6. CCI (Commodity Channel Index) ─────────────────────────────────────
  if (ti.cci20 < -100)
    add(buy,  'CCI_OVERSOLD',         'BUY',  0.7, `CCI-20 at ${ti.cci20.toFixed(0)}: price well below its statistical average — oversold`);
  if (ti.cci20 > 100)
    add(sell, 'CCI_OVERBOUGHT',       'SELL', 0.7, `CCI-20 at ${ti.cci20.toFixed(0)}: price well above its statistical average — overbought`);

  // ── 7. MFI (Money Flow Index) ─── volume-weighted RSI ────────────────────
  if (ti.mfi14 < 20)
    add(buy,  'MFI_OVERSOLD',         'BUY',  1.0, `MFI-14 at ${ti.mfi14.toFixed(0)}: money flowing OUT at low prices — smart money may be accumulating`);
  if (ti.mfi14 > 80)
    add(sell, 'MFI_OVERBOUGHT',       'SELL', 1.0, `MFI-14 at ${ti.mfi14.toFixed(0)}: heavy money flowing IN at high prices — distribution risk`);

  // ── 8. ADX / Directional Index ─── trend strength ─────────────────────────
  if (ti.adx14 > 25 && ti.diPlus > ti.diMinus)
    add(buy,  'ADX_STRONG_UPTREND',   'BUY',  1.2, `ADX ${ti.adx14.toFixed(0)} — strong trend confirmed. +DI(${ti.diPlus.toFixed(0)}) > -DI(${ti.diMinus.toFixed(0)}): buyers in control`);
  if (ti.adx14 > 25 && ti.diMinus > ti.diPlus)
    add(sell, 'ADX_STRONG_DOWNTREND', 'SELL', 1.2, `ADX ${ti.adx14.toFixed(0)} — strong trend confirmed. -DI(${ti.diMinus.toFixed(0)}) > +DI(${ti.diPlus.toFixed(0)}): sellers in control`);
  if (ti.adx14 < 20)
    add(buy,  'ADX_WEAK_TREND',       'BUY',  0.3, `ADX ${ti.adx14.toFixed(0)} — weak trend: range-bound market, mean reversion strategies favoured`);

  // ── 9. Bollinger Bands ─── volatility & mean reversion ────────────────────
  if (ti.bbPosition === 'below_lower')
    add(buy,  'BB_LOWER_BREACH',      'BUY',  1.0, 'Price below lower Bollinger Band — statistically oversold, mean reversion expected');
  if (ti.bbPosition === 'above_upper')
    add(sell, 'BB_UPPER_BREACH',      'SELL', 1.0, 'Price above upper Bollinger Band — statistically overbought, pullback likely');
  if (ti.bbSqueeze)
    add(buy,  'BB_SQUEEZE',           'BUY',  0.6, `Bollinger Bands squeezed (width ${ti.bbWidth.toFixed(3)}) — volatility compression: explosive move imminent`);

  // ── 10. Keltner Channel ─── breakout confirmation ─────────────────────────
  if (ti.keltnerPosition === 'below')
    add(buy,  'KELTNER_BELOW',        'BUY',  0.8, `Price below Keltner Channel lower band (${ti.keltnerLower.toFixed(2)}) — oversold relative to EMA + ATR`);
  if (ti.keltnerPosition === 'above')
    add(sell, 'KELTNER_ABOVE',        'SELL', 0.8, `Price above Keltner Channel upper band (${ti.keltnerUpper.toFixed(2)}) — overbought relative to EMA + ATR`);
  // BB inside Keltner = classic squeeze setup
  if (ti.bbSqueeze && ti.keltnerPosition === 'inside')
    add(buy,  'SQUEEZE_PLAY',         'BUY',  1.2, 'Bollinger Band squeeze inside Keltner Channel — classic breakout coil: big move expected soon');

  // ── 11. Parabolic SAR ─── trend direction ─────────────────────────────────
  if (ti.parabolicSarSignal === 'bullish')
    add(buy,  'PSAR_BULLISH',         'BUY',  0.9, `Parabolic SAR (${ti.parabolicSarValue}) is below price — SAR flipped bullish, uptrend in progress`);
  if (ti.parabolicSarSignal === 'bearish')
    add(sell, 'PSAR_BEARISH',         'SELL', 0.9, `Parabolic SAR (${ti.parabolicSarValue}) is above price — SAR flipped bearish, downtrend in progress`);

  // ── 12. Moving Average Alignment ─────────────────────────────────────────
  if (ti.goldenCrossActive && ti.trendShort === 'up' && ti.trendMid === 'up')
    add(buy,  'GOLDEN_CROSS_ALIGNED', 'BUY',  2.0, `Golden Cross active (SMA50 > SMA200) with short & mid trend UP — bullish long-term structure confirmed`);
  if (ti.deathCrossActive && ti.trendShort === 'down' && ti.trendMid === 'down')
    add(sell, 'DEATH_CROSS_ALIGNED',  'SELL', 2.0, `Death Cross active (SMA50 < SMA200) with short & mid trend DOWN — bearish long-term structure confirmed`);
  if (ti.trendConsistency === 100)
    add(buy,  'FULL_TREND_ALIGNMENT', 'BUY',  1.2, 'All 3 trend timeframes aligned UP (short/mid/long) — strong directional consensus');
  if (ti.trendConsistency === 0)
    add(sell, 'FULL_TREND_BREAKDOWN', 'SELL', 1.2, 'All 3 trend timeframes aligned DOWN (short/mid/long) — strong bearish consensus');

  // ── 13. Ichimoku Cloud ─────────────────────────────────────────────────────
  if (ti.ichimokuSignal === 'above_cloud')
    add(buy,  'ICHIMOKU_ABOVE_CLOUD', 'BUY',  1.0, 'Price above Ichimoku cloud — long-term bullish, cloud acts as strong support below');
  if (ti.ichimokuSignal === 'below_cloud')
    add(sell, 'ICHIMOKU_BELOW_CLOUD', 'SELL', 1.0, 'Price below Ichimoku cloud — long-term bearish, cloud acts as resistance above');

  // ── 14. OBV ─── volume confirms price ────────────────────────────────────
  if (ti.obvTrend === 'accumulation')
    add(buy,  'OBV_ACCUMULATION',     'BUY',  1.0, 'OBV trending up — volume confirms buying pressure: institutional accumulation likely');
  if (ti.obvTrend === 'distribution')
    add(sell, 'OBV_DISTRIBUTION',     'SELL', 1.0, 'OBV trending down — volume confirms selling pressure: smart money distributing');
  if (ti.obvDivergence === 'bullish')
    add(buy,  'OBV_BULLISH_DIV',      'BUY',  1.5, 'Bullish OBV divergence: price lower but OBV higher — buying volume outpacing price drop');
  if (ti.obvDivergence === 'bearish')
    add(sell, 'OBV_BEARISH_DIV',      'SELL', 1.5, 'Bearish OBV divergence: price higher but OBV lower — selling volume outpacing price rise');

  // ── 15. Volume Spike ──────────────────────────────────────────────────────
  if (ti.volumeSignal === 'spike_up')
    add(buy,  'VOLUME_SPIKE_UP',      'BUY',  1.2, `Volume ${ti.volumeRatio.toFixed(1)}× average on an up day — strong conviction buying`);
  if (ti.volumeSignal === 'spike_down')
    add(sell, 'VOLUME_SPIKE_DOWN',    'SELL', 1.2, `Volume ${ti.volumeRatio.toFixed(1)}× average on a down day — strong conviction selling`);

  // ── 16. Chaikin Money Flow ────────────────────────────────────────────────
  if (ti.chaikinMoneyFlow > 0.15)
    add(buy,  'CMF_STRONG_INFLOW',    'BUY',  0.9, `CMF ${ti.chaikinMoneyFlow.toFixed(2)} — persistent buying pressure over past 20 sessions`);
  if (ti.chaikinMoneyFlow < -0.15)
    add(sell, 'CMF_STRONG_OUTFLOW',   'SELL', 0.9, `CMF ${ti.chaikinMoneyFlow.toFixed(2)} — persistent selling pressure over past 20 sessions`);

  // ── 17. VWAP ──────────────────────────────────────────────────────────────
  if (ti.priceVsVwapPct < -3)
    add(buy,  'PRICE_BELOW_VWAP',     'BUY',  0.7, `Price is ${Math.abs(ti.priceVsVwapPct).toFixed(1)}% below VWAP — below fair value (institutional buy zone)`);
  if (ti.priceVsVwapPct > 3)
    add(sell, 'PRICE_ABOVE_VWAP',     'SELL', 0.7, `Price is ${ti.priceVsVwapPct.toFixed(1)}% above VWAP — above fair value (profit-taking zone)`);

  // ── 18. 52-Week Context ───────────────────────────────────────────────────
  if (ti.priceVs52wHighPct < -30 && ti.trendShort === 'up')
    add(buy,  'DEEP_VALUE_RECOVERY',  'BUY',  0.8, `Price is ${Math.abs(ti.priceVs52wHighPct).toFixed(0)}% below 52w high but starting to recover — deep value with momentum`);
  if (ti.priceVs52wHighPct > -3)
    add(sell, 'NEAR_52W_HIGH',        'SELL', 0.6, `Price within 3% of 52-week high — resistance zone, consider taking partial profits`);
  if (ti.priceVs52wLowPct < 5)
    add(buy,  'NEAR_52W_LOW_BOUNCE',  'BUY',  0.8, `Price only ${ti.priceVs52wLowPct.toFixed(1)}% above 52w low — potential floor, high-risk high-reward zone`);

  // ── 19. Candlestick Patterns ──────────────────────────────────────────────
  if (BULLISH_CANDLES.has(ti.candlestickPattern))
    add(buy,  `CANDLE_${ti.candlestickPattern.toUpperCase()}`, 'BUY',  0.8,
      `${ti.candlestickPattern.replace(/_/g,' ')} pattern — bullish reversal candle at current level`);
  if (BEARISH_CANDLES.has(ti.candlestickPattern))
    add(sell, `CANDLE_${ti.candlestickPattern.toUpperCase()}`, 'SELL', 0.8,
      `${ti.candlestickPattern.replace(/_/g,' ')} pattern — bearish reversal candle at current level`);
  if (ti.candlestickPattern === 'doji' && ti.trendShort === 'down')
    add(buy,  'DOJI_IN_DOWNTREND',    'BUY',  0.5, 'Doji in downtrend — indecision candle: sellers losing momentum');

  // ── 20. Fibonacci Proximity ───────────────────────────────────────────────
  const curProxy = ti.sma20;
  if (Math.abs(curProxy - ti.fibRetracement618) / curProxy < 0.015)
    add(buy,  'FIB_618_SUPPORT',      'BUY',  0.7, `Price at 61.8% Fibonacci retracement (PKR ${ti.fibRetracement618.toFixed(2)}) — the "golden ratio" support`);
  if (Math.abs(curProxy - ti.fibRetracement382) / curProxy < 0.015)
    add(sell, 'FIB_382_RESISTANCE',   'SELL', 0.5, `Price at 38.2% Fibonacci level (PKR ${ti.fibRetracement382.toFixed(2)}) — potential resistance`);

  // ── Net conviction ────────────────────────────────────────────────────────
  const convictionScore =
    buy.reduce((s, x) => s + x.weight, 0) -
    sell.reduce((s, x) => s + x.weight, 0);

  let overallSignal: Signal;
  if      (convictionScore >= 6.0)  overallSignal = 'STRONG_BUY';
  else if (convictionScore >= 3.0)  overallSignal = 'BUY';
  else if (convictionScore <= -6.0) overallSignal = 'STRONG_SELL';
  else if (convictionScore <= -3.0) overallSignal = 'SELL';
  else                              overallSignal = 'HOLD';

  // Circuit breaker suppresses all BUY signals
  if (circuitBreakerActive && (overallSignal === 'BUY' || overallSignal === 'STRONG_BUY')) {
    overallSignal = 'HOLD';
    buy.push({ name: 'CIRCUIT_BREAKER', type: 'BUY', weight: 0,
      description: 'BUY signal paused — KSE-100 circuit breaker active (market down sharply today)' });
  }

  // Plain-English summary for both novice and pro
  const topBuySigs  = buy.filter(s => s.weight > 0).slice(0, 3).map(s => s.description);
  const topSellSigs = sell.slice(0, 3).map(s => s.description);

  let technicalSummary: string;
  if (overallSignal === 'HOLD') {
    technicalSummary = `Mixed signals — ${buy.length} bullish vs ${sell.length} bearish indicators active. Conviction score: ${convictionScore.toFixed(1)}. Wait for a clearer setup.`;
  } else if (overallSignal.includes('BUY')) {
    technicalSummary = topBuySigs[0] ?? 'Multiple bullish indicators aligned.';
    if (topBuySigs[1]) technicalSummary += ` Also: ${topBuySigs[1].split('—')[0].trim()}.`;
  } else {
    technicalSummary = topSellSigs[0] ?? 'Multiple bearish indicators aligned.';
    if (topSellSigs[1]) technicalSummary += ` Also: ${topSellSigs[1].split('—')[0].trim()}.`;
  }

  return { buySignals: buy, sellSignals: sell, convictionScore, overallSignal, technicalSummary };
}
