// ─────────────────────────────────────────────────────────────
//  SHARED TYPES
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
  pctB: number; // 0 = at lower, 100 = at upper
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
  distance: number;
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

/** EMA — full array output (null before period-1) */
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

/** SMA — single value for last n bars */
export function calcSMA(arr: number[], period: number): number | null {
  if (!arr || arr.length < period) return null;
  return round2(sma(arr, period)!);
}

// ─────────────────────────────────────────────────────────────
//  RSI  (Wilder smoothing)
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
  const ema12 = calcEMA(close, 12);
  const ema26 = calcEMA(close, 26);
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
      ? "BULLISH_CROSS"
      : lastMacd < lastSig && prevMacd >= prevSig
      ? "BEARISH_CROSS"
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
  const upper = mean + mult * sd;
  const lower = mean - mult * sd;
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
    const lo = Math.min(...sl.map((b) => b.low));
    const hi = Math.max(...sl.map((b) => b.high));
    rawK.push(hi === lo ? 50 : ((hist[i].close - lo) / (hi - lo)) * 100);
  }
  const smK: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const sl = rawK.slice(i - smoothK + 1, i + 1);
    smK.push(sl.reduce((s, v) => s + v, 0) / smoothK);
  }
  const smD: number[] = [];
  for (let i = smoothD - 1; i < smK.length; i++) {
    const sl = smK.slice(i - smoothD + 1, i + 1);
    smD.push(sl.reduce((s, v) => s + v, 0) / smoothD);
  }
  if (!smK.length || !smD.length) return EMPTY;
  const k = round2(smK.at(-1)!)!;
  const d = round2(smD.at(-1)!)!;
  const prevK = smK.at(-2);
  const prevD = smD.at(-2);
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
    const hi = hist[i].high,
      lo = hist[i].low,
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
    const { high: hi, low: lo } = hist[i];
    const { high: ph, low: pl, close: pc } = hist[i - 1];
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
  const di1p = sTR > 0 ? (sDMp / sTR) * 100 : 0;
  const di1m = sTR > 0 ? (sDMm / sTR) * 100 : 0;
  const s1 = di1p + di1m;
  if (s1 > 0) dx.push((Math.abs(di1p - di1m) / s1) * 100);
  for (let i = period; i < trArr.length; i++) {
    sTR = sTR - sTR / period + trArr[i];
    sDMp = sDMp - sDMp / period + dmP[i];
    sDMm = sDMm - sDMm / period + dmM[i];
    const dip = sTR > 0 ? (sDMp / sTR) * 100 : 0;
    const dim = sTR > 0 ? (sDMm / sTR) * 100 : 0;
    const sd = dip + dim;
    if (sd > 0) dx.push((Math.abs(dip - dim) / sd) * 100);
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
//  WILLIAMS %R
// ─────────────────────────────────────────────────────────────

export function calcWilliamsR(hist: OhlcvBar[], period = 14): number | null {
  if (!hist || hist.length < period) return null;
  const sl = hist.slice(-period);
  const hi = Math.max(...sl.map((b) => b.high));
  const lo = Math.min(...sl.map((b) => b.low));
  if (hi === lo) return -50;
  return round2(((hi - hist.at(-1)!.close) / (hi - lo)) * -100);
}

// ─────────────────────────────────────────────────────────────
//  CCI
// ─────────────────────────────────────────────────────────────

export function calcCCI(hist: OhlcvBar[], period = 20): number | null {
  if (!hist || hist.length < period) return null;
  const sl = hist.slice(-period);
  const tps = sl.map((b) => (b.high + b.low + b.close) / 3);
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
    if (hist[i].close > hist[i - 1].close) obv += hist[i].volume || 0;
    else if (hist[i].close < hist[i - 1].close) obv -= hist[i].volume || 0;
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
  const sl = hist.slice(-20);
  let num = 0,
    den = 0;
  for (const b of sl) {
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume || 1;
    num += tp * v;
    den += v;
  }
  return den > 0 ? round2(num / den) : null;
}

// ─────────────────────────────────────────────────────────────
//  ICHIMOKU CLOUD
// ─────────────────────────────────────────────────────────────

export function calcIchimoku(hist: OhlcvBar[]): IchimokuResult | null {
  if (!hist || hist.length < 52) return null;
  const mid = (bars: OhlcvBar[]) => {
    const hi = Math.max(...bars.map((b) => b.high));
    const lo = Math.min(...bars.map((b) => b.low));
    return (hi + lo) / 2;
  };
  const tenkan = round2(mid(hist.slice(-9)))!;
  const kijun = round2(mid(hist.slice(-26)))!;
  const senkouA = round2((tenkan + kijun) / 2)!;
  const senkouB = round2(mid(hist.slice(-52)))!;
  const price = hist.at(-1)!.close;
  const top = Math.max(senkouA, senkouB);
  const bottom = Math.min(senkouA, senkouB);
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
//  PIVOT POINTS  (previous day's H/L/C)
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
  const current = close.at(-1)!;
  const previous = close.at(-1 - period)!;
  if (!previous || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
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
    const mf = tp * (hist[i].volume || 0);
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
//  SUPERTREND  (10, 3) — most popular PSX retail indicator
// ─────────────────────────────────────────────────────────────

export function calcSuperTrend(
  hist: OhlcvBar[],
  period = 10,
  mult = 3
): SuperTrendResult | null {
  if (!hist || hist.length < period + 1) return null;
  // Build per-bar ATR array
  const atrArr: number[] = [];
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const { high: h, low: l } = hist[i];
    const pc = hist[i - 1].close;
    atr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  atr /= period;
  atrArr.push(atr);
  for (let i = period + 1; i < hist.length; i++) {
    const { high: h, low: l } = hist[i];
    const pc = hist[i - 1].close;
    atr =
      (atr * (period - 1) +
        Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))) /
      period;
    atrArr.push(atr);
  }
  let direction: 1 | -1 = 1;
  let superTrend = 0;
  let prevUpper = 0,
    prevLower = 0;
  for (let i = 0; i < atrArr.length; i++) {
    const idx = i + period;
    const hl2 = (hist[idx].high + hist[idx].low) / 2;
    const rawUp = hl2 + mult * atrArr[i];
    const rawLo = hl2 - mult * atrArr[i];
    const upper =
      rawUp < prevUpper || (hist[idx - 1]?.close ?? 0) > prevUpper
        ? rawUp
        : prevUpper;
    const lower =
      rawLo > prevLower || (hist[idx - 1]?.close ?? 0) < prevLower
        ? rawLo
        : prevLower;
    const close = hist[idx].close;
    if (direction === 1 && close < lower) direction = -1;
    else if (direction === -1 && close > upper) direction = 1;
    superTrend = direction === 1 ? lower : upper;
    prevUpper = upper;
    prevLower = lower;
  }
  const lastClose = hist.at(-1)!.close;
  const signal: "BUY" | "SELL" = direction === 1 ? "BUY" : "SELL";
  return {
    value: round2(superTrend)!,
    signal,
    direction,
    distance: round2(((lastClose - superTrend) / lastClose) * 100)!,
    isBull: direction === 1,
  };
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
  const priceRecent = close.at(-1)!;
  const pricePrev = Math.min(...close.slice(-20, -1));
  const rsiRecent = rsiSeries.at(-1)!;
  const rsiPrev = rsiSeries[rsiSeries.length - 20] ?? rsiSeries[0];
  if (priceRecent < pricePrev && rsiRecent > rsiPrev)
    return "BULLISH_DIVERGENCE";
  const priceHigh = Math.max(...close.slice(-20, -1));
  const rsiHigh = Math.max(...rsiSeries.slice(-20, -1));
  if (priceRecent > priceHigh && rsiRecent < rsiHigh)
    return "BEARISH_DIVERGENCE";
  return null;
}

// ─────────────────────────────────────────────────────────────
//  CANDLESTICK PATTERNS
// ─────────────────────────────────────────────────────────────

export function detectPatterns(hist: OhlcvBar[]): CandlePattern[] {
  if (!hist || hist.length < 3) return [];
  const patterns: CandlePattern[] = [];
  const c0 = hist.at(-1)!,
    c1 = hist.at(-2)!,
    c2 = hist.at(-3)!;
  const body0 = Math.abs(c0.close - c0.open);
  const range0 = c0.high - c0.low;
  if (range0 === 0) return patterns;
  const bRatio = body0 / range0;
  const upWick = c0.high - Math.max(c0.close, c0.open);
  const loWick = Math.min(c0.close, c0.open) - c0.low;
  const bull0 = c0.close > c0.open;
  const bull1 = c1.close > c1.open;

  if (bRatio < 0.08)
    patterns.push({
      name: "Doji",
      bias: "NEUTRAL",
      desc: "Indecision — watch next candle",
    });
  if (loWick > body0 * 2.5 && upWick < body0 * 0.3 && bull0)
    patterns.push({
      name: "Hammer",
      bias: "BULLISH",
      desc: "Buyers rejected lows — reversal",
    });
  if (upWick > body0 * 2.5 && loWick < body0 * 0.3 && bull0)
    patterns.push({
      name: "Inverted Hammer",
      bias: "BULLISH",
      desc: "Buying pressure at lows",
    });
  if (upWick > body0 * 2.5 && loWick < body0 * 0.3 && !bull0)
    patterns.push({
      name: "Shooting Star",
      bias: "BEARISH",
      desc: "Sellers rejected highs — reversal",
    });
  if (loWick > body0 * 2.5 && upWick < body0 * 0.3 && !bull0)
    patterns.push({
      name: "Hanging Man",
      bias: "BEARISH",
      desc: "Selling pressure at highs",
    });
  if (
    !bull1 &&
    bull0 &&
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
    bull1 &&
    !bull0 &&
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
    !bull1 &&
    bull0 &&
    Math.abs(c1.close - c1.open) < Math.abs(c2.close - c2.open) * 0.3
  )
    patterns.push({
      name: "Morning Star",
      bias: "BULLISH",
      desc: "3-candle bullish reversal",
    });
  if (
    bull1 &&
    !bull0 &&
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
  if (!hist || hist.length < 20) {
    return {
      current: 0,
      avg20: null,
      avg5: null,
      volRatio: null,
      volSpike: false,
      volTrend: "STABLE",
    };
  }
  const vols = hist.map((b) => b.volume || 0);
  const avg20 = round2(sma(vols, 20)!)!;
  const avg5 = round2(sma(vols, 5)!)!;
  const current = vols.at(-1)!;
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
  if (!hist || !close || hist.length === 0) {
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
  }
  const high6m = round2(Math.max(...hist.map((b) => b.high)))!;
  const low6m = round2(Math.min(...hist.map((b) => b.low)))!;
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
//  TREND CLASSIFICATION  (composite score)
// ─────────────────────────────────────────────────────────────

export function classifyTrend(
  price: number,
  ma5: number | null,
  ma20: number | null,
  ma50: number | null,
  macd: MacdResult,
  adx: AdxResult
): TrendLabel {
  let bullCount = 0,
    total = 0;
  if (ma20 != null) {
    total++;
    if (price > ma20) bullCount++;
  }
  if (ma50 != null) {
    total++;
    if (price > ma50) bullCount++;
  }
  if (ma5 != null && ma20 != null) {
    total++;
    if (ma5 > ma20) bullCount++;
  }
  if (ma20 != null && ma50 != null) {
    total++;
    if (ma20 > ma50) bullCount++;
  }
  if (macd.macd != null && macd.signal != null) {
    total++;
    if (macd.macd > macd.signal) bullCount++;
  }
  if (adx.diPlus != null && adx.diMinus != null) {
    total++;
    if (adx.diPlus > adx.diMinus) bullCount++;
  }
  if (total === 0) return "UNKNOWN";
  const ratio = bullCount / total;
  if (ratio >= 0.85) return "STRONG_BULL";
  if (ratio >= 0.6) return "BULL";
  if (ratio <= 0.15) return "STRONG_BEAR";
  if (ratio <= 0.4) return "BEAR";
  return "SIDEWAYS";
}

// ─────────────────────────────────────────────────────────────
//  ASCII SPARKLINE
// ─────────────────────────────────────────────────────────────

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function buildSparkline(values: number[], length = 20): string {
  if (!values || values.length === 0) return "";
  const sl = values.slice(-length);
  const lo = Math.min(...sl),
    hi = Math.max(...sl);
  const rng = hi - lo;
  if (rng === 0) return SPARK_CHARS[3].repeat(sl.length);
  return sl
    .map((v) => {
      const idx = Math.floor(((v - lo) / rng) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[Math.min(Math.max(idx, 0), SPARK_CHARS.length - 1)];
    })
    .join("");
}
