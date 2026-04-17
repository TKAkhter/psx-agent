"use strict";
const { round2, calcPct } = require("./indicators");
const { SIGNAL_THRESHOLDS, RSI_LEVELS } = require("./config");

// ─────────────────────────────────────────────────────────────
//  SCORE WEIGHTS  (tuned for PSX — emerging market, less liquid)
// ─────────────────────────────────────────────────────────────
const WEIGHTS = Object.freeze({
    RSI_EXTREME: 4,   // RSI < 20 or > 80
    RSI_DEEP: 3,   // RSI < 25 or > 75
    RSI_NORMAL: 2,   // RSI < 35 or > 65
    RSI_MILD: 1,   // RSI < 45 or > 55
    STOCH_EXTREME: 3,
    STOCH_NORMAL: 2,
    STOCH_CROSS: 1,
    MACD_CROSSOVER: 3,   // fresh crossover — highest signal
    MACD_HISTOGRAM: 2,   // expanding histogram
    MACD_WEAK: 1,
    BB_EXTREME: 4,   // outside bands
    BB_NEAR: 2,
    ADX_STRONG: 2,
    ADX_WEAK: 1,
    WILLIAMS_EXTREME: 2,
    WILLIAMS_NORMAL: 1,
    CCI_EXTREME: 2,
    CCI_NORMAL: 1,
    MA_CROSS: 1,   // each MA relationship
    VWAP: 2,
    OBV: 2,   // institutional flow
    ICHI_CLOUD: 2,
    ICHI_TK: 1,
    VOLUME_CONFIRM: 1,   // volume spike confirming direction
    PIVOT_LEVEL: 1,
    POSITION_6M: 1,
    PATTERN_MAJOR: 2,   // engulfing, soldiers, crows, stars
    PATTERN_MINOR: 1,   // doji, hammer, shooting star
    DIVERGENCE: 2,
});

// ─────────────────────────────────────────────────────────────
//  SIGNAL BUILDER
// ─────────────────────────────────────────────────────────────

function buildSignal(ticker, d) {
    const sym = ticker.replace(".KA", "");

    if (!d.price || d.error) {
        return { action: "SKIP", symbol: sym, error: d.error || "No price data" };
    }

    let score = 0;
    const bullReasons = [];   // bullish signals found
    const bearReasons = [];   // bearish signals found
    const neutralNotes = [];   // informational

    // ── RSI-14 ───────────────────────────────────────────────
    if (d.rsi14 != null) {
        if (d.rsi14 < RSI_LEVELS.EXTREME_OVERSOLD) { score += WEIGHTS.RSI_EXTREME; bullReasons.push(`RSI-14 ${d.rsi14} — extreme oversold (rare buy opportunity)`); }
        else if (d.rsi14 < RSI_LEVELS.DEEPLY_OVERSOLD) { score += WEIGHTS.RSI_DEEP; bullReasons.push(`RSI-14 ${d.rsi14} — deeply oversold`); }
        else if (d.rsi14 < RSI_LEVELS.OVERSOLD) { score += WEIGHTS.RSI_NORMAL; bullReasons.push(`RSI-14 ${d.rsi14} — oversold zone`); }
        else if (d.rsi14 < RSI_LEVELS.MILD_OVERSOLD) { score += WEIGHTS.RSI_MILD; bullReasons.push(`RSI-14 ${d.rsi14} — mildly oversold`); }
        else if (d.rsi14 > RSI_LEVELS.EXTREME_OVERBOUGHT) { score -= WEIGHTS.RSI_EXTREME; bearReasons.push(`RSI-14 ${d.rsi14} — extreme overbought`); }
        else if (d.rsi14 > RSI_LEVELS.DEEPLY_OVERBOUGHT) { score -= WEIGHTS.RSI_DEEP; bearReasons.push(`RSI-14 ${d.rsi14} — deeply overbought`); }
        else if (d.rsi14 > RSI_LEVELS.OVERBOUGHT) { score -= WEIGHTS.RSI_NORMAL; bearReasons.push(`RSI-14 ${d.rsi14} — overbought zone`); }
        else if (d.rsi14 > RSI_LEVELS.MILD_OVERBOUGHT) { score -= WEIGHTS.RSI_MILD; bearReasons.push(`RSI-14 ${d.rsi14} — mildly overbought`); }
        else neutralNotes.push(`RSI-14 ${d.rsi14} — neutral (45–55)`);
    }

    // ── RSI-9 confirmation (only adds if RSI-14 already trending same way) ──
    if (d.rsi9 != null && d.rsi14 != null) {
        if (d.rsi9 < 30 && d.rsi14 < 40) { score += 1; bullReasons.push(`RSI-9 ${d.rsi9} confirms oversold momentum`); }
        else if (d.rsi9 > 70 && d.rsi14 > 60) { score -= 1; bearReasons.push(`RSI-9 ${d.rsi9} confirms overbought momentum`); }
    }

    // ── Stochastic ────────────────────────────────────────────
    if (d.stoch?.k != null) {
        const { k, d: dLine, zone, kCrossD } = d.stoch;
        if (k < 15 && dLine < 15) { score += WEIGHTS.STOCH_EXTREME; bullReasons.push(`Stoch %K ${k} / %D ${dLine} — extreme oversold`); }
        else if (k < 20 && dLine < 20) { score += WEIGHTS.STOCH_NORMAL; bullReasons.push(`Stoch %K ${k} / %D ${dLine} — oversold`); }
        else if (k > 85 && dLine > 85) { score -= WEIGHTS.STOCH_EXTREME; bearReasons.push(`Stoch %K ${k} / %D ${dLine} — extreme overbought`); }
        else if (k > 80 && dLine > 80) { score -= WEIGHTS.STOCH_NORMAL; bearReasons.push(`Stoch %K ${k} / %D ${dLine} — overbought`); }

        // %K / %D cross (independent of zone)
        if (kCrossD === "BULLISH" && k < 50) { score += WEIGHTS.STOCH_CROSS; bullReasons.push(`Stoch bullish cross: K(${k}) crossed above D(${dLine}) from low`); }
        else if (kCrossD === "BEARISH" && k > 50) { score -= WEIGHTS.STOCH_CROSS; bearReasons.push(`Stoch bearish cross: K(${k}) crossed below D(${dLine}) from high`); }
    }

    // ── MACD ─────────────────────────────────────────────────
    if (d.macd?.macd != null) {
        if (d.macd.crossover === "BULLISH_CROSS") { score += WEIGHTS.MACD_CROSSOVER; bullReasons.push(`MACD bullish crossover ⚡ — strong momentum shift`); }
        else if (d.macd.crossover === "BEARISH_CROSS") { score -= WEIGHTS.MACD_CROSSOVER; bearReasons.push(`MACD bearish crossover ⚡ — strong momentum shift`); }
        else if (d.macd.histogram > 0 && d.macd.histTrend === "EXPANDING") { score += WEIGHTS.MACD_HISTOGRAM; bullReasons.push(`MACD histogram expanding (+${d.macd.histogram}) — accelerating bullish momentum`); }
        else if (d.macd.histogram < 0 && d.macd.histTrend === "EXPANDING") { score -= WEIGHTS.MACD_HISTOGRAM; bearReasons.push(`MACD histogram expanding (${d.macd.histogram}) — accelerating bearish momentum`); }
        else if (d.macd.histogram > 0) { score += WEIGHTS.MACD_WEAK; bullReasons.push(`MACD histogram positive (${d.macd.histogram})`); }
        else if (d.macd.histogram < 0) { score -= WEIGHTS.MACD_WEAK; bearReasons.push(`MACD histogram negative (${d.macd.histogram})`); }
    }

    // ── Bollinger Bands ───────────────────────────────────────
    if (d.bb?.pctB != null) {
        const { pctB, bandwidth, squeeze } = d.bb;
        if (pctB < 0) { score += WEIGHTS.BB_EXTREME; bullReasons.push(`BB %B ${round2(pctB)} — price broke below lower band (extreme)`); }
        else if (pctB < 10) { score += WEIGHTS.BB_NEAR + 1; bullReasons.push(`BB %B ${round2(pctB)} — hugging lower Bollinger band`); }
        else if (pctB < 25) { score += WEIGHTS.BB_NEAR; bullReasons.push(`BB %B ${round2(pctB)} — near lower Bollinger band`); }
        else if (pctB > 100) { score -= WEIGHTS.BB_EXTREME; bearReasons.push(`BB %B ${round2(pctB)} — price broke above upper band (extreme)`); }
        else if (pctB > 90) { score -= WEIGHTS.BB_NEAR + 1; bearReasons.push(`BB %B ${round2(pctB)} — hugging upper Bollinger band`); }
        else if (pctB > 75) { score -= WEIGHTS.BB_NEAR; bearReasons.push(`BB %B ${round2(pctB)} — near upper Bollinger band`); }

        if (squeeze) neutralNotes.push(`BB squeeze (bandwidth ${d.bb.bandwidth}%) — volatility compression, breakout approaching`);
    }

    // ── ADX (Trend Strength) ──────────────────────────────────
    if (d.adx?.adx != null) {
        const { adx: adxVal, diPlus, diMinus, strength } = d.adx;
        if (strength === "STRONG_BULL") { score += WEIGHTS.ADX_STRONG; bullReasons.push(`ADX ${adxVal} — strong bull trend (DI+ ${diPlus} > DI- ${diMinus})`); }
        else if (strength === "WEAK_BULL") { score += WEIGHTS.ADX_WEAK; bullReasons.push(`ADX ${adxVal} — weak bull trend (DI+ ${diPlus} > DI- ${diMinus})`); }
        else if (strength === "STRONG_BEAR") { score -= WEIGHTS.ADX_STRONG; bearReasons.push(`ADX ${adxVal} — strong bear trend (DI- ${diMinus} > DI+ ${diPlus})`); }
        else if (strength === "WEAK_BEAR") { score -= WEIGHTS.ADX_WEAK; bearReasons.push(`ADX ${adxVal} — weak bear trend (DI- ${diMinus} > DI+ ${diPlus})`); }
        else if (strength === "RANGING") neutralNotes.push(`ADX ${adxVal} — ranging market, trend signals less reliable`);
    }

    // ── Williams %R ───────────────────────────────────────────
    if (d.willR != null) {
        if (d.willR < -90) { score += WEIGHTS.WILLIAMS_EXTREME; bullReasons.push(`Williams %R ${d.willR} — extremely oversold`); }
        else if (d.willR < -80) { score += WEIGHTS.WILLIAMS_NORMAL; bullReasons.push(`Williams %R ${d.willR} — oversold`); }
        else if (d.willR > -10) { score -= WEIGHTS.WILLIAMS_EXTREME; bearReasons.push(`Williams %R ${d.willR} — extremely overbought`); }
        else if (d.willR > -20) { score -= WEIGHTS.WILLIAMS_NORMAL; bearReasons.push(`Williams %R ${d.willR} — overbought`); }
    }

    // ── CCI ───────────────────────────────────────────────────
    if (d.cci != null) {
        if (d.cci < -200) { score += WEIGHTS.CCI_EXTREME; bullReasons.push(`CCI ${d.cci} — extreme oversold`); }
        else if (d.cci < -100) { score += WEIGHTS.CCI_NORMAL; bullReasons.push(`CCI ${d.cci} — oversold`); }
        else if (d.cci > 200) { score -= WEIGHTS.CCI_EXTREME; bearReasons.push(`CCI ${d.cci} — extreme overbought`); }
        else if (d.cci > 100) { score -= WEIGHTS.CCI_NORMAL; bearReasons.push(`CCI ${d.cci} — overbought`); }
    }

    // ── Moving Averages ───────────────────────────────────────
    // Price vs MA20
    if (d.ma20 != null) {
        if (d.price > d.ma20) { score += WEIGHTS.MA_CROSS; bullReasons.push(`Price ${d.price} above MA20 ${d.ma20}`); }
        else { score -= WEIGHTS.MA_CROSS; bearReasons.push(`Price ${d.price} below MA20 ${d.ma20}`); }
    }
    // MA5 vs MA20 (short-term cross)
    if (d.ma5 != null && d.ma20 != null) {
        if (d.ma5 > d.ma20) { score += WEIGHTS.MA_CROSS; bullReasons.push(`MA5 ${d.ma5} > MA20 ${d.ma20} — golden cross`); }
        else { score -= WEIGHTS.MA_CROSS; bearReasons.push(`MA5 ${d.ma5} < MA20 ${d.ma20} — death cross`); }
    }
    // MA20 vs MA50 (medium-term)
    if (d.ma20 != null && d.ma50 != null) {
        if (d.ma20 > d.ma50) { score += WEIGHTS.MA_CROSS; bullReasons.push(`MA20 ${d.ma20} > MA50 ${d.ma50} — medium uptrend`); }
        else { score -= WEIGHTS.MA_CROSS; bearReasons.push(`MA20 ${d.ma20} < MA50 ${d.ma50} — medium downtrend`); }
    }
    // Price vs MA200 (long-term)
    if (d.ma200 != null) {
        if (d.price > d.ma200) { score += WEIGHTS.MA_CROSS; bullReasons.push(`Price above MA200 ${d.ma200} — long-term bull structure`); }
        else { score -= WEIGHTS.MA_CROSS; bearReasons.push(`Price below MA200 ${d.ma200} — long-term bear structure`); }
    }
    // EMA9 vs EMA21
    if (d.ema9 != null && d.ema21 != null) {
        if (d.ema9 > d.ema21) { score += WEIGHTS.MA_CROSS; bullReasons.push(`EMA9 ${d.ema9} > EMA21 ${d.ema21} — short momentum up`); }
        else { score -= WEIGHTS.MA_CROSS; bearReasons.push(`EMA9 ${d.ema9} < EMA21 ${d.ema21} — short momentum down`); }
    }

    // ── VWAP ─────────────────────────────────────────────────
    if (d.vwap != null) {
        const vwapDiff = calcPct(d.price, d.vwap);
        if (vwapDiff < -3) { score += WEIGHTS.VWAP; bullReasons.push(`Price ${round2(vwapDiff)}% below VWAP ${d.vwap} — undervalued vs fair value`); }
        else if (vwapDiff < 0) { score += 1; bullReasons.push(`Price slightly below VWAP ${d.vwap}`); }
        else if (vwapDiff > 3) { score -= WEIGHTS.VWAP; bearReasons.push(`Price ${round2(vwapDiff)}% above VWAP ${d.vwap} — stretched vs fair value`); }
        else if (vwapDiff > 0) { score -= 1; bearReasons.push(`Price slightly above VWAP ${d.vwap}`); }
    }

    // ── OBV (separate from volume spike — different signal) ───
    if (d.obv?.trend === "ACCUMULATION") { score += WEIGHTS.OBV; bullReasons.push(`OBV ${d.obv.trend} — institutional smart money buying`); }
    else if (d.obv?.trend === "DISTRIBUTION") { score -= WEIGHTS.OBV; bearReasons.push(`OBV ${d.obv.trend} — institutional smart money selling`); }

    // ── Ichimoku Cloud ────────────────────────────────────────
    if (d.ichi) {
        if (d.ichi.position === "ABOVE_CLOUD") { score += WEIGHTS.ICHI_CLOUD; bullReasons.push(`Ichimoku: price ABOVE ${d.ichi.cloudColor} cloud — in bull zone`); }
        else if (d.ichi.position === "BELOW_CLOUD") { score -= WEIGHTS.ICHI_CLOUD; bearReasons.push(`Ichimoku: price BELOW ${d.ichi.cloudColor} cloud — in bear zone`); }
        else neutralNotes.push(`Ichimoku: price inside cloud — consolidation / uncertainty`);

        if (d.ichi.tkBullish) { score += WEIGHTS.ICHI_TK; bullReasons.push(`Ichimoku TK cross: Tenkan ${d.ichi.tenkan} > Kijun ${d.ichi.kijun}`); }
        else { score -= WEIGHTS.ICHI_TK; bearReasons.push(`Ichimoku TK: Tenkan ${d.ichi.tenkan} < Kijun ${d.ichi.kijun}`); }

        if (d.ichi.chikouBullish != null) {
            if (d.ichi.chikouBullish) bullReasons.push(`Ichimoku Chikou above price 26-bars ago — bullish confirmation`);
            else bearReasons.push(`Ichimoku Chikou below price 26-bars ago — bearish confirmation`);
        }
    }

    // ── Volume spike (directional confirmation only — avoid double-count with OBV) ──
    if (d.vol?.volSpike) {
        if (score > 0) { score += WEIGHTS.VOLUME_CONFIRM; bullReasons.push(`Volume ${d.vol.volRatio}x avg — confirms bullish move with smart money`); }
        else { score -= WEIGHTS.VOLUME_CONFIRM; bearReasons.push(`Volume ${d.vol.volRatio}x avg — confirms bearish move with smart money`); }
    }

    // ── Pivot Support / Resistance ────────────────────────────
    if (d.pivots) {
        const { s1, s2, r1, r2 } = d.pivots;
        if (s1 != null && d.price <= s1 * 1.005 && d.price > s2) { score += WEIGHTS.PIVOT_LEVEL; bullReasons.push(`Near S1 pivot support ${s1} — demand zone`); }
        if (s2 != null && d.price <= s2 * 1.005) { score += WEIGHTS.PIVOT_LEVEL; bullReasons.push(`Near S2 pivot support ${s2} — strong demand floor`); }
        if (r1 != null && d.price >= r1 * 0.995 && d.price < r2) { score -= WEIGHTS.PIVOT_LEVEL; bearReasons.push(`Near R1 pivot resistance ${r1} — supply zone`); }
        if (r2 != null && d.price >= r2 * 0.995) { score -= WEIGHTS.PIVOT_LEVEL; bearReasons.push(`Near R2 pivot resistance ${r2} — strong supply ceiling`); }
    }

    // ── 6-Month Position ──────────────────────────────────────
    if (d.pctFrom6mLow != null && d.pctFrom6mLow < 3) { score += WEIGHTS.POSITION_6M; bullReasons.push(`Near 6m low — potential base / reversal zone`); }
    if (d.pctFrom6mHigh != null && d.pctFrom6mHigh > -3) { score -= WEIGHTS.POSITION_6M; bearReasons.push(`Near 6m high — limited upside near-term`); }

    // ── Candlestick Patterns ──────────────────────────────────
    for (const pattern of (d.patterns || [])) {
        const w = ["Bullish Engulfing", "Bearish Engulfing", "Three White Soldiers", "Three Black Crows", "Morning Star", "Evening Star"].includes(pattern.name)
            ? WEIGHTS.PATTERN_MAJOR : WEIGHTS.PATTERN_MINOR;
        if (pattern.bias === "BULLISH") { score += w; bullReasons.push(`Pattern: ${pattern.name} — ${pattern.desc}`); }
        else if (pattern.bias === "BEARISH") { score -= w; bearReasons.push(`Pattern: ${pattern.name} — ${pattern.desc}`); }
        else neutralNotes.push(`Pattern: ${pattern.name} — ${pattern.desc}`);
    }

    // ── RSI Divergence ────────────────────────────────────────
    if (d.divergence === "BULLISH_DIVERGENCE") { score += WEIGHTS.DIVERGENCE; bullReasons.push("Bullish RSI divergence — price new low but RSI higher low (reversal signal)"); }
    else if (d.divergence === "BEARISH_DIVERGENCE") { score -= WEIGHTS.DIVERGENCE; bearReasons.push("Bearish RSI divergence — price new high but RSI lower high (exhaustion signal)"); }

    // ── P&L Context ───────────────────────────────────────────
    if ((d.unrealizedPct || 0) < -20)
        neutralNotes.push(`⚠️ Position down ${Math.abs(d.unrealizedPct)}% from cost — review investment thesis`);
    if ((d.unrealizedPct || 0) > 50)
        neutralNotes.push(`✅ Position up ${d.unrealizedPct}% from cost — consider partial profit booking`);

    // ─────────────────────────────────────────────────────────
    //  ACTION DETERMINATION
    // ─────────────────────────────────────────────────────────

    let action;
    if (score >= SIGNAL_THRESHOLDS.STRONG_BUY) action = "STRONG_BUY";
    else if (score >= SIGNAL_THRESHOLDS.BUY) action = "BUY";
    else if (score <= SIGNAL_THRESHOLDS.STRONG_SELL) action = "STRONG_SELL";
    else if (score <= SIGNAL_THRESHOLDS.SELL) action = "SELL";
    else action = "HOLD";

    const isBuy = action === "BUY" || action === "STRONG_BUY";
    const isSell = action === "SELL" || action === "STRONG_SELL";

    // ─────────────────────────────────────────────────────────
    //  PRICE LEVELS  (ATR-based + pivot-anchored)
    // ─────────────────────────────────────────────────────────

    const atr = d.atr || d.price * 0.02;   // fallback: 2% if ATR missing
    const { s1, s2, r1, r2 } = d.pivots || {};

    let limitPrice, targetPrice, stopLoss, qty;

    if (isBuy) {
        // Entry: at or just below nearest support
        limitPrice = round2(s1 ? Math.min(d.price, s1) : d.price - atr * 0.25);
        targetPrice = round2(r1 ? r1 : d.price + atr * 2.5);
        stopLoss = round2(s2 ? s2 - atr * 0.1 : d.price - atr * 1.5);
        const pctQty = action === "STRONG_BUY" ? 0.15 : 0.10;
        qty = Math.max(50, Math.round(d.shares * pctQty / 10) * 10);

    } else if (isSell) {
        // Entry: at or just above nearest resistance
        limitPrice = round2(r1 ? Math.max(d.price, r1) : d.price + atr * 0.25);
        targetPrice = round2(s1 ? s1 : d.price - atr * 2.5);
        stopLoss = round2(r2 ? r2 + atr * 0.1 : d.price + atr * 1.5);
        const pctQty = action === "STRONG_SELL" ? 0.25 : 0.15;
        qty = Math.min(d.shares, Math.max(50, Math.round(d.shares * pctQty / 10) * 10));

    } else {
        limitPrice = d.price;
        targetPrice = round2(r1 || d.price + atr);
        stopLoss = round2(s1 || d.price - atr);
        qty = 0;
    }

    // Risk/Reward ratio
    const rewardAmt = Math.abs((targetPrice || 0) - (limitPrice || 0));
    const riskAmt = Math.abs((limitPrice || 0) - (stopLoss || 0));
    const rrRatio = riskAmt > 0 ? round2(rewardAmt / riskAmt) : null;

    // ─────────────────────────────────────────────────────────
    //  CONFIDENCE
    // ─────────────────────────────────────────────────────────

    const absScore = Math.abs(score);
    const confidence = absScore >= 14 ? "Very High"
        : absScore >= 10 ? "High"
            : absScore >= 6 ? "Medium"
                : "Low";

    // ─────────────────────────────────────────────────────────
    //  HUMAN-READABLE OUTPUT
    // ─────────────────────────────────────────────────────────

    // Trade instruction (precise, unambiguous)
    const instruction = isBuy
        ? `Buy ${qty} shares of ${sym} at PKR ${limitPrice} or below (limit order)`
        : isSell
            ? `Sell ${qty} shares of ${sym} at PKR ${limitPrice} or above (limit order)`
            : `Hold — support PKR ${stopLoss}, resistance PKR ${targetPrice}`;

    // Beginner explanation (no jargon)
    const beginnerNote = isBuy
        ? `The stock is showing multiple buying signals. Place a limit buy order at PKR ${limitPrice}. If it goes to PKR ${targetPrice} consider selling some. If it drops below PKR ${stopLoss} sell to protect capital.`
        : isSell
            ? `The stock is showing multiple selling signals. Consider trimming your position. Place a limit sell at PKR ${limitPrice}. Your protective stop is PKR ${stopLoss} if the trade goes wrong.`
            : `Mixed signals — no clear trade. Watch PKR ${stopLoss} as a floor and PKR ${targetPrice} as a ceiling. Act only when price reaches one of these levels.`;

    // Pro summary (one line for analysts)
    const proSummary = `Score ${score > 0 ? "+" : ""}${score} | ${d.trend} | RSI ${d.rsi14} | MACD ${d.macd?.crossover || d.macd?.histTrend} | BB%B ${d.bb?.pctB} | ADX ${d.adx?.adx}(${d.adx?.strength}) | Ichi ${d.ichi?.position}`;

    return {
        symbol: sym,
        action,
        score,
        confidence,
        qty,
        limitPrice,
        targetPrice,
        stopLoss,
        rrRatio,
        instruction,
        beginnerNote,
        proSummary,
        bullReasons,
        bearReasons,
        neutralNotes,
        // Key display fields
        price: d.price,
        open: d.open,
        high: d.high,
        low: d.low,
        rsi14: d.rsi14,
        rsi9: d.rsi9,
        stoch: d.stoch,
        macd: d.macd,
        bb: d.bb,
        adx: d.adx,
        willR: d.willR,
        cci: d.cci,
        ichi: d.ichi,
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
        // P&L
        unrealizedPnl: d.unrealizedPnl,
        unrealizedPct: d.unrealizedPct,
        marketValue: d.marketValue,
        costBasis: d.costBasis,
        shares: d.shares,
        avgCost: d.avgCost,
        // Performance
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

function getSignals(stockData) {
    const signals = {};
    for (const [ticker, d] of Object.entries(stockData)) {
        signals[ticker.replace(".KA", "")] = buildSignal(ticker, d);
    }
    return signals;
}

// ─────────────────────────────────────────────────────────────
//  PORTFOLIO SUMMARY
// ─────────────────────────────────────────────────────────────

function calcPortfolioSummary(stockData) {
    let totalCost = 0, totalValue = 0;
    const sectorMap = {};

    for (const d of Object.values(stockData)) {
        if (!d.price || d.error) continue;
        totalCost += d.costBasis || 0;
        totalValue += d.marketValue || 0;
        if (d.sector) sectorMap[d.sector] = (sectorMap[d.sector] || 0) + (d.marketValue || 0);
    }

    const totalPnl = round2(totalValue - totalCost);
    const totalPnlPct = totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100) : 0;

    const sectorWeights = {};
    for (const [sec, val] of Object.entries(sectorMap)) {
        sectorWeights[sec] = totalValue > 0 ? round2((val / totalValue) * 100) : 0;
    }

    return {
        totalCost: round2(totalCost),
        totalValue: round2(totalValue),
        totalPnl,
        totalPnlPct,
        sectorWeights,
    };
}

module.exports = { getSignals, calcPortfolioSummary };