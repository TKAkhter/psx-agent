import pino from 'pino';
import { CONFIG } from '../config';

// Custom serializers to make logs easier to read
const serializers = {
  err: pino.stdSerializers.err,
  // Truncate long objects in logs
  rec: (r: unknown) => typeof r === 'object' && r !== null
    ? { ticker: (r as Record<string,unknown>).ticker, signal: (r as Record<string,unknown>).signal }
    : r,
};

export const logger = pino({
  level: CONFIG.LOG_LEVEL,
  serializers,
  transport: CONFIG.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize:         true,
          translateTime:    'SYS:HH:MM:ss',
          ignore:           'pid,hostname',
          messageFormat:    '{msg}',
          errorLikeObjectKeys: ['err', 'error'],
        },
      }
    : undefined,
  base: { service: 'psx-analyzer' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ─── Structured progress logger ───────────────────────────────────────────────
// Provides clean, readable output for each engine phase

export function logPhase(phase: string, detail?: Record<string, unknown>): void {
  logger.info({ phase, ...detail }, `▶ ${phase}`);
}

export function logPhaseOk(phase: string, detail?: Record<string, unknown>): void {
  logger.info({ phase, status: 'ok', ...detail }, `✅ ${phase}`);
}

export function logWarn(msg: string, detail?: Record<string, unknown>): void {
  logger.warn({ ...detail }, `⚠️  ${msg}`);
}

export function logError(msg: string, err: unknown, detail?: Record<string, unknown>): void {
  logger.error({ err, ...detail }, `❌ ${msg}`);
}

export function logSignal(ticker: string, signal: string, score: number, source: 'algo' | 'ai'): void {
  const EMOJI: Record<string, string> = {
    STRONG_BUY:'🟢🟢', BUY:'🟢', HOLD:'🟡', SELL:'🔴', STRONG_SELL:'🔴🔴',
  };
  logger.info({ ticker, signal, score, source }, `  ${EMOJI[signal] ?? '⚪'} ${ticker.padEnd(8)} ${signal.padEnd(12)} score=${score} [${source}]`);
}
