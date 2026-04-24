import { Pool } from 'pg';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { Holding } from '../types';

// ─── Fallback static portfolio (used when DB unavailable) ─────────────────────

export const STATIC_PORTFOLIO: Holding[] = [
  { symbol: 'MEBL',  ticker: 'MEBL',  shares: 1150, avgCost: 429.93, name: 'Meezan Bank',     sector: 'Banking',      type: 'psx' },
  { symbol: 'OGDC',  ticker: 'OGDC',  shares: 1100, avgCost: 266.29, name: 'OGDC',             sector: 'Oil & Gas',    type: 'psx' },
  { symbol: 'HUBC',  ticker: 'HUBC',  shares: 1100, avgCost: 191.85, name: 'Hub Power',        sector: 'Energy',       type: 'psx' },
  { symbol: 'EFERT', ticker: 'EFERT', shares: 900,  avgCost: 202.37, name: 'Engro Fertilizer', sector: 'Fertilizer',   type: 'psx' },
  { symbol: 'ENGROH',ticker: 'ENGROH',shares: 400,  avgCost: 279.51, name: 'Engro Holdings',   sector: 'Conglomerate', type: 'psx' },
  { symbol: 'FFC',   ticker: 'FFC',   shares: 400,  avgCost: 507.94, name: 'Fauji Fertilizer', sector: 'Fertilizer',   type: 'psx' },
  { symbol: 'LUCK',  ticker: 'LUCK',  shares: 300,  avgCost: 378.70, name: 'Lucky Cement',     sector: 'Cement',       type: 'psx' },
  { symbol: 'MARI',  ticker: 'MARI',  shares: 200,  avgCost: 635.00, name: 'Mari Petroleum',   sector: 'Oil & Gas',    type: 'psx' },
  { symbol: 'POL',   ticker: 'POL',   shares: 200,  avgCost: 639.18, name: 'Pakistan Oilfields',sector: 'Oil & Gas',   type: 'psx' },
  { symbol: 'SYS',   ticker: 'SYS',   shares: 750,  avgCost: 137.25, name: 'Systems Ltd',      sector: 'Technology',   type: 'psx' },
];

// ─── Portfolio Repository ─────────────────────────────────────────────────────

export class PortfolioRepository {
  private pool: Pool | null = null;

  constructor() {
    try {
      this.pool = new Pool({ connectionString: CONFIG.DB_CONNECTION_STRING });
      this.pool.on('error', (err) => logger.error({ err }, 'DB pool error'));
    } catch (err) {
      logger.warn({ err }, 'DB connection failed — using static portfolio');
    }
  }

  async getHoldings(): Promise<Holding[]> {
    if (!this.pool) return STATIC_PORTFOLIO;

    try {
      const { rows } = await this.pool.query<Holding>(
        `SELECT symbol, ticker, shares, avg_cost as "avgCost", name, sector, type
         FROM ${CONFIG.PORTFOLIO_TABLE}
         WHERE type = 'psx' AND shares > 0
         ORDER BY symbol`
      );
      if (rows.length === 0) {
        logger.warn('No holdings found in DB — using static portfolio');
        return STATIC_PORTFOLIO;
      }
      logger.info({ count: rows.length }, 'Loaded portfolio from DB');
      return rows;
    } catch (err) {
      logger.error({ err }, 'DB query failed — using static portfolio');
      return STATIC_PORTFOLIO;
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}
