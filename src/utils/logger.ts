import pino from 'pino';
import { CONFIG } from '../config';

export const logger = pino({
  level: CONFIG.LOG_LEVEL,
  transport:
    CONFIG.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  base: { service: 'psx-analyzer' },
});
