import "dotenv/config";
import type { PortfolioType, EmailTheme, PortfolioEntry } from "./types";

export type { PortfolioType, EmailTheme, PortfolioEntry } from "./types";

// ─────────────────────────────────────────────────────────────
//  CONFIG-SPECIFIC TYPES
// ─────────────────────────────────────────────────────────────

export interface EnvConfig {
  // MongoDB
  MONGODB_URI: string;
  MONGODB_DB: string;
  // Email
  EMAIL_ENABLED: boolean;
  EMAIL_USER: string;
  EMAIL_PASS: string;
  EMAIL_TO: string;
  EMAIL_THEME: EmailTheme;
  // Green API WhatsApp  (green-api.com)
  WHATSAPP_ENABLED: boolean;
  WHATSAPP_INSTANCE_ID: string; // Green API instance ID
  WHATSAPP_TOKEN: string; // Green API instance token
  WHATSAPP_CHAT_ID: string; // e.g. 923001234567@c.us
  GREEN_API_URL: string; // e.g. https://7107.api.greenapi.com (instance-specific host)
  // Gemini
  GEMINI_ENABLED: boolean;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  // Data
  PORTFOLIO_TYPE: PortfolioType;
  PSX_BASE_URL: string;
  // Data mode (PSX only)
  // A = PSX live tick only (no history, indicators null)
  // B = Yahoo Finance OHLCV + PSX live tick override (full indicators)
  DATA_MODE: "A" | "B";
  // Misc
  TIMEZONE: string;
}

// ─────────────────────────────────────────────────────────────
//  ENVIRONMENT
// ─────────────────────────────────────────────────────────────

export const ENV: EnvConfig = {
  MONGODB_URI: process.env.MONGODB_URI ?? "",
  MONGODB_DB: process.env.MONGODB_DB ?? "psx_agent",

  EMAIL_ENABLED: process.env.EMAIL_ENABLED === "true",
  EMAIL_USER: process.env.EMAIL_USER ?? "",
  EMAIL_PASS: process.env.EMAIL_PASS ?? "",
  EMAIL_TO: process.env.EMAIL_TO ?? "",
  EMAIL_THEME: (process.env.EMAIL_THEME === "light"
    ? "light"
    : "dark") as EmailTheme,

  // Green API WhatsApp  (free tier: 1500 messages/month)
  // Setup: green-api.com → create instance → scan QR with WhatsApp
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED === "true",
  WHATSAPP_INSTANCE_ID: process.env.WHATSAPP_INSTANCE_ID ?? "",
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN ?? "",
  WHATSAPP_CHAT_ID: process.env.WHATSAPP_CHAT_ID ?? "",
  GREEN_API_URL:
    process.env.GREEN_API_URL ??
    `https://${process.env.WHATSAPP_INSTANCE_ID ?? "api"}.api.greenapi.com`,

  GEMINI_ENABLED: process.env.GEMINI_ENABLED === "true",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-preview-04-17",

  PORTFOLIO_TYPE: (process.env.PORTFOLIO_TYPE === "yahoo"
    ? "yahoo"
    : "psx") as PortfolioType,
  PSX_BASE_URL: process.env.PSX_BASE_URL ?? "https://psxterminal.com",
  DATA_MODE: (process.env.DATA_MODE?.toUpperCase() === "A" ? "A" : "B") as "A" | "B",

  TIMEZONE: "Asia/Karachi",
};

// ─────────────────────────────────────────────────────────────
//  SIGNAL SCORING CONSTANTS
// ─────────────────────────────────────────────────────────────

export const SIGNAL_THRESHOLDS = Object.freeze({
  STRONG_BUY: 8,
  BUY: 4,
  SELL: -4,
  STRONG_SELL: -8,
} as const);

export const SCORE_WEIGHTS = Object.freeze({
  // Oscillators
  RSI_EXTREME: 4,
  RSI_DEEP: 3,
  RSI_NORMAL: 2,
  RSI_MILD: 1,
  MFI_EXTREME: 3,
  MFI_NORMAL: 2,
  ROC_STRONG: 2,
  ROC_MILD: 1,
  STOCH_EXTREME: 3,
  STOCH_NORMAL: 2,
  STOCH_CROSS: 1,
  CCI_EXTREME: 2,
  CCI_NORMAL: 1,
  WILLIAMS_EXTREME: 2,
  WILLIAMS_NORMAL: 1,
  // Trend
  SUPERTREND: 3,
  MACD_CROSSOVER: 3,
  MACD_HISTOGRAM: 2,
  MACD_WEAK: 1,
  ADX_STRONG: 2,
  ADX_WEAK: 1,
  ICHI_CLOUD: 2,
  ICHI_TK: 1,
  // Price structure
  BB_EXTREME: 4,
  BB_NEAR: 2,
  MA_CROSS: 1,
  VWAP: 2,
  PIVOT_LEVEL: 1,
  POSITION_6M: 1,
  // Flow
  OBV: 2,
  VOLUME_CONFIRM: 1,
  // Patterns
  PATTERN_MAJOR: 2,
  PATTERN_MINOR: 1,
  DIVERGENCE: 2,
  // Fundamentals (mild bias)
  FUNDAMENTAL_PE: 1,
  FUNDAMENTAL_DIV: 1,
} as const);

export const RSI_LEVELS = Object.freeze({
  EXTREME_OVERSOLD: 20,
  DEEPLY_OVERSOLD: 25,
  OVERSOLD: 35,
  MILD_OVERSOLD: 45,
  MILD_OVERBOUGHT: 55,
  OVERBOUGHT: 65,
  DEEPLY_OVERBOUGHT: 75,
  EXTREME_OVERBOUGHT: 80,
} as const);

// ─────────────────────────────────────────────────────────────
//  DEFAULT PORTFOLIO  (seeded to MongoDB on first run)
// ─────────────────────────────────────────────────────────────

export const DEFAULT_PORTFOLIO: ReadonlyArray<PortfolioEntry> = Object.freeze([
  {
    symbol: "MEBL",
    ticker: "MEBL",
    shares: 1150,
    avgCost: 429.93,
    name: "Meezan Bank",
    sector: "Banking",
  },
  {
    symbol: "OGDC",
    ticker: "OGDC",
    shares: 1100,
    avgCost: 266.29,
    name: "OGDC",
    sector: "Oil & Gas",
  },
  {
    symbol: "HUBC",
    ticker: "HUBC",
    shares: 1100,
    avgCost: 191.85,
    name: "Hub Power",
    sector: "Energy",
  },
  {
    symbol: "EFERT",
    ticker: "EFERT",
    shares: 900,
    avgCost: 202.37,
    name: "Engro Fertilizer",
    sector: "Fertilizer",
  },
  {
    symbol: "ENGROH",
    ticker: "ENGROH",
    shares: 400,
    avgCost: 279.51,
    name: "Engro Holdings",
    sector: "Conglomerate",
  },
  {
    symbol: "FFC",
    ticker: "FFC",
    shares: 400,
    avgCost: 507.94,
    name: "Fauji Fertilizer",
    sector: "Fertilizer",
  },
  {
    symbol: "LUCK",
    ticker: "LUCK",
    shares: 300,
    avgCost: 378.7,
    name: "Lucky Cement",
    sector: "Cement",
  },
  {
    symbol: "MARI",
    ticker: "MARI",
    shares: 200,
    avgCost: 635.0,
    name: "Mari Petroleum",
    sector: "Oil & Gas",
  },
  {
    symbol: "POL",
    ticker: "POL",
    shares: 200,
    avgCost: 639.18,
    name: "Pakistan Oilfields",
    sector: "Oil & Gas",
  },
  {
    symbol: "SYS",
    ticker: "SYS",
    shares: 750,
    avgCost: 137.25,
    name: "Systems Ltd",
    sector: "Technology",
  },
]);
