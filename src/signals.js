"use strict";
const { f2, pct } = require("./indicators");
const { SIGNAL_THRESHOLDS, RSI_ZONES } = require("./config");

/**
 * Build a complete signal for one stock.
 * Returns an enriched signal object with action, precise prices, confidence,
 * human-readable reasoning for both noobs and professionals.
 */
function buildSignal(ticker, d) {
    const sym = ticker.replace(".KA", "");

    if (!d.price || d.error) {
        return { action: "SKIP", symbol: sym, error: d.error || "No price data" };
    }

    let score = 0;
    const bullSignals = [];
    const bearSignals = [];
    const neutralNotes = [];

    // ── RSI-14 ─────────────────────────────────────────────────
    if (d.rsi14 !== null) {
        if (d.rsi14 < 20) { score += 4; bullSignals.push(`RSI ${d.rsi14} — extremely oversold (rare opportunity)`); }
        else if (d.rsi14 < RSI_ZONES.DEEPLY_OVERSOLD) { score += 3; bullSignals.push(`RSI ${d.rsi14} — deeply oversold`); }
        else if (d.rsi14 < RSI_ZONES.OVERSOLD) { score += 2; bullSignals.push(`RSI ${d.rsi14} — oversold`); }
        else if (d.rsi14 < RSI_ZONES.MILD_OVERSOLD) { score += 1; bullSignals.push(`RSI ${d.rsi14} — mildly oversold`); }
        else if (d.rsi14 > 80) { score -= 4; bearSignals.push(`RSI ${d.rsi14} — extremely overbought`); }
        else if (d.rsi14 > RSI_ZONES.DEEPLY_OVERBOUGHT) { score -= 3; bearSignals.push(`RSI ${d.rsi14} — deeply overbought`); }
        else if (d.rsi14 > RSI_ZONES.OVERBOUGHT) { score -= 2; bearSignals.push(`RSI ${d.rsi14} — overbought`); }
        else if (d.rsi14 > RSI_ZONES.MILD_OVERBOUGHT) { score -= 1; bearSignals.push(`RSI ${d.rsi14} — mildly overbought`); }
        else neutralNotes.push(`RSI ${d.rsi14} — neutral (40-55 zone)`);
    }

    // ── RSI-9 Confirmation ─────────────────────────────────────
    if (d.rsi9 !== null && d.rsi14 !== null) {
        if (d.rsi9 < 30 && d.rsi14 < 35) { score += 1; bullSignals.push(`RSI-9 ${d.rsi9} confirms short-term oversold`); }
        else if (d.rsi9 > 70 && d.rsi14 > 65) { score -= 1; bearSignals.push(`RSI-9 ${d.rsi9} confirms short-term overbought`); }
    }

    // ── Stochastic ─────────────────────────────────────────────
    if (d.stoch?.k !== null) {
        if (d.stoch.k < 15 && d.stoch.d < 15) { score += 3; bullSignals.push(`Stoch %K/${d.stoch.k} %D/${d.stoch.d} — extreme oversold`); }
        else if (d.stoch.k < 20 && d.stoch.d < 20) { score += 2; bullSignals.push(`Stoch ${d.stoch.k}/${d.stoch.d} — oversold`); }
        else if (d.stoch.k > 85 && d.stoch.d > 85) { score -= 3; bearSignals.push(`Stoch ${d.stoch.k}/${d.stoch.d} — extreme overbought`); }
        else if (d.stoch.k > 80 && d.stoch.d > 80) { score -= 2; bearSignals.push(`Stoch ${d.stoch.k}/${d.stoch.d} — overbought`); }
        else if (d.stoch.k > d.stoch.d && d.stoch.k < 50) { score += 1; bullSignals.push(`Stoch K crossing D upward from low — bullish`); }
        else if (d.stoch.k < d.stoch.d && d.stoch.k > 50) { score -= 1; bearSignals.push(`Stoch K crossing D downward from high — bearish`); }
    }

    // ── MACD ───────────────────────────────────────────────────
    if (d.macd?.crossover === "BULLISH_CROSS") { score += 3; bullSignals.push("MACD bullish crossover ⚡ — strong momentum shift"); }
    else if (d.macd?.crossover === "BEARISH_CROSS") { score -= 3; bearSignals.push("MACD bearish crossover ⚡ — strong momentum shift"); }
    else if (d.macd?.histogram > 0 && d.macd?.histTrend === "EXPANDING") { score += 2; bullSignals.push("MACD histogram expanding positive — accelerating bullish momentum"); }
    else if (d.macd?.histogram < 0 && d.macd?.histTrend === "EXPANDING") { score -= 2; bearSignals.push("MACD histogram expanding negative — accelerating bearish momentum"); }
    else if (d.macd?.histogram > 0) { score += 1; bullSignals.push("MACD histogram positive"); }
    else if (d.macd?.histogram < 0) { score -= 1; bearSignals.push("MACD histogram negative"); }

    // ── Bollinger Bands ────────────────────────────────────────
    if (d.bb?.pctB !== null) {
        if (d.bb.pctB < 0) { score += 4; bullSignals.push(`BB %B ${d.bb.pctB} — price below lower band (rare extreme)`); }
        else if (d.bb.pctB < 10) { score += 3; bullSignals.push(`BB %B ${d.bb.pctB} — hugging lower Bollinger band`); }
        else if (d.bb.pctB < 25) { score += 2; bullSignals.push(`BB %B ${d.bb.pctB} — near lower Bollinger band`); }
        else if (d.bb.pctB > 100) { score -= 4; bearSignals.push(`BB %B ${d.bb.pctB} — price above upper band (rare extreme)`); }
        else if (d.bb.pctB > 90) { score -= 3; bearSignals.push(`BB %B ${d.bb.pctB} — hugging upper Bollinger band`); }
        else if (d.bb.pctB > 75) { score -= 2; bearSignals.push(`BB %B ${d.bb.pctB} — near upper Bollinger band`); }
        // Squeeze (low bandwidth = volatility compression = breakout coming)
        if (d.bb.bandwidth < 5) neutralNotes.push(`BB squeeze (bandwidth ${d.bb.bandwidth}%) — breakout imminent`);
    }

    // ── ADX (Trend Strength) ───────────────────────────────────
    if (d.adx?.adx !== null) {
        if (d.adx.trend === "STRONG_BULL") { score += 2; bullSignals.push(`ADX ${d.adx.adx} — strong bullish trend (DI+ ${d.adx.diPlus} > DI- ${d.adx.diMinus})`); }
        else if (d.adx.trend === "STRONG_BEAR") { score -= 2; bearSignals.push(`ADX ${d.adx.adx} — strong bearish trend (DI- ${d.adx.diMinus} > DI+ ${d.adx.diPlus})`); }
        else if (d.adx.trend === "RANGING") neutralNotes.push(`ADX ${d.adx.adx} — ranging market, signals less reliable`);
    }

    // ── Williams %R ────────────────────────────────────────────
    if (d.willR !== null) {
        if (d.willR < -90) { score += 2; bullSignals.push(`Williams %R ${d.willR} — deeply oversold`); }
        else if (d.willR < -80) { score += 1; bullSignals.push(`Williams %R ${d.willR} — oversold zone`); }
        else if (d.willR > -10) { score -= 2; bearSignals.push(`Williams %R ${d.willR} — deeply overbought`); }
        else if (d.willR > -20) { score -= 1; bearSignals.push(`Williams %R ${d.willR} — overbought zone`); }
    }

    // ── CCI ────────────────────────────────────────────────────
    if (d.cci !== null) {
        if (d.cci < -200) { score += 2; bullSignals.push(`CCI ${d.cci} — extreme oversold`); }
        else if (d.cci < -100) { score += 1; bullSignals.push(`CCI ${d.cci} — oversold`); }
        else if (d.cci > 200) { score -= 2; bearSignals.push(`CCI ${d.cci} — extreme overbought`); }
        else if (d.cci > 100) { score -= 1; bearSignals.push(`CCI ${d.cci} — overbought`); }
    }

    // ── Moving Averages ────────────────────────────────────────
    if (d.ma5 > d.ma20) { score += 1; bullSignals.push("MA5 > MA20 — short-term golden cross"); }
    else { score -= 1; bearSignals.push("MA5 < MA20 — short-term death cross"); }
    if (d.ma20 && d.ma50) {
        if (d.ma20 > d.ma50) { score += 1; bullSignals.push("MA20 > MA50 — medium-term uptrend"); }
        else { score -= 1; bearSignals.push("MA20 < MA50 — medium-term downtrend"); }
    }
    if (d.price > d.ma20) { score += 1; bullSignals.push(`Price (${d.price}) above MA20 (${d.ma20})`); }
    else { score -= 1; bearSignals.push(`Price (${d.price}) below MA20 (${d.ma20})`); }
    if (d.ma200) {
        if (d.price > d.ma200) { score += 1; bullSignals.push(`Price above MA200 (${d.ma200}) — long-term bull`); }
        else { score -= 1; bearSignals.push(`Price below MA200 (${d.ma200}) — long-term bear`); }
    }

    // ── VWAP ───────────────────────────────────────────────────
    if (d.vwap) {
        if (d.price < d.vwap * 0.97) { score += 2; bullSignals.push(`Price 3%+ below VWAP (${d.vwap}) — undervalued vs fair value`); }
        else if (d.price < d.vwap) { score += 1; bullSignals.push(`Price slightly below VWAP (${d.vwap})`); }
        else if (d.price > d.vwap * 1.03) { score -= 2; bearSignals.push(`Price 3%+ above VWAP (${d.vwap}) — stretched vs fair value`); }
        else if (d.price > d.vwap) { score -= 1; bearSignals.push(`Price slightly above VWAP (${d.vwap})`); }
    }

    // ── OBV ────────────────────────────────────────────────────
    if (d.obv?.trend === "ACCUMULATION") { score += 2; bullSignals.push("OBV rising — institutional accumulation detected"); }
    else if (d.obv?.trend === "DISTRIBUTION") { score -= 2; bearSignals.push("OBV falling — institutional distribution detected"); }

    // ── Ichimoku Cloud ─────────────────────────────────────────
    if (d.ichi) {
        if (d.ichi.position === "ABOVE_CLOUD") { score += 2; bullSignals.push(`Ichimoku: price above ${d.ichi.cloudColor} cloud — bullish`); }
        else if (d.ichi.position === "BELOW_CLOUD") { score -= 2; bearSignals.push(`Ichimoku: price below ${d.ichi.cloudColor} cloud — bearish`); }
        else neutralNotes.push("Ichimoku: price inside cloud — consolidation");
        if (d.ichi.bullishTK) { score += 1; bullSignals.push(`Ichimoku TK cross: Tenkan (${d.ichi.tenkan}) > Kijun (${d.ichi.kijun})`); }
        else { score -= 1; bearSignals.push(`Ichimoku TK: Tenkan (${d.ichi.tenkan}) < Kijun (${d.ichi.kijun})`); }
    }

    // ── OBV Volume Spike ───────────────────────────────────────
    if (d.volSpike) {
        if (score > 0) { score += 1; bullSignals.push(`Volume ${d.volRatio}x average — confirms bullish move`); }
        else { score -= 1; bearSignals.push(`Volume ${d.volRatio}x average — confirms bearish move`); }
    }

    // ── Pivot Support/Resistance ────────────────────────────────
    if (d.pivots) {
        const { s1, s2, r1, r2 } = d.pivots;
        if (d.price <= s1 * 1.005) { score += 1; bullSignals.push(`At/near S1 pivot support (${s1})`); }
        if (d.price <= s2 * 1.005) { score += 1; bullSignals.push(`At/near S2 pivot support (${s2}) — strong floor`); }
        if (d.price >= r1 * 0.995) { score -= 1; bearSignals.push(`At/near R1 pivot resistance (${r1})`); }
        if (d.price >= r2 * 0.995) { score -= 1; bearSignals.push(`At/near R2 pivot resistance (${r2}) — strong ceiling`); }
    }

    // ── 6m Position ────────────────────────────────────────────
    if (d.pctFrom6mLow !== null && d.pctFrom6mLow < 3) { score += 1; bullSignals.push(`Near 6-month low — potential base forming`); }
    if (d.pctFrom6mHigh !== null && d.pctFrom6mHigh > -3) { score -= 1; bearSignals.push(`Near 6-month high — limited upside near term`); }

    // ── Candlestick Patterns ────────────────────────────────────
    for (const p of (d.patterns || [])) {
        if (p.bias === "BULLISH") { score += 2; bullSignals.push(`Pattern: ${p.name} — ${p.desc}`); }
        else if (p.bias === "BEARISH") { score -= 2; bearSignals.push(`Pattern: ${p.name} — ${p.desc}`); }
        else neutralNotes.push(`Pattern: ${p.name} — ${p.desc}`);
    }

    // ── P&L Context ────────────────────────────────────────────
    if ((d.unrealizedPct || 0) < -20) bearSignals.push(`⚠️ Down ${Math.abs(d.unrealizedPct)}% from cost — review investment thesis`);
    if ((d.unrealizedPct || 0) > 40) neutralNotes.push(`✅ Up ${d.unrealizedPct}% from cost — consider partial profit booking`);

    // ── Action Determination ────────────────────────────────────
    let action;
    if (score >= SIGNAL_THRESHOLDS.STRONG_BUY) action = "STRONG_BUY";
    else if (score >= SIGNAL_THRESHOLDS.BUY) action = "BUY";
    else if (score <= SIGNAL_THRESHOLDS.STRONG_SELL) action = "STRONG_SELL";
    else if (score <= SIGNAL_THRESHOLDS.SELL) action = "SELL";
    else action = "HOLD";

    // ── Precise Price Levels (ATR-based + Pivot-anchored) ───────
    const atr = d.atr || d.price * 0.02;
    const { s1, s2, r1, r2 } = d.pivots || {};
    let limitPrice, targetPrice, stopLoss, qty;

    const isBuy = action === "BUY" || action === "STRONG_BUY";
    const isSell = action === "SELL" || action === "STRONG_SELL";

    if (isBuy) {
        // Limit: enter at or slightly below support / current price
        limitPrice = f2(s1 ? Math.min(d.price, s1 * 1.005) : d.price - atr * 0.3);
        targetPrice = f2(r1 ? r1 : d.price + atr * 2.5);
        stopLoss = f2(s2 ? s2 * 0.998 : d.price - atr * 1.5);
        const pctQty = action === "STRONG_BUY" ? 0.15 : 0.10;
        qty = Math.max(50, Math.round(d.shares * pctQty / 10) * 10);
    } else if (isSell) {
        limitPrice = f2(r1 ? Math.max(d.price, r1 * 0.995) : d.price + atr * 0.3);
        targetPrice = f2(s1 ? s1 : d.price - atr * 2.5);
        stopLoss = f2(r2 ? r2 * 1.002 : d.price + atr * 1.5);
        const pctQty = action === "STRONG_SELL" ? 0.25 : 0.15;
        qty = Math.min(d.shares, Math.max(50, Math.round(d.shares * pctQty / 10) * 10));
    } else {
        limitPrice = d.price;
        targetPrice = f2(r1 || d.price + atr);
        stopLoss = f2(s1 || d.price - atr);
        qty = 0;
    }

    const rrRatio = (targetPrice && stopLoss && limitPrice && Math.abs(limitPrice - stopLoss) > 0)
        ? f2(Math.abs(targetPrice - limitPrice) / Math.abs(limitPrice - stopLoss))
        : null;

    // ── Confidence ─────────────────────────────────────────────
    const absScore = Math.abs(score);
    const confidence = absScore >= 12 ? "Very High" : absScore >= 8 ? "High" : absScore >= 5 ? "Medium" : "Low";

    // ── Human-readable Instructions ─────────────────────────────
    const actionLabel = { STRONG_BUY: "BUY", BUY: "BUY", SELL: "SELL", STRONG_SELL: "SELL", HOLD: "HOLD" }[action];
    const instruction = isBuy
        ? `Buy ${qty} shares of ${sym} at PKR ${limitPrice} or below (limit order)`
        : isSell
            ? `Sell ${qty} shares of ${sym} at PKR ${limitPrice} or above (limit order)`
            : `Hold ${sym} — watch PKR ${stopLoss} (support) & PKR ${targetPrice} (resistance)`;

    // Noob summary (plain English)
    const noobSummary = isBuy
        ? `📗 This stock is showing buying signs. ${bullSignals[0] || ""}. Try to buy at PKR ${limitPrice} and sell around PKR ${targetPrice}. Put a stop loss at PKR ${stopLoss} to limit risk.`
        : isSell
            ? `📕 This stock is showing selling signs. ${bearSignals[0] || ""}. Try to sell at PKR ${limitPrice}. If price rises to PKR ${stopLoss}, that is your exit to cut losses.`
            : `📘 No clear signal right now. Hold and watch. Support is at PKR ${stopLoss} — if it breaks below this, consider selling. Resistance is at PKR ${targetPrice} — that is a good profit-taking zone.`;

    // Pro summary
    const proSummary = `${action} signal (score ${score >= 0 ? "+" : ""}${score}) | Trend: ${d.trend} | ADX: ${d.adx?.adx} (${d.adx?.trend}) | BB %B: ${d.bb?.pctB} | Ichi: ${d.ichi?.position || "N/A"}`;

    return {
        symbol: sym,
        action,
        actionLabel,
        score,
        confidence,
        qty,
        limitPrice,
        targetPrice,
        stopLoss,
        rrRatio,
        instruction,
        noobSummary,
        proSummary,
        bullSignals,
        bearSignals,
        neutralNotes,
        // Key metrics for display
        price: d.price,
        rsi14: d.rsi14,
        stoch: d.stoch,
        macdCrossover: d.macd?.crossover,
        trend: d.trend,
        adx: d.adx,
        ichiPosition: d.ichi?.position,
        patterns: d.patterns,
        unrealizedPct: d.unrealizedPct,
        unrealized: d.unrealized,
        marketValue: d.marketValue,
        pivots: d.pivots,
        bb: d.bb,
    };
}

/**
 * Generate signals for all stocks in stockData
 */
function getSignals(stockData) {
    const signals = {};
    for (const [ticker, d] of Object.entries(stockData)) {
        const sym = ticker.replace(".KA", "");
        signals[sym] = buildSignal(ticker, d);
    }
    return signals;
}

/**
 * Portfolio-level aggregated summary
 */
function portfolioSummary(stockData) {
    let totalCost = 0, totalValue = 0;
    const positions = [];
    for (const d of Object.values(stockData)) {
        if (!d.price || d.error) continue;
        totalCost += d.costBasis || 0;
        totalValue += d.marketValue || 0;
        positions.push({ symbol: d.symbol, sector: d.sector, value: d.marketValue, pct: 0 });
    }
    const totalPnl = f2(totalValue - totalCost);
    const totalPnlPct = totalCost ? f2(((totalValue - totalCost) / totalCost) * 100) : 0;
    // Sector weights
    const sectorMap = {};
    for (const p of positions) {
        sectorMap[p.sector] = (sectorMap[p.sector] || 0) + p.value;
    }
    return {
        totalCost: f2(totalCost),
        totalValue: f2(totalValue),
        totalPnl,
        totalPnlPct,
        sectorWeights: Object.fromEntries(
            Object.entries(sectorMap).map(([s, v]) => [s, f2((v / totalValue) * 100)])
        ),
    };
}

module.exports = { getSignals, portfolioSummary };