# PSX AI Portfolio Analyzer

An automated, production-grade TypeScript application that ingests national and international news, PSX market data, and macroeconomic indicators to analyse your Pakistan Stock Exchange portfolio — then uses an AI model (Claude / GPT-4o / Gemini) to validate signals and deliver a rich HTML email report and/or a condensed WhatsApp summary.

---

## Architecture

```
Layer 0  Config & env validation (Joi)
Layer 1  Parallel data ingestion  (news RSS, PSX market data, macro, fundamentals)
Layer 2  Preprocessing            (NLP sentiment, Shariah filter, data quality gate, circuit breaker)
Layer 3  Technical analysis       (RSI, MACD, Bollinger, ATR, OBV, candlestick patterns)
Layer 4  Scoring & discovery      (composite score, price targets, position sizing, alerts)
Layer 5  AI review                (Claude / GPT-4o / Gemini validates signals, adds narrative)
Layer 6  Report building          (HTML email + WhatsApp plain-text)
Layer 7  Notification dispatch    (SMTP / SendGrid / Twilio — 3x retry with exponential backoff)
Layer 8  Audit log                (structured JSON via pino)
```

---

## Quick Start

### 1. Clone & install

```bash
git clone <repo>
cd psx-analyzer
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — minimum required fields:
#   DB_CONNECTION_STRING
#   ANTHROPIC_API_KEY  (or OPENAI_API_KEY / GEMINI_API_KEY)
#   EMAIL_FROM / EMAIL_TO  (if NOTIFY_EMAIL=true)
#   WHATSAPP_TO / TWILIO_*  (if NOTIFY_WHATSAPP=true)
```

### 3. Run immediately

```bash
npm run dev -- --run-now      # development (ts-node)
npm run build && npm start -- --run-now   # production
```

### 4. Run on schedule (weekdays 9 AM PKT by default)

```bash
npm run build && npm start
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SHARIAH_MODE` | `compliant` | `compliant` / `non_compliant` / `both` |
| `INDEX_FILTER` | `KSE-100` | `KSE-100` / `KSE-30` / `ALL_SHARE` / `CUSTOM` |
| `AI_MODEL` | `claude` | `claude` / `gpt4o` / `gemini` |
| `ANTHROPIC_API_KEY` | — | Required when `AI_MODEL=claude` |
| `OPENAI_API_KEY` | — | Required when `AI_MODEL=gpt4o` |
| `GEMINI_API_KEY` | — | Required when `AI_MODEL=gemini` |
| `DB_CONNECTION_STRING` | — | PostgreSQL URI; falls back to static portfolio if unset |
| `NOTIFY_EMAIL` | `false` | Send HTML report by email |
| `NOTIFY_WHATSAPP` | `false` | Send condensed summary via WhatsApp |
| `NOTIFY_ON_ALERT_ONLY` | `false` | Only notify when alerts fire |
| `EMAIL_PROVIDER` | `smtp` | `smtp` / `sendgrid` / `ses` |
| `WHATSAPP_PROVIDER` | `twilio` | `twilio` / `meta` |
| `RUN_SCHEDULE` | `0 9 * * 1-5` | Cron expression (Asia/Karachi timezone) |
| `RUN_MODE` | `full` | `full` / `portfolio_only` / `discovery_only` / `alerts_only` |
| `CIRCUIT_BREAKER_INDEX_DROP_PCT` | `5` | Pause BUY signals if KSE-100 drops more than this % |
| `WEIGHT_TECHNICAL` | `0.40` | Composite score weight (all four must sum to 1.0) |
| `WEIGHT_SENTIMENT` | `0.20` | |
| `WEIGHT_FUNDAMENTAL` | `0.30` | |
| `WEIGHT_MACRO` | `0.10` | |

---

## Portfolio Database Schema

```sql
CREATE TABLE holdings (
  id        SERIAL PRIMARY KEY,
  symbol    VARCHAR(10)  NOT NULL,
  ticker    VARCHAR(10)  NOT NULL UNIQUE,
  shares    INTEGER      NOT NULL,
  avg_cost  NUMERIC(12,2) NOT NULL,
  name      VARCHAR(100) NOT NULL,
  sector    VARCHAR(50)  NOT NULL,
  type      VARCHAR(10)  NOT NULL DEFAULT 'psx'
);
```

If `DB_CONNECTION_STRING` is not set or the table is empty, the app falls back to the static seed portfolio defined in `src/db/portfolio-repository.ts`.

---

## Connecting Live Data Sources

All data ingestion is in `src/ingestion/`. The market data and fundamentals modules contain clearly marked `TODO` comments where you swap mock stubs for real API calls:

| Module | What to integrate |
|---|---|
| `market-data-fetcher.ts` | PSX Data Portal API, TREC feed, Alpha Vantage, Investing.com |
| `news-fetcher.ts` | RSS feeds are live; add ticker NER model for better entity extraction |
| `market-data-fetcher.ts` (macro) | SBP open data API, forex.com.pk for PKR rates, PSX weekly bulletin for FPI |

---

## Project Structure

```
src/
├── index.ts                         Entry point — immediate run or cron scheduler
├── engine.ts                        Main orchestrator — wires all layers together
├── config/index.ts                  Env var loading, Joi validation, CONFIG object
├── types/index.ts                   All TypeScript interfaces and types
├── ingestion/
│   ├── news-fetcher.ts              National + international RSS, entity extraction
│   └── market-data-fetcher.ts       OHLCV candles, macro snapshot, fundamentals
├── preprocessing/
│   ├── sentiment-analyser.ts        Lexicon NLP, recency-weighted per-ticker scoring
│   ├── shariah-filter.ts            Filter universe by Shariah compliance flag
│   └── data-quality.ts             Gap detection, liquidity check, penny-stock gate
├── analysis/
│   ├── technical-indicators.ts      RSI, MACD, BB, ATR, OBV, stochastic, patterns
│   └── signal-engine.ts            Weighted signal aggregation → conviction score
├── scoring/
│   ├── composite-scorer.ts          Composite score, price targets, position sizing
│   └── alert-evaluator.ts          Per-holding alerts, sector concentration, circuit breaker
├── ai-review/
│   ├── prompt-builder.ts            System prompt + runtime user prompt builder
│   └── ai-client.ts                Claude / GPT-4o / Gemini callers + response parser
├── reporting/
│   └── report-builder.ts           HTML email report + WhatsApp plain-text builder
├── notifications/
│   ├── email-sender.ts             Nodemailer (SMTP / SendGrid / SES)
│   ├── whatsapp-sender.ts          Twilio WhatsApp API
│   └── notification-dispatcher.ts  Orchestrates both channels with 3x retry
├── scheduler/
│   └── cron-scheduler.ts           Cron job with overlap guard
├── db/
│   └── portfolio-repository.ts     PostgreSQL query + static fallback
└── utils/
    ├── logger.ts                    Pino structured logger
    ├── http-client.ts               Axios with retry
    └── helpers.ts                   Normalise, round, formatPkr, recencyDecay, etc.
```

---

## Docker

```bash
docker build -t psx-analyzer .
docker run --env-file .env psx-analyzer --run-now
```

---

## Extending

- **Add a new indicator**: compute it in `technical-indicators.ts`, add its name to `TechnicalIndicators` type, add the signal rule in `signal-engine.ts`
- **Add a new news source**: add the RSS URL to `PSX_NEWS_SOURCES` in `config/index.ts`
- **Add a new notification channel**: create `src/notifications/telegram-sender.ts`, add a flag in `.env.example` and `config/index.ts`, call it from `notification-dispatcher.ts`
- **Add backtesting**: the full `RunOutput` JSON is logged on every run — replay archived outputs through the scoring layer to measure historical accuracy

---

## Disclaimer

This software is for informational purposes only. It does not constitute financial advice. Always conduct your own due diligence before making investment decisions. Past performance does not guarantee future results. Investing in equities involves risk of capital loss.
