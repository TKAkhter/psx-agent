import dotenv from 'dotenv';
import Joi from 'joi';
import type { ShariahMode, IndexFilter, AiModel, EmailProvider } from '../types';

dotenv.config();

const schema = Joi.object({
  DATABASE_URL:                 Joi.string().required(),
  SHARIAH_MODE:                 Joi.string().valid('compliant','non_compliant','both').default('compliant'),
  INDEX_FILTER:                 Joi.string().valid('KSE-100','KSE-30','ALL_SHARE','CUSTOM').default('KSE-100'),
  AI_MODEL:                     Joi.string().valid('claude','gpt4o','gemini').default('gemini'),
  ANTHROPIC_API_KEY:            Joi.string().allow('').default(''),
  OPENAI_API_KEY:               Joi.string().allow('').default(''),
  GEMINI_API_KEY:               Joi.string().allow('').default(''),
  GEMINI_MODEL: Joi.string().when('AI_MODEL', { is: 'gemini', then: Joi.required() }).default('gemini-3.1-flash-lite-preview'),
  AI_MODEL_TEMP:                Joi.number().min(0).max(1).default(0.2),
  AI_MAX_TOKENS:                Joi.number().default(4000),
  WEIGHT_TECHNICAL:             Joi.number().default(0.35),
  WEIGHT_SENTIMENT:             Joi.number().default(0.15),
  WEIGHT_FUNDAMENTAL:           Joi.number().default(0.35),
  WEIGHT_MACRO:                 Joi.number().default(0.15),
  NOTIFY_EMAIL:                 Joi.string().valid('true','false').default('false'),
  NOTIFY_WHATSAPP:              Joi.string().valid('true','false').default('false'),
  NOTIFY_ON_ALERT_ONLY:         Joi.string().valid('true','false').default('false'),
  EMAIL_PROVIDER:               Joi.string().valid('smtp','sendgrid','ses').default('smtp'),
  EMAIL_FROM:                   Joi.string().allow('').default(''),
  EMAIL_TO:                     Joi.string().allow('').default(''),
  SENDGRID_API_KEY:             Joi.string().allow('').default(''),
  SMTP_HOST:                    Joi.string().allow('').default(''),
  SMTP_PORT:                    Joi.number().default(587),
  SMTP_USER:                    Joi.string().allow('').default(''),
  SMTP_PASS:                    Joi.string().allow('').default(''),
  WHATSAPP_TO:                  Joi.string().allow('').default(''),
  TWILIO_ACCOUNT_SID:           Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN:            Joi.string().allow('').default(''),
  TWILIO_WHATSAPP_FROM:         Joi.string().default('whatsapp:+14155238886'),
  ALERT_RSI_OVERSOLD:           Joi.number().default(30),
  ALERT_RSI_OVERBOUGHT:         Joi.number().default(70),
  ALERT_PRICE_DROP_PCT:         Joi.number().default(5),
  CIRCUIT_BREAKER_INDEX_DROP_PCT: Joi.number().default(5),
  PSXTERMINAL_API_KEY:          Joi.string().allow('').default(''),
  LOG_LEVEL:                    Joi.string().default('info'),
  NODE_ENV:                     Joi.string().default('development'),
}).unknown(true);

const { error, value } = schema.validate(process.env);
if (error) throw new Error(`Config error: ${error.message}`);
const e = value as Record<string, string>;

export const CONFIG = {
  DATABASE_URL:           e.DATABASE_URL,
  SHARIAH_MODE:           e.SHARIAH_MODE as ShariahMode,
  INDEX_FILTER:           e.INDEX_FILTER as IndexFilter,
  AI_MODEL:               e.AI_MODEL as AiModel,
  ANTHROPIC_API_KEY:      e.ANTHROPIC_API_KEY,
  OPENAI_API_KEY:         e.OPENAI_API_KEY,
  GEMINI_API_KEY:         e.GEMINI_API_KEY,
  GEMINI_MODEL: e.GEMINI_MODEL,
  AI_MODEL_TEMP:          parseFloat(e.AI_MODEL_TEMP),
  AI_MAX_TOKENS:          parseInt(e.AI_MAX_TOKENS),
  WEIGHTS: {
    TECHNICAL:   parseFloat(e.WEIGHT_TECHNICAL),
    SENTIMENT:   parseFloat(e.WEIGHT_SENTIMENT),
    FUNDAMENTAL: parseFloat(e.WEIGHT_FUNDAMENTAL),
    MACRO:       parseFloat(e.WEIGHT_MACRO),
  },
  NOTIFY_EMAIL:           e.NOTIFY_EMAIL === 'true',
  NOTIFY_WHATSAPP:        e.NOTIFY_WHATSAPP === 'true',
  NOTIFY_ON_ALERT_ONLY:   e.NOTIFY_ON_ALERT_ONLY === 'true',
  EMAIL_PROVIDER:         e.EMAIL_PROVIDER as EmailProvider,
  EMAIL_FROM:             e.EMAIL_FROM,
  EMAIL_TO:               e.EMAIL_TO,
  SENDGRID_API_KEY:       e.SENDGRID_API_KEY,
  SMTP_HOST:              e.SMTP_HOST,
  SMTP_PORT:              parseInt(e.SMTP_PORT),
  SMTP_USER:              e.SMTP_USER,
  SMTP_PASS:              e.SMTP_PASS,
  WHATSAPP_TO:            e.WHATSAPP_TO,
  TWILIO_ACCOUNT_SID:     e.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN:      e.TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM:   e.TWILIO_WHATSAPP_FROM,
  ALERT_RSI_OVERSOLD:     parseFloat(e.ALERT_RSI_OVERSOLD),
  ALERT_RSI_OVERBOUGHT:   parseFloat(e.ALERT_RSI_OVERBOUGHT),
  ALERT_PRICE_DROP_PCT:   parseFloat(e.ALERT_PRICE_DROP_PCT),
  CIRCUIT_BREAKER_DROP_PCT: parseFloat(e.CIRCUIT_BREAKER_INDEX_DROP_PCT),
  PSXTERMINAL_API_KEY:    e.PSXTERMINAL_API_KEY,
  LOG_LEVEL:              e.LOG_LEVEL,
  NODE_ENV:               e.NODE_ENV,

  // Static — full KSE-100 top universe for discovery
  KSE100_UNIVERSE: [
    'MEBL','OGDC','HUBC','EFERT','ENGROH','FFC','LUCK','MARI','POL','SYS',
    'HBL','MCB','UBL','NBP','BAHL','PSO','PPL','ENGRO','DGKC','CHCC',
    'KAPCO','KEL','HCAR','PSMC','AGTL','MLCF','KOHC','PIOC','ACPL','FCCL',
    'SEARL','PKGS','PSEL','ILP','NESTLE','COLG','UNITY','BAFL','FABL','SILK',
  ],

  SHARIAH_COMPLIANT: new Set([
    'MEBL','BAHL','SILK','FABL',
    'EFERT','FFBL','FFC','ENGRO','ENGROH',
    'LUCK','DGKC','CHCC','MLCF','KOHC','PIOC','ACPL','FCCL',
    'PSO','HASCOL','AGTL','PSMC','HCAR',
    'SYS','TRG','NETSOL',
    'HUBC','KAPCO','KEL',
    'OGDC','MARI','POL','PPL',
    'NESTLE','COLG','UNITY',
  ]),
} as const;

const wSum = Object.values(CONFIG.WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(wSum - 1.0) > 0.001) {
  throw new Error(`Analysis weights must sum to 1.0, currently ${wSum.toFixed(3)}`);
}
