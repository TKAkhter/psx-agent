import dotenv from 'dotenv';
import Joi from 'joi';
import type { ShariahMode, IndexFilter, AiModel, RunMode, EmailProvider, WhatsAppProvider } from '../types';

dotenv.config();

// ─── Validation Schema ────────────────────────────────────────────────────────

const schema = Joi.object({
  SHARIAH_MODE: Joi.string().valid('compliant', 'non_compliant', 'both').default('compliant'),
  INDEX_FILTER: Joi.string().valid('KSE-100', 'KSE-30', 'ALL_SHARE', 'CUSTOM').default('KSE-100'),
  CUSTOM_TICKERS: Joi.string().allow('').default(''),

  AI_MODEL: Joi.string().valid('claude', 'gpt4o', 'gemini').default('gemini'),
  ANTHROPIC_API_KEY: Joi.string().when('AI_MODEL', { is: 'claude', then: Joi.required() }).allow(''),
  OPENAI_API_KEY: Joi.string().when('AI_MODEL', { is: 'gpt4o', then: Joi.required() }).allow(''),
  GEMINI_API_KEY: Joi.string().when('AI_MODEL', { is: 'gemini', then: Joi.required() }).allow(''),
  GEMINI_MODEL: Joi.string().when('AI_MODEL', { is: 'gemini', then: Joi.required() }).default('gemini-3.1-flash-lite-preview'),
  AI_MODEL_TEMP: Joi.number().min(0).max(1).default(0.2),
  AI_MAX_TOKENS: Joi.number().integer().min(500).max(8000).default(4000),

  WEIGHT_TECHNICAL: Joi.number().default(0.40),
  WEIGHT_SENTIMENT: Joi.number().default(0.20),
  WEIGHT_FUNDAMENTAL: Joi.number().default(0.30),
  WEIGHT_MACRO: Joi.number().default(0.10),

  DB_CONNECTION_STRING: Joi.string().required(),
  PORTFOLIO_TABLE: Joi.string().default('holdings'),

  NOTIFY_EMAIL: Joi.string().valid('true', 'false').default('false'),
  NOTIFY_WHATSAPP: Joi.string().valid('true', 'false').default('false'),
  NOTIFY_ON_ALERT_ONLY: Joi.string().valid('true', 'false').default('false'),

  EMAIL_PROVIDER: Joi.string().valid('smtp', 'sendgrid', 'ses').default('smtp'),
  EMAIL_FROM: Joi.string().email().when('NOTIFY_EMAIL', { is: 'true', then: Joi.required() }).allow(''),
  EMAIL_TO: Joi.string().email().when('NOTIFY_EMAIL', { is: 'true', then: Joi.required() }).allow(''),
  SENDGRID_API_KEY: Joi.string().allow('').default(''),
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),

  WHATSAPP_PROVIDER: Joi.string().valid('twilio', 'meta').default('meta'),
  WHATSAPP_TO: Joi.string().allow('').default(''),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').default(''),
  TWILIO_WHATSAPP_FROM: Joi.string().allow('').default('whatsapp:+14155238886'),

  RUN_SCHEDULE: Joi.string().default('0 9 * * 1-5'),
  RUN_MODE: Joi.string().valid('full', 'portfolio_only', 'discovery_only', 'alerts_only').default('full'),

  ALERT_RSI_OVERSOLD: Joi.number().default(30),
  ALERT_RSI_OVERBOUGHT: Joi.number().default(70),
  ALERT_PRICE_DROP_PCT: Joi.number().default(5),
  ALERT_STOP_LOSS_BREACH: Joi.string().valid('true', 'false').default('true'),
  ALERT_AI_HIGH_CONFIDENCE_SELL: Joi.string().valid('true', 'false').default('true'),
  CIRCUIT_BREAKER_INDEX_DROP_PCT: Joi.number().default(5),

  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error').default('info'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
}).unknown(true);

const { error, value } = schema.validate(process.env);
if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const env = value as Record<string, string>;

// ─── Exported Config Object ───────────────────────────────────────────────────

export const CONFIG = {
  // Filters
  SHARIAH_MODE: env.SHARIAH_MODE as ShariahMode,
  INDEX_FILTER: env.INDEX_FILTER as IndexFilter,
  CUSTOM_TICKERS: env.CUSTOM_TICKERS
    ? env.CUSTOM_TICKERS.split(',').map((t) => t.trim())
    : [],

  // AI
  AI_MODEL: env.AI_MODEL as AiModel,
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  GEMINI_API_KEY: env.GEMINI_API_KEY,
  GEMINI_MODEL: env.GEMINI_MODEL,
  AI_MODEL_TEMP: parseFloat(env.AI_MODEL_TEMP),
  AI_MAX_TOKENS: parseInt(env.AI_MAX_TOKENS),

  // Weights
  WEIGHTS: {
    TECHNICAL: parseFloat(env.WEIGHT_TECHNICAL),
    SENTIMENT: parseFloat(env.WEIGHT_SENTIMENT),
    FUNDAMENTAL: parseFloat(env.WEIGHT_FUNDAMENTAL),
    MACRO: parseFloat(env.WEIGHT_MACRO),
  },

  // DB
  DB_CONNECTION_STRING: env.DB_CONNECTION_STRING,
  PORTFOLIO_TABLE: env.PORTFOLIO_TABLE,

  // Notifications
  NOTIFY_EMAIL: env.NOTIFY_EMAIL === 'true',
  NOTIFY_WHATSAPP: env.NOTIFY_WHATSAPP === 'true',
  NOTIFY_ON_ALERT_ONLY: env.NOTIFY_ON_ALERT_ONLY === 'true',

  // Email
  EMAIL_PROVIDER: env.EMAIL_PROVIDER as EmailProvider,
  EMAIL_FROM: env.EMAIL_FROM,
  EMAIL_TO: env.EMAIL_TO,
  SENDGRID_API_KEY: env.SENDGRID_API_KEY,
  SMTP_HOST: env.SMTP_HOST,
  SMTP_PORT: parseInt(env.SMTP_PORT),
  SMTP_USER: env.SMTP_USER,
  SMTP_PASS: env.SMTP_PASS,

  // WhatsApp
  WHATSAPP_PROVIDER: env.WHATSAPP_PROVIDER as WhatsAppProvider,
  WHATSAPP_TO: env.WHATSAPP_TO,
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM: env.TWILIO_WHATSAPP_FROM,

  // Schedule & Run
  RUN_SCHEDULE: env.RUN_SCHEDULE,
  RUN_MODE: env.RUN_MODE as RunMode,

  // Alert thresholds
  ALERT_RSI_OVERSOLD: parseFloat(env.ALERT_RSI_OVERSOLD),
  ALERT_RSI_OVERBOUGHT: parseFloat(env.ALERT_RSI_OVERBOUGHT),
  ALERT_PRICE_DROP_PCT: parseFloat(env.ALERT_PRICE_DROP_PCT),
  ALERT_STOP_LOSS_BREACH: env.ALERT_STOP_LOSS_BREACH === 'true',
  ALERT_AI_HIGH_CONFIDENCE_SELL: env.ALERT_AI_HIGH_CONFIDENCE_SELL === 'true',
  CIRCUIT_BREAKER_INDEX_DROP_PCT: parseFloat(env.CIRCUIT_BREAKER_INDEX_DROP_PCT),

  // System
  LOG_LEVEL: env.LOG_LEVEL,
  NODE_ENV: env.NODE_ENV,

  // Static PSX data
  PSX_NEWS_SOURCES: [
    'https://www.dawn.com/business',
    'https://profit.pakistantoday.com.pk/feed/',
    'https://businessrecorder.com/feed/',
    'https://arynews.net/tag/business/feed/',
  ],
  INTL_NEWS_SOURCES: [
    'https://feeds.reuters.com/reuters/PKbusinessNews',
    'https://www.ft.com/emerging-markets?format=rss',
  ],
  SHARIAH_COMPLIANT_TICKERS: [
    'MEBL', 'BAHL', 'MCB', 'UBL', 'HBL',
    'EFERT', 'FFBL', 'FFC', 'ENGRO', 'ENGROH',
    'LUCK', 'DGKC', 'CHCC',
    'PSO', 'HASCOL',
    'SYS', 'TRG', 'NETSOL',
    'HUBC', 'KAPCO', 'KEL',
    'OGDC', 'MARI', 'POL', 'PPL',
  ],
} as const;

// Validate weights sum to 1
const weightSum = Object.values(CONFIG.WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`Analysis weights must sum to 1.0, got ${weightSum}`);
}
