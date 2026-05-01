import "dotenv/config";
import type { PortfolioType, EmailTheme, PortfolioEntry } from "./types";

// ─────────────────────────────────────────────────────────────
//  ENVIRONMENT CONFIG
// ─────────────────────────────────────────────────────────────

export const ENV = Object.freeze({
  // MongoDB
  MONGODB_URI:           process.env.MONGODB_URI           ?? "",
  MONGODB_DB:            process.env.MONGODB_DB            ?? "psx_agent",
  // Email
  EMAIL_ENABLED:         process.env.EMAIL_ENABLED         === "true",
  EMAIL_USER:            process.env.EMAIL_USER            ?? "",
  EMAIL_PASS:            process.env.EMAIL_PASS            ?? "",
  EMAIL_TO:              process.env.EMAIL_TO              ?? "",
  EMAIL_THEME:           (process.env.EMAIL_THEME === "light" ? "light" : "dark") as EmailTheme,
  // Green API WhatsApp  (https://green-api.com — free 1500 msgs/month)
  WHATSAPP_ENABLED:      process.env.WHATSAPP_ENABLED      === "true",
  WHATSAPP_INSTANCE_ID:  process.env.WHATSAPP_INSTANCE_ID  ?? "",   // e.g. 7107597280
  WHATSAPP_TOKEN:        process.env.WHATSAPP_TOKEN        ?? "",   // instance token
  WHATSAPP_CHAT_ID:      process.env.WHATSAPP_CHAT_ID      ?? "",   // e.g. 923342137306@c.us
  // Gemini
  GEMINI_ENABLED:        process.env.GEMINI_ENABLED        === "true",
  GEMINI_API_KEY:        process.env.GEMINI_API_KEY        ?? "",
  GEMINI_MODEL:          process.env.GEMINI_MODEL          ?? "gemini-2.5-flash-preview-04-17",
  // Data source
  PORTFOLIO_TYPE:        (process.env.PORTFOLIO_TYPE === "yahoo" ? "yahoo" : "psx") as PortfolioType,
  PSX_BASE_URL:          process.env.PSX_BASE_URL          ?? "https://psxterminal.com",
  // Misc
  TIMEZONE:              "Asia/Karachi",
});

// ─────────────────────────────────────────────────────────────
//  SIGNAL SCORING THRESHOLDS
// ─────────────────────────────────────────────────────────────

export const SIGNAL_THRESHOLDS = Object.freeze({
  STRONG_BUY:   10,   // raised from 8 — require stronger confluence
  BUY:           5,
  SELL:         -5,
  STRONG_SELL: -10,
} as const);

// ─────────────────────────────────────────────────────────────
//  SCORE WEIGHTS  (PSX-tuned)
// ─────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = Object.freeze({
  // Oscillators — oversold/overbought
  RSI_EXTREME:        4,
  RSI_DEEP:           3,
  RSI_NORMAL:         2,
  RSI_MILD:           1,
  MFI_EXTREME:        3,   // volume-weighted RSI — high weight
  MFI_NORMAL:         2,
  ROC_STRONG:         2,
  ROC_MILD:           1,
  STOCH_EXTREME:      3,
  STOCH_NORMAL:       2,
  STOCH_CROSS:        1,
  CCI_EXTREME:        2,
  CCI_NORMAL:         1,
  WILLIAMS_EXTREME:   2,
  WILLIAMS_NORMAL:    1,
  // Trend
  SUPERTREND:         3,   // PSX retail favourite — single clean signal
  MACD_CROSSOVER:     3,
  MACD_HISTOGRAM:     2,
  MACD_WEAK:          1,
  ADX_STRONG:         2,
  ADX_WEAK:           1,
  ICHI_CLOUD:         2,
  ICHI_TK:            1,
  MARKET_REGIME:      2,   // NEW: trending vs ranging regime
  // Price structure
  BB_EXTREME:         4,
  BB_NEAR:            2,
  MA_CROSS:           1,
  VWAP:               2,
  VWAP_DEV:           1,   // NEW: VWAP deviation %
  PIVOT_LEVEL:        1,
  POSITION_6M:        1,
  // Flow
  OBV:                2,
  VOLUME_CONFIRM:     1,
  // Patterns
  PATTERN_MAJOR:      2,
  PATTERN_MINOR:      1,
  DIVERGENCE:         2,
  // Fundamentals (mild bias — confirms, does not drive)
  FUNDAMENTAL_PE:     1,
  FUNDAMENTAL_DIV:    1,
  FUNDAMENTAL_PB:     1,   // NEW: Price-to-Book ratio
} as const);

export const RSI_LEVELS = Object.freeze({
  EXTREME_OVERSOLD:    20,
  DEEPLY_OVERSOLD:     25,
  OVERSOLD:            35,
  MILD_OVERSOLD:       45,
  MILD_OVERBOUGHT:     55,
  OVERBOUGHT:          65,
  DEEPLY_OVERBOUGHT:   75,
  EXTREME_OVERBOUGHT:  80,
} as const);

// ─────────────────────────────────────────────────────────────
//  DEFAULT PORTFOLIO  (seeded to MongoDB on first run)
// ─────────────────────────────────────────────────────────────

export const DEFAULT_PORTFOLIO: ReadonlyArray<PortfolioEntry> = Object.freeze([
  { symbol: "MEBL",   ticker: "MEBL",   shares: 1150, avgCost: 429.93, name: "Meezan Bank",        sector: "Banking"      },
  { symbol: "OGDC",   ticker: "OGDC",   shares: 1100, avgCost: 266.29, name: "OGDC",               sector: "Oil & Gas"    },
  { symbol: "HUBC",   ticker: "HUBC",   shares: 1100, avgCost: 191.85, name: "Hub Power",          sector: "Energy"       },
  { symbol: "EFERT",  ticker: "EFERT",  shares:  900, avgCost: 202.37, name: "Engro Fertilizer",   sector: "Fertilizer"   },
  { symbol: "ENGROH", ticker: "ENGROH", shares:  400, avgCost: 279.51, name: "Engro Holdings",     sector: "Conglomerate" },
  { symbol: "FFC",    ticker: "FFC",    shares:  400, avgCost: 507.94, name: "Fauji Fertilizer",   sector: "Fertilizer"   },
  { symbol: "LUCK",   ticker: "LUCK",   shares:  300, avgCost: 378.70, name: "Lucky Cement",       sector: "Cement"       },
  { symbol: "MARI",   ticker: "MARI",   shares:  200, avgCost: 635.00, name: "Mari Petroleum",     sector: "Oil & Gas"    },
  { symbol: "POL",    ticker: "POL",    shares:  200, avgCost: 639.18, name: "Pakistan Oilfields", sector: "Oil & Gas"    },
  { symbol: "SYS",    ticker: "SYS",    shares:  750, avgCost: 137.25, name: "Systems Ltd",        sector: "Technology"   },
]);