import type {
  OhlcvBar,
  MacdResult,
  BollingerResult,
  StochasticResult,
  AdxResult,
  ObvResult,
  VolumeMetrics,
  IchimokuResult,
  PivotResult,
  SuperTrendResult,
  CandlePattern,
  PerfStats,
  TrendLabel,
} from "./types";

// Re-export types so files that previously imported from here still compile
export type {
  OhlcvBar,
  MacdResult,
  BollingerResult,
  StochasticResult,
  AdxResult,
  ObvResult,
  VolumeMetrics,
  IchimokuResult,
  PivotResult,
  SuperTrendResult,
  CandlePattern,
  PerfStats,
  TrendLabel,
};

// ─────────────────────────────────────────────────────────────
//  MATH UTILITIES
// ─────────────────────────────────────────────────────────────

export function round2(n: number | null | undefined): number | null {
  if (n == null || isNaN(n) || !isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function calcPct(a: number, b: number): number | null {
  if (!b || b === 0) return null;
  return round2(((a - b) / b) * 100);
}

export function sma(arr: number[], n: number): number | null {
  const sl = arr.slice(-n);
  if (sl.length < n) return null;
  return sl.reduce((s, v) => s + v, 0) / n;
}

function stdDev(arr: number[]): number {
  if (!arr.length) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// ─────────────────────────────────────────────────────────────
//  MOVING AVERAGES
// ─────────────────────────────────────────────────────────────

export function calcEMA(arr: number[], period: number): (number | null)[] {
  if (!arr || arr.length < period) return [];
  const k = 2 / (period + 1);
  const seed = arr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out: (number | null)[] = new Array(period - 1).fill(null);
  out.push(seed);
  for (let i = period; i < arr.length; i++) {
    out.push(arr[i] * k + (out[i - 1] as number) * (1 - k));
  }
  return out;
}

export function calcSMA(arr: number[], period: number): number | null {
  if (!arr || arr.length < period) return null;
  return round2(sma(arr, period)!);
}

// ─────────────────────────────────────────────────────────────
//  RSI  (Wilder smoothing — industry standard)
// ─────────────────────────────────────────────────────────────

export function calcRSI(close: number[], period = 14): number | null {
  if (!close || close.length < period + 1) return null;
  const gains: number[] = [],
    losses: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let ag = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
  }
  if (al === 0) return 100;
  return round2(100 - 100 / (1 + ag / al));
}

// ─────────────────────────────────────────────────────────────
//  MACD  (12-26-9)
// ─────────────────────────────────────────────────────────────

export function calcMACD(close: number[]): MacdResult {
  const EMPTY: MacdResult = {
    macd: null,
    signal: null,
    histogram: null,
    prevHistogram: null,
    crossover: null,
    histTrend: null,
  };
  if (!close || close.length < 35) return EMPTY;
  const ema12 = calcEMA(close, 12),
    ema26 = calcEMA(close, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (ema12[i] != null && ema26[i] != null)
      macdLine.push(ema12[i]! - ema26[i]!);
  }
  if (macdLine.length < 9) return EMPTY;
  const signalArr = calcEMA(macdLine, 9);
  const lastMacd = macdLine.at(-1)!;
  const prevMacd = macdLine.at(-2)!;
  const lastSig = signalArr.at(-1) as number;
  const prevSig = (signalArr.at(-2) as number) ?? lastSig;
  const lastHist = lastMacd - lastSig;
  const prevHist = prevMacd - prevSig;
  const crossover =
    lastMacd > lastSig && prevMacd <= prevSig
      ? ("BULLISH_CROSS" as const)
      : lastMacd < lastSig && prevMacd >= prevSig
      ? ("BEARISH_CROSS" as const)
      : null;
  return {
    macd: round2(lastMacd),
    signal: round2(lastSig),
    histogram: round2(lastHist),
    prevHistogram: round2(prevHist),
    crossover,
    histTrend: lastHist > prevHist ? "EXPANDING" : "CONTRACTING",
  };
}

// ─────────────────────────────────────────────────────────────
//  BOLLINGER BANDS
// ─────────────────────────────────────────────────────────────

export function calcBollinger(
  close: number[],
  period = 20,
  mult = 2
): BollingerResult | null {
  if (!close || close.length < period) return null;
  const sl = close.slice(-period);
  const mean = sl.reduce((s, v) => s + v, 0) / period;
  const sd = stdDev(sl);
  const upper = mean + mult * sd,
    lower = mean - mult * sd;
  const price = close.at(-1)!;
  const bw = mean > 0 ? ((upper - lower) / mean) * 100 : 0;
  const pctB =
    upper - lower > 0 ? ((price - lower) / (upper - lower)) * 100 : 50;
  return {
    upper: round2(upper)!,
    lower: round2(lower)!,
    mid: round2(mean)!,
    bandwidth: round2(bw)!,
    pctB: round2(pctB)!,
    squeeze: bw < 4,
  };
}

// ─────────────────────────────────────────────────────────────
//  STOCHASTIC  (correct SMA-of-SMA %D)
// ─────────────────────────────────────────────────────────────

export function calcStochastic(
  hist: OhlcvBar[],
  kPeriod = 14,
  smoothK = 3,
  smoothD = 3
): StochasticResult {
  const EMPTY: StochasticResult = {
    k: null,
    d: null,
    zone: null,
    kCrossD: null,
  };
  if (!hist || hist.length < kPeriod + smoothK + smoothD - 2) return EMPTY;
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < hist.length; i++) {
    const sl = hist.slice(i - kPeriod + 1, i + 1);
    const lo = Math.min(...sl.map((b) => b.low)),
      hi = Math.max(...sl.map((b) => b.high));
    rawK.push(hi === lo ? 50 : ((hist[i].close - lo) / (hi - lo)) * 100);
  }
  const smK: number[] = [],
    smD: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const sl = rawK.slice(i - smoothK + 1, i + 1);
    smK.push(sl.reduce((s, v) => s + v, 0) / smoothK);
  }
  for (let i = smoothD - 1; i < smK.length; i++) {
    const sl = smK.slice(i - smoothD + 1, i + 1);
    smD.push(sl.reduce((s, v) => s + v, 0) / smoothD);
  }
  if (!smK.length || !smD.length) return EMPTY;
  const k = round2(smK.at(-1)!)!,
    d = round2(smD.at(-1)!)!;
  const prevK = smK.at(-2),
    prevD = smD.at(-2);
  const zone: StochasticResult["zone"] =
    k < 20 ? "OVERSOLD" : k > 80 ? "OVERBOUGHT" : "NEUTRAL";
  const kCrossD: StochasticResult["kCrossD"] =
    prevK != null && prevD != null
      ? k > d && prevK <= prevD
        ? "BULLISH"
        : k < d && prevK >= prevD
        ? "BEARISH"
        : null
      : null;
  return { k, d, zone, kCrossD };
}

// ─────────────────────────────────────────────────────────────
//  ATR  (Wilder smoothed)
// ─────────────────────────────────────────────────────────────

export function calcATR(hist: OhlcvBar[], period = 14): number | null {
  if (!hist || hist.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const { high: hi, low: lo } = hist[i],
      pc = hist[i - 1].close;
    trs.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++)
    atr = (atr * (period - 1) + trs[i]) / period;
  return round2(atr);
}

// ─────────────────────────────────────────────────────────────
//  ADX  (Wilder smoothed — correct implementation)
// ─────────────────────────────────────────────────────────────

export function calcADX(hist: OhlcvBar[], period = 14): AdxResult {
  const EMPTY: AdxResult = {
    adx: null,
    diPlus: null,
    diMinus: null,
    strength: null,
  };
  if (!hist || hist.length < period * 2 + 1) return EMPTY;
  const trArr: number[] = [],
    dmP: number[] = [],
    dmM: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const { high: hi, low: lo } = hist[i],
      { high: ph, low: pl, close: pc } = hist[i - 1];
    trArr.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
    const up = hi - ph,
      dn = pl - lo;
    dmP.push(up > dn && up > 0 ? up : 0);
    dmM.push(dn > up && dn > 0 ? dn : 0);
  }
  let sTR = trArr.slice(0, period).reduce((s, v) => s + v, 0);
  let sDMp = dmP.slice(0, period).reduce((s, v) => s + v, 0);
  let sDMm = dmM.slice(0, period).reduce((s, v) => s + v, 0);
  const dx: number[] = [];
  const di1p = sTR > 0 ? (sDMp / sTR) * 100 : 0,
    di1m = sTR > 0 ? (sDMm / sTR) * 100 : 0;
  if (di1p + di1m > 0) dx.push((Math.abs(di1p - di1m) / (di1p + di1m)) * 100);
  for (let i = period; i < trArr.length; i++) {
    sTR = sTR - sTR / period + trArr[i];
    sDMp = sDMp - sDMp / period + dmP[i];
    sDMm = sDMm - sDMm / period + dmM[i];
    const dip = sTR > 0 ? (sDMp / sTR) * 100 : 0,
      dim = sTR > 0 ? (sDMm / sTR) * 100 : 0;
    if (dip + dim > 0) dx.push((Math.abs(dip - dim) / (dip + dim)) * 100);
  }
  if (dx.length < period) return EMPTY;
  let adxVal = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dx.length; i++)
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
  const lastDiP = sTR > 0 ? round2((sDMp / sTR) * 100)! : 0;
  const lastDiM = sTR > 0 ? round2((sDMm / sTR) * 100)! : 0;
  const adx = round2(adxVal)!;
  const strength: AdxResult["strength"] =
    adx >= 40
      ? "VERY_STRONG"
      : adx >= 25
      ? lastDiP > lastDiM
        ? "STRONG_BULL"
        : "STRONG_BEAR"
      : adx >= 15
      ? lastDiP > lastDiM
        ? "WEAK_BULL"
        : "WEAK_BEAR"
      : "RANGING";
  return { adx, diPlus: lastDiP, diMinus: lastDiM, strength };
}

// ─────────────────────────────────────────────────────────────
//  WILLIAMS %R, CCI
// ─────────────────────────────────────────────────────────────

export function calcWilliamsR(hist: OhlcvBar[], period = 14): number | null {
  if (!hist || hist.length < period) return null;
  const sl = hist.slice(-period);
  const hi = Math.max(...sl.map((b) => b.high)),
    lo = Math.min(...sl.map((b) => b.low));
  if (hi === lo) return -50;
  return round2(((hi - hist.at(-1)!.close) / (hi - lo)) * -100);
}

export function calcCCI(hist: OhlcvBar[], period = 20): number | null {
  if (!hist || hist.length < period) return null;
  const tps = hist.slice(-period).map((b) => (b.high + b.low + b.close) / 3);
  const mean = tps.reduce((s, v) => s + v, 0) / period;
  const md = tps.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
  return md > 0 ? round2((tps.at(-1)! - mean) / (0.015 * md)) : null;
}

// ─────────────────────────────────────────────────────────────
//  OBV
// ─────────────────────────────────────────────────────────────

export function calcOBV(hist: OhlcvBar[]): ObvResult {
  if (!hist || hist.length < 10)
    return { value: 0, trend: "NEUTRAL", slopeScore: 0 };
  let obv = 0;
  const series: number[] = [0];
  for (let i = 1; i < hist.length; i++) {
    if (hist[i].close > hist[i - 1].close) obv += hist[i].volume;
    else if (hist[i].close < hist[i - 1].close) obv -= hist[i].volume;
    series.push(obv);
  }
  const recent = series.slice(-5),
    prior = series.slice(-10, -5);
  const avgR = recent.reduce((s, v) => s + v, 0) / 5;
  const avgP = prior.reduce((s, v) => s + v, 0) / 5;
  const slopeScore =
    avgP !== 0 ? round2(((avgR - avgP) / Math.abs(avgP)) * 100)! : 0;
  const trend: ObvResult["trend"] =
    avgR > avgP * 1.02
      ? "ACCUMULATION"
      : avgR < avgP * 0.98
      ? "DISTRIBUTION"
      : "NEUTRAL";
  return { value: series.at(-1)!, trend, slopeScore };
}

// ─────────────────────────────────────────────────────────────
//  VWAP  (20-day rolling)
// ─────────────────────────────────────────────────────────────

export function calcVWAP(hist: OhlcvBar[]): number | null {
  if (!hist || hist.length < 5) return null;
  let num = 0,
    den = 0;
  for (const b of hist.slice(-20)) {
    const tp = (b.high + b.low + b.close) / 3,
      v = b.volume || 1;
    num += tp * v;
    den += v;
  }
  return den > 0 ? round2(num / den) : null;
}

/** VWAP deviation % — how far price is from VWAP */
export function calcVwapDevPct(
  price: number,
  vwap: number | null
): number | null {
  if (vwap == null || vwap === 0) return null;
  return round2(((price - vwap) / vwap) * 100);
}

// ─────────────────────────────────────────────────────────────
//  ICHIMOKU CLOUD
// ─────────────────────────────────────────────────────────────

export function calcIchimoku(hist: OhlcvBar[]): IchimokuResult | null {
  if (!hist || hist.length < 52) return null;
  const mid = (bars: OhlcvBar[]) =>
    (Math.max(...bars.map((b) => b.high)) +
      Math.min(...bars.map((b) => b.low))) /
    2;
  const tenkan = round2(mid(hist.slice(-9)))!,
    kijun = round2(mid(hist.slice(-26)))!;
  const senkouA = round2((tenkan + kijun) / 2)!,
    senkouB = round2(mid(hist.slice(-52)))!;
  const price = hist.at(-1)!.close;
  const top = Math.max(senkouA, senkouB),
    bottom = Math.min(senkouA, senkouB);
  const position: IchimokuResult["position"] =
    price > top ? "ABOVE_CLOUD" : price < bottom ? "BELOW_CLOUD" : "IN_CLOUD";
  const chikouBullish =
    hist.length >= 27 ? hist.at(-1)!.close > hist.at(-27)!.close : null;
  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    position,
    tkBullish: tenkan > kijun,
    cloudColor: senkouA >= senkouB ? "GREEN" : "RED",
    chikouBullish,
    distanceToCloud: round2(price > top ? price - top : bottom - price)!,
  };
}

// ─────────────────────────────────────────────────────────────
//  PIVOT POINTS  (uses previous day's H/L/C — correct formula)
// ─────────────────────────────────────────────────────────────

export function calcPivots(hist: OhlcvBar[]): PivotResult | null {
  if (!hist || hist.length < 2) return null;
  const { high: hi, low: lo, close: cl } = hist.at(-2)!;
  const p = (hi + lo + cl) / 3;
  return {
    r3: round2(hi + 2 * (p - lo))!,
    r2: round2(p + (hi - lo))!,
    r1: round2(2 * p - lo)!,
    pivot: round2(p)!,
    s1: round2(2 * p - hi)!,
    s2: round2(p - (hi - lo))!,
    s3: round2(lo - 2 * (hi - p))!,
  };
}

// ─────────────────────────────────────────────────────────────
//  ROC  (Rate of Change)
// ─────────────────────────────────────────────────────────────

export function calcROC(close: number[], period = 12): number | null {
  if (!close || close.length < period + 1) return null;
  const prev = close.at(-1 - period);
  if (!prev || prev === 0) return null;
  return round2(((close.at(-1)! - prev) / prev) * 100);
}

// ─────────────────────────────────────────────────────────────
//  MFI  (Money Flow Index — volume-weighted RSI)
// ─────────────────────────────────────────────────────────────

export function calcMFI(hist: OhlcvBar[], period = 14): number | null {
  if (!hist || hist.length < period + 1) return null;
  const mfPos: number[] = [],
    mfNeg: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const tp = (hist[i].high + hist[i].low + hist[i].close) / 3;
    const prevTp = (hist[i - 1].high + hist[i - 1].low + hist[i - 1].close) / 3;
    const mf = tp * hist[i].volume;
    if (tp > prevTp) {
      mfPos.push(mf);
      mfNeg.push(0);
    } else {
      mfNeg.push(mf);
      mfPos.push(0);
    }
  }
  const posSum = mfPos.slice(-period).reduce((s, v) => s + v, 0);
  const negSum = mfNeg.slice(-period).reduce((s, v) => s + v, 0);
  if (negSum === 0) return 100;
  return round2(100 - 100 / (1 + posSum / negSum));
}

// ─────────────────────────────────────────────────────────────
//  SUPERTREND  (period=10, mult=3)
// ─────────────────────────────────────────────────────────────

export function calcSuperTrend(
  hist: OhlcvBar[],
  period = 10,
  mult = 3
): SuperTrendResult | null {
  if (!hist || hist.length < period + 1) return null;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const { high: h, low: l } = hist[i],
      pc = hist[i - 1].close;
    atr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  atr /= period;
  const atrArr = [atr];
  for (let i = period + 1; i < hist.length; i++) {
    const { high: h, low: l } = hist[i],
      pc = hist[i - 1].close;
    atr =
      (atr * (period - 1) +
        Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))) /
      period;
    atrArr.push(atr);
  }
  let dir: 1 | -1 = 1,
    st = 0,
    prevUp = 0,
    prevLo = 0;
  for (let i = 0; i < atrArr.length; i++) {
    const idx = i + period;
    const hl2 = (hist[idx].high + hist[idx].low) / 2;
    const rawUp = hl2 + mult * atrArr[i],
      rawLo = hl2 - mult * atrArr[i];
    const upper =
      rawUp < prevUp || (hist[idx - 1]?.close ?? 0) > prevUp ? rawUp : prevUp;
    const lower =
      rawLo > prevLo || (hist[idx - 1]?.close ?? 0) < prevLo ? rawLo : prevLo;
    const close = hist[idx].close;
    if (dir === 1 && close < lower) dir = -1;
    else if (dir === -1 && close > upper) dir = 1;
    st = dir === 1 ? lower : upper;
    prevUp = upper;
    prevLo = lower;
  }
  const lastClose = hist.at(-1)!.close;
  return {
    value: round2(st)!,
    signal: dir === 1 ? "BUY" : "SELL",
    direction: dir,
    distance: round2(((lastClose - st) / lastClose) * 100)!,
    isBull: dir === 1,
  };
}

// ─────────────────────────────────────────────────────────────
//  MARKET REGIME  (new — tells algo whether to trust trend signals)
//  Uses ADX + Bollinger bandwidth to classify the regime.
// ─────────────────────────────────────────────────────────────

export type MarketRegime =
  | "TRENDING_BULL"
  | "TRENDING_BEAR"
  | "RANGING"
  | "BREAKOUT"
  | "BREAKDOWN";

export function classifyMarketRegime(
  adx: AdxResult,
  bb: BollingerResult | null,
  macd: MacdResult
): MarketRegime {
  const adxVal = adx.adx ?? 0;
  const bw = bb?.bandwidth ?? 10;
  const squeez = bb?.squeeze ?? false;

  if (
    squeez &&
    macd.histogram != null &&
    macd.histogram > 0 &&
    macd.histTrend === "EXPANDING"
  )
    return "BREAKOUT";
  if (
    squeez &&
    macd.histogram != null &&
    macd.histogram < 0 &&
    macd.histTrend === "EXPANDING"
  )
    return "BREAKDOWN";
  if (
    adxVal >= 25 &&
    (adx.strength === "STRONG_BULL" || adx.strength === "WEAK_BULL")
  )
    return "TRENDING_BULL";
  if (
    adxVal >= 25 &&
    (adx.strength === "STRONG_BEAR" || adx.strength === "WEAK_BEAR")
  )
    return "TRENDING_BEAR";
  return "RANGING";
}

// ─────────────────────────────────────────────────────────────
//  RSI DIVERGENCE
// ─────────────────────────────────────────────────────────────

export function detectDivergence(
  close: number[],
  rsiSeries: number[]
): "BULLISH_DIVERGENCE" | "BEARISH_DIVERGENCE" | null {
  if (!close || close.length < 20 || !rsiSeries || rsiSeries.length < 20)
    return null;
  const priceRecent = close.at(-1)!,
    pricePrev = Math.min(...close.slice(-20, -1));
  const rsiRecent = rsiSeries.at(-1)!,
    rsiPrev = rsiSeries[rsiSeries.length - 20] ?? rsiSeries[0];
  if (priceRecent < pricePrev && rsiRecent > rsiPrev)
    return "BULLISH_DIVERGENCE";
  const priceHigh = Math.max(...close.slice(-20, -1)),
    rsiHigh = Math.max(...rsiSeries.slice(-20, -1));
  if (priceRecent > priceHigh && rsiRecent < rsiHigh)
    return "BEARISH_DIVERGENCE";
  return null;
}

// ─────────────────────────────────────────────────────────────
//  CANDLESTICK PATTERNS
// ─────────────────────────────────────────────────────────────

export function detectPatterns(hist: OhlcvBar[]): CandlePattern[] {
  if (!hist || hist.length < 3) return [];
  const c0 = hist.at(-1)!,
    c1 = hist.at(-2)!,
    c2 = hist.at(-3)!;
  const body0 = Math.abs(c0.close - c0.open),
    range0 = c0.high - c0.low;
  if (range0 === 0) return [];
  const bR = body0 / range0,
    upW = c0.high - Math.max(c0.close, c0.open),
    loW = Math.min(c0.close, c0.open) - c0.low;
  const b0 = c0.close > c0.open,
    b1 = c1.close > c1.open;
  const patterns: CandlePattern[] = [];
  if (bR < 0.08)
    patterns.push({
      name: "Doji",
      bias: "NEUTRAL",
      desc: "Indecision — watch next candle",
    });
  if (loW > body0 * 2.5 && upW < body0 * 0.3 && b0)
    patterns.push({
      name: "Hammer",
      bias: "BULLISH",
      desc: "Buyers rejected lows — reversal",
    });
  if (upW > body0 * 2.5 && loW < body0 * 0.3 && !b0)
    patterns.push({
      name: "Shooting Star",
      bias: "BEARISH",
      desc: "Sellers rejected highs — reversal",
    });
  if (
    !b1 &&
    b0 &&
    c0.open <= c1.close &&
    c0.close >= c1.open &&
    body0 > Math.abs(c1.close - c1.open)
  )
    patterns.push({
      name: "Bullish Engulfing",
      bias: "BULLISH",
      desc: "Strong reversal signal",
    });
  if (
    b1 &&
    !b0 &&
    c0.open >= c1.close &&
    c0.close <= c1.open &&
    body0 > Math.abs(c1.close - c1.open)
  )
    patterns.push({
      name: "Bearish Engulfing",
      bias: "BEARISH",
      desc: "Strong reversal signal",
    });
  if (
    !b1 &&
    b0 &&
    Math.abs(c1.close - c1.open) < Math.abs(c2.close - c2.open) * 0.3
  )
    patterns.push({
      name: "Morning Star",
      bias: "BULLISH",
      desc: "3-candle bullish reversal",
    });
  if (
    b1 &&
    !b0 &&
    Math.abs(c1.close - c1.open) < Math.abs(c2.close - c2.open) * 0.3
  )
    patterns.push({
      name: "Evening Star",
      bias: "BEARISH",
      desc: "3-candle bearish reversal",
    });
  if (
    c2.close > c2.open &&
    c1.close > c1.open &&
    c0.close > c0.open &&
    c0.close > c1.close &&
    c1.close > c2.close
  )
    patterns.push({
      name: "Three White Soldiers",
      bias: "BULLISH",
      desc: "Strong uptrend confirmation",
    });
  if (
    c2.close < c2.open &&
    c1.close < c1.open &&
    c0.close < c0.open &&
    c0.close < c1.close &&
    c1.close < c2.close
  )
    patterns.push({
      name: "Three Black Crows",
      bias: "BEARISH",
      desc: "Strong downtrend confirmation",
    });
  return patterns;
}

// ─────────────────────────────────────────────────────────────
//  VOLUME METRICS
// ─────────────────────────────────────────────────────────────

export function calcVolumeMetrics(hist: OhlcvBar[]): VolumeMetrics {
  if (!hist || hist.length < 20)
    return {
      current: 0,
      avg20: null,
      avg5: null,
      volRatio: null,
      volSpike: false,
      volTrend: "STABLE",
    };
  const vols = hist.map((b) => b.volume);
  const avg20 = round2(sma(vols, 20)!)!,
    avg5 = round2(sma(vols, 5)!)!,
    current = vols.at(-1)!;
  const volRatio = avg20 > 0 ? round2(current / avg20) : null;
  const volTrend: VolumeMetrics["volTrend"] =
    avg5 > avg20 * 1.2
      ? "INCREASING"
      : avg5 < avg20 * 0.8
      ? "DECREASING"
      : "STABLE";
  return {
    current,
    avg20,
    avg5,
    volRatio,
    volSpike: volRatio != null && volRatio > 1.5,
    volTrend,
  };
}

// ─────────────────────────────────────────────────────────────
//  PERFORMANCE STATS
// ─────────────────────────────────────────────────────────────

export function calcPerfStats(hist: OhlcvBar[], close: number[]): PerfStats {
  if (!hist || !close || hist.length === 0)
    return {
      high6m: 0,
      low6m: 0,
      pctFrom6mHigh: null,
      pctFrom6mLow: null,
      perf6m: null,
      perf1m: null,
      perf1w: null,
      perf1d: null,
      maxDrawdown: 0,
    };
  const high6m = round2(Math.max(...hist.map((b) => b.high)))!,
    low6m = round2(Math.min(...hist.map((b) => b.low)))!;
  let peak = close[0],
    maxDD = 0;
  for (const c of close) {
    if (c > peak) peak = c;
    const dd = peak > 0 ? ((peak - c) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const last = close.at(-1)!;
  return {
    high6m,
    low6m,
    pctFrom6mHigh: calcPct(last, high6m),
    pctFrom6mLow: calcPct(last, low6m),
    perf6m: calcPct(last, close[0]),
    perf1m: calcPct(last, close.length >= 22 ? close.at(-22)! : close[0]),
    perf1w: calcPct(last, close.length >= 5 ? close.at(-5)! : close[0]),
    perf1d: calcPct(last, close.length >= 2 ? close.at(-2)! : close[0]),
    maxDrawdown: round2(maxDD)!,
  };
}

// ─────────────────────────────────────────────────────────────
//  TREND CLASSIFICATION  (composite)
// ─────────────────────────────────────────────────────────────

export function classifyTrend(
  price: number,
  ma5: number | null,
  ma20: number | null,
  ma50: number | null,
  macd: MacdResult,
  adx: AdxResult
): TrendLabel {
  let bull = 0,
    total = 0;
  if (ma20 != null) {
    total++;
    if (price > ma20) bull++;
  }
  if (ma50 != null) {
    total++;
    if (price > ma50) bull++;
  }
  if (ma5 != null && ma20 != null) {
    total++;
    if (ma5 > ma20) bull++;
  }
  if (ma20 != null && ma50 != null) {
    total++;
    if (ma20 > ma50) bull++;
  }
  if (macd.macd != null && macd.signal != null) {
    total++;
    if (macd.macd > macd.signal) bull++;
  }
  if (adx.diPlus != null && adx.diMinus != null) {
    total++;
    if (adx.diPlus > adx.diMinus) bull++;
  }
  if (total === 0) return "UNKNOWN";
  const r = bull / total;
  return r >= 0.85
    ? "STRONG_BULL"
    : r >= 0.6
    ? "BULL"
    : r <= 0.15
    ? "STRONG_BEAR"
    : r <= 0.4
    ? "BEAR"
    : "SIDEWAYS";
}

// ─────────────────────────────────────────────────────────────
//  ASCII SPARKLINE
// ─────────────────────────────────────────────────────────────

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function buildSparkline(values: number[], length = 20): string {
  if (!values || values.length === 0) return "";
  const sl = values.slice(-length),
    lo = Math.min(...sl),
    hi = Math.max(...sl),
    rng = hi - lo;
  if (rng === 0) return SPARK_CHARS[3].repeat(sl.length);
  return sl
    .map(
      (v) =>
        SPARK_CHARS[
          Math.min(
            Math.max(
              Math.floor(((v - lo) / rng) * (SPARK_CHARS.length - 1)),
              0
            ),
            SPARK_CHARS.length - 1
          )
        ]
    )
    .join("");
}
