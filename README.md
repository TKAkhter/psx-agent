# PSX Analyzer v2

Automated AI-powered Pakistan Stock Exchange portfolio analysis system.

Runs on a schedule via Render.com cron, generates a full PDF report, and delivers it via email and/or WhatsApp.

---

## What it does

1. **Ingests** national & international news (RSS), PSX market data, macro indicators, and per-ticker fundamentals
2. **Analyses** every portfolio holding and the full KSE-100 discovery universe with 17 signal categories across 30+ technical indicators
3. **Scores** each stock on a 0–100 composite scale (technical 35% + fundamental 35% + macro 15% + sentiment 15%)
4. **Generates** precise buy/sell/hold guidance with exact entry prices, three targets, and ATR-based stop losses
5. **Suggests replacements** — when recommending SELL, the system automatically suggests which portfolio stock (or discovery pick) to buy instead
6. **Sends AI review** through Claude/GPT-4o/Gemini for validation, narrative, Pakistan-specific risk commentary, and signal override
7. **Generates a PDF** with the full report (Puppeteer → Chromium)
8. **Delivers** the PDF via email (with rich text body) and/or WhatsApp (with condensed summary)

---

## Quick Start

```bash
# 1. Install
npm install
npx prisma generate

# 2. Configure
cp .env.example .env
# Fill in: DATABASE_URL, ANTHROPIC_API_KEY, EMAIL_*, TWILIO_* (if WhatsApp)

# 3. Run
npm run dev          # ts-node, single run, exits when done
npm run build && npm start  # compiled production run
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | MongoDB connection string for Prisma |
| `SHARIAH_MODE` | `compliant` | `compliant` / `non_compliant` / `both` |
| `INDEX_FILTER` | `KSE-100` | Discovery universe filter |
| `AI_MODEL` | `claude` | `claude` / `gpt4o` / `gemini` |
| `ANTHROPIC_API_KEY` | — | Required for Claude |
| `OPENAI_API_KEY` | — | Required for GPT-4o |
| `GEMINI_API_KEY` | — | Required for Gemini |
| `PSXTERMINAL_API_KEY` | — | PSX Terminal API key (falls back to mock data if absent) |
| `NOTIFY_EMAIL` | `false` | Send PDF via email |
| `NOTIFY_WHATSAPP` | `false` | Send summary + PDF note via WhatsApp |
| `NOTIFY_ON_ALERT_ONLY` | `false` | Only notify when critical/warning alerts fire |
| `EMAIL_PROVIDER` | `smtp` | `smtp` / `sendgrid` / `ses` |
| `EMAIL_FROM` | — | Sender address |
| `EMAIL_TO` | — | Recipient address |
| `WEIGHT_TECHNICAL` | `0.35` | Composite score weight |
| `WEIGHT_FUNDAMENTAL` | `0.35` | Composite score weight |
| `WEIGHT_MACRO` | `0.15` | Composite score weight |
| `WEIGHT_SENTIMENT` | `0.15` | Composite score weight |
| `CIRCUIT_BREAKER_INDEX_DROP_PCT` | `5` | Pause BUY signals if KSE-100 drops > N% |

---

## MongoDB Collection Schema

The app reads from a `holdings` collection. Each document must have:

```json
{
  "symbol":  "MEBL",
  "ticker":  "MEBL",
  "shares":  1150,
  "avgCost": 429.93,
  "name":    "Meezan Bank",
  "sector":  "Banking"
}
```

If the collection is empty or unreachable, the app falls back to the static seed portfolio defined in `src/db/portfolio-repository.ts`.

---

## Deploying on Render

1. Push this repo to GitHub
2. In Render dashboard → New → Cron Job → Docker
3. Set environment variables in the Render dashboard
4. Set schedule: `0 4 * * 1-5` (4am UTC = 9am PKT, weekdays)
5. Render builds the Docker image and runs it on schedule — no manual intervention needed

The `render.yaml` file in this repo configures the service automatically.

---

## Connecting Live PSX Data

All data comes from `src/ingestion/psxterminal-client.ts`. 

Register at [psxterminal.com](https://psxterminal.com) and set `PSXTERMINAL_API_KEY` to replace all mock stubs with live data. Each function has a `TODO` comment showing the exact endpoint to call.

---

## Project Structure

```
src/
├── index.ts                          Entry point — runs once, exits
├── engine.ts                         Main orchestrator
├── config/index.ts                   Env validation + CONFIG constant
├── types/index.ts                    All TypeScript interfaces
├── db/
│   ├── prisma-client.ts              Prisma singleton (MongoDB)
│   └── portfolio-repository.ts       Read holdings + save run logs
├── ingestion/
│   ├── psxterminal-client.ts         Market data, fundamentals, macro
│   └── news-fetcher.ts               RSS news + entity sentiment scoring
├── preprocessing/
│   ├── shariah-filter.ts             Filter by Shariah compliance flag
│   └── data-quality.ts              Gap detection, liquidity gate
├── analysis/
│   ├── technical-indicators.ts       30+ indicators (RSI, MACD, ADX, CMF, etc.)
│   └── signal-engine.ts             17 signal categories → conviction score
├── scoring/
│   ├── composite-scorer.ts           Composite score, price targets, position sizing
│   └── alert-evaluator.ts           10 alert types + replacement suggestions
├── ai-review/
│   ├── prompt-builder.ts             System + user prompt construction
│   └── ai-client.ts                 Claude / GPT-4o / Gemini callers
├── reporting/
│   └── pdf-builder.ts               HTML → PDF via Puppeteer
├── notifications/
│   ├── email-sender.ts              SMTP/SendGrid/SES with PDF attachment
│   ├── whatsapp-sender.ts           Twilio WhatsApp
│   └── dispatcher.ts               Orchestrates both channels with 3× retry
└── utils/
    ├── logger.ts                    Pino structured logger
    ├── http-client.ts               Axios with retry
    └── helpers.ts                   Formatters, maths, score grade
prisma/
└── schema.prisma                    MongoDB schema (Holding + RunLog)
```

---

## Technical Indicators Reference

The system computes and signals on all of the following:

| Category | Indicators |
|---|---|
| Moving Averages | SMA 10/20/50/100/200, EMA 9/12/21/26/50, VWAP |
| Momentum | RSI-14/9 + divergence, MACD (line/signal/cross), Stochastic K/D, Williams %R, CCI-20, MFI-14, ROC-10 |
| Volatility | ATR-14, Bollinger Bands (width, squeeze, position), Historical Volatility 30d |
| Volume | OBV + trend, Accumulation/Distribution, Chaikin Money Flow, Volume ratio |
| Trend Strength | ADX-14, +DI/-DI, Ichimoku cloud signal |
| Support/Resistance | 3-level S/R, Pivot points (classic), Fibonacci 38.2/50/61.8% |
| Candlesticks | Doji, Hammer, Shooting Star, Bullish/Bearish Engulfing, Morning/Evening Star, Inverted Hammer |

---

## Disclaimer

This software is for informational purposes only. It does not constitute financial advice.
Always conduct your own due diligence before making investment decisions.
Past performance does not guarantee future results. Investing in equities involves risk of capital loss.
