require("dotenv").config();
const YahooFinance = require("yahoo-finance2").default;
const yf = new YahooFinance();
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const moment = require("moment-timezone");

// ──────────────────────────────
// ENV CONFIG
// ──────────────────────────────
const {
    MONGODB_URI,
    MONGODB_DB,
    TWILIO_ENABLED,
    EMAIL_ENABLED,
    GEMINI_ENABLED,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM,
    TWILIO_TO,
    EMAIL_USER,
    EMAIL_PASS,
    EMAIL_TO,
    GEMINI_API_KEY,
} = process.env;

const FEATURES = {
    message: TWILIO_ENABLED === "true",
    email: EMAIL_ENABLED === "true",
    gemini: GEMINI_ENABLED === "true",
};

// ──────────────────────────────
// PORTFOLIO  (updated avg costs & tickers)
// ──────────────────────────────
const PORTFOLIO = {
    "MEBL.KA": { shares: 1150, avg_cost: 429.93, name: "Meezan Bank", sector: "Banking" },
    "OGDC.KA": { shares: 1100, avg_cost: 266.29, name: "OGDC", sector: "Oil & Gas" },
    "HUBC.KA": { shares: 1100, avg_cost: 191.85, name: "Hub Power", sector: "Energy" },
    "EFERT.KA": { shares: 900, avg_cost: 202.37, name: "Engro Fertilizer", sector: "Fertilizer" },
    "ENGROH.KA": { shares: 400, avg_cost: 279.51, name: "Engro Holdings", sector: "Conglomerate" },
    "FFC.KA": { shares: 400, avg_cost: 507.94, name: "Fauji Fertilizer", sector: "Fertilizer" },
    "LUCK.KA": { shares: 300, avg_cost: 378.70, name: "Lucky Cement", sector: "Cement" },
    "MARI.KA": { shares: 200, avg_cost: 635.00, name: "Mari Petroleum", sector: "Oil & Gas" },
    "POL.KA": { shares: 200, avg_cost: 639.18, name: "Pakistan Oilfields", sector: "Oil & Gas" },
    "SYS.KA": { shares: 750, avg_cost: 137.25, name: "Systems Ltd", sector: "Technology" },
};

// ──────────────────────────────
// UTILS
// ──────────────────────────────
const nowPKT = () => moment().tz("Asia/Karachi");
const isWeekend = () => [0, 6].includes(nowPKT().day());
const fmt2 = (n) => (n !== null && n !== undefined && !isNaN(n)) ? +n.toFixed(2) : null;
const pct = (a, b) => b ? fmt2(((a - b) / b) * 100) : null;

// ──────────────────────────────
// DB
// ──────────────────────────────
let db;
async function initDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(MONGODB_DB || "psx_agent");
}

// ──────────────────────────────
// TECHNICAL INDICATORS
// ──────────────────────────────
function calcRSI(close, period = 14) {
    if (close.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = close[i] - close[i - 1];
        if (d >= 0) gains += d; else losses -= d;
    }
    let ag = gains / period, al = losses / period;
    for (let i = period + 1; i < close.length; i++) {
        const d = close[i] - close[i - 1];
        ag = (ag * (period - 1) + Math.max(d, 0)) / period;
        al = (al * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (al === 0) return 100;
    return fmt2(100 - 100 / (1 + ag / al));
}

function calcEMA(arr, n) {
    const k = 2 / (n + 1);
    const out = [arr[0]];
    for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
    return out;
}

function calcMACD(close) {
    const e12 = calcEMA(close, 12);
    const e26 = calcEMA(close, 26);
    const line = e12.map((v, i) => v - e26[i]);
    const sig = calcEMA(line, 9);
    return {
        macd: fmt2(line.at(-1)),
        signal: fmt2(sig.at(-1)),
        histogram: fmt2(line.at(-1) - sig.at(-1)),
    };
}

function calcBollinger(close, period = 20) {
    const sl = close.slice(-period);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { upper: fmt2(mean + 2 * std), lower: fmt2(mean - 2 * std), mid: fmt2(mean) };
}

function avgN(arr, n) {
    const sl = arr.slice(-n);
    return sl.reduce((a, b) => a + b, 0) / sl.length;
}

function calcATR(hist, period = 14) {
    const trs = [];
    for (let i = 1; i < hist.length; i++) {
        const h = hist[i].high, l = hist[i].low, pc = hist[i - 1].close;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    return fmt2(trs.slice(-period).reduce((a, b) => a + b, 0) / period);
}

function calc6mStats(hist) {
    if (!hist.length) return {};
    const closes = hist.map(d => d.close);
    const high6m = fmt2(Math.max(...hist.map(d => d.high)));
    const low6m = fmt2(Math.min(...hist.map(d => d.low)));
    const first = closes[0];
    const last = closes.at(-1);
    const perf6m = pct(last, first);
    // 1-month performance
    const slice1m = closes.slice(-22);
    const perf1m = pct(slice1m.at(-1), slice1m[0]);
    // 1-week
    const slice1w = closes.slice(-5);
    const perf1w = pct(slice1w.at(-1), slice1w[0]);
    return { high6m, low6m, perf6m, perf1m, perf1w };
}

// ──────────────────────────────
// FETCH STOCK DATA
// ──────────────────────────────
async function fetchStockData() {
    const tickers = Object.keys(PORTFOLIO);
    const results = await Promise.all(
        tickers.map(async (ticker) => {
            const info = PORTFOLIO[ticker];
            try {
                const period2 = new Date();
                const period1 = new Date();
                period1.setMonth(period1.getMonth() - 6);

                const res = await yf.chart(ticker, { period1, period2, interval: "1d" });
                const hist = (res.quotes || []).filter(d => d.close && d.open && d.high && d.low);

                if (hist.length < 30) return [ticker, { error: "Not enough data", ...info }];

                const close = hist.map(d => d.close);
                const volume = hist.map(d => d.volume || 0);
                const price = close.at(-1);
                const ma5 = fmt2(avgN(close, 5));
                const ma10 = fmt2(avgN(close, 10));
                const ma20 = fmt2(avgN(close, 20));
                const ma50 = fmt2(avgN(close, 50));
                const vol_avg = fmt2(avgN(volume, 10));
                const vol_now = volume.at(-1);
                const rsi = calcRSI(close);
                const macd = calcMACD(close);
                const bb = calcBollinger(close);
                const atr = calcATR(hist);
                const stats6m = calc6mStats(hist);

                // P&L
                const cost_basis = fmt2(info.shares * info.avg_cost);
                const market_value = fmt2(info.shares * price);
                const unrealized = fmt2(market_value - cost_basis);
                const unrealized_pct = pct(price, info.avg_cost);

                // Trend
                let trend = "SIDEWAYS";
                if (price > ma20 && ma5 > ma20 && macd.macd > macd.signal) trend = "BULL";
                if (price < ma20 && ma5 < ma20 && macd.macd < macd.signal) trend = "BEAR";

                return [ticker, {
                    name: info.name,
                    sector: info.sector,
                    price: fmt2(price),
                    ma5, ma10, ma20, ma50,
                    rsi,
                    macd,
                    bollinger: bb,
                    atr,
                    volume: vol_now,
                    vol_avg,
                    vol_spike: vol_now > vol_avg * 1.5,
                    shares: info.shares,
                    avg_cost: info.avg_cost,
                    cost_basis,
                    market_value,
                    unrealized,
                    unrealized_pct,
                    trend,
                    ...stats6m,
                }];
            } catch (err) {
                console.error(`Error fetching ${ticker}:`, err.message);
                return [ticker, { error: err.message, ...info }];
            }
        })
    );
    return Object.fromEntries(results);
}

// ──────────────────────────────
// SIGNAL ENGINE  (with qty + limit price)
// ──────────────────────────────
function getSignals(stockData) {
    const signals = {};

    for (const ticker of Object.keys(stockData)) {
        const d = stockData[ticker];
        if (!d.price || d.error) continue;

        let score = 0;
        const reasons = [];

        // RSI
        if (d.rsi !== null) {
            if (d.rsi < 30) { score += 3; reasons.push(`RSI oversold (${d.rsi})`); }
            else if (d.rsi < 40) { score += 1; reasons.push(`RSI mildly oversold (${d.rsi})`); }
            else if (d.rsi > 70) { score -= 3; reasons.push(`RSI overbought (${d.rsi})`); }
            else if (d.rsi > 60) { score -= 1; reasons.push(`RSI mildly overbought (${d.rsi})`); }
        }

        // Trend
        if (d.trend === "BULL") { score += 2; reasons.push("Bullish trend"); }
        if (d.trend === "BEAR") { score -= 2; reasons.push("Bearish trend"); }

        // MACD
        if (d.macd.histogram > 0) { score += 1; reasons.push("MACD bullish"); }
        else { score -= 1; reasons.push("MACD bearish"); }

        // Bollinger
        if (d.price < d.bollinger.lower) { score += 2; reasons.push("Below lower BB (oversold)"); }
        if (d.price > d.bollinger.upper) { score -= 2; reasons.push("Above upper BB (overbought)"); }

        // MA cross
        if (d.ma5 > d.ma20) { score += 1; reasons.push("MA5 > MA20 (golden)"); }
        else { score -= 1; reasons.push("MA5 < MA20 (death)"); }

        // MA50
        if (d.price > d.ma50) score += 1;
        else score -= 1;

        // Volume
        if (d.vol_spike) { score += 1; reasons.push("Volume spike"); }

        // P&L context
        if (d.unrealized_pct < -10) reasons.push(`⚠️ Down ${d.unrealized_pct}% from cost`);
        if (d.unrealized_pct > 20) reasons.push(`✅ Up ${d.unrealized_pct}% from cost`);

        // Determine action
        let action = "HOLD";
        if (score >= 4) action = "BUY";
        if (score <= -4) action = "SELL";

        // ATR-based limit prices (1x ATR for precision)
        const atr = d.atr || d.price * 0.02;

        let limitPrice = null;
        let targetPrice = null;
        let stopLoss = null;
        let qty = 0;

        if (action === "BUY") {
            // Limit buy slightly below current — wait for dip confirmation
            limitPrice = fmt2(d.price - atr * 0.3);
            targetPrice = fmt2(d.price + atr * 2);
            stopLoss = fmt2(d.price - atr * 1.5);
            // Buy qty: ~10% of position (min 50 shares)
            qty = Math.max(50, Math.round(d.shares * 0.1 / 10) * 10);
        } else if (action === "SELL") {
            limitPrice = fmt2(d.price + atr * 0.3); // sell slightly above current
            targetPrice = fmt2(d.price - atr * 2);
            stopLoss = fmt2(d.price + atr * 1.5);
            // Sell qty: ~15% of holdings (min 50 shares)
            qty = Math.min(d.shares, Math.max(50, Math.round(d.shares * 0.15 / 10) * 10));
        } else {
            limitPrice = d.price;
            targetPrice = fmt2(d.price + atr);
            stopLoss = fmt2(d.price - atr);
            qty = 0;
        }

        // Confidence
        let confidence = "Low";
        const absScore = Math.abs(score);
        if (absScore >= 6) confidence = "High";
        else if (absScore >= 4) confidence = "Medium";

        const symbol = ticker.replace(".KA", "");
        signals[symbol] = {
            action,
            score,
            confidence,
            qty,
            limitPrice,
            targetPrice,
            stopLoss,
            instruction: action === "BUY"
                ? `Buy ${qty} shares of ${symbol} at PKR ${limitPrice} or below (limit order)`
                : action === "SELL"
                    ? `Sell ${qty} shares of ${symbol} at PKR ${limitPrice} or above (limit order)`
                    : `Hold ${symbol} — no action needed`,
            reason: reasons.join("; "),
            unrealized_pct: d.unrealized_pct,
            unrealized: d.unrealized,
            market_value: d.market_value,
            trend: d.trend,
            rsi: d.rsi,
        };
    }
    return signals;
}

// ──────────────────────────────
// PORTFOLIO SUMMARY
// ──────────────────────────────
function portfolioSummary(stockData) {
    let total_cost = 0, total_value = 0, total_pnl = 0;
    for (const d of Object.values(stockData)) {
        if (!d.price || d.error) continue;
        total_cost += d.cost_basis || 0;
        total_value += d.market_value || 0;
        total_pnl += d.unrealized || 0;
    }
    return {
        total_cost: fmt2(total_cost),
        total_value: fmt2(total_value),
        total_pnl: fmt2(total_pnl),
        total_pnl_pct: pct(total_value, total_cost),
    };
}

// ──────────────────────────────
// GEMINI  (market context + signal validation)
// ──────────────────────────────
function buildGeminiPrompt(stockData, signals, summary) {
    const holdings = Object.entries(stockData).filter(([, d]) => !d.error).map(([t, d]) => ({
        symbol: t.replace(".KA", ""),
        sector: d.sector,
        price: d.price,
        avg_cost: d.avg_cost,
        unrealized_pct: d.unrealized_pct,
        rsi: d.rsi,
        trend: d.trend,
        perf6m: d.perf6m,
        perf1m: d.perf1m,
        perf1w: d.perf1w,
        high6m: d.high6m,
        low6m: d.low6m,
    }));

    return `
You are a senior analyst covering Pakistan Stock Exchange (PSX / KSE-100) with deep knowledge of:
- Pakistan macro: SBP policy rate, PKR/USD, inflation, IMF program
- Global macro: oil prices (Brent/WTI), Fed rate expectations, EM fund flows
- Sector dynamics for: Banking, Oil & Gas, Fertilizer, Cement, Technology, Energy

TASK:
1. Give a brief MARKET CONTEXT paragraph (Pakistan + global situation today)
2. Validate each system signal — agree / disagree / neutral with SHORT reason
3. For each stock, suggest exact action with price if you DISAGREE with the system
4. List top 2-3 RISKS for the portfolio
5. List top 2-3 OPPORTUNITIES

RULES:
- Use your web knowledge for current market context
- Be precise — mention actual current oil price estimate, SBP rate etc if known
- Concise: max 2 sentences per stock validation
- If you agree with system signal, just say "Agree"
- Return ONLY valid JSON, no markdown, no preamble

OUTPUT FORMAT:
{
  "market_context": "...",
  "pakistan_macro": "...",
  "validation": [
    { "symbol": "MEBL", "verdict": "Agree|Disagree|Neutral", "reason": "...", "alt_action": null or "Sell 200 shares at PKR 460" }
  ],
  "risks": ["...", "..."],
  "opportunities": ["...", "..."],
  "overall_stance": "Bullish|Bearish|Neutral on PSX today"
}

PORTFOLIO SUMMARY: ${JSON.stringify(summary)}
HOLDINGS DATA: ${JSON.stringify(holdings)}
SYSTEM SIGNALS: ${JSON.stringify(signals)}
    `.trim();
}

async function getGeminiInsight(stockData, signals, summary) {
    if (!FEATURES.gemini) return null;
    const prompt = buildGeminiPrompt(stockData, signals, summary);
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3 },
                }),
            }
        );
        const json = await res.json();
        const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!raw) { console.log("Gemini returned empty"); return null; }

        // Strip any accidental markdown fences
        const clean = raw.replace(/```json|```/gi, "").trim();
        try {
            return JSON.parse(clean);
        } catch {
            return { raw };
        }
    } catch (err) {
        console.error("Gemini error:", err.message);
        return null;
    }
}

// ──────────────────────────────
// PERFORMANCE TRACKER
// ──────────────────────────────
async function evaluatePerformance(currentData) {
    try {
        const last = await db.collection("signals")
            .find()
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();
        if (!last.length) return null;
        const prev = last[0];
        let correct = 0, total = 0;
        for (const ticker in currentData) {
            const symbol = ticker.replace(".KA", "");
            const prevSig = prev.signals?.[symbol];
            const prevSnap = prev.snapshot?.[symbol];
            const curr = currentData[ticker];
            if (!prevSig || !prevSnap || !curr?.price) continue;
            total++;
            const entry = prevSnap.price;
            const current = curr.price;
            let ok = false;
            if (prevSig.action === "BUY") ok = current > entry;
            if (prevSig.action === "SELL") ok = current < entry;
            if (prevSig.action === "HOLD") ok = Math.abs(current - entry) / entry < 0.02;
            if (ok) correct++;
        }
        return total ? { accuracy: fmt2((correct / total) * 100), correct, total } : null;
    } catch (err) {
        console.error("Performance eval error:", err.message);
        return null;
    }
}

// ──────────────────────────────
// HTML EMAIL BUILDER
// ──────────────────────────────
function buildHtmlEmail(stockData, signals, summary, performance, gemini) {
    const time = nowPKT().format("DD MMM YYYY, HH:mm [PKT]");
    const buys = Object.values(signals).filter(s => s.action === "BUY").length;
    const sells = Object.values(signals).filter(s => s.action === "SELL").length;
    const holds = Object.values(signals).filter(s => s.action === "HOLD").length;

    const pnlColor = summary.total_pnl >= 0 ? "#22c55e" : "#ef4444";
    const pnlSign = summary.total_pnl >= 0 ? "+" : "";

    // Per-stock rows
    let stockRows = "";
    for (const [ticker, sig] of Object.entries(signals)) {
        const d = stockData[ticker + ".KA"] || {};
        const actionColor = sig.action === "BUY" ? "#22c55e" : sig.action === "SELL" ? "#ef4444" : "#f59e0b";
        const pnlC = (sig.unrealized_pct || 0) >= 0 ? "#22c55e" : "#ef4444";
        const confBadge = sig.confidence === "High" ? "#7c3aed" : sig.confidence === "Medium" ? "#2563eb" : "#64748b";

        // Gemini validation for this stock
        let geminiRow = "";
        if (gemini && gemini.validation) {
            const gv = gemini.validation.find(v => v.symbol === ticker);
            if (gv) {
                const vc = gv.verdict === "Agree" ? "#22c55e" : gv.verdict === "Disagree" ? "#ef4444" : "#f59e0b";
                geminiRow = `
                <tr>
                    <td colspan="2" style="padding:4px 12px 8px;font-size:11px;color:#94a3b8;">
                        🤖 Gemini: <span style="color:${vc};font-weight:600;">${gv.verdict}</span>
                        ${gv.reason ? `— ${gv.reason}` : ""}
                        ${gv.alt_action ? `<br/><span style="color:#f59e0b;">Alternative: ${gv.alt_action}</span>` : ""}
                    </td>
                </tr>`;
            }
        }

        stockRows += `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:#1e293b;border-radius:10px;overflow:hidden;border:1px solid #334155;">
            <tr>
                <td style="padding:10px 12px;background:#0f172a;">
                    <span style="font-size:15px;font-weight:700;color:#f1f5f9;">${ticker}</span>
                    <span style="font-size:11px;color:#64748b;margin-left:8px;">${d.sector || ""}</span>
                </td>
                <td style="padding:10px 12px;background:#0f172a;text-align:right;">
                    <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;
                        background:${actionColor}22;color:${actionColor};border:1px solid ${actionColor}55;">
                        ${sig.action}
                    </span>
                    <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;margin-left:6px;
                        background:${confBadge}22;color:${confBadge};border:1px solid ${confBadge}44;">
                        ${sig.confidence}
                    </span>
                </td>
            </tr>
            <tr>
                <td style="padding:6px 12px;font-size:12px;color:#94a3b8;">Current Price</td>
                <td style="padding:6px 12px;font-size:13px;font-weight:600;color:#f1f5f9;text-align:right;">
                    PKR ${d.price || "—"}
                </td>
            </tr>
            <tr>
                <td style="padding:2px 12px;font-size:12px;color:#94a3b8;">Avg Cost</td>
                <td style="padding:2px 12px;font-size:12px;color:#cbd5e1;text-align:right;">PKR ${d.avg_cost || "—"}</td>
            </tr>
            <tr>
                <td style="padding:2px 12px;font-size:12px;color:#94a3b8;">Unrealised P&L</td>
                <td style="padding:2px 12px;font-size:12px;font-weight:600;color:${pnlC};text-align:right;">
                    ${(sig.unrealized_pct || 0) >= 0 ? "+" : ""}${sig.unrealized_pct || 0}%
                    (PKR ${(sig.unrealized || 0) >= 0 ? "+" : ""}${sig.unrealized || 0})
                </td>
            </tr>
            ${sig.action !== "HOLD" ? `
            <tr>
                <td colspan="2" style="padding:6px 12px;">
                    <div style="background:#0f172a;border-left:3px solid ${actionColor};padding:6px 10px;border-radius:4px;
                        font-size:12px;color:#e2e8f0;">
                        📋 <strong>${sig.instruction}</strong>
                    </div>
                </td>
            </tr>
            <tr>
                <td style="padding:2px 12px;font-size:11px;color:#64748b;">Target</td>
                <td style="padding:2px 12px;font-size:11px;color:#22c55e;text-align:right;">PKR ${sig.targetPrice}</td>
            </tr>
            <tr>
                <td style="padding:2px 12px 6px;font-size:11px;color:#64748b;">Stop Loss</td>
                <td style="padding:2px 12px 6px;font-size:11px;color:#ef4444;text-align:right;">PKR ${sig.stopLoss}</td>
            </tr>` : ""}
            <tr>
                <td colspan="2" style="padding:4px 12px 8px;font-size:11px;color:#64748b;">
                    📊 RSI: ${sig.rsi || "—"} &nbsp;|&nbsp; Trend: ${sig.trend || "—"}
                    ${d.perf6m !== undefined ? `&nbsp;|&nbsp; 6M: ${d.perf6m >= 0 ? "+" : ""}${d.perf6m}%` : ""}
                    ${d.perf1m !== undefined ? `&nbsp;|&nbsp; 1M: ${d.perf1m >= 0 ? "+" : ""}${d.perf1m}%` : ""}
                </td>
            </tr>
            ${sig.reason ? `
            <tr>
                <td colspan="2" style="padding:0 12px 8px;font-size:10px;color:#475569;">
                    ${sig.reason}
                </td>
            </tr>` : ""}
            ${geminiRow}
        </table>`;
    }

    // Gemini section
    let geminiSection = "";
    if (gemini) {
        const stanceColor = gemini.overall_stance?.startsWith("Bull") ? "#22c55e"
            : gemini.overall_stance?.startsWith("Bear") ? "#ef4444" : "#f59e0b";
        geminiSection = `
        <div style="margin-top:20px;">
            <h2 style="color:#f1f5f9;font-size:14px;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:12px;">
                🤖 GEMINI AI MARKET INTELLIGENCE
            </h2>
            ${gemini.raw ? `<p style="color:#94a3b8;font-size:12px;">${gemini.raw}</p>` : `
            <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:10px;">
                <div style="margin-bottom:8px;">
                    <span style="color:#f59e0b;font-size:11px;font-weight:700;text-transform:uppercase;">Market Context</span>
                    <p style="color:#cbd5e1;font-size:12px;margin:4px 0 0;">${gemini.market_context || ""}</p>
                </div>
                ${gemini.pakistan_macro ? `
                <div style="margin-top:8px;">
                    <span style="color:#f59e0b;font-size:11px;font-weight:700;text-transform:uppercase;">Pakistan Macro</span>
                    <p style="color:#cbd5e1;font-size:12px;margin:4px 0 0;">${gemini.pakistan_macro}</p>
                </div>` : ""}
                <div style="margin-top:10px;text-align:right;">
                    <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;
                        background:${stanceColor}22;color:${stanceColor};border:1px solid ${stanceColor}55;">
                        Overall: ${gemini.overall_stance || "—"}
                    </span>
                </div>
            </div>
            ${gemini.risks?.length ? `
            <div style="background:#1e293b;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                <span style="color:#ef4444;font-size:11px;font-weight:700;">⚠️ RISKS</span>
                <ul style="margin:6px 0 0;padding-left:16px;color:#94a3b8;font-size:12px;">
                    ${gemini.risks.map(r => `<li style="margin-bottom:3px;">${r}</li>`).join("")}
                </ul>
            </div>` : ""}
            ${gemini.opportunities?.length ? `
            <div style="background:#1e293b;border-radius:8px;padding:10px 12px;">
                <span style="color:#22c55e;font-size:11px;font-weight:700;">🚀 OPPORTUNITIES</span>
                <ul style="margin:6px 0 0;padding-left:16px;color:#94a3b8;font-size:12px;">
                    ${gemini.opportunities.map(o => `<li style="margin-bottom:3px;">${o}</li>`).join("")}
                </ul>
            </div>` : ""}
            `}
        </div>`;
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:16px;">

    <!-- HEADER -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:12px;padding:20px;margin-bottom:16px;
        border:1px solid #1e40af44;">
        <div style="font-size:11px;color:#3b82f6;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
            Pakistan Stock Exchange
        </div>
        <div style="font-size:22px;font-weight:800;color:#f1f5f9;margin:4px 0;">
            📊 PSX Trading Report
        </div>
        <div style="font-size:12px;color:#64748b;">${time}</div>
        <div style="margin-top:12px;display:flex;gap:8px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;background:#22c55e22;
                color:#22c55e;border:1px solid #22c55e44;">▲ BUY: ${buys}</span>
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;background:#ef444422;
                color:#ef4444;border:1px solid #ef444444;">▼ SELL: ${sells}</span>
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;background:#f59e0b22;
                color:#f59e0b;border:1px solid #f59e0b44;">● HOLD: ${holds}</span>
        </div>
    </div>

    <!-- PORTFOLIO SUMMARY -->
    <div style="background:#1e293b;border-radius:10px;padding:14px;margin-bottom:16px;border:1px solid #334155;">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:8px;">
            Portfolio Summary
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
                <td style="color:#94a3b8;font-size:12px;">Total Invested</td>
                <td style="color:#f1f5f9;font-size:13px;font-weight:600;text-align:right;">PKR ${summary.total_cost?.toLocaleString()}</td>
            </tr>
            <tr>
                <td style="color:#94a3b8;font-size:12px;padding-top:4px;">Market Value</td>
                <td style="color:#f1f5f9;font-size:13px;font-weight:600;text-align:right;padding-top:4px;">
                    PKR ${summary.total_value?.toLocaleString()}</td>
            </tr>
            <tr>
                <td style="color:#94a3b8;font-size:12px;padding-top:4px;">Unrealised P&L</td>
                <td style="font-size:14px;font-weight:800;color:${pnlColor};text-align:right;padding-top:4px;">
                    ${pnlSign}PKR ${summary.total_pnl?.toLocaleString()}
                    (${pnlSign}${summary.total_pnl_pct}%)
                </td>
            </tr>
        </table>
    </div>

    ${performance ? `
    <div style="background:#1e293b;border-radius:10px;padding:12px;margin-bottom:16px;border:1px solid #334155;">
        <span style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Signal Accuracy (Last Session)</span>
        <span style="float:right;font-size:14px;font-weight:800;color:#a78bfa;">
            ${performance.accuracy}% (${performance.correct}/${performance.total})
        </span>
    </div>` : ""}

    <!-- SIGNALS -->
    <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:10px;
        border-bottom:1px solid #1e293b;padding-bottom:6px;">
        Stock Signals
    </div>
    ${stockRows}

    ${geminiSection}

    <!-- FOOTER -->
    <div style="margin-top:20px;text-align:center;font-size:10px;color:#334155;">
        Generated by PSX Agent · ${time}<br/>
        This is algorithmic analysis only — not financial advice.
    </div>
</div>
</body>
</html>`;
}

// ──────────────────────────────
// WHATSAPP TEXT BUILDER
// ──────────────────────────────
function buildWhatsAppMessage(signals, summary, gemini, performance) {
    const time = nowPKT().format("DD MMM HH:mm");
    let msg = `📊 *PSX Report* — ${time}\n`;
    msg += `━━━━━━━━━━━━━━━\n`;

    // Portfolio P&L summary
    const pnlSign = summary.total_pnl >= 0 ? "+" : "";
    msg += `💼 Portfolio: PKR ${summary.total_value?.toLocaleString()}\n`;
    msg += `📈 P&L: ${pnlSign}PKR ${summary.total_pnl?.toLocaleString()} (${pnlSign}${summary.total_pnl_pct}%)\n\n`;

    // Signals
    const buys = Object.entries(signals).filter(([, s]) => s.action === "BUY");
    const sells = Object.entries(signals).filter(([, s]) => s.action === "SELL");
    const holds = Object.entries(signals).filter(([, s]) => s.action === "HOLD");

    if (buys.length) {
        msg += `✅ *BUY SIGNALS*\n`;
        buys.forEach(([sym, s]) => {
            msg += `• ${s.instruction}\n`;
            msg += `  Target: ${s.targetPrice} | SL: ${s.stopLoss} | ${s.confidence} confidence\n`;
        });
        msg += "\n";
    }

    if (sells.length) {
        msg += `🔴 *SELL SIGNALS*\n`;
        sells.forEach(([sym, s]) => {
            msg += `• ${s.instruction}\n`;
            msg += `  Target: ${s.targetPrice} | SL: ${s.stopLoss} | ${s.confidence} confidence\n`;
        });
        msg += "\n";
    }

    if (holds.length) {
        msg += `⏸ *HOLD:* ${holds.map(([sym]) => sym).join(", ")}\n\n`;
    }

    if (performance) {
        msg += `🎯 Last signal accuracy: ${performance.accuracy}%\n`;
    }

    if (gemini && !gemini.raw) {
        if (gemini.overall_stance) msg += `\n🤖 Gemini: *${gemini.overall_stance}*\n`;
        if (gemini.market_context) msg += `${gemini.market_context.slice(0, 200)}...\n`;
        if (gemini.risks?.length) msg += `⚠️ Risk: ${gemini.risks[0]}\n`;
    }

    msg += `\n_Algorithmic signal — not financial advice_`;
    return msg;
}

// ──────────────────────────────
// SENDERS
// ──────────────────────────────
async function sendWhatsApp(msg) {
    if (!FEATURES.message) return;
    try {
        const client = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        await client.messages.create({
            body: msg.slice(0, 1600),
            from: TWILIO_FROM,
            to: TWILIO_TO,
        });
        console.log("WhatsApp sent ✓");
    } catch (err) {
        console.error("WhatsApp error:", err.message);
    }
}

async function sendEmail(subject, html, text) {
    if (!FEATURES.email) return;
    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        });
        await transporter.sendMail({
            from: EMAIL_USER,
            to: EMAIL_TO,
            subject,
            html,
            text,
        });
        console.log("Email sent ✓");
    } catch (err) {
        console.error("Email error:", err.message);
    }
}

// ──────────────────────────────
// MAIN
// ──────────────────────────────
async function main() {
    const startTime = nowPKT();
    console.log(`[${startTime.format()}] PSX Agent starting...`);

    if (isWeekend()) {
        console.log("Market closed (weekend) — skipping.");
        process.exit(0);
    }

    await initDB();

    console.log("→ Fetching 6-month stock data from Yahoo Finance...");
    const stockData = await fetchStockData();

    console.log("→ Computing signals...");
    const signals = getSignals(stockData);
    const summary = portfolioSummary(stockData);

    console.log("→ Evaluating past signal performance...");
    const performance = await evaluatePerformance(stockData);

    console.log("→ Calling Gemini for market intelligence + signal validation...");
    const gemini = await getGeminiInsight(stockData, signals, summary);

    console.log("→ Building report...");
    const htmlEmail = buildHtmlEmail(stockData, signals, summary, performance, gemini);
    const waMessage = buildWhatsAppMessage(signals, summary, gemini, performance);

    const subject = `PSX Report — ${Object.values(signals).filter(s => s.action === "BUY").length}B / `
        + `${Object.values(signals).filter(s => s.action === "SELL").length}S — `
        + `${nowPKT().format("DD MMM HH:mm")}`;

    console.log("→ Saving to MongoDB...");
    await db.collection("signals").insertOne({
        createdAt: new Date(),
        signals,
        summary,
        gemini,
        snapshot: Object.fromEntries(
            Object.entries(stockData).map(([k, v]) => [
                k.replace(".KA", ""),
                { price: v.price, unrealized_pct: v.unrealized_pct }
            ])
        ),
    });

    console.log("→ Sending notifications...");
    await Promise.all([
        sendWhatsApp(waMessage),
        sendEmail(subject, htmlEmail, waMessage),
    ]);

    // Console preview
    console.log("\n" + "=".repeat(60));
    console.log("SIGNALS PREVIEW:");
    for (const [sym, s] of Object.entries(signals)) {
        const icon = s.action === "BUY" ? "✅" : s.action === "SELL" ? "🔴" : "⏸";
        console.log(`${icon} ${s.instruction}`);
    }
    console.log(`\nPortfolio P&L: ${summary.total_pnl >= 0 ? "+" : ""}PKR ${summary.total_pnl?.toLocaleString()} (${summary.total_pnl_pct}%)`);
    if (gemini?.overall_stance) console.log(`Gemini stance: ${gemini.overall_stance}`);
    console.log("=".repeat(60));

    const elapsed = moment().diff(startTime.toDate(), "seconds");
    console.log(`\n[${nowPKT().format()}] Done in ${elapsed}s`);
    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});